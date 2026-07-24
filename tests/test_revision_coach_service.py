from revision_coach_service import (
    RevisionCoachGuardrailOutput,
    RevisionCoachOutput,
    _validation_issues,
    preferred_revision_action,
    normalize_profile_facts,
    rank_profile_fact_candidates,
    run_revision_coach,
)
from templates.revision_coach import build_revision_coach_prompt
from api.routes import RevisionCoachRequest, run_revision_coach as run_revision_coach_route


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
            "edit_action": "replace",
            "scope": "sentence_group",
            "development_goal": "Add a concrete result",
            "suggested_text": "I supported 50 students.",
            "selected_profile_facts": [
                {"fact_id": "profile.work.impact", "relevance": "Concrete impact"}
            ],
        },
        selected_text="I supported students.",
        surrounding_text="I volunteered every week.",
        fact_index={fact["fact_id"]: fact},
    )

    assert any("50" in issue for issue in issues)


def test_validation_rejects_placeholders_in_suggestion_only_mode():
    issues = _validation_issues(
        {
            "mode": "structural_guidance",
            "edit_action": "replace",
            "scope": "sentence_group",
            "development_goal": "Show an observed result",
            "suggested_text": "I helped students achieve [the result I observed].",
            "selected_profile_facts": [],
        },
        selected_text="I empowered others.",
        surrounding_text="",
        fact_index={},
    )

    assert any("without bracketed placeholders" in issue for issue in issues)


def test_validation_rejects_editing_instructions_instead_of_essay_text():
    issues = _validation_issues(
        {
            "mode": "structural_guidance",
            "edit_action": "insert_after",
            "scope": "paragraph",
            "development_goal": "Connect the scholarship to future plans",
            "suggested_text": (
                "Add a focused passage explaining how the scholarship supports "
                "your future goals and community impact."
            ),
            "selected_profile_facts": [],
        },
        selected_text="I plan to serve my community.",
        surrounding_text="",
        fact_index={},
        priority={"title": "Enhance Scholarship Connection"},
    )

    assert any("essay-ready prose" in issue for issue in issues)


def test_priority_action_maps_clarity_and_connections_to_correct_edits():
    assert preferred_revision_action(
        {
            "title": "Revise for Clarity",
            "action": "Simplify the sentence structure.",
        }
    ) == "replace"
    assert preferred_revision_action(
        {
            "title": "Improve Narrative Flow",
            "action": "Add a sentence connecting the two experiences.",
        }
    ) == "insert_after"
    assert preferred_revision_action(
        {
            "title": "Enhance Scholarship Connection",
            "action": "Explain how the scholarship will enable future goals.",
        }
    ) == "insert_after"


def test_clarity_priority_rejects_insertion_and_requires_replacement():
    issues = _validation_issues(
        {
            "mode": "exact_edit",
            "edit_action": "insert_after",
            "scope": "sentence_group",
            "development_goal": "Make the sentence easier to understand",
            "suggested_text": "This shorter sentence states the same idea more directly.",
            "selected_profile_facts": [],
        },
        selected_text="The original sentence is difficult to follow.",
        surrounding_text="",
        fact_index={},
        priority={
            "title": "Revise for Clarity",
            "action": "Simplify the sentence structure.",
        },
    )

    assert any("Use replace for this priority" in issue for issue in issues)


def test_over_limit_essay_requires_a_shorter_replacement():
    priority = {
        "title": "Add Specific Outcomes of Scholarship Impact",
        "action": "Include specific community outcomes.",
    }
    issues = _validation_issues(
        {
            "mode": "exact_edit",
            "edit_action": "insert_after",
            "scope": "paragraph",
            "development_goal": "Add measurable outcomes",
            "suggested_text": (
                "The scholarship would support two additional community workshops "
                "and expand access to local planning resources."
            ),
            "selected_profile_facts": [],
        },
        selected_text="I want to serve my community.",
        surrounding_text="I want to serve my community.",
        fact_index={},
        priority=priority,
        preferred_edit_action="replace",
        current_word_count=880,
        word_limit=500,
    )

    assert any("Use replace for this priority" in issue for issue in issues)
    assert any("already over its word limit" in issue for issue in issues)


