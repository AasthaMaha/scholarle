# nodes/combine.py
"""Combiner agent: fans in every specialist agent's output and synthesizes the
consumer-facing readiness index, coaching brief, growth report, and priorities.
Re-runs with Critic guidance when the graph loops back."""

from nodes.coaching.agents import run_combiner
from nodes.coaching.readiness import (
    READINESS_DIMENSIONS,
    READINESS_LABELS,
    build_readiness_entry,
    compute_growth_report,
    overall_strength_level,
)


def _strongest_dim(readiness: dict) -> str:
    best = max(
        READINESS_DIMENSIONS,
        key=lambda d: readiness.get(d, {}).get("score", 0),
    )
    return READINESS_LABELS[best]


def _weakest_dim(readiness: dict) -> str:
    worst = min(
        READINESS_DIMENSIONS,
        key=lambda d: readiness.get(d, {}).get("score", 100),
    )
    return READINESS_LABELS[worst]


def _build_eligibility_matrix(report: dict) -> dict:
    """Normalize the eligibility agent output and derive the violation/missing
    lists the UI uses to tell the student exactly where they need to fill in."""
    rows = report.get("rows") or []
    normalized = []
    violations = []
    missing = []
    for row in rows:
        status = str(row.get("status", "missing")).lower()
        if status not in ("met", "not_met", "missing"):
            status = "missing"
        entry = {
            "requirement": row.get("requirement", ""),
            "category": row.get("category", "Other"),
            "student_value": row.get("student_value", "Not provided"),
            "status": status,
            "explanation": row.get("explanation", ""),
            "action_needed": row.get("action_needed", ""),
        }
        normalized.append(entry)
        if status == "not_met":
            violations.append(entry)
        elif status == "missing":
            missing.append(entry)

    return {
        "rows": normalized,
        "violations": violations,
        "missing_info": missing,
        "violation_count": len(violations),
        "missing_count": len(missing),
        "met_count": sum(1 for r in normalized if r["status"] == "met"),
        "overall": report.get(
            "overall",
            "incomplete" if (violations or missing) else "eligible",
        ),
        "summary": report.get("summary", ""),
    }


def combine_coaching(state):
    context = state.get("shared_context", "")
    strategy = state.get("strategy_report", {})
    eligibility = state.get("eligibility_report", {})
    discovery = state.get("discovery_report", {})
    narrative = state.get("narrative_report", {})
    reviewers = state.get("reviewer_report", {})
    critique = state.get("critique") or None
    previous_readiness = state.get("previous_readiness") or {}
    draft_number = int(state.get("draft_number") or 1)

    synthesis = run_combiner(
        context, strategy, discovery, narrative, reviewers, critique=critique
    )

    raw_readiness = synthesis.get("readiness_index", {})
    evaluation_rubric = synthesis.get("evaluation_rubric", {})
    readiness_index = {}
    for dim in READINESS_DIMENSIONS:
        entry = raw_readiness.get(dim, {})
        normalized = build_readiness_entry(
            entry.get("score", 0),
            "",
        )
        normalized.update({
            "justification": entry.get("justification", ""),
            "revision_actions": entry.get("revision_actions", []) or [],
            "rubric": evaluation_rubric.get(dim, {}),
        })
        readiness_index[dim] = normalized

    coaching_brief = synthesis.get("coaching_brief", {})
    if not coaching_brief.get("current_strength_level"):
        coaching_brief["current_strength_level"] = overall_strength_level(
            readiness_index
        )

    growth = compute_growth_report(previous_readiness, readiness_index, draft_number)
    delta = growth.get("overall_delta", 0)
    readiness_index["revision_progress"] = {
        "level": (
            "First draft"
            if not growth.get("has_previous_draft")
            else (f"+{delta}" if delta > 0 else str(delta))
        ),
        "coaching": growth.get("growth_message", ""),
        "delta": delta,
        "improvements": growth.get("improvements", []),
    }

    reviewer_comments = [
        {
            "persona": "Scholarship Reviewer",
            "comment": reviewers.get("scholarship_reviewer", {}).get("comment", ""),
        },
        {
            "persona": "Admissions Officer",
            "comment": reviewers.get("admissions_officer", {}).get("comment", ""),
        },
        {
            "persona": "Recruiter",
            "comment": reviewers.get("recruiter", {}).get("comment", ""),
        },
        {
            "persona": "Skeptical Reviewer",
            "comment": reviewers.get("skeptical_reviewer", {}).get("comment", ""),
        },
    ]

    coaching_reports = {
        "evaluation_rubric": evaluation_rubric,
        "strategy": strategy,
        "discovery": discovery,
        "narrative": narrative,
        "reviewers": reviewers,
    }

    avg_score = round(
        sum(readiness_index[d]["score"] for d in READINESS_DIMENSIONS)
        / len(READINESS_DIMENSIONS)
    )

    priorities = [
        coaching_brief.get("recommended_action", ""),
        narrative.get("biggest_narrative_gap", ""),
        discovery.get("recommended_experience_to_feature", ""),
    ]

    return {
        "coaching_brief": coaching_brief,
        "readiness_index": readiness_index,
        "growth_report": growth,
        "reviewer_comments": reviewer_comments,
        "coaching_reports": coaching_reports,
        "eligibility_matrix": _build_eligibility_matrix(eligibility),
        "feedback": coaching_brief.get("coach_message", ""),
        "revision_priorities": [p for p in priorities if p],
        "scores": {
            "overall_score": avg_score,
            "strongest_metric": _strongest_dim(readiness_index),
            "weakest_metric": _weakest_dim(readiness_index),
        },
        "draft_number": draft_number,
    }
