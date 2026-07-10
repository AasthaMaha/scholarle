from pydantic import BaseModel, Field

from llm.client import llm
from nodes.readiness_matrix import build_application_readiness_matrix

# Profile-fit only. Materials readiness is collected for later use but does NOT
# affect fit_score / fit_label.
ELIGIBILITY_WEIGHT = 0.65
CRITERIA_WEIGHT = 0.35

ELIGIBILITY_POINTS = {
    "met": 1.0,
    "unclear": 0.35,
    "not met": 0.0,
}

CRITERIA_POINTS = {
    "strong": 1.0,
    "moderate": 0.65,
    "weak": 0.30,
    "unclear": 0.35,
}

FIT_ANALYSIS_INSTRUCTIONS = (
    "You are a scholarship fit analysis agent. Compare the student profile against "
    "the cleaned scholarship record.\n\n"
    "Your job is evidence checking, NOT inventing a final score. Downstream code "
    "computes fit_score and fit_label from your structured statuses.\n\n"
    "Rules:\n"
    "- Use only provided data. Do not invent student facts or scholarship requirements.\n"
    "- Check every stated mandatory eligibility requirement. If the scholarship does "
    "not state a requirement, omit it (do not invent it).\n"
    "- For each eligibility item set status to exactly one of the following: Met, Not met, Unclear, "
    "Not applicable.\n"
    "- Use Not met only when profile evidence clearly conflicts with a stated "
    "mandatory requirement (for example undergrad vs postdoc, GPA below minimum, "
    "wrong citizenship).\n"
    "- Use Unclear when the profile lacks enough evidence to decide. Missing evidence "
    "is not the same as Not met.\n"
    "- Separately score stated selection criteria as Strong, Moderate, Weak, or Unclear.\n"
    "- Separate eligibility from competitiveness.\n"
    "- application_materials_check is optional for later use; leave it empty or minimal. "
    "Do not treat materials readiness as part of profile fit."
)


class EligibilityCheck(BaseModel):
    requirement: str = Field(description="Scholarship requirement being checked.")
    status: str = Field(description="Met, Not met, Unclear, or Not applicable.")
    student_evidence: str = Field(
        description="Direct evidence from the student profile, or 'No student information provided.'"
    )
    explanation: str = Field(description="Brief reason for the status.")


class MaterialCheck(BaseModel):
    material: str = Field(description="Required application material.")
    status: str = Field(
        description="Ready, Missing, Need to prepare, Need to confirm, or Not applicable."
    )
    notes: str = Field(description="Brief note based only on provided student information.")


class SelectionCriterionCheck(BaseModel):
    criterion: str = Field(description="Selection criterion from the scholarship record.")
    alignment: str = Field(description="Strong, Moderate, Weak, or Unclear.")
    student_evidence: str = Field(
        description="Direct student evidence, or 'No student information provided.'"
    )
    notes: str = Field(description="Brief alignment explanation.")


class FitAnalysisResult(BaseModel):
    scholarship_name: str = Field(description="Scholarship name.")
    summary: str = Field(description="Concise overall fit explanation based on eligibility and criteria.")
    eligibility_analysis: list[EligibilityCheck] = Field(
        description="One check per stated mandatory eligibility requirement."
    )
    strengths: list[str] = Field(description="Relevant strengths supported by the profile.")
    gaps_or_risks: list[str] = Field(description="Eligibility problems, weak alignment, or risks.")
    missing_student_information: list[str] = Field(
        description="Student details needed to complete the fit analysis."
    )
    application_materials_check: list[MaterialCheck] = Field(
        default_factory=list,
        description="Optional materials notes for later; not used in fit scoring.",
    )
    selection_criteria_alignment: list[SelectionCriterionCheck] = Field(
        description="Alignment against explicitly stated selection criteria."
    )
    recommended_next_steps: list[str] = Field(description="Practical next actions.")


