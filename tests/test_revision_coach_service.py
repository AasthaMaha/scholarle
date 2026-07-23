from revision_coach_service import (
    RevisionCoachGuardrailOutput,
    RevisionCoachOutput,
    _validation_issues,
    normalize_profile_facts,
    run_revision_coach,
)
from templates.revision_coach import build_revision_coach_prompt


def test_normalized_profile_inventory_excludes_workflow_and_raw_essay_state():
    facts = normalize_profile_facts(
        {
            "name": "Maya",
            "essayDraft": "Private working draft",
            "essayReviewResult": {"overall_score": 80},
            "workExperience": [
                {"role": "Tutor", "impact": "Supported 15 students"}
            ],
        }
    )

    values = [fact["value"] for fact in facts]
    assert "Maya" in values
    assert "Tutor" in values
    assert "Supported 15 students" in values
    assert "Private working draft" not in values
    assert "80" not in values
    assert all(fact["confirmation_status"] == "student_confirmed" for fact in facts)


def test_sensitive_profile_facts_are_labeled_for_guardrail_review():
    facts = normalize_profile_facts(
        {
            "raceEthnicity": "Example identity",
            "careerGoal": "Become a teacher",
        }
    )
    by_field = {fact["field"]: fact for fact in facts}

    assert by_field["raceEthnicity"]["sensitivity"] == "sensitive"
    assert by_field["careerGoal"]["sensitivity"] == "standard"


def test_validation_rejects_unsupported_numbers():
    fact = {
        "fact_id": "profile.work.impact",
        "value": "Supported 15 students",
    }
    issues = _validation_issues(
        {
            "mode": "evidence_grounded_edit",
            "suggested_text": "I supported 50 students.",
            "selected_profile_facts": [
                {"fact_id": "profile.work.impact", "relevance": "Concrete impact"}
            ],
            "student_input_required": False,
        },
        selected_text="I supported students.",
        surrounding_text="I volunteered every week.",
        fact_index={fact["fact_id"]: fact},
    )

    assert any("50" in issue for issue in issues)


def test_validation_requires_placeholders_for_missing_student_input():
    issues = _validation_issues(
        {
            "mode": "student_input_scaffold",
            "suggested_text": "I helped a student find their voice.",
            "selected_profile_facts": [],
            "student_input_required": True,
        },
        selected_text="I empowered others.",
        surrounding_text="",
        fact_index={},
    )

    assert any("placeholders" in issue for issue in issues)


def test_validation_rejects_repeating_an_adjacent_idea():
    issues = _validation_issues(
        {
            "mode": "exact_edit",
            "suggested_text": (
                "I tutored students every Saturday, reinforcing my belief "
                "that leadership matters."
            ),
            "selected_profile_facts": [],
            "student_input_required": False,
        },
        selected_text="I helped students",
        surrounding_text="and learned that leadership matters.",
        after_text=" and learned that leadership matters.",
        fact_index={},
    )

    assert any("adjacent-context concepts" in issue for issue in issues)


def test_validation_rejects_invented_reflection_or_impact_language():
    issues = _validation_issues(
        {
            "mode": "evidence_grounded_edit",
            "suggested_text": (
                "I tutored 15 students, which strengthened my commitment "
                "to community service."
            ),
            "selected_profile_facts": [
                {"fact_id": "profile.service", "relevance": "Specific action"}
            ],
            "student_input_required": False,
        },
        selected_text="I helped students.",
        surrounding_text="",
        fact_index={
            "profile.service": {
                "fact_id": "profile.service",
                "value": "Tutored 15 students",
            }
        },
    )

    assert any("unsupported reflection" in issue for issue in issues)


