from __future__ import annotations

from typing import Any


def _text(value: Any) -> str:
    value = "" if value is None else str(value).strip()
    return "" if value.lower() == "not stated" else value


def _lines(title: str, fields: list[tuple[str, Any]], lists: list[tuple[str, list[Any]]] | None = None) -> str:
    parts = [title]
    for label, value in fields:
        clean = _text(value)
        if clean:
            parts.append(f"{label}: {clean}")
    for label, values in lists or []:
        clean_values = [_text(item) for item in values or []]
        clean_values = [item for item in clean_values if item]
        if clean_values:
            parts.append(f"{label}:")
            parts.extend(f"- {item}" for item in clean_values)
    return "\n".join(parts)


def build_profile_memory_text(profile: dict[str, Any]) -> str:
    undergrad = profile.get("undergrad") or {}
    graduate = profile.get("graduate") or {}
    optional = profile.get("optional") or {}
    return _lines(
        "Student Profile:",
        [
            ("Name", profile.get("name")),
            ("Degree Level", profile.get("educationLevel")),
            ("University", graduate.get("institution") or undergrad.get("institution")),
            ("Field of Study", graduate.get("researchArea") or graduate.get("program") or undergrad.get("major")),
            ("Citizenship", profile.get("citizenshipStatus") or profile.get("nationality")),
            ("Location", profile.get("location")),
            ("GPA", graduate.get("gpa") or undergrad.get("gpa")),
            ("Career Goal", profile.get("careerGoal")),
        ],
        [
            ("Skills", profile.get("skills") or []),
            ("Leadership", [optional.get("leadership")]),
            ("Projects", [optional.get("projects")]),
        ],
    )


def build_scholarship_memory_text(clean_record: dict[str, Any]) -> str:
    return _lines(
        "Scholarship:",
        [
            ("Name", clean_record.get("name")),
            ("Organization", clean_record.get("organization")),
            ("Award", clean_record.get("awardAmount")),
            ("Deadline", clean_record.get("applicationDeadline")),
            ("Status", clean_record.get("currentStatus")),
            ("Description", clean_record.get("description")),
        ],
        [
            ("Eligibility Requirements", clean_record.get("eligibilityRequirements") or []),
            ("Required Materials", clean_record.get("requiredApplicationMaterials") or []),
            ("Benefits", clean_record.get("benefits") or []),
            ("Selection Criteria", clean_record.get("selectionCriteria") or []),
            ("Application Process", clean_record.get("applicationProcess") or []),
        ],
    )


def build_essay_memory_text(essay_version: dict[str, Any]) -> str:
    return _lines(
        "Essay Draft:",
        [
            ("Title", essay_version.get("title")),
            ("Prompt", essay_version.get("prompt_text")),
            ("Word Count", essay_version.get("word_count")),
            ("Draft", essay_version.get("draft_text")),
        ],
    )


def build_feedback_memory_text(feedback: dict[str, Any]) -> str:
    return _lines(
        "Feedback Summary:",
        [
            ("Summary", feedback.get("summary") or feedback.get("feedback")),
            ("Fit Label", feedback.get("fit_label")),
            ("Fit Score", feedback.get("fit_score")),
            ("Likely Eligible", feedback.get("likely_eligible")),
        ],
        [
            ("Strengths", feedback.get("strengths") or []),
            ("Gaps or Risks", feedback.get("gaps_or_risks") or []),
            ("Next Steps", feedback.get("recommended_next_steps") or []),
        ],
    )


def build_saved_source_memory_text(source: dict[str, Any]) -> str:
    return _lines(
        "Saved Scholarship Source:",
        [
            ("Name", source.get("name")),
            ("URL", source.get("url")),
            ("Category", source.get("category")),
            ("Notes", source.get("notes")),
        ],
        [("Tags", source.get("tags") or source.get("best_for") or [])],
    )

