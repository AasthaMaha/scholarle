from pydantic import BaseModel, Field

from llm.client import llm
from nodes.readiness_matrix import build_application_readiness_matrix


class EligibilityCheck(BaseModel):
    requirement: str = Field(description="Scholarship requirement being checked.")
    status: str = Field(description="Met, Not met, Unclear, or Not applicable.")
    student_evidence: str = Field(description="Direct evidence from the student profile, or 'No student information provided.'")
    explanation: str = Field(description="Brief reason for the status.")


class MaterialCheck(BaseModel):
    material: str = Field(description="Required application material.")
    status: str = Field(description="Ready, Missing, Need to prepare, Need to confirm, or Not applicable.")
    notes: str = Field(description="Brief note based only on provided student information.")


class SelectionCriterionCheck(BaseModel):
    criterion: str = Field(description="Selection criterion from the scholarship record.")
    alignment: str = Field(description="Strong, Moderate, Weak, or Unclear.")
    student_evidence: str = Field(description="Direct student evidence, or 'No student information provided.'")
    notes: str = Field(description="Brief alignment explanation.")


class FitAnalysisResult(BaseModel):
    scholarship_name: str = Field(description="Scholarship name.")
    fit_label: str = Field(description="Strong Fit, Good Fit, Possible Fit, Weak Fit, Not Eligible, or Insufficient Information.")
    fit_score: int = Field(description="Integer fit score from 0 to 100.")
    likely_eligible: str = Field(description="Yes, No, or Unclear.")
    summary: str = Field(description="Concise overall fit explanation.")
    eligibility_analysis: list[EligibilityCheck] = Field(description="One check per stated eligibility requirement.")
    strengths: list[str] = Field(description="Relevant strengths supported by the profile.")
    gaps_or_risks: list[str] = Field(description="Eligibility problems, weak alignment, or risks.")
    missing_student_information: list[str] = Field(description="Student details needed to complete the fit analysis.")
    application_materials_check: list[MaterialCheck] = Field(description="Readiness check for required materials.")
    selection_criteria_alignment: list[SelectionCriterionCheck] = Field(description="Alignment against explicitly stated selection criteria.")
    recommended_next_steps: list[str] = Field(description="Practical next actions.")


def _model_dump(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.dict()


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
                "You are a scholarship fit analysis agent. Compare the provided student "
                "profile against the provided cleaned scholarship record. Do not search the "
                "web, write essays, invent student facts, invent scholarship requirements, or "
                "make recommendations beyond practical next steps. Use only the provided data. "
                "Separate eligibility from competitiveness. If student information is missing, "
                "mark the requirement as unclear rather than guessing. If the scholarship does "
                "not state a requirement, do not penalize the student for it. Keep the score "
                "conservative when eligibility is unclear and below 40 if a mandatory requirement "
                "is clearly not met.",
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
    score = data.get("fit_score", 0)
    try:
        score = max(0, min(100, int(score)))
    except (TypeError, ValueError):
        score = 0

    allowed_labels = {
        "Strong Fit",
        "Good Fit",
        "Possible Fit",
        "Weak Fit",
        "Not Eligible",
        "Insufficient Information",
    }
    fit_label = str(data.get("fit_label") or "").strip()
    if fit_label not in allowed_labels:
        fit_label = "Insufficient Information"

    eligible = str(data.get("likely_eligible") or "").strip()
    if eligible not in {"Yes", "No", "Unclear"}:
        eligible = "Unclear"

    cleaned = {
        "scholarship_name": str(data.get("scholarship_name") or "").strip(),
        "fit_label": fit_label,
        "fit_score": score,
        "likely_eligible": eligible,
        "summary": str(data.get("summary") or "").strip(),
        "eligibility_analysis": data.get("eligibility_analysis") or [],
        "strengths": data.get("strengths") or [],
        "gaps_or_risks": data.get("gaps_or_risks") or [],
        "missing_student_information": data.get("missing_student_information") or [],
        "application_materials_check": data.get("application_materials_check") or [],
        "selection_criteria_alignment": data.get("selection_criteria_alignment") or [],
        "recommended_next_steps": data.get("recommended_next_steps") or [],
    }
    cleaned["application_readiness_matrix"] = build_application_readiness_matrix(cleaned)
    return cleaned
