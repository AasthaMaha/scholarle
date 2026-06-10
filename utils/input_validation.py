# utils/input_validation.py
"""Factual summaries of submitted input — context for agents, not score overrides."""


def word_count(text: str) -> int:
    text = (text or "").strip()
    return len(text.split()) if text else 0


def summarize_submitted_input(
    cv_text: str,
    essay_text: str,
    scholarship_name: str,
    prompt: str,
) -> str:
    """Describe exactly what the student submitted (no scoring logic)."""
    return (
        f"Scholarship name ({word_count(scholarship_name)} words): {scholarship_name!r}\n"
        f"Scholarship prompt ({word_count(prompt)} words): {prompt!r}\n"
        f"CV / profile ({word_count(cv_text)} words): {cv_text!r}\n"
        f"Essay draft ({word_count(essay_text)} words): {essay_text!r}"
    )
