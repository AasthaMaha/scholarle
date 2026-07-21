"""One Manager-first review pipeline for the Page 4 Essay Workspace.

Mechanical pre-correction remains owned by the API route. This service receives
that cleaned draft, creates one scholarship-specific rubric, runs seven
criterion-owned review agents in parallel, audits their result, and calculates
one deterministic weighted overall score.
"""

from __future__ import annotations

import json
import hashlib
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from essay_context import build_review_context
from essay_context import profile_text as profile_text_from_payload
from essay_context import scholarship_context as build_scholarship_context
from essay_editor_service import run_outline_coverage
from nodes.coaching.criterion_review import (
    audit_failed_criteria,
    correction_guidance_for,
    normalize_criterion_review,
    normalize_manager_plan,
    run_action_guardrail,
    run_criterion_qa,
    run_criterion_review_agent,
    run_manager_agent,
    weighted_overall_score,
)
from nodes.coaching.readiness import READINESS_DIMENSIONS
from opportunity_analysis import analyze_opportunity_text
from prompt_adaptation import format_brief_for_prompt, resolve_writing_brief
from utils.input_validation import summarize_submitted_input


Runner = Callable[[], Any]


def _opportunity_text(name: str, opportunity_type: str, prompt: str) -> str:
    return (
        f"Scholarship: {name or 'Scholarship opportunity'}\n"
        f"Type: {opportunity_type or 'Scholarship'}\n\n"
        f"{(prompt or '').strip()}"
    )


def _fallback_opportunity_analysis(record: dict, prompt: str) -> dict:
    requirements = []
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
            except Exception as exc:  # noqa: BLE001 - lanes degrade independently
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
    """Manager input is deliberately blind to the student profile and draft."""
    return f"""
SCHOLARSHIP INFORMATION:
{opportunity_text}

STRUCTURED OPPORTUNITY ANALYSIS:
{json.dumps(opportunity_analysis or {}, indent=2, default=str)}

SCHOLARSHIP CONTEXT:
{scholarship_details}

ESSAY PROMPT AND WRITING BRIEF:
{prompt_for_agents}

WORD LIMIT:
{word_limit or '(not stated)'}
""".strip()


def _programmatic_failed_criteria(reviews: dict) -> list[str]:
    failed = []
    for key in READINESS_DIMENSIONS:
        review = reviews.get(key) or {}
        assessment = review.get("assessment") or {}
        reviewer = review.get("reviewer_feedback") or {}
        action = review.get("priority_action") or {}
        if not review.get("available"):
            failed.append(key)
            continue
        required = (
            assessment.get("main_gap"),
            reviewer.get("likely_reaction"),
            reviewer.get("main_concern"),
            action.get("title"),
            action.get("how_to_fix"),
            action.get("why_this_addresses_the_reviewer"),
        )
        if not all(str(value or "").strip() for value in required):
            failed.append(key)
    return failed


