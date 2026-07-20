"""Single-graph Essay Workspace coaching orchestration.

This service replaces the former "run the lightweight pipeline beside the deep
pipeline" session behavior. It prepares one grounded context, fans out one set
of complementary specialists, sends their reports to one rubric-based
evaluator, runs one bounded QA loop, and projects the shared result into the
existing Coach and Evaluation response contracts.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from essay_coaching_service import (
    _clean_sentence_suggestions,
    _compose_summary,
    _derive_writing_scores,
    _empty_package,
    _outline_text,
    _profile_text,
    _run_guardrail_critic,
    _run_outline_coverage,
    _run_profile_grounding,
    _run_prompt_alignment,
    _run_sentence_corrector,
    _run_specificity,
    _run_structure_flow,
    _run_tone_authenticity,
    _scholarship_context,
)
from graph.builder import analyze_opportunity
from nodes.assemble_package import assemble_package
from nodes.coach_sections import coach_sections
from nodes.coaching.agents import (
    build_context,
    run_discovery_coach,
    run_eligibility_matrix,
    run_narrative_coach,
    run_reviewer_simulation_coach,
    run_strategy_coach,
)
from nodes.combine import combine_coaching
from nodes.critic import critic_review
from nodes.essay_alignment import build_essay_alignment_matrix
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
        "deadlines": [str(record["applicationDeadline"])] if record.get("applicationDeadline") else [],
        "evaluation_themes": [str(item) for item in themes if item],
        "prompt": prompt,
    }


def _run_parallel(
    jobs: dict[str, Runner],
    warnings: list[str],
    agent_status: dict[str, str],
    *,
    max_workers: int = 6,
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
            except Exception as exc:  # noqa: BLE001 - specialists degrade independently
                results[name] = None
                agent_status[name] = "error"
                warnings.append(f"{name} failed: {exc}")
    return results


def _evaluation_response(state: dict) -> dict:
    return {
        "coaching_brief": state.get("coaching_brief", {}),
        "readiness_index": state.get("readiness_index", {}),
        "growth_report": state.get("growth_report", {}),
        "reviewer_comments": state.get("reviewer_comments", []),
        "coaching_reports": state.get("coaching_reports", {}),
        "eligibility_matrix": state.get("eligibility_matrix", {}),
        "essay_alignment_matrix": state.get("essay_alignment_matrix", {}),
        "feedback": state.get("feedback", ""),
        "section_coaching": state.get("section_coaching", {}),
        "opportunity_analysis": state.get("opportunity_analysis", {}),
        "critique": state.get("critique", {}),
        "final_application_package": state.get("final_application_package", ""),
        "revision_priorities": state.get("revision_priorities", []),
        "ranked_revision_actions": state.get("ranked_revision_actions", []),
        "draft_number": state.get("draft_number", 1),
    }


def _fallback_priorities(results: dict[str, Any]) -> list[dict[str, str]]:
    candidates: list[str] = []
    alignment = results.get("alignment") or {}
    structure = results.get("structure") or {}
    specificity = results.get("specificity") or {}
    tone = results.get("tone") or {}
    candidates.extend(alignment.get("revision_tasks") or [])
    candidates.extend(structure.get("revision_tasks") or [])
    candidates.extend(specificity.get("places_to_add_detail") or [])
    candidates.extend(tone.get("tone_improvement_suggestions") or [])
    return [
        {
            "priority": item,
            "why_it_matters": "This specialist finding is the strongest available revision lead.",
            "how_to_fix": item,
            "impact": "Medium",
            "estimated_effort": "Moderate",
        }
        for item in list(dict.fromkeys(str(item) for item in candidates if item))[:4]
    ]


def _coach_response(
    results: dict[str, Any],
    sentence_suggestions: list[dict],
    guardrail: dict,
    evaluation: Optional[dict],
    writing_brief: dict,
    writing_support_level: str,
    warnings: list[str],
) -> dict:
    package = _empty_package()
    coach_specialists = {"sentence", "alignment", "grounding", "structure", "specificity", "tone", "coverage"}
    if not any(name in results and results[name] is not None for name in coach_specialists):
        package["status"] = "error"
        package["coach_summary"] = "The writing specialists could not analyze this draft."
        package["warnings"] = list(dict.fromkeys(warnings))
        return package
    package["writing_brief"] = {
        "mode": writing_brief.get("mode"),
        "has_formal_prompt": writing_brief.get("has_formal_prompt"),
        "prompt_asks": writing_brief.get("prompt_asks") or [],
    }
    package["writing_support_level"] = writing_support_level
    package["sentence_suggestions"] = sentence_suggestions
    package["guardrail"] = guardrail or {}
    package["prompt_alignment"] = results.get("alignment") or {}
    package["profile_grounding"] = results.get("grounding") or {}
    package["structure_feedback"] = results.get("structure") or {}
    package["paragraph_feedback"] = package["structure_feedback"].get("paragraph_feedback", [])
    package["specificity_feedback"] = results.get("specificity") or {}
    package["tone_feedback"] = results.get("tone") or {}
    package["outline_coverage"] = results.get("coverage") or {}

    readiness = (evaluation or {}).get("readiness_index") or {}
    formal_scores = {
        key: value.get("score", 0)
        for key, value in readiness.items()
        if key != "revision_progress" and isinstance(value, dict) and isinstance(value.get("score"), int)
    }
    clarity, grammar = _derive_writing_scores(sentence_suggestions)
    package["overall_scores"] = formal_scores or {
        "prompt_alignment": package["prompt_alignment"].get("alignment_score", 0),
        "profile_grounding": package["profile_grounding"].get("grounding_score", 0),
        "structure_flow": package["structure_feedback"].get("structure_score", 0),
        "specificity": package["specificity_feedback"].get("specificity_score", 0),
        "authenticity": package["tone_feedback"].get("authenticity_score", 0),
        "clarity": clarity,
    }
    package["overall_scores"]["grammar_mechanics"] = grammar

    ranked = (evaluation or {}).get("ranked_revision_actions") or _fallback_priorities(results)
    package["revision_priorities"] = ranked[:5]
    package["quick_fixes"] = [
        item.get("how_to_fix") or item.get("priority", "")
        for item in ranked
        if item.get("estimated_effort") == "Quick"
    ][:5]
    package["deeper_revision_tasks"] = [
        item.get("how_to_fix") or item.get("priority", "")
        for item in ranked
        if item.get("estimated_effort") in {"Moderate", "Deep"}
    ][:5]
    package["coach_summary"] = (
        ((evaluation or {}).get("coaching_brief") or {}).get("coach_message")
        or _compose_summary(package)
    )
    alignment_status = ((evaluation or {}).get("essay_alignment_matrix") or {}).get("overall_alignment_status")
    package["ready_for_final_review"] = alignment_status in {"Ready", "Mostly ready"}
    package["warnings"] = list(dict.fromkeys(warnings))
    return package


def run_unified_coaching_session(
    *,
    student_profile: Optional[dict] = None,
    clean_scholarship_record: Optional[dict] = None,
    essay_prompt: str = "",
    essay_draft: str = "",
    personalized_outline: Optional[dict] = None,
    user_notes: str = "",
    word_limit: str = "",
    outline_points: Optional[list] = None,
    writing_support_level: str = "sentence_polish",
    profile_text: str = "",
    scholarship_name: str = "",
    scholarship_type: str = "Scholarship",
    opportunity_prompt: str = "",
    previous_readiness: Optional[dict] = None,
    draft_number: int = 1,
    include_section_coaching: bool = False,
) -> dict:
    """Run one shared specialist graph and project it into both UI contracts."""
    essay_draft = (essay_draft or "").strip()
    if not essay_draft:
        return {
            "evaluation": None,
            "coach_pack": {**_empty_package("error"), "coach_summary": "Add an essay draft, then run the coach."},
            "warnings": ["No essay draft provided."],
            "agent_status": {},
        }

    record = clean_scholarship_record or {}
    # The API's cv_text is the fullest canonical profile rendering. Fall back
    # to the structured lightweight payload when callers omit it.
    profile = (profile_text or _profile_text(student_profile) or "").strip()[:50000]
    selected_prompt = (essay_prompt or opportunity_prompt or "").strip()
    writing_brief = resolve_writing_brief(
        essay_prompt=selected_prompt,
        clean_scholarship_record=record,
        allow_scholarship_fallback=True,
    )
    prompt_for_agents = (
        f"{format_brief_for_prompt(writing_brief)}\n\n"
        f"SELECTED ESSAY PROMPT TEXT:\n{selected_prompt or '(none — use scholarship-guided brief)'}"
    )
    scholarship_context = _scholarship_context(record)
    outline_text = _outline_text(personalized_outline)
    opportunity_text = _opportunity_text(
        scholarship_name or record.get("name", ""),
        scholarship_type or record.get("type", "Scholarship"),
        opportunity_prompt or selected_prompt,
    )

    warnings: list[str] = []
    agent_status: dict[str, str] = {}
    try:
        opportunity_analysis = analyze_opportunity({"opportunity_text": opportunity_text}).get(
            "opportunity_analysis", {}
        )
        agent_status["opportunity_analysis"] = "success"
    except Exception as exc:  # noqa: BLE001
        opportunity_analysis = _fallback_opportunity_analysis(record, opportunity_prompt or selected_prompt)
        agent_status["opportunity_analysis"] = "fallback"
        warnings.append(f"opportunity analysis failed; structured scholarship fallback used: {exc}")

    submitted_summary = summarize_submitted_input(
        profile,
        essay_draft,
        scholarship_name or record.get("name", ""),
        opportunity_prompt or selected_prompt,
    )
    shared_context = build_context(
        opportunity_text,
        profile or "(none provided)",
        essay_draft,
        opportunity_analysis,
        submitted_summary=submitted_summary,
    )

    jobs: dict[str, Runner] = {
        "sentence": lambda: _run_sentence_corrector(
            essay_draft,
            prompt_for_agents,
            scholarship_context,
            user_notes or "",
            writing_support_level,
        ),
        "alignment": lambda: _run_prompt_alignment(essay_draft, prompt_for_agents, scholarship_context),
        "grounding": lambda: _run_profile_grounding(essay_draft, profile, scholarship_context),
        "structure": lambda: _run_structure_flow(essay_draft, prompt_for_agents, outline_text),
        "specificity": lambda: _run_specificity(essay_draft, profile, scholarship_context),
        "tone": lambda: _run_tone_authenticity(essay_draft, profile, scholarship_context),
        "strategy": lambda: run_strategy_coach(shared_context),
        "eligibility": lambda: run_eligibility_matrix(shared_context),
        "narrative": lambda: run_narrative_coach(shared_context),
    }
    if profile:
        jobs["discovery"] = lambda: run_discovery_coach(shared_context)
    if outline_points:
        jobs["coverage"] = lambda: _run_outline_coverage(essay_draft, outline_points or [], scholarship_context)
    if include_section_coaching:
        jobs["section_coaching"] = lambda: coach_sections(
            {
                "retrieved_profile_chunks": [profile] if profile else [],
                "student_draft": essay_draft,
                "opportunity_text": opportunity_text,
                "opportunity_analysis": opportunity_analysis,
            }
        ).get("section_coaching", {})

    results = _run_parallel(jobs, warnings, agent_status)
    raw_sentence = results.get("sentence") or []
    sentence_suggestions = _clean_sentence_suggestions(
        essay_draft,
        raw_sentence,
        writing_support_level=writing_support_level,
    )

    state: dict[str, Any] = {
        "opportunity_text": opportunity_text,
        "opportunity_analysis": opportunity_analysis,
        "student_draft": essay_draft,
        "profile_text": profile,
        "retrieved_profile_chunks": [profile] if profile else [],
        "shared_context": shared_context,
        "submitted_summary": submitted_summary,
        "strategy_report": results.get("strategy") or {},
        "eligibility_report": results.get("eligibility") or {},
        "discovery_report": results.get("discovery") or {},
        "narrative_report": results.get("narrative") or {},
        "specialist_reports": {
            "prompt_alignment": results.get("alignment") or {},
            "profile_grounding": results.get("grounding") or {},
            "structure_flow": results.get("structure") or {},
            "specificity": results.get("specificity") or {},
            "tone_authenticity": results.get("tone") or {},
            "section_coaching": results.get("section_coaching") or {},
        },
        "previous_readiness": previous_readiness or {},
        "draft_number": draft_number,
        "active_scholarship": record,
        "section_coaching": results.get("section_coaching") or {},
        "critic_attempts": 0,
    }

    second_jobs: dict[str, Runner] = {
        "reviewer": lambda: run_reviewer_simulation_coach(
            shared_context,
            results.get("strategy") or {},
        ),
        "alignment_matrix": lambda: build_essay_alignment_matrix(state),
    }
    if sentence_suggestions:
        second_jobs["guardrail"] = lambda: _run_guardrail_critic(
            essay_draft,
            profile,
            sentence_suggestions,
        )
    second = _run_parallel(second_jobs, warnings, agent_status)
    state["reviewer_report"] = second.get("reviewer") or {}
    state["essay_alignment_matrix"] = second.get("alignment_matrix") or {}

    guardrail = second.get("guardrail") or {}
    if guardrail:
        unsafe = {
            int(index)
            for index in guardrail.get("unsafe_suggestion_indices", [])
            if isinstance(index, int) or str(index).isdigit()
        }
        if unsafe:
            sentence_suggestions = [
                suggestion
                for index, suggestion in enumerate(sentence_suggestions)
                if index not in unsafe
            ]
            warnings.append(f"Guardrail removed {len(unsafe)} unsafe sentence suggestion(s).")

    evaluation: Optional[dict] = None
    try:
        state.update(combine_coaching(state))
        agent_status["evaluator"] = "success"
        try:
            state.update(critic_review(state))
            agent_status["qa_critic"] = "success"
            if state.get("needs_revision"):
                state.update(combine_coaching(state))
                agent_status["evaluator_retry"] = "success"
                state.update(critic_review(state))
                agent_status["qa_critic_retry"] = "success"
        except Exception as exc:  # noqa: BLE001
            agent_status["qa_critic"] = "error"
            warnings.append(f"quality review failed: {exc}")

        state.update(assemble_package(state))
        evaluation = _evaluation_response(state)
    except Exception as exc:  # noqa: BLE001
        agent_status["evaluator"] = "error"
        warnings.append(f"unified evaluation failed: {exc}")

    coach_pack = _coach_response(
        results,
        sentence_suggestions,
        guardrail,
        evaluation,
        writing_brief,
        writing_support_level,
        warnings,
    )
    return {
        "evaluation": evaluation,
        "coach_pack": coach_pack,
        "warnings": list(dict.fromkeys(warnings)),
        "agent_status": agent_status,
    }
