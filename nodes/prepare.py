# nodes/prepare.py
"""Context-preparation node: builds the single grounded context that every
specialized generation agent shares, so the expensive assembly happens once."""

from nodes.coaching.agents import build_context
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


def prepare_context(state):
    opportunity_text = state.get("opportunity_text", "")
    student_draft = state.get("student_draft", "")
    profile_chunks = state.get("retrieved_profile_chunks", [])
    opportunity_analysis = state.get("opportunity_analysis", {})

    cv_text = _profile_text_from_state(state)
    name, _stype, prompt = _parse_opportunity_fields(opportunity_text)
    submitted_summary = summarize_submitted_input(cv_text, student_draft, name, prompt)

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

    return {
        "shared_context": context,
        "profile_text": profile_text,
        "submitted_summary": submitted_summary,
    }
