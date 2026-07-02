# nodes/assemble_package.py

from nodes.coaching.readiness import READINESS_DIMENSIONS, READINESS_LABELS


def _format_analysis(analysis):
    if not analysis:
        return "_No opportunity analysis available._"

    lines = [f"- **Type:** {analysis.get('opportunity_type', 'unknown')}"]

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

    return f"""- **Current strength level:** {brief.get('current_strength_level', '-')}
- **Biggest opportunity:** {brief.get('biggest_opportunity', '-')}
- **Recommended action:** {brief.get('recommended_action', '-')}
- **Expected improvement:** {brief.get('expected_improvement', '-')}

{brief.get('coach_message', '')}"""


def _format_readiness_index(readiness):
    if not readiness:
        return "_No readiness index available._"

    rows = ["| Dimension | Score | Level | Coaching |", "| --- | --- | --- | --- |"]
    for dim in READINESS_DIMENSIONS + ["revision_progress"]:
        entry = readiness.get(dim, {})
        label = READINESS_LABELS.get(dim, dim.replace("_", " ").title())
        rows.append(
            f"| {label} | {entry.get('score', '-')} | {entry.get('level', '-')} | "
            f"{entry.get('coaching', '-')} |"
        )
    return "\n".join(rows)


def _format_eligibility_matrix(matrix):
    if not matrix or not matrix.get("rows"):
        return "_No eligibility comparison available._"

    status_label = {"met": "✅ Met", "not_met": "❌ Not met", "missing": "⚠️ Missing"}
    rows = [
        "| Requirement | Category | Your profile | Status | What to do |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in matrix["rows"]:
        status = status_label.get(row.get("status"), row.get("status", "-"))
        action = row.get("action_needed") or "-"
        rows.append(
            f"| {row.get('requirement', '-')} | {row.get('category', '-')} | "
            f"{row.get('student_value', '-')} | {status} | {action} |"
        )

    summary = matrix.get("summary", "")
    violations = matrix.get("violation_count", 0)
    missing = matrix.get("missing_count", 0)
    header = (
        f"**Overall:** {matrix.get('overall', 'incomplete')} — "
        f"{violations} requirement(s) not met, {missing} needing more info.\n\n"
    )
    return header + ("\n".join(rows)) + (f"\n\n{summary}" if summary else "")


def _format_essay_alignment_matrix(matrix):
    if not matrix or not matrix.get("matrix"):
        return "_No essay alignment check available._"

    rows = [
        "| Requirement | Type | Evidence | Status | Risk | Revision task |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in matrix.get("matrix", []):
        rows.append(
            f"| {row.get('requirement', '-')} | {row.get('requirement_type', '-')} | "
            f"{row.get('essay_evidence', '-')} | {row.get('status', '-')} | "
            f"{row.get('risk_level', '-')} | {row.get('revision_needed') or '-'} |"
        )

    header = (
        f"**Overall:** {matrix.get('overall_alignment_status', 'Insufficient information')} — "
        f"{matrix.get('completion_percent', 0)}% complete, "
        f"{matrix.get('word_count', 0)} words, "
        f"{matrix.get('word_limit_status', 'No limit provided')}.\n\n"
    )
    tasks = matrix.get("recommended_revision_tasks") or []
    task_block = "\n\n**Revision tasks:**\n" + "\n".join(f"- {task}" for task in tasks) if tasks else ""
    return header + "\n".join(rows) + task_block


def _format_reviewer_comments(comments):
    if not comments:
        return "_No reviewer simulation available._"
    return "\n\n".join(
        f"### {item.get('persona', 'Reviewer')}\n\n{item.get('comment', '')}"
        for item in comments
    )


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
        return growth.get("growth_message", "_First draft - revise and analyse again._")

    lines = [growth.get("growth_message", "")]
    for item in growth.get("improvements") or []:
        lines.append(f"- {item}")
    return "\n".join(lines)


def _format_section_coaching(section_coaching):
    if not section_coaching:
        return "_No section coaching available._"
    return "\n\n".join(
        f"### {section_name}\n\n{feedback}"
        for section_name, feedback in section_coaching.items()
    )


def _format_critique(critique):
    if not critique:
        return "_No critic review available._"

    issues = critique.get("issues") or []
    issues_block = (
        "\n".join(f"  - {i}" for i in issues) if issues else "  - _None found_"
    )
    return (
        f"- **Verdict:** {critique.get('verdict', 'approved')}\n"
        f"- **Confidence:** {critique.get('confidence', '-')}\n"
        f"- **Grounding check:** {'pass' if critique.get('grounding_pass', True) else 'fail'}\n"
        f"- **Guardrail check:** {'pass' if critique.get('guardrail_pass', True) else 'fail'}\n"
        f"- **Review passes:** {critique.get('attempt', 1)}\n"
        f"- **Issues:**\n{issues_block}"
    )


def assemble_package(state):
    profile_chunks = state.get("retrieved_profile_chunks", [])
    evidence = (
        "\n\n".join(f"> {chunk}" for chunk in profile_chunks)
        if profile_chunks
        else "_No profile evidence retrieved._"
    )

    package = f"""# ScholarlE Engen - Coaching Package

## Your Next Step

{_format_coaching_brief(state.get('coaching_brief', {}))}

## Application Readiness Index

{_format_readiness_index(state.get('readiness_index', {}))}

## Eligibility & Requirements Matrix

{_format_eligibility_matrix(state.get('eligibility_matrix', {}))}

## Essay Alignment Matrix

{_format_essay_alignment_matrix(state.get('essay_alignment_matrix', {}))}

## Growth Across Drafts

{_format_growth(state.get('growth_report', {}))}

## Reviewer Simulation

{_format_reviewer_comments(state.get('reviewer_comments', []))}

## Coach Reports

{_format_coaching_reports(state.get('coaching_reports', {}))}

## Opportunity Analysis

{_format_analysis(state.get('opportunity_analysis', {}))}

## Retrieved Profile Evidence

{evidence}

## Section-by-Section Coaching

{_format_section_coaching(state.get('section_coaching', {}))}

## Quality Check (Critic Agent)

{_format_critique(state.get('critique', {}))}
"""

    return {"final_application_package": package}