def _model_dump(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.dict()


def _norm(value) -> str:
    return str(value or "").strip().lower()


def _label_for_score(score: int, has_clear_fail: bool) -> str:
    if score >= 90:
        return "Strong Fit"
    if score >= 75:
        return "Good Fit"
    if score >= 55:
        return "Possible Fit"
    if score >= 40:
        return "Weak Fit"
    return "Not Eligible" if has_clear_fail else "Insufficient Information"


def _average(points: list[float]) -> float | None:
    if not points:
        return None
    return sum(points) / len(points)


def compute_fit_score(
    eligibility_analysis: list,
    selection_criteria_alignment: list,
) -> tuple[int, str, str]:
    """
    Deterministic profile-fit score from structured statuses.

    Returns (fit_score, fit_label, likely_eligible).
    Materials readiness is intentionally ignored.
    """
    eligibility_rows = [item for item in (eligibility_analysis or []) if isinstance(item, dict)]
    criteria_rows = [item for item in (selection_criteria_alignment or []) if isinstance(item, dict)]

    active_eligibility = []
    eligibility_points: list[float] = []
    not_met_count = 0
    unclear_count = 0
    met_count = 0

    for item in eligibility_rows:
        status = _norm(item.get("status"))
        if status in {"not applicable", "n/a", ""}:
            continue
        active_eligibility.append(status)
        if status == "not met":
            not_met_count += 1
            eligibility_points.append(ELIGIBILITY_POINTS["not met"])
        elif status == "unclear":
            unclear_count += 1
            eligibility_points.append(ELIGIBILITY_POINTS["unclear"])
        elif status == "met":
            met_count += 1
            eligibility_points.append(ELIGIBILITY_POINTS["met"])
        else:
            # Unknown status treated as unclear, not as a hard fail.
            unclear_count += 1
            eligibility_points.append(ELIGIBILITY_POINTS["unclear"])

    criteria_points: list[float] = []
    for item in criteria_rows:
        alignment = _norm(item.get("alignment"))
        if alignment in {"not applicable", "n/a", ""}:
            continue
        criteria_points.append(CRITERIA_POINTS.get(alignment, CRITERIA_POINTS["unclear"]))

    has_clear_fail = not_met_count > 0
    active_count = len(active_eligibility)
    unclear_ratio = (unclear_count / active_count) if active_count else 1.0
    met_ratio = (met_count / active_count) if active_count else 0.0

    # Hard gate: any mandatory Not met => Not Eligible in 0-39.
    if has_clear_fail:
        # More failed hard requirements => lower score inside the band.
        score = max(5, 32 - (8 * not_met_count))
        return score, "Not Eligible", "No"

    # No usable eligibility checks and no criteria => insufficient information.
    if active_count == 0 and not criteria_points:
        return 20, "Insufficient Information", "Unclear"

    eligibility_avg = _average(eligibility_points)
    criteria_avg = _average(criteria_points)

    if eligibility_avg is None and criteria_avg is not None:
        combined = criteria_avg
    elif criteria_avg is None and eligibility_avg is not None:
        combined = eligibility_avg
    else:
        combined = (ELIGIBILITY_WEIGHT * eligibility_avg) + (CRITERIA_WEIGHT * criteria_avg)

    score = int(round(max(0.0, min(1.0, combined)) * 100))

    # Too much missing evidence to score confidently high.
    mostly_unclear = active_count > 0 and unclear_ratio >= 0.5 and met_ratio < 0.5
    if mostly_unclear:
        score = min(score, 39)
        return score, "Insufficient Information", "Unclear"

    # Moderate uncertainty: keep below Strong/Good unless evidence is solid.
    if active_count > 0 and unclear_ratio >= 0.4:
        score = min(score, 74)

    if met_ratio >= 0.8 and unclear_count == 0:
        likely_eligible = "Yes"
    elif met_ratio >= 0.5:
        likely_eligible = "Yes" if unclear_count == 0 else "Unclear"
    else:
        likely_eligible = "Unclear"

    label = _label_for_score(score, has_clear_fail=False)
    return score, label, likely_eligible


def analyze_fit(state):
    model = llm._get_client().with_structured_output(FitAnalysisResult)
    rag_context = "\n\n".join(
        f"[{item.get('source_type', 'memory')}] {item.get('text', '')}"
        for item in state.get("rag_context", [])[:8]
    )
    result = model.invoke(
        [
            (
                "system",
                FIT_ANALYSIS_INSTRUCTIONS,
            ),
            (
                "human",
                "Analyze fit using the cleaned scholarship record and student profile below.\n\n"
                f"Clean scholarship record:\n{state.get('scholarship_record', {})}\n\n"
                f"Student profile:\n{state.get('student_profile', {})}\n\n"
                f"Retrieved user memory context:\n{rag_context or 'No retrieved memory context.'}",
            ),
        ]
    )
    return {"fit_result": _model_dump(result)}


def clean_fit_result(state):
    data = state.get("fit_result") or {}
    eligibility_analysis = data.get("eligibility_analysis") or []
    selection_criteria_alignment = data.get("selection_criteria_alignment") or []

    score, fit_label, eligible = compute_fit_score(
        eligibility_analysis,
        selection_criteria_alignment,
    )

    cleaned = {
        "scholarship_name": str(data.get("scholarship_name") or "").strip(),
        "fit_label": fit_label,
        "fit_score": score,
        "likely_eligible": eligible,
        "summary": str(data.get("summary") or "").strip(),
        "eligibility_analysis": eligibility_analysis,
        "strengths": data.get("strengths") or [],
        "gaps_or_risks": data.get("gaps_or_risks") or [],
        "missing_student_information": data.get("missing_student_information") or [],
        "application_materials_check": data.get("application_materials_check") or [],
        "selection_criteria_alignment": selection_criteria_alignment,
        "recommended_next_steps": data.get("recommended_next_steps") or [],
    }
    cleaned["application_readiness_matrix"] = build_application_readiness_matrix(cleaned)
    return cleaned