def _build_review_result(
    manager_plan: dict,
    reviews: dict,
    qa: dict,
    guardrail: dict,
) -> dict:
    overall_score = weighted_overall_score(reviews)
    missing = [key for key in READINESS_DIMENSIONS if not reviews[key].get("available")]
    audit_ok = bool(qa.get("approved")) and bool(guardrail.get("approved"))
    available_count = len(READINESS_DIMENSIONS) - len(missing)
    status = "success" if not missing and audit_ok else "partial" if available_count else "error"
    quality_review = {
        "qa": qa,
        "guardrail": guardrail,
        "approved": audit_ok,
    }
    return {
        "schema_version": 2,
        "status": status,
        "overall_score": overall_score,
        "criteria": reviews,
        "manager_plan": manager_plan,
        "quality_review": quality_review,
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
) -> dict:
    """Run the Manager, seven criterion lanes, and two parallel critics."""
    essay_draft = (essay_draft or "").strip()
    if not essay_draft:
        return {
            "review": None,
            "outline_coverage": {},
            "warnings": ["No essay draft provided."],
            "agent_status": {},
        }

    record = clean_scholarship_record or {}
    profile = (profile_text or profile_text_from_payload(student_profile) or "").strip()[:50000]
    selected_prompt = (essay_prompt or opportunity_prompt or "").strip()
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
    scholarship_details = build_scholarship_context(record)
    opportunity_text = _opportunity_text(
        scholarship_name or record.get("name", ""),
        scholarship_type or record.get("type", "Scholarship"),
        opportunity_prompt or selected_prompt,
    )

    warnings: list[str] = []
    agent_status: dict[str, str] = {}
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

    submitted_summary = summarize_submitted_input(
        profile,
        essay_draft,
        scholarship_name or record.get("name", ""),
        opportunity_prompt or selected_prompt,
    )
    shared_context = build_review_context(
        opportunity_text,
        profile or "(none provided)",
        essay_draft,
        opportunity_analysis,
        submitted_summary=submitted_summary,
    )

    manager_context = _manager_context(
        opportunity_text,
        opportunity_analysis,
        scholarship_details,
        prompt_for_agents,
        word_limit,
    )
    # Fingerprint deterministic scholarship/prompt inputs only. The structured
    # opportunity analysis may be LLM-generated and must not invalidate an
    # otherwise unchanged rubric between draft revisions.
    manager_fingerprint = json.dumps(
        {
            "opportunity_text": opportunity_text,
            "scholarship_context": scholarship_details,
            "prompt_for_agents": prompt_for_agents,
            "word_limit": word_limit or "",
        },
        sort_keys=True,
    )
    manager_context_hash = hashlib.sha256(manager_fingerprint.encode("utf-8")).hexdigest()
    prior_plan = previous_manager_plan or {}
    if prior_plan.get("context_hash") == manager_context_hash:
        manager_plan = normalize_manager_plan(prior_plan)
        agent_status["manager"] = "reused"
    else:
        try:
            manager_plan = run_manager_agent(manager_context)
            agent_status["manager"] = "success"
        except Exception as exc:  # noqa: BLE001
            manager_plan = normalize_manager_plan({})
            agent_status["manager"] = "fallback"
            warnings.append(f"manager failed; balanced fallback rubric used: {exc}")
    manager_plan["context_hash"] = manager_context_hash

    jobs: dict[str, Runner] = {
        key: (
            lambda criterion=key: run_criterion_review_agent(
                criterion,
                shared_context,
                manager_plan["criteria"][criterion],
            )
        )
        for key in READINESS_DIMENSIONS
    }
    if outline_points:
        jobs["outline_coverage"] = lambda: run_outline_coverage(
            essay_draft,
            outline_points or [],
            scholarship_details,
        )
    first_wave = _run_parallel(jobs, warnings, agent_status, max_workers=8)
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
    outline_coverage = first_wave.get("outline_coverage") or {}

    critic_jobs: dict[str, Runner] = {
        "qa_critic": lambda: run_criterion_qa(shared_context, manager_plan, reviews),
        "guardrail_critic": lambda: run_action_guardrail(shared_context, reviews),
    }
    audits = _run_parallel(critic_jobs, warnings, agent_status, max_workers=2)
    qa = audits.get("qa_critic") or {
        "approved": False,
        "failed_criteria": [],
        "issues": ["QA Critic was unavailable."],
    }
    guardrail = audits.get("guardrail_critic") or {
        "approved": False,
        "unsafe_criteria": [],
        "issues": ["Guardrail Critic was unavailable."],
    }

    failed = set(_programmatic_failed_criteria(reviews))
    failed.update(audit_failed_criteria(qa, guardrail))
    failed_ordered = [key for key in READINESS_DIMENSIONS if key in failed]
    if failed_ordered:
        retry_jobs: dict[str, Runner] = {}
        for key in failed_ordered:
            guidance = correction_guidance_for(key, qa, guardrail)
            if key in _programmatic_failed_criteria(reviews):
                guidance = (
                    guidance + " " if guidance else ""
                ) + (
                    "Return every required field: a valid score, main gap, reviewer reaction, "
                    "reviewer concern, and one specific aligned priority action."
                )
            retry_jobs[f"{key}_retry"] = (
                lambda criterion=key, notes=guidance: run_criterion_review_agent(
                    criterion,
                    shared_context,
                    manager_plan["criteria"][criterion],
                    correction_guidance=notes,
                    prior_review=reviews[criterion],
                )
            )
        repaired = _run_parallel(retry_jobs, warnings, agent_status, max_workers=7)
        for key in failed_ordered:
            candidate = repaired.get(f"{key}_retry")
            if isinstance(candidate, dict):
                reviews[key] = candidate
                agent_status[key] = "success"

        final_audits = _run_parallel(
            {
                "qa_critic_retry": lambda: run_criterion_qa(
                    shared_context, manager_plan, reviews
                ),
                "guardrail_critic_retry": lambda: run_action_guardrail(
                    shared_context, reviews
                ),
            },
            warnings,
            agent_status,
            max_workers=2,
        )
        qa = final_audits.get("qa_critic_retry") or qa
        guardrail = final_audits.get("guardrail_critic_retry") or guardrail

    review = _build_review_result(
        manager_plan,
        reviews,
        qa,
        guardrail,
    )
    return {
        "review": review,
        "outline_coverage": outline_coverage,
        "warnings": list(dict.fromkeys(warnings)),
        "agent_status": agent_status,
    }
