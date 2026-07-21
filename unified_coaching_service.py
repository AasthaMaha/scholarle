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
    _compose_summary,
    _derive_writing_scores,
    _empty_package,
    _outline_text,
    _prepare_sentence_suggestions,
    _profile_text,
    _profile_grounding_view,
    _prompt_alignment_view,
    _run_alignment,
    _run_clarity_concision,
    _run_evidence_strength,
    _run_grammar,
    _run_guardrail_critic,
    _run_insight,
    _run_outline_coverage,
    _run_narrative_structure,
    _run_tone_authenticity,
    _scholarship_context,
    _sentence_feedback_view,
    _specificity_view,
    _structure_flow_view,
)
from graph.builder import analyze_opportunity
from nodes.assemble_package import assemble_package
from nodes.coaching.agents import (
    build_context,
    run_reviewer_simulation_coach,
)
from nodes.combine import combine_coaching
from nodes.critic import critic_review
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
        "feedback": state.get("feedback", ""),
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
    narrative_structure = results.get("narrative_structure") or {}
    evidence = results.get("evidence_strength") or {}
    insight = results.get("insight") or {}
    tone = results.get("tone") or {}
    grammar = results.get("grammar") or {}
    clarity = results.get("clarity_concision") or {}
    candidates.extend(alignment.get("revision_tasks") or [])
    candidates.extend(narrative_structure.get("revision_tasks") or [])
    candidates.extend(evidence.get("recommendations") or [])
    candidates.extend(evidence.get("places_to_add_detail") or [])
    candidates.extend(insight.get("revision_tasks") or [])
    candidates.extend(insight.get("missing_meaning_or_reflection") or [])
    candidates.extend(tone.get("tone_improvement_suggestions") or [])
    candidates.extend(grammar.get("revision_tasks") or [])
    candidates.extend(clarity.get("revision_tasks") or [])
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
    coach_specialists = {
        "grammar",
        "clarity_concision",
        "alignment",
        "evidence_strength",
        "narrative_structure",
        "insight",
        "tone",
        "coverage",
    }
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
    grammar_feedback = results.get("grammar") or {}
    clarity_feedback = results.get("clarity_concision") or {}
    package["grammar_feedback"] = _sentence_feedback_view(grammar_feedback)
    package["clarity_concision_feedback"] = _sentence_feedback_view(clarity_feedback)
    package["guardrail"] = guardrail or {}
    alignment = results.get("alignment") or {}
    package["alignment"] = alignment
    package["prompt_alignment"] = _prompt_alignment_view(alignment)
    evidence_strength = results.get("evidence_strength") or {}
    package["evidence_strength"] = evidence_strength
    # Compatibility projections keep old clients and targeted-tool contracts
    # working without running duplicate grounding or specificity agents.
    package["profile_grounding"] = _profile_grounding_view(evidence_strength)
    narrative_structure = results.get("narrative_structure") or {}
    package["narrative_structure"] = narrative_structure
    package["structure_feedback"] = _structure_flow_view(narrative_structure)
    package["paragraph_feedback"] = narrative_structure.get("paragraph_feedback", [])
    insight = results.get("insight") or {}
    package["insight"] = insight
    package["specificity_feedback"] = _specificity_view(evidence_strength)
    package["tone_feedback"] = results.get("tone") or {}
    package["outline_coverage"] = results.get("coverage") or {}

    readiness = (evaluation or {}).get("readiness_index") or {}
    formal_scores = {
        key: value.get("score", 0)
        for key, value in readiness.items()
        if key != "revision_progress" and isinstance(value, dict) and isinstance(value.get("score"), int)
    }
    derived_clarity, derived_grammar = _derive_writing_scores(sentence_suggestions)
    package["overall_scores"] = formal_scores or {
        "alignment": alignment.get("alignment_score", 0),
        "evidence_strength": evidence_strength.get("evidence_strength_score", 0),
        "narrative_structure_flow_coherence": narrative_structure.get("narrative_structure_score", 0),
        "insight": insight.get("insight_score", 0),
        "authenticity": package["tone_feedback"].get("authenticity_score", 0),
        "clarity_concision": clarity_feedback.get("clarity_concision_score", derived_clarity),
    }
    package["overall_scores"]["grammar_mechanics"] = grammar_feedback.get(
        "grammar_score", derived_grammar
    )

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
        "grammar": lambda: _run_grammar(essay_draft, user_notes or ""),
        "clarity_concision": lambda: _run_clarity_concision(
            essay_draft,
            user_notes or "",
            writing_support_level,
        ),
        "alignment": lambda: _run_alignment(essay_draft, prompt_for_agents, profile, scholarship_context),
        "evidence_strength": lambda: _run_evidence_strength(essay_draft, profile, scholarship_context),
        "narrative_structure": lambda: _run_narrative_structure(
            essay_draft,
            prompt_for_agents,
            outline_text,
            profile,
        ),
        "insight": lambda: _run_insight(essay_draft, prompt_for_agents, profile, scholarship_context),
        "tone": lambda: _run_tone_authenticity(essay_draft, profile, scholarship_context),
    }
    if outline_points:
        jobs["coverage"] = lambda: _run_outline_coverage(essay_draft, outline_points or [], scholarship_context)
    results = _run_parallel(jobs, warnings, agent_status)
    grammar_feedback = results.get("grammar") or {}
    clarity_feedback = results.get("clarity_concision") or {}
    sentence_suggestions = _prepare_sentence_suggestions(
        essay_draft,
        grammar_feedback,
        clarity_feedback,
        writing_support_level,
    )

    state: dict[str, Any] = {
        "opportunity_text": opportunity_text,
        "opportunity_analysis": opportunity_analysis,
        "student_draft": essay_draft,
        "profile_text": profile,
        "retrieved_profile_chunks": [profile] if profile else [],
        "shared_context": shared_context,
        "submitted_summary": submitted_summary,
        # The standalone Strategy specialist is merged into Alignment here.
        "strategy_report": {},
        # Eligibility/profile fit belongs to the earlier Fit Assessment page,
        # not the Essay Workspace specialist wave.
        "eligibility_report": {},
        # The old discovery stage is intentionally empty in this graph; its
        # responsibilities now live in the single Evidence Strength report.
        "discovery_report": {},
        # The standalone Narrative specialist is merged with Structure & Flow.
        "narrative_report": {},
        "specialist_reports": {
            "grammar": _sentence_feedback_view(grammar_feedback),
            "clarity_concision": _sentence_feedback_view(clarity_feedback),
            "alignment": results.get("alignment") or {},
            "evidence_strength": results.get("evidence_strength") or {},
            "narrative_structure_flow_coherence": results.get("narrative_structure") or {},
            "insight": results.get("insight") or {},
            "tone_authenticity": results.get("tone") or {},
        },
        "previous_readiness": previous_readiness or {},
        "draft_number": draft_number,
        "active_scholarship": record,
        "critic_attempts": 0,
    }

    second_jobs: dict[str, Runner] = {
        "reviewer": lambda: run_reviewer_simulation_coach(
            shared_context,
            results.get("alignment") or {},
        ),
    }
    if sentence_suggestions:
        second_jobs["guardrail"] = lambda: _run_guardrail_critic(
            essay_draft,
            profile,
            sentence_suggestions,
        )
    second = _run_parallel(second_jobs, warnings, agent_status)
    state["reviewer_report"] = second.get("reviewer") or {}

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