def test_validation_rejects_generic_ai_style_not_used_by_student():
    issues = _validation_issues(
        {
            "mode": "exact_edit",
            "edit_action": "replace",
            "scope": "sentence_group",
            "development_goal": "Clarify the outcome",
            "suggested_text": (
                "This transformative opportunity is a testament to my profound "
                "commitment to community service."
            ),
            "selected_profile_facts": [],
        },
        selected_text="I care about community service.",
        surrounding_text="I care about community service.",
        fact_index={},
        priority={"title": "Revise for Clarity"},
    )

    assert any("generic AI-style phrasing" in issue for issue in issues)


def test_validation_rejects_details_not_supported_by_essay_or_profile():
    issues = _validation_issues(
        {
            "mode": "exact_edit",
            "edit_action": "replace",
            "scope": "sentence_group",
            "development_goal": "Add an observed result",
            "suggested_text": (
                "I supported 12 students, which strengthened my commitment "
                "to community tutoring."
            ),
            "selected_profile_facts": [],
        },
        selected_text="I supported students.",
        surrounding_text="",
        fact_index={},
    )

    assert any("12" in issue for issue in issues)
    assert any("unsupported reflection" in issue for issue in issues)


def test_validation_rejects_repeating_an_adjacent_idea():
    issues = _validation_issues(
        {
            "mode": "exact_edit",
            "edit_action": "replace",
            "scope": "sentence_group",
            "development_goal": "Connect the example to leadership",
            "suggested_text": (
                "I tutored students every Saturday, reinforcing my belief "
                "that leadership matters."
            ),
            "selected_profile_facts": [],
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
            "edit_action": "replace",
            "scope": "sentence_group",
            "development_goal": "Show impact",
            "suggested_text": (
                "I tutored 15 students, which strengthened my commitment "
                "to community service."
            ),
            "selected_profile_facts": [
                {"fact_id": "profile.service", "relevance": "Specific action"}
            ],
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
                "edit_action": "replace",
                "scope": "paragraph",
                "development_goal": "Develop a concrete tutoring example",
                "suggested_text": (
                    "As a tutor, I supported 15 students through regular sessions. "
                    "That direct work gives a concrete example of how I served others."
                ),
                "reason": "Adds a verified example.",
                "selected_profile_facts": [
                    {
                        "fact_id": impact_fact["fact_id"],
                        "relevance": "Provides a concrete outcome.",
                    }
                ],
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
            "substantive_change": True,
            "not_grammar_only": True,
            "uses_best_available_evidence": True,
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
    assert result["suggested_text"] == (
        "As a tutor, I supported 15 students through regular sessions. "
        "That direct work gives a concrete example of how I served others."
    )
    assert result["scope"] == "paragraph"
    assert result["selected_profile_facts"][0]["fact_id"] == impact_fact["fact_id"]
    assert result["guardrail"]["approved"] is True


def test_revision_coach_retries_unsupported_reflection_as_direct_suggestion(
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
                    "edit_action": "replace",
                    "scope": "sentence_group",
                    "development_goal": "Show the result",
                    "suggested_text": (
                        "I helped students, which strengthened my confidence."
                    ),
                    "reason": "Adds impact.",
                    "selected_profile_facts": [],
                }
            assert "Do not ask a question" in prompt
            return {
                "mode": "exact_edit",
                "edit_action": "replace",
                "scope": "paragraph",
                "development_goal": "Show the result",
                "suggested_text": (
                    "I helped students by offering direct support and staying focused "
                    "on the work in front of me."
                ),
                "reason": "Develops the supported action without inventing a result.",
                "selected_profile_facts": [],
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
            "substantive_change": True,
            "not_grammar_only": True,
            "uses_best_available_evidence": True,
            "issues": [],
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
    assert result["mode"] == "exact_edit"
    assert result["can_apply"] is True
    assert "coaching_question" not in result
    assert "[" not in result["suggested_text"]
    assert proposal_count == 2


def test_revision_coach_returns_no_question_fields(monkeypatch):
    def fake_structured_response(_prompt, schema):
        if schema is RevisionCoachOutput:
            return {
                "mode": "exact_edit",
                "edit_action": "replace",
                "scope": "sentence_group",
                "development_goal": "Develop the supported action",
                "suggested_text": (
                    "I supported students through the program by giving them "
                    "consistent attention during each session."
                ),
                "reason": "Develops the action already present in the essay.",
                "selected_profile_facts": [],
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
            "substantive_change": True,
            "not_grammar_only": True,
            "uses_best_available_evidence": True,
            "issues": [],
        }

    monkeypatch.setattr(
        "revision_coach_service._structured_response", fake_structured_response
    )
    essay = "I supported students through the program."
    result = run_revision_coach(
        priority={"title": "Develop the action"},
        essay_text=essay,
        target_start=0,
        target_end=len(essay),
        student_profile={},
        draft_revision="draft-direct",
    )

    assert result["status"] == "success"
    assert result["can_apply"] is True
    assert "student_input_required" not in result
    assert "coaching_question" not in result
    assert "student_answer_used" not in result


def test_revision_coach_removes_internal_language_from_visible_explanation(monkeypatch):
    def fake_structured_response(_prompt, schema):
        if schema is RevisionCoachOutput:
            return {
                "mode": "exact_edit",
                "edit_action": "replace",
                "scope": "sentence_group",
                "development_goal": "Strengthen the supported example",
                "suggested_text": (
                    "I supported students through weekly sessions that focused "
                    "on the assignments in front of them."
                ),
                "reason": (
                    "The guardrail validator approved this grounded model output. "
                    "It makes the student’s action more specific."
                ),
                "selected_profile_facts": [],
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
            "substantive_change": True,
            "not_grammar_only": True,
            "uses_best_available_evidence": True,
            "issues": [],
        }

    monkeypatch.setattr(
        "revision_coach_service._structured_response", fake_structured_response
    )
    essay = "I supported students through weekly sessions."
    result = run_revision_coach(
        priority={"title": "Develop the student’s action"},
        essay_text=essay,
        target_start=0,
        target_end=len(essay),
        student_profile={},
    )

    assert result["status"] == "success"
    assert result["reason"] == "It makes the student’s action more specific."
    assert "guardrail" not in result["reason"].lower()
    assert "model" not in result["reason"].lower()


def test_validation_rejects_grammar_only_polish():
    issues = _validation_issues(
        {
            "mode": "exact_edit",
            "edit_action": "replace",
            "scope": "sentence_group",
            "development_goal": "Strengthen the example",
            "suggested_text": "I lead the tutoring program every single week.",
            "selected_profile_facts": [],
        },
        selected_text="I lead the tutoring program every week.",
        surrounding_text="",
        fact_index={},
    )

    assert any(
        "grammar-level" in issue or "grammar polish" in issue
        for issue in issues
    )


def test_profile_fact_candidates_prioritize_relevant_experience():
    facts = normalize_profile_facts(
        {
            "careerGoal": "Become an engineer",
            "workExperience": [
                {
                    "role": "Tutor",
                    "impact": "Supported 15 students in weekly math sessions",
                }
            ],
        }
    )
    ranked = rank_profile_fact_candidates(
        facts,
        priority={
            "title": "Add a tutoring example",
            "action": "Show specific evidence of tutoring impact.",
        },
        essay_prompt="Describe your community leadership.",
        selected_text="I care about helping students.",
    )

    assert ranked[0]["value"] == "Supported 15 students in weekly math sessions"
    assert ranked[0]["candidate_relevance_score"] > 0


def test_revision_coach_returns_actionable_advice_when_a_complete_edit_is_not_safe(
    monkeypatch,
):
    def fake_structured_response(_prompt, schema):
        assert schema is RevisionCoachOutput
        return {
            "mode": "exact_edit",
            "edit_action": "replace",
            "scope": "sentence_group",
            "development_goal": "Add evidence",
            "suggested_text": "I helped students a lot.",
            "reason": "Improves the sentence.",
            "selected_profile_facts": [],
        }

    monkeypatch.setattr(
        "revision_coach_service._structured_response", fake_structured_response
    )
    essay = "I helped students."
    result = run_revision_coach(
        priority={
            "title": "Add a concrete outcome",
            "action": "Develop the example with an observed result.",
        },
        essay_text=essay,
        target_start=0,
        target_end=len(essay),
        student_profile={},
        draft_revision="draft-fallback",
    )

    assert result["status"] == "success"
    assert result["assistance_type"] == "advice"
    assert result["can_apply"] is False
    assert "suggested_text" not in result
    assert "observed" in result["advice"]
    assert "verified" in result["evidence_needed"]
    assert "validation" not in result["advice"].lower()


def test_revision_coach_returns_useful_advice_when_model_is_unavailable(monkeypatch):
    def unavailable_model(_prompt, _schema):
        raise RuntimeError("temporary provider failure")

    monkeypatch.setattr(
        "revision_coach_service._structured_response", unavailable_model
    )
    essay = "I volunteered in my community."
    result = run_revision_coach(
        priority={"title": "Develop the community example"},
        essay_text=essay,
        target_start=0,
        target_end=len(essay),
        student_profile={},
        draft_revision="draft-unavailable",
    )

    assert result["status"] == "success"
    assert result["assistance_type"] == "advice"
    assert result["can_apply"] is False
    assert "suggested_text" not in result
    assert result["advice"]
    assert "agent" not in result["advice"].lower()
    assert "model" not in result["advice"].lower()


def test_over_limit_model_failure_returns_safe_extractive_shortening(monkeypatch):
    def unavailable_model(_prompt, _schema):
        raise RuntimeError("temporary provider failure")

    monkeypatch.setattr(
        "revision_coach_service._structured_response", unavailable_model
    )
    essay = (
        "I returned from Tanzania committed to studying civil engineering. "
        "I will organize two additional community planning workshops and create "
        "a reusable guide for residents. "
        "These projects will give neighbors practical tools for future planning."
    )
    result = run_revision_coach(
        priority={
            "title": "Add Specific Outcomes of Scholarship Impact",
            "action": "Include two specific community outcomes.",
        },
        essay_text=essay,
        target_start=0,
        target_end=len(essay),
        student_profile={},
        draft_revision="draft-over-limit",
        current_word_count=880,
        word_limit=500,
    )

    assert result["status"] == "success"
    assert result["edit_action"] == "replace"
    assert result["word_delta"] < 0
    assert result["projected_word_count"] < 880
    assert result["guardrail"]["programmatic_extractive_shortening"] is True
    assert result["suggested_text"] in essay


def test_revision_coach_route_forwards_word_budget(monkeypatch):
    captured = {}

    def fake_service(**kwargs):
        captured.update(kwargs)
        return {"status": "success"}

    monkeypatch.setattr("api.routes.run_revision_coach_service", fake_service)
    monkeypatch.setattr("api.routes.settings.openai_api_key", "test-key")
    result = run_revision_coach_route(
        RevisionCoachRequest(
            priority={"title": "Shorten the impact passage"},
            essay_text="A complete essay passage.",
            target_start=0,
            target_end=26,
            current_word_count=880,
            word_limit=500,
        )
    )

    assert result["status"] == "success"
    assert captured["current_word_count"] == 880
    assert captured["word_limit"] == 500


def test_revision_prompt_marks_adjacent_text_as_immutable_boundaries():
    prompt = build_revision_coach_prompt(
        priority={"title": "Add evidence"},
        full_essay="Before this, I organized a tutoring program. I helped students.",
        selected_text="I helped students",
        before_text="Before this, I organized a tutoring program. ",
        after_text=" and learned that leadership matters.",
        essay_prompt="Describe your impact.",
        scholarship_context="Community leadership",
        profile_facts=[],
        preferred_edit_action="insert_after",
    )

    assert "TEXT IMMEDIATELY BEFORE" in prompt
    assert "TEXT IMMEDIATELY AFTER" in prompt
    assert "immutable" in prompt
    assert "without repeating" in prompt
    assert "Address only this priority" in prompt
    assert "normally develops content rather than correcting mechanics" in prompt
    assert "normally two to five sentences" in prompt
    assert "Never ask the student a question" in prompt
    assert "essay-ready prose only" in prompt
