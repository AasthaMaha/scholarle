"""Shared Essay Workspace context helpers."""

from __future__ import annotations

from typing import Optional
import json


def _word_count(text: str) -> int:
    text = (text or "").strip()
    return len(text.split()) if text else 0


def scholarship_context(record: Optional[dict]) -> str:
    if not record:
        return ""
    keys = (
        "name",
        "organization",
        "type",
        "description",
        "selectionCriteria",
        "benefits",
        "financialNeedRequirement",
        "eligibleMajors",
        "otherEligibilityRules",
        "eligibilityRequirements",
        "essayPrompts",
        "otherRequiredMaterials",
        "requirementsPreview",
        "importantNotes",
        "additionalNotes",
        "fullText",
    )
    parts = []
    for key in keys:
        value = record.get(key)
        if not value:
            continue
        if isinstance(value, list):
            value = "; ".join(str(item) for item in value)
        parts.append(f"{key}: {value}")
    return "\n".join(parts)[:8000]


def profile_text(student_profile: Optional[dict]) -> str:
    if not student_profile:
        return ""
    text = student_profile.get("profile_text")
    if isinstance(text, str) and text.strip():
        return text[:8000]
    parts = []
    for key, value in student_profile.items():
        if isinstance(value, (str, int, float)) and str(value).strip():
            parts.append(f"{key}: {value}")
    return "\n".join(parts)[:8000]


def build_review_context(
    opportunity_text: str,
    profile: str,
    student_draft: str,
    opportunity_analysis: dict,
    submitted_summary: str = "",
) -> str:
    analysis_json = json.dumps(opportunity_analysis or {}, indent=2)
    summary_block = ""
    if submitted_summary:
        summary_block = f"""
VERBATIM SUBMITTED INPUT (the ONLY source for scores - read every character):
{submitted_summary}
"""
    return f"""
OPPORTUNITY TEXT:
{opportunity_text}

OPPORTUNITY ANALYSIS:
{analysis_json}
{summary_block}
STUDENT PROFILE EVIDENCE:
{profile}

STUDENT DRAFT ({_word_count(student_draft)} words):
{student_draft}
"""
