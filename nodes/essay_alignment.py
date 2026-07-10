from __future__ import annotations

import re
from typing import Any


ALLOWED_STATUSES = {"Met", "Partially met", "Missing", "Unclear", "Not applicable"}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text))


def _tokens(text: str) -> set[str]:
    stop = {
        "the", "and", "or", "a", "an", "to", "of", "in", "for", "with", "on",
        "by", "from", "your", "you", "student", "scholarship", "essay", "must",
        "should", "will", "can", "that", "this", "their", "our", "about",
    }
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 2 and word not in stop}


def _evidence(requirement: str, essay: str) -> tuple[str, str, str]:
    req_tokens = _tokens(requirement)
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n+", essay) if p.strip()]
    best_index = -1
    best_score = 0
    best = ""
    for index, paragraph in enumerate(paragraphs):
        score = len(req_tokens & _tokens(paragraph))
        if score > best_score:
            best_score = score
            best_index = index
            best = paragraph

    if not req_tokens:
        return "Not applicable", "", ""
    if best_score >= max(2, min(4, len(req_tokens) // 3)):
        return "Met", best[:220], f"Paragraph {best_index + 1}"
    if best_score > 0:
        return "Partially met", best[:220], f"Paragraph {best_index + 1}"
    return "Missing", "", ""


def _risk(status: str) -> str:
    if status == "Met" or status == "Not applicable":
        return "Low"
    if status == "Partially met" or status == "Unclear":
        return "Medium"
    return "High"


def _row(requirement: str, requirement_type: str, essay: str, revision: str) -> dict[str, str]:
    status, evidence, location = _evidence(requirement, essay)
    return {
        "requirement": requirement,
        "requirement_type": requirement_type,
        "essay_evidence": evidence or "No clear essay evidence found.",
        "essay_location": location,
        "status": status if status in ALLOWED_STATUSES else "Unclear",
        "risk_level": _risk(status),
        "revision_needed": "" if status == "Met" else revision,
        "notes": "Checked against the current essay draft without adding new claims.",
    }


def _word_limit(prompt: str, scholarship_record: dict[str, Any]) -> int | None:
    text = " ".join(
        [
            prompt,
            _text(scholarship_record.get("essayPrompts")),
            _text(scholarship_record.get("otherRequiredMaterials")),
            _text(scholarship_record.get("requirementsPreview")),
        ]
    )
    matches = [int(match) for match in re.findall(r"(\d{2,4})\s*[-–]?\s*word", text, flags=re.I)]
    return max(matches) if matches else None


def _theme_requirements(state: dict[str, Any]) -> list[tuple[str, str, str]]:
    analysis = state.get("opportunity_analysis") or {}
    prompt = _text(state.get("opportunity_text"))
    requirements: list[tuple[str, str, str]] = []

    for requirement in analysis.get("requirements") or []:
        requirements.append((str(requirement), "Scholarship requirement", "Address this stated requirement directly in the essay if it belongs in the prompt."))
    for theme in analysis.get("evaluation_themes") or []:
        requirements.append((str(theme), "Selection criterion", "Add concrete evidence that supports this selection criterion."))

    theme_patterns = {
        "leadership": "Show a concrete leadership example and its impact.",
        "service": "Include a specific community service or contribution example.",
        "financial need": "Address financial need only if it is accurate and requested.",
        "career": "Connect the essay to career goals and the scholarship purpose.",
        "academic": "Connect academic preparation to the opportunity.",
        "research": "Describe research interests, methods, or outputs where relevant.",
        "challenge": "Explain the challenge, response, and growth.",
        "identity": "Discuss identity only if the prompt requests it and the student wants to include it.",
        "community": "Show community impact with specific evidence.",
    }
    lowered = prompt.lower()
    for key, revision in theme_patterns.items():
        if key in lowered:
            requirements.append((key.title(), "Required theme", revision))

    return requirements


def build_essay_alignment_matrix(state: dict[str, Any]) -> dict[str, Any]:
    essay = _text(state.get("student_draft"))
    if not essay:
        return {}

    scholarship_record = state.get("active_scholarship") or {}
    prompt = _text(state.get("opportunity_text"))
    word_count = _word_count(essay)
    limit = _word_limit(prompt, scholarship_record)
    rows = [
        _row(requirement, requirement_type, essay, revision)
        for requirement, requirement_type, revision in _theme_requirements(state)
        if requirement.strip()
    ]

    if not rows and prompt:
        rows.append(
            _row(
                "Respond to the main scholarship prompt",
                "Prompt coverage",
                essay,
                "Make the response more explicitly answer the prompt.",
            )
        )

    profile_text = _text(state.get("profile_text"))
    profile_overlap = len(_tokens(profile_text) & _tokens(essay))
    grounding_status = "Met" if profile_overlap >= 8 else "Partially met" if profile_overlap >= 3 else "Unclear"
    rows.append(
        {
            "requirement": "Use evidence that is supported by the student profile",
            "requirement_type": "Profile grounding",
            "essay_evidence": "Profile overlap found in the draft." if profile_overlap else "No obvious profile evidence matched the draft.",
            "essay_location": "",
            "status": grounding_status,
            "risk_level": _risk(grounding_status),
            "revision_needed": "" if grounding_status == "Met" else "Make sure important claims are backed by profile details or uploaded documents.",
            "notes": "This checks grounding, not writing style.",
        }
    )

    if limit:
        if word_count > limit:
            word_limit_status = "Over limit"
            status = "Missing"
            revision = f"Reduce the essay to {limit} words or fewer."
        elif word_count < max(80, int(limit * 0.35)):
            word_limit_status = "Underdeveloped"
            status = "Partially met"
            revision = "Develop the essay with more specific evidence while staying within the limit."
        else:
            word_limit_status = "Within limit"
            status = "Met"
            revision = ""
    else:
        word_limit_status = "No limit provided"
        status = "Not applicable"
        revision = ""

    rows.append(
        {
            "requirement": "Meet stated word limit or essay length guidance",
            "requirement_type": "Length / format",
            "essay_evidence": f"Current draft has {word_count} words.",
            "essay_location": "",
            "status": status,
            "risk_level": _risk(status),
            "revision_needed": revision,
            "notes": "No penalty is applied when no limit is provided.",
        }
    )

    active_rows = [row for row in rows if row["status"] != "Not applicable"]
    met = sum(1 for row in active_rows if row["status"] == "Met")
    partial = sum(1 for row in active_rows if row["status"] == "Partially met")
    completion = round(((met + partial * 0.5) / len(active_rows)) * 100) if active_rows else 0

    high_risk = [row for row in rows if row["risk_level"] == "High"]
    medium_risk = [row for row in rows if row["risk_level"] == "Medium"]
    if not active_rows:
        overall = "Insufficient information"
    elif high_risk:
        overall = "Major gaps"
    elif medium_risk or completion < 85:
        overall = "Needs revision"
    elif completion < 95:
        overall = "Mostly ready"
    else:
        overall = "Ready"

    missing_or_weak = [
        row["requirement"]
        for row in rows
        if row["status"] in {"Missing", "Partially met", "Unclear"}
    ]
    revision_tasks = [
        row["revision_needed"]
        for row in rows
        if row.get("revision_needed")
    ]

    return {
        "essay_id": "",
        "essay_version_id": str(state.get("draft_number") or ""),
        "opportunity_id": "",
        "overall_alignment_status": overall,
        "completion_percent": completion,
        "word_count": word_count,
        "word_limit_status": word_limit_status,
        "matrix": rows,
        "missing_or_weak_items": missing_or_weak,
        "unsupported_claims": [],
        "strengths": [
            row["requirement"]
            for row in rows
            if row["status"] == "Met" and row["requirement_type"] != "Length / format"
        ][:5],
        "recommended_revision_tasks": revision_tasks[:8],
        "final_submission_readiness": (
            "Ready for final review." if overall in {"Ready", "Mostly ready"} else "Revise before final submission."
        ),
    }


def essay_alignment_node(state: dict[str, Any]) -> dict[str, Any]:
    return {"essay_alignment_matrix": build_essay_alignment_matrix(state)}