def test_revision_coach_returns_grounded_selected_profile_facts(monkeypatch):
    profile = {
        "workExperience": [
            {"role": "Tutor", "impact": "Supported 15 students"}
        ]
    }
    facts = normalize_profile_facts(profile)
    impact_fact = next(fact for fact in facts if fact["value"] == "Supported 15 students")

    def fake_structured_response(_prompt, schema):
        if schema is RevisionCoachOutput:
            return {
                "mode": "evidence_grounded_edit",
                "suggested_text": "As a tutor, I supported 15 students.",
                "reason": "Adds a verified example.",
                "selected_profile_facts": [
                    {
                        "fact_id": impact_fact["fact_id"],
                        "relevance": "Provides a concrete outcome.",
                    }
                ],
                "student_input_required": False,
            }
        assert schema is RevisionCoachGuardrailOutput
        return {
            "approved": True,
            "addresses_priority": True,
            "factual_claims_grounded": True,
            "reflection_grounded": True,
            "boundary_join_clean": True,
            "voice_preserved": True,
            "localized_scope": True,
            "issues": [],
        }

    monkeypatch.setattr(
        "revision_coach_service._structured_response", fake_structured_response
    )
    essay = "I learned to empower others."
    result = run_revision_coach(
        priority={
            "title": "Add a specific example",
            "action": "Ground the claim in evidence.",
        },
        essay_text=essay,
        target_start=0,
        target_end=len(essay),
        student_profile=profile,
        draft_revision="draft-1",
    )

    assert result["status"] == "success"
    assert result["suggested_text"] == "As a tutor, I supported 15 students."
    assert result["selected_profile_facts"][0]["fact_id"] == impact_fact["fact_id"]
    assert result["guardrail"]["approved"] is True


def test_revision_coach_retries_unsupported_reflection_as_student_scaffold(
    monkeypatch,
):
    proposal_count = 0

    def fake_structured_response(prompt, schema):
        nonlocal proposal_count
        if schema is RevisionCoachOutput:
            proposal_count += 1
            if proposal_count == 1:
                return {
                    "mode": "exact_edit",
                    "suggested_text": (
                        "I helped students, which strengthened my confidence."
                    ),
                    "reason": "Adds impact.",
                    "selected_profile_facts": [],
                    "student_input_required": False,
                }
            assert "REQUIRED MODE FOR THIS RETRY: student_input_scaffold" in prompt
            return {
                "mode": "student_input_scaffold",
                "suggested_text": (
                    "I helped students, resulting in [change you personally observed]."
                ),
                "reason": "Prompts the student for the missing result.",
                "selected_profile_facts": [],
                "student_input_required": True,
            }
        assert schema is RevisionCoachGuardrailOutput
        return {
            "approved": False,
            "addresses_priority": True,
            "factual_claims_grounded": True,
            "reflection_grounded": False,
            "boundary_join_clean": True,
            "voice_preserved": True,
            "localized_scope": True,
            "issues": ["A placeholder is not a completed reflection."],
        }

    monkeypatch.setattr(
        "revision_coach_service._structured_response", fake_structured_response
    )
    essay = "I helped students."
    result = run_revision_coach(
        priority={"title": "Show the result"},
        essay_text=essay,
        target_start=0,
        target_end=len(essay),
        student_profile={},
        draft_revision="draft-2",
    )

    assert result["status"] == "success"
    assert result["mode"] == "student_input_scaffold"
    assert result["student_input_required"] is True
    assert "[change you personally observed]" in result["suggested_text"]
    assert proposal_count == 2


def test_revision_prompt_marks_adjacent_text_as_immutable_boundaries():
    prompt = build_revision_coach_prompt(
        priority={"title": "Add evidence"},
        selected_text="I helped students",
        before_text="Before this, I organized a tutoring program. ",
        after_text=" and learned that leadership matters.",
        essay_prompt="Describe your impact.",
        scholarship_context="Community leadership",
        profile_facts=[],
    )

    assert "TEXT IMMEDIATELY BEFORE" in prompt
    assert "TEXT IMMEDIATELY AFTER" in prompt
    assert "immutable" in prompt
    assert "without repeating" in prompt
    assert "Address only this priority" in prompt
