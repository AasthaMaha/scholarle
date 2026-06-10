<<<<<<< Updated upstream
# nodes/assemble_package.py

from outputs.writer import save

OUTPUT_PATH = "outputs/final_application_package.md"


def _format_analysis(analysis):
    if not analysis:
        return "_No opportunity analysis available._"

    lines = []
    lines.append(f"- **Type:** {analysis.get('opportunity_type', 'unknown')}")

    requirements = analysis.get("requirements", [])
    lines.append("- **Requirements:**")
    if requirements:
        lines.extend(f"  - {r}" for r in requirements)
    else:
        lines.append("  - _None detected_")

    deadlines = analysis.get("deadlines", [])
    lines.append("- **Deadlines:**")
    if deadlines:
        lines.extend(f"  - {d}" for d in deadlines)
    else:
        lines.append("  - _None stated_")

    themes = analysis.get("evaluation_themes", [])
    lines.append("- **Evaluation themes:**")
    if themes:
        lines.extend(f"  - {t}" for t in themes)
    else:
        lines.append("  - _None detected_")

    return "\n".join(lines)


def _format_scores(scores):
    if not scores:
        return "_No scores available._"

    order = [
        "prompt_alignment",
        "authenticity",
        "clarity",
        "specificity",
        "leadership_impact",
        "writing_quality",
        "competitiveness",
        "overall_score",
    ]

    rows = ["| Criterion | Score |", "| --- | --- |"]
    for key in order:
        label = key.replace("_", " ").title()
        rows.append(f"| {label} | {scores.get(key, 0)} |")
    return "\n".join(rows)


def assemble_package(state):
    """
    Build the final coaching package as markdown and save it to disk.
    """
    analysis = state.get("opportunity_analysis", {})
    profile_chunks = state.get("retrieved_profile_chunks", [])
    feedback = state.get("feedback", "") or "_No feedback available._"
    scores = state.get("scores", {})

    if profile_chunks:
        evidence = "\n\n".join(f"> {chunk}" for chunk in profile_chunks)
    else:
        evidence = "_No profile evidence retrieved._"

    package = f"""# ScholarlE Engen — Application Coaching Package

## Opportunity Analysis

{_format_analysis(analysis)}

## Retrieved Profile Evidence

{evidence}

## Draft Feedback

{feedback}

## Scorecard

{_format_scores(scores)}
"""

    save(package, filename=OUTPUT_PATH)

    return {"final_application_package": package}
=======
# nodes/assemble_package.py

from nodes.coaching.readiness import READINESS_DIMENSIONS, READINESS_LABELS
from outputs.writer import save

OUTPUT_PATH = "outputs/final_application_package.md"


def _format_analysis(analysis):
    if not analysis:
        return "_No opportunity analysis available._"

    lines = []
    lines.append(f"- **Type:** {analysis.get('opportunity_type', 'unknown')}")

    requirements = analysis.get("requirements", [])
    lines.append("- **Requirements:**")
    if requirements:
        lines.extend(f"  - {r}" for r in requirements)
    else:
        lines.append("  - _None detected_")

    deadlines = analysis.get("deadlines", [])
    lines.append("- **Deadlines:**")
    if deadlines:
        lines.extend(f"  - {d}" for d in deadlines)
    else:
        lines.append("  - _None stated_")

    themes = analysis.get("evaluation_themes", [])
    lines.append("- **Evaluation themes:**")
    if themes:
        lines.extend(f"  - {t}" for t in themes)
    else:
        lines.append("  - _None detected_")

    return "\n".join(lines)


def _format_coaching_brief(brief):
    if not brief:
        return "_No coaching brief available._"

    return f"""- **Current strength level:** {brief.get('current_strength_level', '—')}
- **Biggest opportunity:** {brief.get('biggest_opportunity', '—')}
- **Recommended action:** {brief.get('recommended_action', '—')}
- **Expected improvement:** {brief.get('expected_improvement', '—')}

{brief.get('coach_message', '')}"""


