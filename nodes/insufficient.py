# nodes/insufficient.py
"""Zero-LLM short-circuit for submissions with no substantive content.

Reached via the conditional entry edge so we never spend tokens evaluating an
empty or placeholder application."""

from nodes.coaching.readiness import (
    READINESS_DIMENSIONS,
    build_readiness_entry,
    compute_growth_report,
)

_NO_CONTENT_COACHING = (
    "No substantive content submitted yet — add your essay draft and profile, "
    "then run the coach again."
)


def insufficient_input(state):
    draft_number = int(state.get("draft_number") or 1)
    previous = state.get("previous_readiness") or {}

    readiness = {
        dim: build_readiness_entry(0, _NO_CONTENT_COACHING)
        for dim in READINESS_DIMENSIONS
    }
    growth = compute_growth_report(previous, readiness, draft_number)
    readiness["revision_progress"] = {
        "level": (
            "First draft"
            if not growth.get("has_previous_draft")
            else str(growth.get("overall_delta", 0))
        ),
        "coaching": growth.get("growth_message", ""),
        "delta": growth.get("overall_delta", 0),
        "improvements": growth.get("improvements", []),
    }

    brief = {
        "current_strength_level": "Needs Work",
        "biggest_opportunity": "There is not enough submitted content to evaluate.",
        "recommended_action": (
            "Add your essay draft (and profile details), then run the AI coach again."
        ),
        "expected_improvement": "High",
        "coach_message": (
            "I couldn't find enough content to coach yet. Paste your essay draft "
            "and fill in your profile, then send it to the coach."
        ),
    }

    return {
        "readiness_index": readiness,
        "coaching_brief": brief,
        "growth_report": growth,
        "reviewer_comments": [],
        "coaching_reports": {},
        "eligibility_matrix": {
            "rows": [],
            "violations": [],
            "missing_info": [],
            "violation_count": 0,
            "missing_count": 0,
            "met_count": 0,
            "overall": "incomplete",
            "summary": (
                "Add your profile and the scholarship's requirements, then run "
                "the coach again to see the eligibility comparison."
            ),
        },
        "feedback": brief["coach_message"],
        "revision_priorities": [brief["recommended_action"]],
        "scores": {"overall_score": 0, "strongest_metric": "-", "weakest_metric": "-"},
        "critique": {},
        "draft_number": draft_number,
    }
