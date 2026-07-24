"""Schema-v5 Essay Workspace evaluation and coaching pipeline.

The Manager and all six scoring specialists are profile blind. Models answer
fixed rubric questions; Python calculates every score, level, weight, safeguard,
and overall result. A single profile-aware Revision Planner runs only after the
scoring decisions are locked.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from essay_context import (
    build_planner_context,
    build_scoring_contexts,
    canonicalize_essay_text,
    essay_evidence_passages,
    evaluation_fingerprint,
    profile_text as profile_text_from_payload,
    scholarship_context as build_scholarship_context,
    submission_readiness,
)
from essay_editor_service import run_outline_coverage
from nodes.coaching.criterion_review import (
    EVALUATOR_VERSION,
    REVISION_PLANNER_VERSION,
    audit_failed_criteria,
    calculate_overall_result,
    correction_guidance_for,
    criterion_audit_is_complete,
    normalize_criterion_review,
    normalize_manager_plan,
    planner_correction_guidance,
    run_action_guardrail,
    run_criterion_qa,
    run_criterion_review_agent,
    run_manager_agent,
    run_revision_planner,
)
from nodes.coaching.readiness import READINESS_DIMENSIONS
from opportunity_analysis import analyze_opportunity_text
from prompt_adaptation import format_brief_for_prompt, resolve_writing_brief
from rubrics.essay_rubric_v1 import RUBRIC_VERSION


Runner = Callable[[], Any]


def _opportunity_text(name: str, opportunity_type: str, prompt: str) -> str:
    return (
        f"Scholarship: {name or 'Scholarship opportunity'}\n"
        f"Type: {opportunity_type or 'Scholarship'}\n\n"
        f"{(prompt or '').strip()}"
    )


def _fallback_opportunity_analysis(record: dict, prompt: str) -> dict:
    requirements: list[str] = []
    for key in (
        "eligibilityRequirements",
        "requiredApplicationMaterials",
        "requiredDocumentTypes",
        "selectionCriteria",
    ):
        value = record.get(key)
        if isinstance(value, list):
            requirements.extend(str(item) for item in value if item)
        elif value:
            requirements.append(str(value))
    themes = record.get("selectionCriteria") or []
    if not isinstance(themes, list):
        themes = [str(themes)] if themes else []
    return {
        "opportunity_type": record.get("type") or "Scholarship",
        "requirements": list(dict.fromkeys(requirements)),
        "deadlines": [str(record["applicationDeadline"])]
        if record.get("applicationDeadline")
        else [],
        "evaluation_themes": [str(item) for item in themes if item],
        "prompt": prompt,
    }


def _run_parallel(
    jobs: dict[str, Runner],
    warnings: list[str],
    agent_status: dict[str, str],
    *,
    max_workers: int = 8,
) -> dict[str, Any]:
    results: dict[str, Any] = {}
    if not jobs:
        return results
    with ThreadPoolExecutor(max_workers=min(max_workers, len(jobs))) as pool:
        futures = {name: pool.submit(runner) for name, runner in jobs.items()}
        for name, future in futures.items():
            try:
                results[name] = future.result()
                agent_status[name] = "success"
            except Exception as exc:  # noqa: BLE001 - independent lanes degrade
                results[name] = None
                agent_status[name] = "error"
                warnings.append(f"{name} failed: {exc}")
    return results


def _manager_context(
    opportunity_text: str,
    opportunity_analysis: dict,
    scholarship_details: str,
    prompt_for_agents: str,
    word_limit: str,
) -> str:
    """Official source context only: no profile and no student essay."""
    return f"""SCHOLARSHIP INFORMATION:
{opportunity_text}

STRUCTURED OPPORTUNITY ANALYSIS:
{json.dumps(opportunity_analysis or {}, indent=2, default=str)}

OFFICIAL SCHOLARSHIP CONTEXT:
{scholarship_details or "(none provided)"}

ESSAY PROMPT AND WRITING BRIEF:
{prompt_for_agents or "(none provided)"}

