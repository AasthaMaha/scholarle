"""Shared Essay Workspace context helpers."""

from __future__ import annotations

from typing import Optional
import hashlib
import json
import re
import unicodedata

from nodes.coaching.readiness import READINESS_DIMENSIONS


def _word_count(text: str) -> int:
    text = (text or "").strip()
    return len(text.split()) if text else 0


def canonicalize_essay_text(text: str) -> str:
    """Ignore presentation-only differences while preserving scored meaning."""
    value = unicodedata.normalize("NFKC", str(text or ""))
    value = value.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    value = re.sub(r"[\u200b-\u200d\uFEFF]", "", value)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.split("\n")]
    output: list[str] = []
    pending_blank = False
    for line in lines:
        if not line:
            pending_blank = bool(output)
            continue
        if pending_blank:
            output.append("")
        output.append(line)
        pending_blank = False
    return "\n".join(output).strip()


def essay_evidence_passages(text: str) -> dict[str, str]:
    """Create stable paragraph and sentence IDs owned by backend code."""
    canonical = canonicalize_essay_text(text)
    passages: dict[str, str] = {}
    for paragraph_index, paragraph in enumerate(
        [part.strip() for part in canonical.split("\n\n") if part.strip()],
        start=1,
    ):
        paragraph_id = f"p{paragraph_index}"
        passages[paragraph_id] = paragraph
        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", paragraph)
            if sentence.strip()
        ]
        for sentence_index, sentence in enumerate(sentences, start=1):
            passages[f"{paragraph_id}.s{sentence_index}"] = sentence
    return passages


def evidence_indexed_essay(text: str) -> str:
    """Present exact backend-owned passage IDs to scoring specialists."""
    passages = essay_evidence_passages(text)
    sentence_items = [
        (passage_id, passage)
        for passage_id, passage in passages.items()
        if ".s" in passage_id
    ]
    if sentence_items:
        return "\n".join(
            f"[{passage_id}] {passage}" for passage_id, passage in sentence_items
        )
    return "\n".join(
        f"[{passage_id}] {passage}"
        for passage_id, passage in passages.items()
    )


def evaluation_fingerprint(
    essay_text: str,
    *,
    prompt_text: str,
    scholarship_context_text: str,
    rubric_version: str,
    evaluator_version: str,
) -> str:
    payload = json.dumps(
        {
            "essay": canonicalize_essay_text(essay_text),
            "prompt": canonicalize_essay_text(prompt_text),
            "scholarship_context": canonicalize_essay_text(scholarship_context_text),
            "rubric_version": rubric_version,
            "evaluator_version": evaluator_version,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


_PLACEHOLDER_ONLY_RE = re.compile(
    r"^(?:\s|[-*_#]|\[?(?:todo|tbd|placeholder|insert(?:\s+\w+){0,5}|"
    r"write(?:\s+\w+){0,5}\s+here)\]?|lorem\s+ipsum)+$",
    flags=re.IGNORECASE,
)


def submission_readiness(essay_text: str) -> dict[str, str | bool]:
    canonical = canonicalize_essay_text(essay_text)
    if not canonical:
        return {
            "assessable": False,
            "status": "insufficient_to_assess",
            "reason_code": "blank_submission",
            "message": "Not enough content to assess",
        }
    if _PLACEHOLDER_ONLY_RE.fullmatch(canonical):
        return {
            "assessable": False,
            "status": "insufficient_to_assess",
            "reason_code": "placeholders_only",
            "message": "Not enough content to assess",
        }
    return {
        "assessable": True,
        "status": "ready",
        "reason_code": "",
        "message": "",
    }


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


def build_scoring_contexts(
    *,
    essay_draft: str,
    prompt_text: str,
    scholarship_details: str,
    opportunity_analysis: dict,
) -> dict[str, str]:
    """Build the six strict, profile-blind scorer contexts."""
    essay_block = f"""STUDENT ESSAY ({_word_count(essay_draft)} words):
Each sentence has a backend-owned evidence ID. Use the exact ID when citing it.
{evidence_indexed_essay(essay_draft)}"""
    contexts = {
        "alignment": f"""ESSAY PROMPT / WRITING BRIEF:
{prompt_text or "(none provided)"}

OFFICIAL SCHOLARSHIP CRITERIA:
{scholarship_details or "(none provided)"}

STRUCTURED OPPORTUNITY ANALYSIS:
{json.dumps(opportunity_analysis or {}, indent=2, default=str)}

{essay_block}""",
        "evidence_strength": f"""ESSAY PROMPT / WRITING BRIEF:
{prompt_text or "(none provided)"}

{essay_block}""",
        "insight": essay_block,
        "narrative_structure_flow_coherence": essay_block,
        "tone_authenticity": essay_block,
        "clarity_concision": essay_block,
    }
    return {key: contexts[key] for key in READINESS_DIMENSIONS}


def build_planner_context(
    *,
    essay_draft: str,
    prompt_text: str,
    scholarship_details: str,
    profile: str,
) -> str:
    """Build the profile-aware context used only after scores are locked."""
    return f"""ESSAY PROMPT / WRITING BRIEF:
{prompt_text or "(none provided)"}

OFFICIAL SCHOLARSHIP CONTEXT:
{scholarship_details or "(none provided)"}

STUDENT ESSAY:
{essay_draft}

RELEVANT STUDENT PROFILE FACTS (COACHING ONLY; NEVER PART OF A SCORE):
{profile or "(none provided)"}
""".strip()