def _format_readiness_index(readiness):
    if not readiness:
        return "_No readiness index available._"

    rows = ["| Dimension | Score | Level | Coaching |", "| --- | --- | --- | --- |"]
    for dim in READINESS_DIMENSIONS + ["revision_progress"]:
        entry = readiness.get(dim, {})
        label = READINESS_LABELS.get(dim, dim.replace("_", " ").title())
        rows.append(
            f"| {label} | {entry.get('score', '—')} | {entry.get('level', '—')} | "
            f"{entry.get('coaching', '—')} |"
        )
    return "\n".join(rows)


def _format_reviewer_comments(comments):
    if not comments:
        return "_No reviewer simulation available._"

    blocks = []
    for item in comments:
        blocks.append(f"### {item.get('persona', 'Reviewer')}\n\n{item.get('comment', '')}")
    return "\n\n".join(blocks)


def _format_coaching_reports(reports):
    if not reports:
        return "_No coaching reports available._"

    sections = []
    strategy = reports.get("strategy", {})
    if strategy:
        sections.append(
            "### Opportunity Strategy\n\n"
            + strategy.get("strategic_insight", "")
            + "\n\n"
            + strategy.get("reflection_vs_story_ratio", "")
        )

    discovery = reports.get("discovery", {})
    if discovery:
        sections.append(
            "### Experience Discovery\n\n"
            + discovery.get("coaching_message", "")
            + "\n\n**Recommended experience:** "
            + discovery.get("recommended_experience_to_feature", "")
        )

    narrative = reports.get("narrative", {})
    if narrative:
        sections.append(
            "### Narrative Coach\n\n"
            + narrative.get("overall_narrative_coaching", "")
            + "\n\n**Biggest gap:** "
            + narrative.get("biggest_narrative_gap", "")
        )

    return "\n\n".join(sections) if sections else "_No coaching reports available._"


def _format_growth(growth):
    if not growth:
        return "_No growth data yet._"
    if not growth.get("has_previous_draft"):
        return growth.get("growth_message", "_First draft — revise and analyse again._")

    lines = [growth.get("growth_message", "")]
    for item in growth.get("improvements") or []:
        lines.append(f"- {item}")
    return "\n".join(lines)


def _format_section_coaching(section_coaching):
    if not section_coaching:
        return "_No section coaching available._"

    blocks = []
    for section_name, feedback in section_coaching.items():
        blocks.append(f"### {section_name}\n\n{feedback}")
    return "\n\n".join(blocks)


def assemble_package(state):
    analysis = state.get("opportunity_analysis", {})
    profile_chunks = state.get("retrieved_profile_chunks", [])
    section_coaching = state.get("section_coaching", {})
    coaching_brief = state.get("coaching_brief", {})
    readiness_index = state.get("readiness_index", {})
    growth_report = state.get("growth_report", {})
    reviewer_comments = state.get("reviewer_comments", [])
    coaching_reports = state.get("coaching_reports", {})

    if profile_chunks:
        evidence = "\n\n".join(f"> {chunk}" for chunk in profile_chunks)
    else:
        evidence = "_No profile evidence retrieved._"

    package = f"""# ScholarlE Engen — Coaching Package

## Your Next Step

{_format_coaching_brief(coaching_brief)}

## Application Readiness Index

{_format_readiness_index(readiness_index)}

## Growth Across Drafts

{_format_growth(growth_report)}

## Reviewer Simulation

{_format_reviewer_comments(reviewer_comments)}

## Coach Reports

{_format_coaching_reports(coaching_reports)}

## Opportunity Analysis

{_format_analysis(analysis)}

## Retrieved Profile Evidence

{evidence}

## Section-by-Section Coaching

{_format_section_coaching(section_coaching)}
"""

    save(package, filename=OUTPUT_PATH)

    return {"final_application_package": package}
>>>>>>> Stashed changes
