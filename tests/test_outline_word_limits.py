from api.routes import (
    OutlineGenerateRequest,
    _effective_outline_word_limit,
    _outline_contract_violations,
    _outline_fallback,
)


def compact_section(number: int, estimated_words: int = 100) -> dict:
    return {
        "section_name": f"Tailored Focus {number}",
        "purpose": "Use one relevant experience and explain how it demonstrates your connection to this opportunity.",
        "suggested_content": ["Use one concrete example.", "Connect it to the scholarship."],
        "profile_evidence_to_use": ["Most relevant profile experience"],
        "scholarship_requirement_addressed": ["What demonstrates your fit with this opportunity?"],
        "estimated_word_count": f"About {estimated_words} words",
        "coaching_notes": ["Keep the example specific."],
    }


def test_scholarship_guided_outline_uses_compact_default_word_limit():
    request = OutlineGenerateRequest(
        scholarship_name="Community Scholarship",
        clean_scholarship_record={"description": "Supports community leadership."},
        essay_prompt="",
        word_limit="",
    )

    assert _effective_outline_word_limit(request) == "Maximum 500 words"
    fallback = _outline_fallback(request)
    section_counts = [
        int(section["estimated_word_count"].split()[1])
        for section in fallback["outline"]["sections"]
    ]
    assert sum(section_counts) == 500
    assert len(fallback["outline"]["sections"]) == 3
    assert all(
        len(section["suggested_content"]) <= 2
        and len(section["profile_evidence_to_use"]) <= 2
        and len(section["coaching_notes"]) <= 2
        for section in fallback["outline"]["sections"]
    )


def test_published_word_limit_overrides_scholarship_guided_default():
    request = OutlineGenerateRequest(
        scholarship_name="Community Scholarship",
        clean_scholarship_record={"requirementsPreview": "Maximum 300 words."},
        essay_prompt="",
        word_limit="Maximum 300 words",
    )

    assert _effective_outline_word_limit(request) == "Maximum 300 words"


def test_compact_scholarship_guided_outline_satisfies_contract():
    data = {"outline": {"sections": [compact_section(index) for index in range(1, 4)]}}
    writing_brief = {"mode": "scholarship_guided", "prompt_asks": []}

    assert _outline_contract_violations(data, writing_brief, "Maximum 300 words") == []


def test_oversized_scholarship_guided_outline_requires_repair():
    sections = [compact_section(index) for index in range(1, 5)]
    sections[0]["suggested_content"].append("Add an unnecessary third suggestion.")
    data = {"outline": {"sections": sections}}
    writing_brief = {"mode": "scholarship_guided", "prompt_asks": []}

    violations = _outline_contract_violations(data, writing_brief, "Maximum 300 words")

    assert any("must contain exactly 3 concise sections" in violation for violation in violations)
    assert any("more than two content suggestions" in violation for violation in violations)
    assert any("exceeding the 300-word limit" in violation for violation in violations)
