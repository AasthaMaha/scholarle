# nodes/critic.py
"""Critic agent: audits the combiner's output for grounding + guardrail
violations. Drives a bounded revision loop (see graph.builder)."""

from nodes.coaching.agents import run_critic_review
from nodes.coaching.readiness import READINESS_DIMENSIONS

MAX_CRITIC_ATTEMPTS = 2


def critic_review(state):
    context = state.get("shared_context", "")
    readiness_index = state.get("readiness_index", {})

    combined = {
        "readiness_index": {
            dim: readiness_index.get(dim, {}) for dim in READINESS_DIMENSIONS
        },
        "coaching_brief": state.get("coaching_brief", {}),
        "reviewer_comments": state.get("reviewer_comments", []),
        "strategy": state.get("strategy_report", {}),
        "eligibility_matrix": state.get("eligibility_matrix", {}),
        "discovery": state.get("discovery_report", {}),
        "narrative": state.get("narrative_report", {}),
        "tailored_rubric": (state.get("coaching_reports", {}) or {}).get(
            "evaluation_rubric", {}
        ),
    }

    critique = run_critic_review(context, combined)

    attempts = int(state.get("critic_attempts") or 0) + 1
    verdict = str(critique.get("verdict", "approved")).lower()
    # Only loop back if a revision is genuinely requested and we still have budget.
    needs_revision = (
        verdict == "needs_revision" and attempts < MAX_CRITIC_ATTEMPTS
    )
    critique["attempt"] = attempts

    return {
        "critique": critique,
        "critic_attempts": attempts,
        "needs_revision": needs_revision,
    }
