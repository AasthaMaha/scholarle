# nodes/score_application.py

from nodes.scoring.agents import (
    _shared_context,
    _word_count,
    run_authenticity_writing_agent,
    run_competitiveness_agent,
    run_coverage_agent,
    run_final_judge,
    run_revision_agent,
)
from nodes.scoring.metrics import (
    METRIC_KEYS,
    METRIC_LABELS,
    clamp_score,
    compute_authenticity_score,
    compute_final_score,
    metric_detail,
)


def score_application(state):
    """Multi-agent scoring pipeline for a student's application draft."""
    opportunity_text = state.get("opportunity_text", "")
    student_draft = state.get("student_draft", "")
    profile_chunks = state.get("retrieved_profile_chunks", [])
    opportunity_analysis = state.get("opportunity_analysis", {})

    profile_text = "\n\n".join(profile_chunks) if profile_chunks else "(none retrieved)"
    context = _shared_context(
        opportunity_text,
        profile_text,
        student_draft,
        opportunity_analysis,
    )
    draft_words = _word_count(student_draft)

    coverage = run_coverage_agent(context)
    authenticity_writing = run_authenticity_writing_agent(context, draft_words)
    competitiveness = run_competitiveness_agent(context, coverage)
    revision = run_revision_agent(coverage, authenticity_writing, competitiveness)

    evidence_score = clamp_score(coverage.get("evidence_coverage_score", 0))
    requirement_score = clamp_score(coverage.get("overall_requirement_coverage_score", 0))
    authenticity_score = compute_authenticity_score(authenticity_writing)
    tone_score = clamp_score(authenticity_writing.get("tone_score", 0))
    grammar_score = clamp_score(authenticity_writing.get("grammar_score", 0))
    length_score = clamp_score(authenticity_writing.get("length_score", 0))
    competitiveness_score = clamp_score(competitiveness.get("competitiveness_score", 0))
    ai_likeness_score = clamp_score(authenticity_writing.get("generic_phrase_penalty", 0))

    writing_readiness = round((tone_score + grammar_score + length_score) / 3)
    computed_final = compute_final_score(
        requirement_score,
        evidence_score,
        authenticity_score,
        competitiveness_score,
        tone_score,
        grammar_score,
        length_score,
    )

    computed_breakdown = {
        "requirement_coverage": requirement_score,
        "evidence_coverage": evidence_score,
        "authenticity": authenticity_score,
        "competitiveness": competitiveness_score,
        "writing_readiness": writing_readiness,
    }

    judge = run_final_judge(
        coverage,
        authenticity_writing,
        competitiveness,
        revision,
        {**computed_breakdown, "computed_final_score": computed_final},
    )

    final_score = clamp_score(judge.get("final_score", computed_final))

    metric_details = {
        "evidence_coverage": metric_detail(
            evidence_score,
            _evidence_feedback(coverage),
            coverage.get("evidence_recommendation", ""),
        ),
        "requirement_coverage": metric_detail(
            requirement_score,
            _requirement_feedback(coverage),
            _weakest_requirement_fix(coverage),
        ),
        "authenticity": metric_detail(
            authenticity_score,
            authenticity_writing.get("revision_advice", ""),
            _authenticity_suggestion(authenticity_writing),
        ),
        "tone": metric_detail(
            tone_score,
            authenticity_writing.get("tone_feedback", ""),
            authenticity_writing.get("tone_suggestion", ""),
        ),
        "grammar": metric_detail(
            grammar_score,
            authenticity_writing.get("grammar_feedback", ""),
            authenticity_writing.get("grammar_suggestion", ""),
        ),
        "length": metric_detail(
            length_score,
            authenticity_writing.get("length_feedback", ""),
            authenticity_writing.get("length_suggestion", ""),
        ),
        "ai_likeness": metric_detail(
            ai_likeness_score,
            _ai_likeness_feedback(authenticity_writing),
            _ai_likeness_suggestion(authenticity_writing),
        ),
        "competitiveness": metric_detail(
            competitiveness_score,
            competitiveness.get("reason", ""),
            _competitiveness_suggestion(competitiveness),
        ),
    }

    numeric_scores = {key: metric_details[key]["score"] for key in METRIC_KEYS}
    numeric_scores["overall_score"] = final_score
    numeric_scores["strongest_metric"] = judge.get(
        "strongest_area", METRIC_LABELS["evidence_coverage"]
    )
    numeric_scores["weakest_metric"] = judge.get(
        "weakest_area", METRIC_LABELS["requirement_coverage"]
    )
    numeric_scores["estimated_tier"] = competitiveness.get("estimated_tier", "")

    revision_priorities = judge.get("top_revision_priorities") or [
        item.get("action", "") for item in revision.get("ranked_revision_actions", [])[:3]
    ]

    return {
        "scores": numeric_scores,
        "metric_details": metric_details,
        "feedback": judge.get("final_coaching_message", ""),
        "agent_reports": {
            "coverage": coverage,
            "authenticity_writing": authenticity_writing,
            "competitiveness": competitiveness,
            "revision": revision,
            "judge": judge,
        },
        "revision_priorities": revision_priorities,
        "score_breakdown": judge.get("score_breakdown", computed_breakdown),
    }


def _evidence_feedback(coverage: dict) -> str:
    used = coverage.get("evidence_used_in_draft") or []
    missing = coverage.get("evidence_missing_from_draft") or []
    parts = []
    if used:
        parts.append(f"Used in draft: {', '.join(used[:4])}.")
    if missing:
        parts.append(f"Strong profile evidence not yet used: {', '.join(missing[:4])}.")
    return " ".join(parts) or "Compare profile evidence to what appears in the essay."


def _requirement_feedback(coverage: dict) -> str:
    weakest = coverage.get("weakest_requirement", "")
    strongest = coverage.get("strongest_requirement", "")
    if weakest and strongest:
        return f"Strongest on: {strongest}. Weakest on: {weakest}."
    return "Prompt requirements mapped against the draft."


def _weakest_requirement_fix(coverage: dict) -> str:
    for item in coverage.get("requirement_map") or []:
        if item.get("status") in ("partial", "not_covered", "weak"):
            return item.get("revision_needed") or item.get("requirement", "")
    return coverage.get("evidence_recommendation", "")


def _authenticity_suggestion(report: dict) -> str:
    unsupported = report.get("unsupported_claims") or []
    if unsupported:
        return f"Support or remove unsupported claims: {unsupported[0]}"
    generic = report.get("generic_phrases") or []
    if generic:
        return f"Replace generic phrasing such as: {generic[0]!r}"
    return report.get("revision_advice", "")


def _ai_likeness_feedback(report: dict) -> str:
    phrases = report.get("generic_phrases") or []
    if phrases:
        return f"Generic or AI-like phrasing detected: {phrases[0]!r}"
    return "Writing sounds personal with few generic template phrases."


def _ai_likeness_suggestion(report: dict) -> str:
    phrases = report.get("generic_phrases") or []
    if len(phrases) > 1:
        return f"Rewrite phrases like {phrases[1]!r} with a detail only you would know."
    if phrases:
        return f"Replace {phrases[0]!r} with a specific moment from your experience."
    return "Keep using concrete, personal details from your profile."


def _competitiveness_suggestion(report: dict) -> str:
    changes = report.get("top_changes") or []
    return changes[0] if changes else report.get("reason", "")
