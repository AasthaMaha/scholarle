"""Narrow Essay Workspace editor helpers.

This module owns only background editor checks and selected-text transforms.
The full essay evaluation lives in `unified_coaching_service.py`.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from threading import Event, RLock, Thread
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
_LANGUAGE_TOOL_VERSION = "6.8"
_LANGUAGE_TOOL_EXCLUDED_CATEGORIES = {
    "COLLOQUIALISMS",
    "GENDER_NEUTRALITY",
    "PLAIN_ENGLISH",
    "REDUNDANCY",
    "STYLE",
}
_language_tool_instance = None
_language_tool_error: Optional[str] = None
_language_tool_state = "idle"
_language_tool_state_lock = RLock()
_language_tool_check_lock = RLock()
_language_tool_warmup_event = Event()
_language_tool_warmup_thread: Optional[Thread] = None
_FIX_PIPELINE_VERSION = "6"
logger = logging.getLogger(__name__)


class LanguageToolNotReadyError(RuntimeError):
    def __init__(self, status: str, message: str = ""):
        super().__init__(message or f"LanguageTool is {status}.")
        self.status = status


class SentenceSuggestion(BaseModel):
    original_text: str = ""
    suggested_text: str = ""
    suggestion_type: str = "clarity"
    reason: str = ""
    severity: str = "medium"
    source: str = "contextual_grammar"
    confidence: str = "medium"
    replacement_available: bool = True
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None


class LanguageToolCandidateReview(BaseModel):
    candidate_index: int = -1
    verdict: str = "reject"
    suggested_text: str = ""
    reason: str = ""
    confidence: str = "medium"


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
    candidate_reviews: list[LanguageToolCandidateReview] = Field(default_factory=list)


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
    protected_terms: Optional[list[str]] = None,
    strict_contextual: bool = False,
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
        # The instant browser checker safely handles the standalone pronoun I.
        # Reject one-character model anchors so an abbreviation such as i.e.
        # cannot be mistaken for that pronoun.
        if original.lower() == "i":
            continue
        hinted_start = _item_value(item, "start_offset")
        hinted_end = _item_value(item, "end_offset")
        start = -1
        if (
            isinstance(hinted_start, int)
            and isinstance(hinted_end, int)
            and hinted_end > hinted_start
            and draft[hinted_start:hinted_end] == original
        ):
            start = hinted_start
        else:
            matches = [match.start() for match in re.finditer(re.escape(original), draft)]
            # An unanchored repeated phrase is unsafe because the UI could
            # underline and replace the wrong occurrence.
            if len(matches) == 1:
                start = matches[0]
        if start < 0:
            continue
        if len(original) > (160 if strict_contextual else 500):
            continue
        risk = EDIT_RISK_TIERS.get(stype, "C2")
        if grammar_only and risk != "C0":
            continue
        if len(suggested) > max(len(original) * 3, len(original) + 160):
            continue
        raw_severity = str(_item_value(item, "severity") or "medium")
        severity = raw_severity if raw_severity in SENTENCE_SEVERITIES else "medium"
        confidence = str(_item_value(item, "confidence") or "medium").lower()
        reason = str(_item_value(item, "reason") or "").strip()
        if strict_contextual:
            if confidence != "high" or not reason:
                continue
            if len(original.split()) > 20:
                continue
            if abs(len(suggested) - len(original)) > 40:
                continue
            if len(original.split()) > 1 and SequenceMatcher(None, original, suggested).ratio() < 0.45:
                continue
            protected = _protected_words(protected_terms)
            removed_words = _protected_words([original]) - _protected_words([suggested])
            if protected.intersection(removed_words):
                continue
        key = (original.lower(), suggested.lower())
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(
            {
                "original_text": original,
                "suggested_text": suggested,
                "suggestion_type": stype,
                "reason": reason,
                "severity": severity,
                "risk_tier": risk,
                "source": str(_item_value(item, "source") or "contextual_grammar"),
                "confidence": confidence,
                "replacement_available": True,
                "start_offset": start,
                "end_offset": start + len(original),
            }
        )
        if len(cleaned) >= max_suggestions:
            break
    return cleaned


def _suggestion_overlaps_any(suggestion: dict, candidates: list[dict]) -> bool:
    start = suggestion.get("start_offset")
    end = suggestion.get("end_offset")
    if not isinstance(start, int) or not isinstance(end, int) or end <= start:
        return False
    for candidate in candidates or []:
        candidate_start = candidate.get("start_offset")
        candidate_end = candidate.get("end_offset")
        if not isinstance(candidate_start, int) or not isinstance(candidate_end, int) or candidate_end <= candidate_start:
            continue
        if start < candidate_end and end > candidate_start:
            return True
    return False


def _run_grammar(
    essay_draft: str,
    user_notes: str = "",
    language_tool_candidates: Optional[list[dict]] = None,
) -> dict:
    prompt_candidates = [
        {
            "candidate_index": index,
            "original_text": candidate.get("original_text", ""),
            "suggested_text": candidate.get("suggested_text", ""),
            "reason": candidate.get("reason", ""),
            "start_offset": candidate.get("start_offset"),
            "end_offset": candidate.get("end_offset"),
        }
        for index, candidate in enumerate(language_tool_candidates or [])
    ]
    system, human = build_grammar_prompt(
        essay_draft=essay_draft,
        user_notes=user_notes,
        language_tool_candidates_json=json.dumps(prompt_candidates, ensure_ascii=False),
    )
    model = llm._get_client().with_structured_output(GrammarOutput)
    result = model.invoke([("system", system), ("human", human)])
    data = result.model_dump()
    data["grammar_score"] = _clamp_score(data.get("grammar_score"))
    return data


_WORD_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")


def _protected_words(terms: Optional[list[str]]) -> set[str]:
    protected: set[str] = set()
    for term in terms or []:
        for match in _WORD_RE.finditer(str(term)):
            protected.add(match.group(0).replace("’", "'").lower())
    return protected


def language_tool_status() -> dict:
    """Return warm-up state immediately, even while Java is still starting."""
    with _language_tool_state_lock:
        return {
            "status": _language_tool_state,
            "ready": _language_tool_instance is not None,
            "error": _language_tool_error if _language_tool_state == "error" else None,
        }


def _initialize_language_tool_worker() -> None:
    """Create and warm the reusable local Java service outside the state lock."""
    global _language_tool_instance, _language_tool_error, _language_tool_state
    tool = None
    try:
        # A project-local conda JDK must win over an older system Java.
        environment_bin = os.path.join(sys.prefix, "bin")
        current_path = os.environ.get("PATH", "")
        if os.path.isfile(os.path.join(environment_bin, "java")):
            os.environ["PATH"] = f"{environment_bin}{os.pathsep}{current_path}"

        import language_tool_python

        tool = language_tool_python.LanguageTool(
            "en-US",
            language_tool_download_version=_LANGUAGE_TOOL_VERSION,
            config={
                "cacheSize": 1000,
                # The first Java pipeline build is much slower than later
                # checks, so it receives a wider one-time allowance.
                "maxCheckTimeMillis": 30000,
                "maxTextLength": 20000,
                "pipelineCaching": True,
            },
        )
        tool.check("LanguageTool is ready.")
        with _language_tool_state_lock:
            _language_tool_instance = tool
            _language_tool_error = None
            _language_tool_state = "ready"
    except Exception as exc:  # LanguageTool degrades independently
        if tool is not None:
            try:
                tool.close()
            except Exception:
                pass
        with _language_tool_state_lock:
            _language_tool_instance = None
            _language_tool_error = str(exc)
            _language_tool_state = "error"
    finally:
        _language_tool_warmup_event.set()


def start_language_tool_warmup() -> dict:
    """Start LanguageTool once in the background and return without waiting."""
    global _language_tool_error, _language_tool_state, _language_tool_warmup_thread
    with _language_tool_state_lock:
        if _language_tool_instance is not None:
            _language_tool_state = "ready"
            return language_tool_status()
        if (
            _language_tool_state == "warming"
            and _language_tool_warmup_thread is not None
            and _language_tool_warmup_thread.is_alive()
        ):
            return language_tool_status()

        _language_tool_error = None
        _language_tool_state = "warming"
        _language_tool_warmup_event.clear()
        thread = Thread(
            target=_initialize_language_tool_worker,
            name="scholar-e-language-tool-warmup",
            daemon=True,
        )
        _language_tool_warmup_thread = thread
        thread.start()
        return {"status": "warming", "ready": False, "error": None}


def initialize_language_tool(timeout: float = 60.0) -> bool:
    """Synchronously ensure readiness for scripts and acceptance tests."""
    state = start_language_tool_warmup()
    if state["ready"]:
        return True
    _language_tool_warmup_event.wait(timeout=timeout)
    return bool(language_tool_status()["ready"])


def close_language_tool() -> None:
    """Stop the local LanguageTool subprocess during API shutdown."""
    global _language_tool_instance, _language_tool_state
    with _language_tool_state_lock:
        thread = _language_tool_warmup_thread
    if thread is not None and thread.is_alive():
        thread.join(timeout=35)
    with _language_tool_state_lock:
        tool = _language_tool_instance
        _language_tool_instance = None
        _language_tool_state = "idle"
        if tool is not None:
            try:
                tool.close()
            except Exception:
                pass


def _get_language_tool():
    with _language_tool_state_lock:
        tool = _language_tool_instance
        status = _language_tool_state
        error = _language_tool_error
    if tool is not None:
        return tool
    if status == "idle":
        start_language_tool_warmup()
        status = "warming"
    raise LanguageToolNotReadyError(status, error or "LanguageTool is warming up.")


def _language_tool_suggestions(
    essay_draft: str,
    protected_terms: Optional[list[str]] = None,
    max_suggestions: int = 40,
) -> list[dict]:
    """Convert local LanguageTool matches into anchored, reviewable Fixes."""
    protected = _protected_words(protected_terms)
    tool = _get_language_tool()
    with _language_tool_check_lock:
        matches = tool.check(essay_draft)

    results: list[dict] = []
    occupied: list[tuple[int, int]] = []
    for match in matches:
        start = int(getattr(match, "offset", -1))
        length = int(getattr(match, "error_length", 0))
        end = start + length
        if start < 0 or length <= 0 or end > len(essay_draft):
            continue
        if any(start < used_end and end > used_start for used_start, used_end in occupied):
            continue

        category = str(getattr(match, "category", "") or "").upper()
        issue_type = str(getattr(match, "rule_issue_type", "") or "").lower()
        if category in _LANGUAGE_TOOL_EXCLUDED_CATEGORIES or issue_type == "style":
            continue

        original = essay_draft[start:end]
        is_spelling = category == "TYPOS" or issue_type == "misspelling"
        possible_proper_noun = bool(
            is_spelling
            and len(original) >= 3
            and re.fullmatch(r"[A-Z][A-Za-z'’-]*", original)
        )
        original_words = _protected_words([original])
        if is_spelling and original_words and original_words.issubset(protected):
            continue

        replacements = [str(value).strip() for value in (getattr(match, "replacements", []) or []) if str(value).strip()]
        replacement = replacements[0] if replacements else ""
        if replacement == original:
            continue
        replacement_available = bool(replacement)
        suggestion_type = (
            "spelling_name"
            if possible_proper_noun
            else "spelling"
            if is_spelling and replacement_available
            else "spelling_unknown"
            if is_spelling
            else "grammar"
        )
        confidence = "low" if possible_proper_noun or not replacement_available else "high"
        reason = str(getattr(match, "message", "") or "Review this language issue.")
        if possible_proper_noun:
            reason = "This capitalized word may be a name or place. Verify it before replacing it."
        occupied.append((start, end))
        results.append({
            "original_text": original,
            "suggested_text": replacement,
            "suggestion_type": suggestion_type,
            "reason": reason,
            "severity": "low" if possible_proper_noun else "medium" if is_spelling else "high",
            "risk_tier": "C1" if possible_proper_noun or not replacement_available else "C0",
            "source": "language_tool",
            "confidence": confidence,
            "replacement_available": replacement_available,
            "start_offset": start,
            "end_offset": end,
            "rule_id": str(getattr(match, "rule_id", "") or ""),
            "requires_contextual_review": not is_spelling,
        })
        if len(results) >= max_suggestions:
            break

    return results


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
    user_notes: str = "",
    protected_terms: Optional[list[str]] = None,
    draft_revision: str = "",
) -> dict:
    essay_draft = essay_draft or ""
    if not essay_draft.strip():
        return {
            "status": "error",
            "sentence_suggestions": [],
            "warnings": ["No essay draft provided."],
            "draft_revision": draft_revision,
        }

    warnings: list[str] = []
    deterministic: list[dict] = []
    try:
        deterministic = [
            suggestion
            for suggestion in _language_tool_suggestions(essay_draft, protected_terms)
            if not suggestion.get("requires_contextual_review", False)
        ]
    except LanguageToolNotReadyError as exc:
        if exc.status == "warming":
            return {
                "status": "warming",
                "sentence_suggestions": [],
                "warnings": [],
                "draft_revision": draft_revision,
                "language_tool_status": "warming",
                "retry_after_ms": 750,
            }
        warnings.append(f"LanguageTool check unavailable: {exc}")
    except Exception as exc:  # LanguageTool degrades independently
        warnings.append(f"LanguageTool check unavailable: {exc}")

    return {
        "status": "success" if not warnings else "partial" if deterministic else "error",
        "sentence_suggestions": deterministic,
        "warnings": warnings,
        "draft_revision": draft_revision,
        "language_tool_status": "ready" if not warnings else "error",
        "fix_pipeline_version": _FIX_PIPELINE_VERSION,
    }


def _reviewed_language_tool_suggestions(
    essay_draft: str,
    candidates: list[dict],
    reviews: list,
    protected_terms: Optional[list[str]],
) -> list[dict]:
    review_by_index = {
        int(_item_value(review, "candidate_index")): review
        for review in reviews or []
        if isinstance(_item_value(review, "candidate_index"), int)
    }
    approved: list[dict] = []
    for index, candidate in enumerate(candidates):
        review = review_by_index.get(index)
        is_spelling = str(candidate.get("suggestion_type") or "").startswith("spelling")
        # High-confidence spelling remains useful without AI approval.
        # Context-dependent grammar is withheld unless AI approves it.
        if review is None:
            if is_spelling:
                approved.append(candidate)
            continue

        verdict = str(_item_value(review, "verdict") or "reject").lower()
        confidence = str(_item_value(review, "confidence") or "medium").lower()
        if verdict == "reject" and confidence == "high":
            continue
        if verdict not in {"accept", "revise"} or confidence != "high":
            if is_spelling:
                approved.append(candidate)
            continue

        replacement = (
            str(_item_value(review, "suggested_text") or "").strip()
            if verdict == "revise"
            else str(candidate.get("suggested_text") or "").strip()
        )
        reviewed = {
            **candidate,
            "suggested_text": replacement,
            "reason": str(_item_value(review, "reason") or candidate.get("reason") or "").strip(),
            "confidence": "high",
            "source": "contextual_grammar",
        }
        cleaned = _clean_sentence_suggestions(
            essay_draft,
            [reviewed],
            writing_support_level="grammar_only",
            allowed_types={"grammar"},
            protected_terms=protected_terms,
            strict_contextual=True,
        )
        if cleaned:
            approved.extend(cleaned)
        elif is_spelling:
            approved.append(candidate)
    return approved


def _contextual_paragraph_spans(essay_draft: str) -> list[tuple[int, int]]:
    """Return meaningful prose blocks with exact offsets for a full scan."""
    spans: list[tuple[int, int]] = []
    block_start = 0
    for separator in re.finditer(r"\n\s*\n", essay_draft):
        raw_start, raw_end = block_start, separator.start()
        block_start = separator.end()
        raw = essay_draft[raw_start:raw_end]
        leading = len(raw) - len(raw.lstrip())
        trailing = len(raw) - len(raw.rstrip())
        start, end = raw_start + leading, raw_end - trailing
        if len(_WORD_RE.findall(essay_draft[start:end])) >= 4:
            spans.append((start, end))
    raw = essay_draft[block_start:]
    leading = len(raw) - len(raw.lstrip())
    trailing = len(raw) - len(raw.rstrip())
    start, end = block_start + leading, len(essay_draft) - trailing
    if len(_WORD_RE.findall(essay_draft[start:end])) >= 4:
        spans.append((start, end))
    return spans if len(spans) > 1 else [(0, len(essay_draft))]


def _contextual_segment_review(
    essay_draft: str,
    user_notes: str,
    language_tool_candidates: list[dict],
    protected_terms: Optional[list[str]],
) -> tuple[dict, list[dict]]:
    initial_grammar = _run_grammar(essay_draft, user_notes, language_tool_candidates)

    def suggestions_from(output: dict) -> list[dict]:
        independent = _clean_sentence_suggestions(
            essay_draft,
            output.get("sentence_suggestions") or [],
            writing_support_level="grammar_only",
            allowed_types={"grammar"},
            protected_terms=protected_terms,
            strict_contextual=True,
        )
        reviewed = _reviewed_language_tool_suggestions(
            essay_draft,
            language_tool_candidates,
            output.get("candidate_reviews") or [],
            protected_terms,
        )
        occupied = [(item.get("start_offset", -1), item.get("end_offset", -1)) for item in reviewed]
        return reviewed + [
            suggestion
            for suggestion in independent
            if not any(
                suggestion.get("start_offset", -1) < end
                and suggestion.get("end_offset", -1) > start
                for start, end in occupied
            )
        ]

    # A separate contextual QA pass validates the first pass's proposed edits
    # and independently scans every clause for errors the first pass and
    # LanguageTool may both have missed. Treat first-pass AI edits as review
    # candidates so no contextual correction reaches the UI on one model
    # judgment alone.
    initial_independent = _clean_sentence_suggestions(
        essay_draft,
        initial_grammar.get("sentence_suggestions") or [],
        writing_support_level="grammar_only",
        allowed_types={"grammar"},
        protected_terms=protected_terms,
        strict_contextual=True,
    )
    verification_candidates = list(language_tool_candidates)
    for suggestion in initial_independent:
        if not _suggestion_overlaps_any(suggestion, verification_candidates):
            verification_candidates.append(suggestion)

    verification_notes = (
        f"{user_notes}\n\n"
        "INDEPENDENT CONTEXTUAL QA: Validate every supplied candidate against "
        "its complete sentence, rejecting any change that would alter a "
        "grammatical noun phrase or clause. Independently audit every clause "
        "for missed subject-verb agreement, tense, auxiliary/modal, pronoun, "
        "capitalization, spelling, and punctuation errors. For each finite "
        "verb, identify its actual grammatical subject before deciding whether "
        "the verb agrees. Return an exact minimal suggestion for every "
        "high-confidence error you find."
    ).strip()
    grammar = _run_grammar(essay_draft, verification_notes, verification_candidates)
    language_tool_candidates = verification_candidates
    contextual = suggestions_from(grammar)
    issue_keys = (
        "spelling_issues",
        "punctuation_issues",
        "capitalization_issues",
        "verb_tense_issues",
        "agreement_issues",
        "other_grammar_issues",
        "sentence_level_correctness_issues",
    )
    reported_issues = list(dict.fromkeys(
        str(issue).strip()
        for key in issue_keys
        for issue in (grammar.get(key) or [])
        if str(issue).strip()
    ))
    if len(reported_issues) > len(contextual):
        retry_notes = (
            f"{user_notes}\n\n"
            "OUTPUT COMPLETENESS RETRY: The previous analysis diagnosed the "
            "following correctness issues but did not return an anchored "
            "sentence_suggestion for every one. Return exact, minimal, "
            "high-confidence corrections for all valid issues:\n- "
            + "\n- ".join(reported_issues)
        ).strip()
        retry = _run_grammar(essay_draft, retry_notes, language_tool_candidates)
        retry_suggestions = suggestions_from(retry)
        occupied = [
            (item.get("start_offset", -1), item.get("end_offset", -1))
            for item in contextual
        ]
        contextual.extend(
            suggestion
            for suggestion in retry_suggestions
            if not any(
                suggestion.get("start_offset", -1) < end
                and suggestion.get("end_offset", -1) > start
                for start, end in occupied
            )
        )
        grammar = _merge_grammar_feedback([(1, grammar), (1, retry)])
    return grammar, contextual


def _merge_grammar_feedback(parts: list[tuple[int, dict]]) -> dict:
    if not parts:
        return {}
    total_weight = sum(max(1, weight) for weight, _grammar in parts)
    merged: dict = {
        "grammar_score": round(sum(max(1, weight) * int(grammar.get("grammar_score") or 0) for weight, grammar in parts) / total_weight)
    }
    for key in (
        "spelling_issues",
        "punctuation_issues",
        "capitalization_issues",
        "verb_tense_issues",
        "agreement_issues",
        "other_grammar_issues",
        "sentence_level_correctness_issues",
        "revision_tasks",
    ):
        merged[key] = list(dict.fromkeys(
            str(item)
            for _weight, grammar in parts
            for item in (grammar.get(key) or [])
            if str(item).strip()
        ))
    return merged


def run_contextual_grammar_check(
    *,
    essay_draft: str,
    user_notes: str = "",
    protected_terms: Optional[list[str]] = None,
    draft_revision: str = "",
) -> dict:
    """Run the slower meaning-aware grammar pass independently from LanguageTool."""
    essay_draft = essay_draft or ""
    if not essay_draft.strip():
        return {
            "status": "error",
            "sentence_suggestions": [],
            "warnings": ["No essay draft provided."],
            "draft_revision": draft_revision,
        }

    warnings: list[str] = []
    grammar: dict = {}
    contextual: list[dict] = []
    language_tool_candidates: list[dict] = []
    try:
        try:
            language_tool_candidates = _language_tool_suggestions(essay_draft, protected_terms)
        except LanguageToolNotReadyError:
            language_tool_candidates = []
        spans = _contextual_paragraph_spans(essay_draft) if draft_revision.startswith("full:") else [(0, len(essay_draft))]

        def review_span(span: tuple[int, int]) -> tuple[int, dict, list[dict]]:
            start, end = span
            segment = essay_draft[start:end]
            local_candidates = [
                {
                    **candidate,
                    "start_offset": candidate["start_offset"] - start,
                    "end_offset": candidate["end_offset"] - start,
                }
                for candidate in language_tool_candidates
                if isinstance(candidate.get("start_offset"), int)
                and isinstance(candidate.get("end_offset"), int)
                and candidate["start_offset"] >= start
                and candidate["end_offset"] <= end
            ]
            segment_grammar, suggestions = _contextual_segment_review(
                segment, user_notes, local_candidates, protected_terms
            )
            for suggestion in suggestions:
                suggestion["start_offset"] += start
                suggestion["end_offset"] += start
            return len(segment), segment_grammar, suggestions

        if len(spans) > 1:
            with ThreadPoolExecutor(max_workers=min(4, len(spans))) as executor:
                segment_results = list(executor.map(review_span, spans))
        else:
            segment_results = [review_span(spans[0])]
        grammar = _merge_grammar_feedback([(weight, result) for weight, result, _items in segment_results])
        contextual = sorted(
            [item for _weight, _result, items in segment_results for item in items],
            key=lambda item: int(item.get("start_offset") or 0),
        )[:40]
        logger.info(
            "Contextual Fixes completed: segments=%d lt_candidates=%d final=%d",
            len(spans),
            len(language_tool_candidates),
            len(contextual),
        )
    except Exception as exc:  # LanguageTool remains independently useful
        warnings.append(f"Contextual grammar check unavailable: {exc}")

    return {
        "status": "success" if not warnings else "partial" if contextual else "error",
        "sentence_suggestions": contextual,
        "grammar_feedback": {
            key: value
            for key, value in grammar.items()
            if key not in {"sentence_suggestions", "candidate_reviews"}
        },
        "warnings": warnings,
        "draft_revision": draft_revision,
        "replaces_language_tool": True,
        "fix_pipeline_version": _FIX_PIPELINE_VERSION,
    }


def run_outline_coverage_check(
    *,
    essay_draft: str,
    clean_scholarship_record: Optional[dict] = None,
    outline_points: Optional[list] = None,
) -> dict:
    """Run conditional outline coverage independently from sentence Fixes."""
    essay_draft = (essay_draft or "").strip()
    if not essay_draft or not outline_points:
        return {"status": "success", "outline_coverage": {"covered_point_ids": []}, "warnings": []}
    coverage = run_outline_coverage(
        essay_draft,
        outline_points or [],
        scholarship_context(clean_scholarship_record),
    )
    return {"status": "success", "outline_coverage": coverage, "warnings": []}


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