WORD LIMIT:
    {word_limit or "(not stated)"}""".strip()


def _planner_requirement_signals(
    manager_plan: dict,
    selected_prompt: str,
    record: dict,
) -> list[dict[str, Any]]:
    """Provide the planner an auditable set of official prompt/criteria quotes."""
    signals = [
        dict(signal)
        for signal in manager_plan.get("source_signals") or []
        if isinstance(signal, dict) and str(signal.get("source_quote") or "").strip()
    ]
    prompt_parts = [
        part.strip()
        for part in re.split(r"(?<=[.!?])\s+|\n+", selected_prompt)
        if len(part.strip().split()) >= 3
    ]
    for part in prompt_parts:
        signals.append(
            {
                "criterion": "alignment",
                "signal_type": "prompt_ask",
                "source_field": "selected essay prompt",
                "source_quote": part,
                "construct": "A material part of the selected essay prompt.",
            }
        )
    criteria = record.get("selectionCriteria") or []
    if not isinstance(criteria, list):
        criteria = [criteria] if criteria else []
    for criterion in criteria:
        quote = str(criterion or "").strip()
        if quote:
            signals.append(
                {
                    "criterion": "alignment",
                    "signal_type": "selection_criterion",
                    "source_field": "selection criteria",
                    "source_quote": quote,
                    "construct": "An explicitly stated scholarship selection criterion.",
                }
            )
    unique: list[dict[str, Any]] = []
    seen = set()
    for signal in signals:
        identity = (
            str(signal.get("signal_type") or ""),
            " ".join(str(signal.get("source_quote") or "").casefold().split()),
        )
        if identity[1] and identity not in seen:
            seen.add(identity)
            unique.append(signal)
    return unique


def _hash_payload(value: Any) -> str:
    canonical = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


_INTERNAL_COACH_LANGUAGE = re.compile(
    r"\b(agent|backend|guardrail|grounding threshold|model output|pipeline|"
    r"prompt version|schema|structured output|validator|validation rule)\b",
    re.IGNORECASE,
)


def _public_coach_text(value: object, fallback: str = "") -> str:
    """Keep implementation language out of student-facing coaching copy."""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return fallback
    replacements = (
        (re.compile(r"\bprofile facts?\b", re.IGNORECASE), "profile details"),
        (re.compile(r"\bgrounded evidence\b", re.IGNORECASE), "specific evidence"),
        (re.compile(r"\bgrounded\b", re.IGNORECASE), "supported"),
        (re.compile(r"\bcriterion-specific\b", re.IGNORECASE), "focused"),
    )
    for pattern, replacement in replacements:
        text = pattern.sub(replacement, text)
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", text)
        if sentence.strip() and not _INTERNAL_COACH_LANGUAGE.search(sentence)
    ]
    return " ".join(sentences).strip() or fallback


def _public_criteria(reviews: dict[str, dict]) -> dict[str, dict]:
    public = json.loads(json.dumps(reviews, default=str))
    for review in public.values():
        feedback = review.get("coach_feedback") or {}
        feedback["grounded_praise"] = _public_coach_text(
            feedback.get("grounded_praise"),
            "The draft contains a useful foundation in this area.",
        )
        feedback["main_gap"] = _public_coach_text(
            feedback.get("main_gap"),
            "This area needs a more specific connection or example.",
        )
        gap = review.get("criterion_specific_gap") or {}
        gap["statement"] = _public_coach_text(
            gap.get("statement"),
            feedback["main_gap"],
        )
        for action in review.get("candidate_actions") or []:
            action["instruction"] = _public_coach_text(action.get("instruction"))
            action["completion_condition"] = _public_coach_text(
                action.get("completion_condition")
            )
        for answer in review.get("answers") or []:
            answer["explanation"] = _public_coach_text(answer.get("explanation"))
    return public


def _public_priorities(priorities: list[dict]) -> list[dict]:
    public = json.loads(json.dumps(priorities, default=str))
    for priority in public:
        priority["title"] = _public_coach_text(
            priority.get("title"), "Strengthen this passage"
        )
        priority["action"] = _public_coach_text(
            priority.get("action"),
            "Develop this passage with a specific, truthful detail.",
        )
        priority["completion_condition"] = _public_coach_text(
            priority.get("completion_condition"),
            "The passage directly and specifically addresses this priority.",
        )
        priority["priority_reason"] = _public_coach_text(
            priority.get("priority_reason"),
            "This change addresses a visible weakness in the current draft.",
        )
        priority["evidence_safety"] = _public_coach_text(
            priority.get("evidence_safety")
        )
    return public


def _quality_approved(review: dict) -> bool:
    """Backward-compatible full-review approval used for coaching cache hits."""
    return (
        review.get("schema_version") == 5
        and review.get("status") == "success"
        and bool((review.get("quality_review") or {}).get("approved"))
        and bool(
            (review.get("quality_review") or {}).get(
                "scoring_approved",
                (review.get("quality_review") or {}).get("approved"),
            )
        )
        and bool(
            (review.get("quality_review") or {}).get(
                "coaching_approved",
                (review.get("quality_review") or {}).get("approved"),
            )
        )
        and all(
            criterion_audit_is_complete(key, (review.get("criteria") or {}).get(key))
            for key in READINESS_DIMENSIONS
        )
    )


def _scoring_approved(review: dict) -> bool:
    quality = review.get("quality_review") or {}
    return (
        review.get("schema_version") == 5
        and review.get("status") in {"success", "scoring_success_coaching_partial"}
        and bool(quality.get("scoring_approved", quality.get("approved")))
        and review.get("overall_score") is not None
        and all(
            criterion_audit_is_complete(key, (review.get("criteria") or {}).get(key))
            for key in READINESS_DIMENSIONS
        )
    )


_EVIDENCE_TRANSLATION = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u201f": '"',
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
    }
)


def _canonicalize_evidence_text(value: str, *, quote: bool = False) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).translate(
        _EVIDENCE_TRANSLATION
    )
    if quote:
        text = text.strip().strip("\"'")
    return re.sub(r"\s+", " ", text).strip().casefold()


def _evidence_quote_exists(essay: str, quote: str) -> bool:
    normalized_quote = _canonicalize_evidence_text(quote, quote=True)
    normalized_essay = _canonicalize_evidence_text(essay)
    return bool(normalized_quote) and normalized_quote in normalized_essay


def _resolve_review_evidence(review: Any, essay_draft: str) -> Any:
    """Replace imperfect model transcription with its selected exact passage."""
    if not isinstance(review, dict):
        return review
    passages = essay_evidence_passages(essay_draft)
    evidence_lists = [
        answer.get("evidence")
        for answer in review.get("answers") or []
        if isinstance(answer, dict)
    ]
    gap = review.get("criterion_specific_gap") or {}
    if isinstance(gap, dict):
        evidence_lists.append(gap.get("evidence"))
    for evidence in evidence_lists:
        for item in evidence or []:
            if not isinstance(item, dict):
                continue
            quote = str(item.get("quote") or "")
            if _evidence_quote_exists(essay_draft, quote):
                continue
            passage_id = str(item.get("paragraph_id") or "").strip().lower()
            exact_passage = passages.get(passage_id)
            if exact_passage:
                item["quote"] = exact_passage
                item["resolved_from_passage_id"] = True
    return review


def _criterion_programmatic_errors(
    key: str, review: Any, essay_draft: str
) -> list[dict[str, str]]:
    review = review if isinstance(review, dict) else {}
    feedback = review.get("coach_feedback") or {}
    gap = review.get("criterion_specific_gap") or {}
    errors: list[dict[str, str]] = []
    if not review.get("available") or not criterion_audit_is_complete(key, review):
        errors.append(
            {
                "criterion": key,
                "error_code": "missing_rubric_answers",
                "question_id": "",
            }
        )
    if not all(
        str(value or "").strip()
        for value in (
            feedback.get("grounded_praise"),
            feedback.get("main_gap"),
            gap.get("statement"),
            gap.get("root_cause_tag"),
        )
    ):
        errors.append(
            {
                "criterion": key,
                "error_code": "missing_coach_feedback",
                "question_id": "",
            }
        )
    if not review.get("candidate_actions"):
        errors.append(
            {
                "criterion": key,
                "error_code": "missing_candidate_action",
                "question_id": "",
            }
        )
    for answer in review.get("answers") or []:
        question_id = str(answer.get("question_id") or "")
        if not str(answer.get("explanation") or "").strip():
            errors.append(
                {
                    "criterion": key,
                    "error_code": "missing_answer_explanation",
                    "question_id": question_id,
                }
            )
        value = answer.get("value")
        if value in {0.5, 1.0}:
            quotes = [
                str(item.get("quote") or "")
                for item in answer.get("evidence") or []
                if isinstance(item, dict)
            ]
            if not any(_evidence_quote_exists(essay_draft, quote) for quote in quotes):
                errors.append(
                    {
                        "criterion": key,
                        "error_code": "evidence_quote_not_found",
                        "question_id": question_id,
                    }
                )
    return errors


def _criterion_is_programmatically_valid(
    key: str, review: Any, essay_draft: str
) -> bool:
    return not _criterion_programmatic_errors(key, review, essay_draft)


def _programmatic_failed_criteria(reviews: dict, essay_draft: str) -> list[str]:
    return [
        key
        for key in READINESS_DIMENSIONS
        if not _criterion_is_programmatically_valid(
            key, reviews.get(key), essay_draft
        )
    ]


def _qa_scoring_approved(qa: dict) -> bool:
    return bool(qa.get("scoring_approved", qa.get("approved"))) and not (
        qa.get("failed_criteria") or []
    )


def _qa_planner_approved(qa: dict) -> bool:
    return bool(qa.get("planner_approved", qa.get("approved"))) and not bool(
        qa.get("planner_failed")
    )


def _accept_valid_repair(
    *,
    key: str,
    candidate: Any,
    reviews: dict,
    essay_draft: str,
    warnings: list[str],
    agent_status: dict[str, str],
    attempt_name: str,
) -> bool:
    """Replace a criterion only when the replacement passes every code check."""
    candidate = _resolve_review_evidence(candidate, essay_draft)
    if not _criterion_is_programmatically_valid(key, candidate, essay_draft):
        error_codes = sorted(
            {
                item["error_code"]
                for item in _criterion_programmatic_errors(
                    key, candidate, essay_draft
                )
            }
        )
        agent_status[attempt_name] = "invalid"
        warnings.append(
            f"{key} repair remained incomplete ({', '.join(error_codes)}); "
            "the invalid replacement was rejected."
        )
        return False
    reviews[key] = candidate
    agent_status[key] = "success"
    return True


def _progress_from_previous(previous_review: dict, reviews: dict, overall: dict) -> dict:
    if previous_review.get("schema_version") != 5:
        return {
            "has_previous_draft": False,
            "overall_change": 0,
            "criterion_changes": [],
            "resolved_gap_count": 0,
        }
    previous_criteria = previous_review.get("criteria") or {}
    changes = []
    resolved = 0
    for key in READINESS_DIMENSIONS:
        previous = previous_criteria.get(key) or {}
        current = reviews.get(key) or {}
        if previous.get("score") is None or current.get("score") is None:
            continue
        previous_gap = str(
            (previous.get("criterion_specific_gap") or {}).get("statement") or ""
        ).strip()
        current_gap = str(
            (current.get("criterion_specific_gap") or {}).get("statement") or ""
        ).strip()
        if previous_gap and current_gap and previous_gap != current_gap:
            resolved += 1
        changes.append(
            {
                "criterion": key,
                "label": current.get("short_label") or current.get("label") or key,
                "previous_score": previous.get("score"),
                "current_score": current.get("score"),
                "score_change": int(current.get("score")) - int(previous.get("score")),
                "previous_level": previous.get("level"),
                "current_level": current.get("level"),
                "level_changed": previous.get("level") != current.get("level"),
                "previous_gap_changed": bool(
                    previous_gap and current_gap and previous_gap != current_gap
                ),
            }
        )
    previous_score = previous_review.get("overall_score")
    current_score = overall.get("score")
    return {
        "has_previous_draft": bool(changes),
        "overall_change": (
            int(current_score) - int(previous_score)
            if current_score is not None and previous_score is not None
            else 0
        ),
        "criterion_changes": changes,
        "resolved_gap_count": resolved,
    }


def _build_review_result(
    *,
    manager_plan: dict,
    reviews: dict,
    revision_plan: dict,
    qa: dict,
    guardrail: dict,
    essay_draft: str,
    scoring_hash: str,
    coaching_hash: str,
    previous_review: dict,
    scoring_reused: bool,
    agent_status: Optional[dict[str, str]] = None,
    warnings: Optional[list[str]] = None,
    retry_attempts: Optional[dict[str, int]] = None,
) -> dict:
    overall = calculate_overall_result(reviews)
    validation_failed = _programmatic_failed_criteria(reviews, essay_draft)
    planner_available = bool(revision_plan.get("available"))
    scoring_approved = bool(
        overall.get("available")
        and not validation_failed
        and _qa_scoring_approved(qa)
    )
    coaching_approved = bool(
        scoring_approved
        and planner_available
        and _qa_planner_approved(qa)
        and bool(guardrail.get("approved"))
    )
    approved = scoring_approved and coaching_approved
    available_count = sum(
        bool((reviews.get(key) or {}).get("available")) for key in READINESS_DIMENSIONS
    )
    status = (
        "success"
        if approved
        else "scoring_success_coaching_partial"
        if scoring_approved
        else "partial"
        if available_count
        else "evaluation_unavailable"
    )
    published_overall = overall if scoring_approved else {}
    published_revision_plan = (
        revision_plan
        if coaching_approved
        else {"version": REVISION_PLANNER_VERSION, "priorities": [], "available": False}
    )
    public_reviews = _public_criteria(reviews)
    public_priorities = _public_priorities(
        published_revision_plan.get("priorities") or []
    )
    criterion_errors = [
        error
        for key in READINESS_DIMENSIONS
        for error in _criterion_programmatic_errors(
            key, reviews.get(key), essay_draft
        )
    ]
    failed_components = list(
        dict.fromkeys(
            [
                *validation_failed,
                *[
                    key
                    for key in qa.get("failed_criteria") or []
                    if key in READINESS_DIMENSIONS
                ],
            ]
        )
    )
    error_codes = [error["error_code"] for error in criterion_errors]
    failure_stage = ""
    if not scoring_approved:
        if validation_failed:
            failure_stage = "criterion_validation"
        elif not _qa_scoring_approved(qa):
            failure_stage = "scoring_qa"
            failed_components = failed_components or ["qa_critic"]
            error_codes.append("scoring_qa_rejected")
        else:
            failure_stage = "scoring_aggregation"
            error_codes.append("overall_score_unavailable")
    elif not coaching_approved:
        if not planner_available:
            failure_stage = "revision_planner"
            failed_components.append("revision_planner")
            error_codes.append("revision_planner_unavailable")
        elif not _qa_planner_approved(qa):
            failure_stage = "revision_plan_qa"
            failed_components.append("qa_critic")
            error_codes.append("revision_plan_qa_rejected")
        elif not guardrail.get("approved"):
            failure_stage = "guardrail"
            failed_components.append("guardrail_critic")
            error_codes.append("guardrail_rejected")
    diagnostics = {
        "failure_stage": failure_stage,
        "failed_components": list(dict.fromkeys(failed_components)),
        "error_codes": list(dict.fromkeys(error_codes)),
        "criterion_errors": criterion_errors,
        "retry_attempts": retry_attempts or {},
        "agent_status": agent_status or {},
        "warnings": list(dict.fromkeys(warnings or [])),
    }
    return {
        "schema_version": 5,
        "status": status,
        "status_message": (
            ""
            if status == "success"
            else (
                "Your essay review is ready, but the personalized revision "
                "suggestions could not be completed. Try Essay Review again."
            )
            if status == "scoring_success_coaching_partial"
            else (
                "We could not complete a reliable review of every area, so no "
                "new score was saved."
            )
            if status == "partial"
            else "Evaluation is currently unavailable."
        ),
        "overall_score": published_overall.get("score"),
        "overall_raw_score": published_overall.get("raw_score"),
        "overall_level": published_overall.get("level") or "Unavailable",
        "overall_safeguards": published_overall.get("applied_safeguards") or [],
        "criteria": public_reviews,
        "revision_priorities": public_priorities,
        "revision_plan": {
            **published_revision_plan,
            "priorities": public_priorities,
        },
        "manager_plan": manager_plan,
        "quality_review": {
            "approved": approved,
            "scoring_approved": scoring_approved,
            "coaching_approved": coaching_approved,
            "qa": qa,
            "guardrail": guardrail,
            "programmatic_failed_criteria": validation_failed,
            "planner_available": planner_available,
        },
        "diagnostics": diagnostics,
        "draft_progress": (
            _progress_from_previous(previous_review, reviews, overall)
            if scoring_approved
            else {
                "has_previous_draft": False,
                "overall_change": 0,
                "criterion_changes": [],
                "resolved_gap_count": 0,
            }
        ),
        "metadata": {
            "rubric_version": RUBRIC_VERSION,
            "evaluator_version": EVALUATOR_VERSION,
            "revision_planner_version": REVISION_PLANNER_VERSION,
            "scoring_fingerprint": scoring_hash,
            "coaching_fingerprint": coaching_hash,
            "scoring_reused": scoring_reused,
        },
    }


def _unavailable_review(status: str, message: str, reason_code: str) -> dict:
    return {
        "schema_version": 5,
        "status": status,
        "status_message": message,
        "reason_code": reason_code,
        "overall_score": None,
        "overall_raw_score": None,
        "overall_level": "Unavailable",
        "overall_safeguards": [],
        "criteria": {},
        "revision_priorities": [],
        "revision_plan": {"priorities": [], "available": False},
        "manager_plan": {},
        "quality_review": {
            "approved": False,
            "scoring_approved": False,
            "coaching_approved": False,
        },
        "diagnostics": {
            "failure_stage": reason_code,
            "failed_components": [],
            "error_codes": [reason_code],
            "criterion_errors": [],
            "retry_attempts": {},
            "agent_status": {},
            "warnings": [],
        },
        "draft_progress": {
            "has_previous_draft": False,
            "overall_change": 0,
            "criterion_changes": [],
            "resolved_gap_count": 0,
        },
        "metadata": {
            "rubric_version": RUBRIC_VERSION,
            "evaluator_version": EVALUATOR_VERSION,
            "revision_planner_version": REVISION_PLANNER_VERSION,
        },
    }


def run_unified_coaching_session(
    *,
    student_profile: Optional[dict] = None,
    clean_scholarship_record: Optional[dict] = None,
    essay_prompt: str = "",
    essay_draft: str = "",
    word_limit: str = "",
    outline_points: Optional[list] = None,
    profile_text: str = "",
    scholarship_name: str = "",
    scholarship_type: str = "Scholarship",
    opportunity_prompt: str = "",
    previous_manager_plan: Optional[dict] = None,
    previous_review: Optional[dict] = None,
) -> dict:
    """Run fixed-rubric scoring, consolidated coaching, and targeted QA."""
    readiness = submission_readiness(essay_draft)
    if not readiness["assessable"]:
        return {
            "review": _unavailable_review(
                str(readiness["status"]),
                str(readiness["message"]),
                str(readiness["reason_code"]),
            ),
            "outline_coverage": {},
            "warnings": [],
            "agent_status": {},
        }

    canonical_essay = canonicalize_essay_text(essay_draft)
    record = clean_scholarship_record or {}
    profile = (profile_text or profile_text_from_payload(student_profile) or "").strip()[
        :50000
    ]
    selected_prompt = (essay_prompt or opportunity_prompt or "").strip()
    scholarship_details = build_scholarship_context(record)
    if not selected_prompt and not scholarship_details:
        return {
            "review": _unavailable_review(
                "evaluation_unavailable",
                "Add or confirm an essay prompt before evaluating this draft.",
                "missing_evaluation_context",
            ),
            "outline_coverage": {},
            "warnings": [],
            "agent_status": {},
        }

    writing_brief = resolve_writing_brief(
        essay_prompt=selected_prompt,
        clean_scholarship_record=record,
        allow_scholarship_fallback=True,
    )
    prompt_for_agents = (
        f"{format_brief_for_prompt(writing_brief)}\n\n"
        f"SELECTED ESSAY PROMPT TEXT:\n"
        f"{selected_prompt or '(none — use scholarship-guided brief)'}"
    )
    opportunity_text = _opportunity_text(
        scholarship_name or record.get("name", ""),
        scholarship_type or record.get("type", "Scholarship"),
        opportunity_prompt or selected_prompt,
    )

    warnings: list[str] = []
    agent_status: dict[str, str] = {}
    retry_attempts: dict[str, int] = {}
    try:
        opportunity_analysis = analyze_opportunity_text(opportunity_text)
        agent_status["opportunity_analysis"] = "success"
    except Exception as exc:  # noqa: BLE001
        opportunity_analysis = _fallback_opportunity_analysis(
            record, opportunity_prompt or selected_prompt
        )
        agent_status["opportunity_analysis"] = "fallback"
        warnings.append(
            f"opportunity analysis failed; structured scholarship fallback used: {exc}"
        )

    manager_context = _manager_context(
        opportunity_text,
        opportunity_analysis,
        scholarship_details,
        prompt_for_agents,
        word_limit,
    )
    manager_context_hash = _hash_payload(
        {
            "opportunity_text": opportunity_text,
            "scholarship_context": scholarship_details,
            "prompt_for_agents": prompt_for_agents,
            "word_limit": word_limit or "",
            "rubric_version": RUBRIC_VERSION,
        }
    )
    previous_review = previous_review or {}
    prior_plan = (
        previous_review.get("manager_plan")
        if previous_review.get("schema_version") == 5
        else previous_manager_plan
    ) or {}
    if prior_plan.get("context_hash") == manager_context_hash:
        manager_plan = normalize_manager_plan(prior_plan, manager_context)
        agent_status["manager"] = "reused"
    else:
        try:
            manager_plan = run_manager_agent(manager_context)
            agent_status["manager"] = "success"
        except Exception as exc:  # noqa: BLE001
            manager_plan = normalize_manager_plan({})
            agent_status["manager"] = "fallback"
            warnings.append(f"manager failed; deterministic base rubric used: {exc}")
    manager_plan["context_hash"] = manager_context_hash
    planner_requirement_signals = _planner_requirement_signals(
        manager_plan,
        selected_prompt,
        record,
    )

    scoring_hash = evaluation_fingerprint(
        canonical_essay,
        prompt_text=prompt_for_agents,
        scholarship_context_text=(
            f"{scholarship_details}\nMANAGER CONTEXT HASH: {manager_context_hash}"
        ),
        rubric_version=RUBRIC_VERSION,
        evaluator_version=EVALUATOR_VERSION,
    )
    coaching_hash = _hash_payload(
        {
            "scoring_fingerprint": scoring_hash,
            "profile": canonicalize_essay_text(profile),
            "revision_planner_version": REVISION_PLANNER_VERSION,
        }
    )
    previous_metadata = previous_review.get("metadata") or {}
    if (
        _quality_approved(previous_review)
        and previous_metadata.get("coaching_fingerprint") == coaching_hash
    ):
        cached = dict(previous_review)
        cached["metadata"] = {
            **previous_metadata,
            "cache_hit": True,
            "scoring_reused": True,
        }
        return {
            "review": cached,
            "outline_coverage": {},
            "warnings": [],
            "agent_status": {
                **{key: "reused" for key in READINESS_DIMENSIONS},
                "manager": "reused",
                "revision_planner": "reused",
                "qa_critic": "reused",
                "guardrail_critic": "reused",
            },
        }

    scoring_contexts = build_scoring_contexts(
        essay_draft=canonical_essay,
        prompt_text=prompt_for_agents,
        scholarship_details=scholarship_details,
        opportunity_analysis=opportunity_analysis,
    )
    coaching_context = build_planner_context(
        essay_draft=canonical_essay,
        prompt_text=prompt_for_agents,
        scholarship_details=scholarship_details,
        profile=profile,
    )

    scoring_reused = (
        _scoring_approved(previous_review)
        and previous_metadata.get("scoring_fingerprint") == scoring_hash
    )
    if scoring_reused:
        reviews = {
            key: dict((previous_review.get("criteria") or {})[key])
            for key in READINESS_DIMENSIONS
        }
        for key in READINESS_DIMENSIONS:
            agent_status[key] = "reused"
        outline_coverage = {}
    else:
        jobs: dict[str, Runner] = {
            key: (
                lambda criterion=key: run_criterion_review_agent(
                    criterion,
                    scoring_contexts[criterion],
                    manager_plan["criteria"][criterion],
                )
            )
            for key in READINESS_DIMENSIONS
        }
        if outline_points:
            jobs["outline_coverage"] = lambda: run_outline_coverage(
                canonical_essay,
                outline_points or [],
                scholarship_details,
            )
        first_wave = _run_parallel(jobs, warnings, agent_status, max_workers=7)
        reviews = {
            key: (
                first_wave[key]
                if isinstance(first_wave.get(key), dict)
                else normalize_criterion_review(
                    key, {}, manager_plan["criteria"][key]
                )
            )
            for key in READINESS_DIMENSIONS
        }
        reviews = {
            key: _resolve_review_evidence(review, canonical_essay)
            for key, review in reviews.items()
        }
        outline_coverage = first_wave.get("outline_coverage") or {}

        programmatic_failed = _programmatic_failed_criteria(reviews, canonical_essay)
        if programmatic_failed:
            for key in programmatic_failed:
                retry_attempts[key] = retry_attempts.get(key, 0) + 1
            retry_jobs: dict[str, Runner] = {
                f"{key}_retry": (
                    lambda criterion=key: run_criterion_review_agent(
                        criterion,
                        scoring_contexts[criterion],
                        manager_plan["criteria"][criterion],
                        correction_guidance=(
                            "Return every applicable fixed question exactly once. "
                            "For each 0.5 or 1, cite one supplied backend-owned "
                            "evidence ID and its passage. Include an explanation, grounded praise, "
                            "one criterion-specific gap, and at least one atomic "
                            "candidate action."
                        ),
                        prior_review=reviews[criterion],
                    )
                )
                for key in programmatic_failed
            }
            repaired = _run_parallel(
                retry_jobs, warnings, agent_status, max_workers=6
            )
            for key in programmatic_failed:
                candidate = repaired.get(f"{key}_retry")
                _accept_valid_repair(
                    key=key,
                    candidate=candidate,
                    reviews=reviews,
                    essay_draft=canonical_essay,
                    warnings=warnings,
                    agent_status=agent_status,
                    attempt_name=f"{key}_retry",
                )

    scoring_failures = _programmatic_failed_criteria(reviews, canonical_essay)
    if scoring_failures:
        revision_plan = {"priorities": [], "available": False}
        agent_status["revision_planner"] = "blocked_by_invalid_scoring"
    else:
        try:
            revision_plan = run_revision_planner(
                coaching_context,
                reviews,
                official_signals=planner_requirement_signals,
            )
            agent_status["revision_planner"] = "success"
        except Exception as exc:  # noqa: BLE001
            revision_plan = {"priorities": [], "available": False}
            agent_status["revision_planner"] = "error"
            warnings.append(f"revision planner failed: {exc}")

    audit_jobs: dict[str, Runner] = {
        "qa_critic": lambda: run_criterion_qa(
            scoring_contexts, manager_plan, reviews, revision_plan
        )
    }
    if revision_plan.get("available"):
        audit_jobs["guardrail_critic"] = lambda: run_action_guardrail(
            coaching_context, reviews, revision_plan
        )
    else:
        agent_status["guardrail_critic"] = "blocked_by_revision_planner"
    audit_results = _run_parallel(
        audit_jobs,
        warnings,
        agent_status,
        max_workers=2,
    )
    qa = audit_results.get("qa_critic") or {
        "approved": False,
        "scoring_approved": False,
        "planner_approved": False,
        "failed_criteria": [],
        "planner_failed": not revision_plan.get("available"),
        "issues": ["QA Critic was unavailable."],
    }
    guardrail = audit_results.get("guardrail_critic") or {
        "approved": False,
        "unsafe_criteria": [],
        "planner_failed": not revision_plan.get("available"),
        "issues": [
            "Guardrail Critic was unavailable."
            if revision_plan.get("available")
            else "Guardrail Critic was blocked because revision priorities were unavailable."
        ],
    }

    failed = set(_programmatic_failed_criteria(reviews, canonical_essay))
    failed.update(audit_failed_criteria(qa, guardrail))
    failed_ordered = [key for key in READINESS_DIMENSIONS if key in failed]
    if failed_ordered and not scoring_reused:
        for key in failed_ordered:
            retry_attempts[key] = retry_attempts.get(key, 0) + 1
        retry_jobs = {
            f"{key}_audit_retry": (
                lambda criterion=key: run_criterion_review_agent(
                    criterion,
                    scoring_contexts[criterion],
                    manager_plan["criteria"][criterion],
                    correction_guidance=correction_guidance_for(
                        criterion, qa, guardrail
                    )
                    or (
                        "Correct the evidence-to-answer, praise, gap, and candidate "
                        "action chain identified by quality control."
                    ),
                    prior_review=reviews[criterion],
                )
            )
            for key in failed_ordered
        }
        repaired = _run_parallel(
            retry_jobs, warnings, agent_status, max_workers=6
        )
        for key in failed_ordered:
            candidate = repaired.get(f"{key}_audit_retry")
            _accept_valid_repair(
                key=key,
                candidate=candidate,
                reviews=reviews,
                essay_draft=canonical_essay,
                warnings=warnings,
                agent_status=agent_status,
                attempt_name=f"{key}_audit_retry",
            )
        if not _programmatic_failed_criteria(reviews, canonical_essay):
            try:
                revision_plan = run_revision_planner(
                    coaching_context,
                    reviews,
                    official_signals=planner_requirement_signals,
                )
                agent_status["revision_planner"] = "success"
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"revision planner repair failed: {exc}")

    planner_needs_repair = bool(
        not revision_plan.get("available")
        or not _qa_planner_approved(qa)
        or not guardrail.get("approved")
    )
    if planner_needs_repair and not _programmatic_failed_criteria(
        reviews, canonical_essay
    ):
        retry_attempts["revision_planner"] = (
            retry_attempts.get("revision_planner", 0) + 1
        )
        try:
            revision_plan = run_revision_planner(
                coaching_context,
                reviews,
                official_signals=planner_requirement_signals,
                correction_guidance=planner_correction_guidance(qa, guardrail)
                or "Make all priorities grounded, distinct, atomic, and safe.",
                prior_plan=revision_plan,
            )
            agent_status["revision_planner"] = "success"
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"revision planner correction failed: {exc}")

    needs_final_qa = bool(
        failed_ordered
        or not _qa_scoring_approved(qa)
        or planner_needs_repair
    )
    if needs_final_qa:
        retry_attempts["qa_critic"] = retry_attempts.get("qa_critic", 0) + 1
        final_audit_jobs: dict[str, Runner] = {
            "qa_critic_retry": lambda: run_criterion_qa(
                scoring_contexts, manager_plan, reviews, revision_plan
            )
        }
        if revision_plan.get("available"):
            retry_attempts["guardrail_critic"] = (
                retry_attempts.get("guardrail_critic", 0) + 1
            )
            final_audit_jobs["guardrail_critic_retry"] = (
                lambda: run_action_guardrail(
                    coaching_context, reviews, revision_plan
                )
            )
        final_audits = _run_parallel(
            final_audit_jobs,
            warnings,
            agent_status,
            max_workers=2,
        )
        qa = final_audits.get("qa_critic_retry") or qa
        guardrail = final_audits.get("guardrail_critic_retry") or guardrail

    review = _build_review_result(
        manager_plan=manager_plan,
        reviews=reviews,
        revision_plan=revision_plan,
        qa=qa,
        guardrail=guardrail,
        essay_draft=canonical_essay,
        scoring_hash=scoring_hash,
        coaching_hash=coaching_hash,
        previous_review=previous_review if not scoring_reused else {},
        scoring_reused=scoring_reused,
        agent_status=agent_status,
        warnings=warnings,
        retry_attempts=retry_attempts,
    )
    return {
        "review": review,
        "outline_coverage": outline_coverage,
        "warnings": list(dict.fromkeys(warnings)),
        "agent_status": agent_status,
    }
