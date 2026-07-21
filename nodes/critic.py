# nodes/critic.py
"""Critic agent: audits the combiner's output for grounding + guardrail
violations. Drives a bounded revision loop (see graph.builder).

Also applies programmatic completeness floors so QA is not LLM-only.
"""

from nodes.coaching.agents import run_critic_review
from nodes.coaching.readiness import READINESS_DIMENSIONS

MAX_CRITIC_ATTEMPTS = 2


def _programmatic_completeness(readiness_index: dict, coaching_brief: dict) -> list[str]:
    """Deterministic QA floors the LLM critic can miss."""
    issues = []
    for dim in READINESS_DIMENSIONS:
        entry = readiness_index.get(dim) or {}
        if not isinstance(entry, dict):
            issues.append(f"{dim}: missing readiness entry")
            continue
        score = entry.get("score")
        if not isinstance(score, int) or score < 0 or score > 97:
            issues.append(f"{dim}: score must be an integer 0-97")
        if not str(entry.get("justification") or "").strip():
            issues.append(f"{dim}: missing justification")
        actions = entry.get("revision_actions") or []
        if not isinstance(actions, list) or len(actions) < 1:
            issues.append(f"{dim}: missing structured revision action")
        else:
            action = actions[0] if isinstance(actions[0], dict) else {}
            for key in ("priority", "how_to_fix", "impact", "estimated_effort"):
                if not str(action.get(key) or "").strip():
                    issues.append(f"{dim}: revision action missing {key}")
    if not str((coaching_brief or {}).get("coach_message") or "").strip():
        issues.append("coaching_brief: missing coach_message")
    return issues


def critic_review(state):
    context = state.get("shared_context", "")
    readiness_index = state.get("readiness_index", {})
    coaching_brief = state.get("coaching_brief", {}) or {}

    combined = {
        "readiness_index": {
            dim: readiness_index.get(dim, {}) for dim in READINESS_DIMENSIONS
        },
        "coaching_brief": coaching_brief,
        "reviewer_comments": state.get("reviewer_comments", []),
        "strategy": state.get("strategy_report", {}),
        "grammar": (state.get("specialist_reports") or {}).get("grammar", {}),
        "clarity_concision": (state.get("specialist_reports") or {}).get(
            "clarity_concision", {}
        ),
        "alignment": (state.get("specialist_reports") or {}).get("alignment", {}),
        "eligibility_matrix": state.get("eligibility_matrix", {}),
        "discovery": state.get("discovery_report", {}),
        "narrative": state.get("narrative_report", {}),
        "narrative_structure_flow_coherence": (state.get("specialist_reports") or {}).get(
            "narrative_structure_flow_coherence", {}
        ),
        "insight": (state.get("specialist_reports") or {}).get("insight", {}),
        "tailored_rubric": (state.get("coaching_reports", {}) or {}).get(
            "evaluation_rubric", {}
        ),
    }

    critique = run_critic_review(context, combined)
    if not isinstance(critique, dict):
        critique = {}

    prog_issues = _programmatic_completeness(readiness_index, coaching_brief)
    if prog_issues:
        existing = list(critique.get("issues") or [])
        critique["issues"] = existing + [f"[programmatic] {i}" for i in prog_issues]
        critique["completeness_pass"] = False
        critique["verdict"] = "needs_revision"
        guidance = str(critique.get("revision_guidance") or "").strip()
        critique["revision_guidance"] = (
            (guidance + " " if guidance else "")
            + "Fix programmatic completeness: "
            + "; ".join(prog_issues[:6])
        ).strip()

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
