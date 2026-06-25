# nodes/generation.py
"""Specialized generation agents. Each is a thin node that runs one focused
LLM agent and writes to its OWN state key, so the strategy/discovery/narrative
agents can execute in parallel without clobbering each other."""

from nodes.coaching.agents import (
    run_discovery_coach,
    run_eligibility_matrix,
    run_narrative_coach,
    run_reviewer_simulation_coach,
    run_strategy_coach,
)


def strategy_node(state):
    return {"strategy_report": run_strategy_coach(state.get("shared_context", ""))}


def eligibility_node(state):
    """Requirements/eligibility comparison matrix — opportunity rules vs profile."""
    return {"eligibility_report": run_eligibility_matrix(state.get("shared_context", ""))}


def discovery_node(state):
    return {"discovery_report": run_discovery_coach(state.get("shared_context", ""))}


def narrative_node(state):
    return {"narrative_report": run_narrative_coach(state.get("shared_context", ""))}


def reviewer_node(state):
    """Reviewer simulation depends on the strategy agent's output."""
    return {
        "reviewer_report": run_reviewer_simulation_coach(
            state.get("shared_context", ""),
            state.get("strategy_report", {}),
        )
    }
