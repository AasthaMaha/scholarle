"""Narrow Essay Workspace editor helpers.

This module owns only background editor checks and selected-text transforms.
The full essay evaluation lives in `unified_coaching_service.py`.
"""

from __future__ import annotations

import json
from typing import Optional

from pydantic import BaseModel, Field

from essay_context import profile_text, scholarship_context
from llm.client import llm
from templates.essay_coach import (
    EDIT_RISK_TIERS,
    REWRITE_ACTIONS,
    SENTENCE_SEVERITIES,
    SENTENCE_TYPES,
    WRITING_SUPPORT_LEVELS,
    build_grammar_prompt,
    build_outline_coverage_prompt,
    build_rewrite_prompt,
)

_GRAMMAR_DEFAULT_MODES = frozenset({"workspace_refresh", "auto_check", "grammar_tone"})


class SentenceSuggestion(BaseModel):
    original_text: str = ""
    suggested_text: str = ""
    suggestion_type: str = "clarity"
    reason: str = ""
    severity: str = "medium"


class GrammarOutput(BaseModel):
    grammar_score: int = 0
    spelling_issues: list[str] = Field(default_factory=list)
    punctuation_issues: list[str] = Field(default_factory=list)
    capitalization_issues: list[str] = Field(default_factory=list)
    verb_tense_issues: list[str] = Field(default_factory=list)
    agreement_issues: list[str] = Field(default_factory=list)
    other_grammar_issues: list[str] = Field(default_factory=list)
    sentence_level_correctness_issues: list[str] = Field(default_factory=list)
    revision_tasks: list[str] = Field(default_factory=list)
    sentence_suggestions: list[SentenceSuggestion] = Field(default_factory=list)


class OutlineCoverageOutput(BaseModel):
    covered_point_ids: list[str] = Field(default_factory=list)


class RewriteOutput(BaseModel):
    rewritten_text: str = ""
    note: str = ""


def _clamp_score(value) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return 0


def _resolve_writing_support_level(mode: str, writing_support_level: str) -> str:
    level = writing_support_level if writing_support_level in WRITING_SUPPORT_LEVELS else ""
    if not level:
        level = "grammar_only" if mode in _GRAMMAR_DEFAULT_MODES else "sentence_polish"
    if mode in _GRAMMAR_DEFAULT_MODES and level != "grammar_only":
        return "grammar_only"
    return level


def _item_value(item, key: str):
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def _clean_sentence_suggestions(
    draft: str,
    suggestions: list,
    *,
    writing_support_level: str = "grammar_only",
    allowed_types: set[str] | None = None,
    max_suggestions: int = 40,
) -> list[dict]:
    cleaned: list[dict] = []
    seen: set[tuple[str, str]] = set()
    grammar_only = writing_support_level == "grammar_only"
    allowed = allowed_types or set(SENTENCE_TYPES)

    for item in suggestions or []:
        original = str(_item_value(item, "original_text") or "").strip()
        suggested = str(_item_value(item, "suggested_text") or "").strip()
        stype = str(_item_value(item, "suggestion_type") or "clarity").strip()
        if stype not in SENTENCE_TYPES:
            stype = "clarity"
        if stype not in allowed:
            continue
        if grammar_only and stype != "grammar":
            continue
        if not original or not suggested or original == suggested:
            continue
        if original not in draft:
            continue
        if len(original) > 500:
            continue
        risk = EDIT_RISK_TIERS.get(stype, "C2")
        if grammar_only and risk != "C0":
            continue
        if len(suggested) > max(len(original) * 3, len(original) + 160):
            continue
        raw_severity = str(_item_value(item, "severity") or "medium")
        severity = raw_severity if raw_severity in SENTENCE_SEVERITIES else "medium"
        key = (original.lower(), suggested.lower())
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(
            {
                "original_text": original,
                "suggested_text": suggested,
                "suggestion_type": stype,
                "reason": str(_item_value(item, "reason") or "").strip(),
                "severity": severity,
                "risk_tier": risk,
            }
        )
        if len(cleaned) >= max_suggestions:
            break
    return cleaned


def _run_grammar(essay_draft: str, user_notes: str = "") -> dict:
    system, human = build_grammar_prompt(
        essay_draft=essay_draft,
        user_notes=user_notes,
    )
    model = llm._get_client().with_structured_output(GrammarOutput)
    result = model.invoke([("system", system), ("human", human)])
    data = result.model_dump()
    data["grammar_score"] = _clamp_score(data.get("grammar_score"))
    return data


def run_outline_coverage(essay_draft: str, outline_points: list, context: str) -> dict:
    points = [{"id": p.get("id", ""), "label": p.get("label", "")} for p in (outline_points or []) if p.get("id")]
    if not points:
        return {"covered_point_ids": []}
    system, human = build_outline_coverage_prompt(
        essay_draft=essay_draft,
        outline_points_json=json.dumps(points, default=str)[:6000],
        scholarship_context=context,
    )
    model = llm._get_client().with_structured_output(OutlineCoverageOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    valid = {p["id"] for p in points}
    data["covered_point_ids"] = [i for i in (data.get("covered_point_ids") or []) if i in valid]
    return data


def run_editor_check(
    *,
    essay_draft: str,
    clean_scholarship_record: Optional[dict] = None,
    outline_points: Optional[list] = None,
    user_notes: str = "",
) -> dict:
    essay_draft = (essay_draft or "").strip()
    if not essay_draft:
        return {
            "status": "error",
            "sentence_suggestions": [],
            "outline_coverage": {},
            "warnings": ["No essay draft provided."],
        }

    grammar = _run_grammar(essay_draft, user_notes)
    suggestions = _clean_sentence_suggestions(
        essay_draft,
        grammar.get("sentence_suggestions") or [],
        writing_support_level="grammar_only",
        allowed_types={"grammar"},
    )
    coverage = (
        run_outline_coverage(
            essay_draft,
            outline_points or [],
            scholarship_context(clean_scholarship_record),
        )
        if outline_points
        else {}
    )
    return {
        "status": "success",
        "sentence_suggestions": suggestions,
        "grammar_feedback": {key: value for key, value in grammar.items() if key != "sentence_suggestions"},
        "outline_coverage": coverage,
        "warnings": [],
    }


def run_selection_rewrite(
    action: str,
    selected_text: str,
    surrounding_text: str = "",
    essay_prompt: str = "",
    clean_scholarship_record: Optional[dict] = None,
    student_profile: Optional[dict] = None,
) -> dict:
    selected_text = (selected_text or "").strip()
    if not selected_text:
        return {"status": "error", "rewritten_text": "", "note": "No text was selected."}
    action = action if action in REWRITE_ACTIONS else "rewrite"
    system, human = build_rewrite_prompt(
        action=action,
        selected_text=selected_text,
        surrounding_text=(surrounding_text or "")[:4000],
        essay_prompt=essay_prompt,
        scholarship_context=scholarship_context(clean_scholarship_record),
        profile_text=profile_text(student_profile),
    )
    try:
        model = llm._get_client().with_structured_output(RewriteOutput)
        data = model.invoke([("system", system), ("human", human)]).model_dump()
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "rewritten_text": "", "note": str(exc)}
    rewritten = str(data.get("rewritten_text") or "").strip()
    return {
        "status": "success" if rewritten else "error",
        "rewritten_text": rewritten,
        "note": data.get("note") or "",
    }
