# nodes/coach_application.py

from nodes.coaching.agents import (
    build_context,
    run_narrative_coach,
    run_readiness_and_brief_coach,
    run_reviewer_simulation_coach,
    run_strategy_and_discovery_coach,
)
from nodes.coaching.readiness import (
    READINESS_DIMENSIONS,
    READINESS_LABELS,
    build_readiness_entry,
    compute_growth_report,
    overall_strength_level,
)
from utils.input_validation import summarize_submitted_input


def _parse_opportunity_fields(opportunity_text: str) -> tuple:
    lines = (opportunity_text or "").split("\n")
    name = ""
    stype = ""
    if lines and lines[0].startswith("Scholarship: "):
        name = lines[0].replace("Scholarship: ", "").strip()
    if len(lines) > 1 and lines[1].startswith("Type: "):
        stype = lines[1].replace("Type: ", "").strip()
    prompt = "\n".join(lines[3:]).strip() if len(lines) > 3 else opportunity_text
    return name, stype, prompt


def _profile_text_from_state(state) -> str:
    docs = state.get("student_profile_docs") or []
    parts = []
    for doc in docs:
        content = getattr(doc, "page_content", None) or str(doc)
        if content.strip():
            parts.append(content.strip())
    return "\n\n".join(parts)


def coach_application(state):
    """
    Coaching-centric pipeline — all scores and coaching come from agent LLM
    calls reading the student's actual submitted text.
    """
    opportunity_text = state.get("opportunity_text", "")
    student_draft = state.get("student_draft", "")
    profile_chunks = state.get("retrieved_profile_chunks", [])
    opportunity_analysis = state.get("opportunity_analysis", {})
    previous_readiness = state.get("previous_readiness") or {}
    draft_number = int(state.get("draft_number") or 1)

    cv_text = _profile_text_from_state(state)
    name, stype, prompt = _parse_opportunity_fields(opportunity_text)
    submitted_summary = summarize_submitted_input(
        cv_text, student_draft, name, prompt
    )

    profile_text = (
        "\n\n".join(profile_chunks) if profile_chunks else cv_text or "(none retrieved)"
    )
    context = build_context(
        opportunity_text,
        profile_text,
        student_draft,
        opportunity_analysis,
        submitted_summary=submitted_summary,
    )

    strategy_discovery = run_strategy_and_discovery_coach(context)
    narrative = run_narrative_coach(context)
    strategy = strategy_discovery.get("strategy", {})
    reviewers = run_reviewer_simulation_coach(context, strategy)
    synthesis = run_readiness_and_brief_coach(
        context, strategy_discovery, narrative, reviewers
    )

    raw_readiness = synthesis.get("readiness_index", {})
    readiness_index = {}
    for dim in READINESS_DIMENSIONS:
        entry = raw_readiness.get(dim, {})
        readiness_index[dim] = build_readiness_entry(
            entry.get("score", 0),
            entry.get("coaching", ""),
        )

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
        "strategy": strategy_discovery.get("strategy", {}),
        "discovery": strategy_discovery.get("discovery", {}),
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
        strategy_discovery.get("discovery", {}).get(
            "recommended_experience_to_feature", ""
        ),
    ]

    return {
        "coaching_brief": coaching_brief,
        "readiness_index": readiness_index,
        "growth_report": growth,
        "reviewer_comments": reviewer_comments,
        "coaching_reports": coaching_reports,
        "feedback": coaching_brief.get("coach_message", ""),
        "revision_priorities": [p for p in priorities if p],
        "scores": {
            "overall_score": avg_score,
            "strongest_metric": _strongest_dim(readiness_index),
            "weakest_metric": _weakest_dim(readiness_index),
        },
        "draft_number": draft_number,
    }


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
