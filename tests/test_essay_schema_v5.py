"""Focused schema-v5 rubric, weighting, isolation, cache, and scoring tests."""

from essay_context import (
    canonicalize_essay_text,
    evidence_indexed_essay,
    submission_readiness,
)
from nodes.coaching.criterion_review import (
    calculate_overall_result,
    normalize_criterion_review,
    normalize_manager_plan,
)
from nodes.coaching.readiness import READINESS_DIMENSIONS
from rubrics.essay_rubric_v1 import (
    ESSAY_RUBRIC,
    calculate_criterion_score,
    normalized_question_weights,
)
from rubrics.manager_weight_policy_v1 import BASE_WEIGHTS, build_manager_plan


def _zero_review(unified, criterion, plan):
    return unified.normalize_criterion_review(
        criterion,
        {
            "answers": [
                {
                    "question_id": question["id"],
                    "value": 0,
                    "evidence": [],
                    "explanation": "This requirement is not demonstrated.",
                }
                for question in plan["questions"]
                if question["applicable"]
            ],
            "coach_feedback": {
                "grounded_praise": "The draft establishes a relevant subject.",
                "main_gap": "The criterion is not yet sufficiently demonstrated.",
            },
            "criterion_specific_gap": {
                "statement": "The criterion is not yet sufficiently demonstrated.",
                "root_cause_tag": "vague_takeaway",
                "severity": "high",
                "evidence": [],
            },
            "candidate_actions": [{
                "action_type": "clarify",
                "location": "Paragraph 1",
                "instruction": "Add one truthful, criterion-relevant detail.",
                "completion_condition": "The requirement is directly demonstrated.",
                "estimated_effort": "Moderate",
            }],
        },
        plan,
    )


def test_fixed_rubric_has_six_criteria_and_thirty_weighted_questions():
    assert tuple(ESSAY_RUBRIC) == tuple(READINESS_DIMENSIONS)
    assert sum(len(config["questions"]) for config in ESSAY_RUBRIC.values()) == 30
    for config in ESSAY_RUBRIC.values():
        assert len(config["questions"]) == 5
        assert sum(question["weight"] for question in config["questions"]) == 100


def test_half_up_rounding_and_essential_question_safeguard_are_code_owned():
    alignment_answers = [
        {"question_id": question_id, "value": value}
        for question_id, value in {
            "A1": 1,
            "A2": 1,
            "A3": 0.5,
            "A4": 0.5,
            "A5": 0.5,
        }.items()
    ]
    result = calculate_criterion_score("alignment", alignment_answers)
    assert result["raw_score"] == 73  # 72.5 rounds half up
    assert result["level"] == "Effective"

    gated = calculate_criterion_score(
        "alignment",
        [
            {"question_id": question["id"], "value": 0 if question["id"] == "A1" else 1}
            for question in ESSAY_RUBRIC["alignment"]["questions"]
        ],
    )
    assert gated["raw_score"] == 70
    assert gated["score"] == 59
    assert gated["level"] == "Developing"
    assert gated["applied_safeguards"]


def test_manager_not_applicable_question_is_predeclared_and_weights_renormalize():
    plan = build_manager_plan(
        {
            "not_applicable_questions": [{
                "criterion": "alignment",
                "question_id": "A3",
                "reason": "No scholarship values or selection priorities were published.",
                "reason_code": "missing_official_context",
                "source_field": "selectionCriteria",
                "source_quote": "",
            }],
        },
        "Prompt: Explain your goals.",
    )
    questions = plan["criteria"]["alignment"]["questions"]
    applicable = [question for question in questions if question["applicable"]]
    assert len(applicable) == 4
    assert next(question for question in questions if question["id"] == "A3")["applicable"] is False
    assert abs(sum(question["normalized_weight"] for question in applicable) - 1) < 1e-9


def test_question_weight_normalization_refuses_fewer_than_four_questions():
    try:
        normalized_question_weights(
            "alignment",
            {"A1": False, "A2": False},
        )
    except ValueError as exc:
        assert "at least four" in str(exc)
    else:
        raise AssertionError("Expected a minimum-applicable-question safeguard")


def test_manager_weights_are_reproducible_bounded_and_explainable():
    source = (
        "Selection criteria: leadership and demonstrated impact. "
        "Prompt: Describe your leadership experience."
    )
    raw = {
        "signals": [
            {
                "criterion": "evidence_strength",
                "signal_type": "selection_criterion",
                "source_field": "selectionCriteria",
                "source_quote": "leadership and demonstrated impact",
                "construct": "demonstrated impact",
            },
            {
                "criterion": "alignment",
                "signal_type": "prompt_ask",
                "source_field": "prompt",
                "source_quote": "Describe your leadership experience",
                "construct": "answer the leadership ask",
            },
        ]
    }
    first = build_manager_plan(raw, source)
    second = build_manager_plan(raw, source)
    first_weights = {key: first["criteria"][key]["weight"] for key in READINESS_DIMENSIONS}
    second_weights = {key: second["criteria"][key]["weight"] for key in READINESS_DIMENSIONS}
    assert first_weights == second_weights
    assert sum(first_weights.values()) == 100
    assert all(abs(first_weights[key] - BASE_WEIGHTS[key]) <= 5 for key in READINESS_DIMENSIONS)
    assert len(first["source_signals"]) == 2


def test_overall_score_caps_score_and_level_when_alignment_is_limited():
    plan = normalize_manager_plan({})
    reviews = {
        key: {
            "available": True,
            "score": 95,
            "level": "Exceptional",
            "weight": plan["criteria"][key]["weight"],
        }
        for key in READINESS_DIMENSIONS
    }
    reviews["alignment"]["score"] = 39
    reviews["alignment"]["level"] = "Limited"
    result = calculate_overall_result(reviews)
    assert result["raw_score"] > 59
    assert result["score"] == 59
    assert result["level"] == "Developing"


def test_blank_or_placeholder_submission_is_insufficient_to_assess():
    assert submission_readiness("   ")["status"] == "insufficient_to_assess"
    assert submission_readiness("[TODO]")["message"] == "Not enough content to assess"
    assert submission_readiness("I led a weekly tutoring group.")["assessable"] is True


def test_api_returns_friendly_insufficient_status_for_blank_submission(monkeypatch):
    from api import routes

    monkeypatch.setattr(routes.settings, "openai_api_key", "test-key")
    result = routes.run_workspace_coaching_session(
        routes.CoachingSessionRequest(essay_text="", prompt="")
    )
    assert result["status"] == "insufficient_to_assess"
    assert result["review"]["status_message"] == "Not enough content to assess"
    assert result["review"]["schema_version"] == 5


def test_formatting_only_changes_share_the_same_canonical_text():
    assert canonicalize_essay_text("First\u00a0line. \r\n\r\n Second line.") == (
        canonicalize_essay_text(" First line.\n\nSecond line. ")
    )
    assert canonicalize_essay_text("First line!\n\nSecond line.") != (
        canonicalize_essay_text("First line.\n\nSecond line.")
    )


def test_profile_only_change_reuses_scorers_and_refreshes_revision_planner(monkeypatch):
    import unified_coaching_service as unified

    monkeypatch.setattr(
        unified,
        "analyze_opportunity_text",
        lambda _text: {"requirements": [], "evaluation_themes": [], "deadlines": []},
    )
    monkeypatch.setattr(
        unified,
        "run_manager_agent",
        lambda _context: normalize_manager_plan({}),
    )
    scorer_calls = []
    planner_profiles = []

    def fake_scorer(key, _context, plan, **_kwargs):
        scorer_calls.append(key)
        return _zero_review(unified, key, plan)

    def fake_planner(context, reviews, **_kwargs):
        planner_profiles.append(context)
        return {
            "available": True,
            "priorities": [{
                "id": "priority_1",
                "title": "Ground the example",
                "action": "Add one truthful action and result.",
                "primary_criterion": "evidence_strength",
                "also_improves": [],
            }],
        }

    monkeypatch.setattr(unified, "run_criterion_review_agent", fake_scorer)
    monkeypatch.setattr(unified, "run_revision_planner", fake_planner)
    monkeypatch.setattr(
        unified,
        "run_criterion_qa",
        lambda _contexts, _plan, _reviews, _priorities: {
            "approved": True,
            "failed_criteria": [],
            "planner_failed": False,
            "issues": [],
        },
    )
    monkeypatch.setattr(
        unified,
        "run_action_guardrail",
        lambda _context, _reviews, _priorities: {
            "approved": True,
            "unsafe_criteria": [],
            "planner_failed": False,
            "issues": [],
        },
    )
    common = {
        "clean_scholarship_record": {"name": "Award"},
        "essay_prompt": "Describe your impact.",
        "essay_draft": "I organized a weekly tutoring group.",
        "scholarship_name": "Award",
        "opportunity_prompt": "Describe your impact.",
    }
    first = unified.run_unified_coaching_session(
        **common,
        profile_text="Profile version one.",
    )
    assert first["review"]["status"] == "success"
    assert len(scorer_calls) == 6

    second = unified.run_unified_coaching_session(
        **common,
        profile_text="Profile version two with a verified result.",
        previous_review=first["review"],
    )
    assert len(scorer_calls) == 6
    assert all(second["agent_status"][key] == "reused" for key in READINESS_DIMENSIONS)
    assert second["review"]["metadata"]["scoring_reused"] is True
    assert "Profile version two" in planner_profiles[-1]

    third = unified.run_unified_coaching_session(
        **common,
        profile_text="Profile version two with a verified result.",
        previous_review=second["review"],
    )
    assert len(planner_profiles) == 2
    assert third["review"]["metadata"]["cache_hit"] is True


def test_criterion_scorer_uses_zero_temperature_structured_output(monkeypatch):
    import nodes.coaching.criterion_review as criterion_review

    captured = {}
    plan = normalize_manager_plan({})["criteria"]["alignment"]
    raw_review = {
        "criterion": "alignment",
        "answers": [
            {
                "question_id": question["id"],
                "value": 0,
                "evidence": [],
                "explanation": "This requirement is not demonstrated.",
            }
            for question in plan["questions"]
            if question["applicable"]
        ],
        "coach_feedback": {
            "grounded_praise": "The draft identifies a relevant subject.",
            "main_gap": "The response does not yet answer the prompt fully.",
        },
        "criterion_specific_gap": {
            "statement": "The response does not yet answer the prompt fully.",
            "root_cause_tag": "missing_prompt_requirement",
            "severity": "high",
            "evidence": [],
        },
        "candidate_actions": [
            {
                "action_type": "answer_prompt",
                "location": "Paragraph 1",
                "instruction": "Answer the missing prompt requirement.",
                "completion_condition": "Every material prompt part is addressed.",
                "estimated_effort": "Moderate",
            }
        ],
    }

    class FakeStructuredModel:
        def invoke(self, prompt):
            captured["prompt"] = prompt
            return raw_review

    class FakeClient:
        def with_structured_output(self, schema):
            captured["schema"] = schema
            return FakeStructuredModel()

    def fake_get_client(temperature=None):
        captured["temperature"] = temperature
        return FakeClient()

    monkeypatch.setattr(criterion_review.llm, "_get_client", fake_get_client)
    result = criterion_review.run_criterion_review_agent(
        "alignment",
        "ESSAY:\nA short draft.",
        plan,
    )

    assert captured["temperature"] == 0.0
    assert captured["schema"] is criterion_review.CriterionReviewOutput
    assert result["available"] is True
    assert len(result["answers"]) == 5


def test_planner_and_critics_use_zero_temperature_structured_output(monkeypatch):
    import nodes.coaching.criterion_review as criterion_review

    captured = {"temperatures": [], "schemas": []}
    manager_plan = normalize_manager_plan({})
    reviews = {
        key: _zero_review(
            criterion_review,
            key,
            manager_plan["criteria"][key],
        )
        for key in READINESS_DIMENSIONS
    }

    outputs = {
        criterion_review.RevisionPlanOutput: {
            "priorities": [
                {
                    "title": "Ground the central example",
                    "action": "Add one truthful action and result.",
                    "location": "Paragraph 1",
                    "completion_condition": "The action and result are explicit.",
                    "primary_criterion": "evidence_strength",
                    "also_improves": ["insight"],
                    "source_gap_criteria": ["evidence_strength"],
                    "impact": "High",
                    "estimated_effort": "Moderate",
                    "evidence_safety": "Use only details you can verify.",
                    "profile_opportunity": {
                        "used": False,
                        "fact": "",
                        "included_in_score": False,
                    },
                }
            ]
        },
        criterion_review.QualityAuditOutput: {
            "scoring_approved": True,
            "failed_criteria": [],
            "planner_approved": True,
            "planner_failed": False,
            "issues": [],
            "correction_guidance": [],
            "planner_correction_guidance": "",
        },
        criterion_review.GuardrailAuditOutput: {
            "approved": True,
            "unsafe_criteria": [],
            "planner_failed": False,
            "issues": [],
            "correction_guidance": [],
            "planner_correction_guidance": "",
        },
    }

    class FakeStructuredModel:
        def __init__(self, schema):
            self.schema = schema

        def invoke(self, _prompt):
            return outputs[self.schema]

    class FakeClient:
        def with_structured_output(self, schema):
            captured["schemas"].append(schema)
            return FakeStructuredModel(schema)

    def fake_get_client(temperature=None):
        captured["temperatures"].append(temperature)
        return FakeClient()

    monkeypatch.setattr(criterion_review.llm, "_get_client", fake_get_client)
    plan = criterion_review.run_revision_planner("COACHING", reviews)
    qa = criterion_review.run_criterion_qa(
        {"alignment": "SCORING"},
        manager_plan,
        reviews,
        plan,
    )
    guardrail = criterion_review.run_action_guardrail("COACHING", reviews, plan)

    assert captured["temperatures"] == [0.0, 0.0, 0.0]
    assert captured["schemas"] == [
        criterion_review.RevisionPlanOutput,
        criterion_review.QualityAuditOutput,
        criterion_review.GuardrailAuditOutput,
    ]
    assert plan["available"] is True
    assert qa["scoring_approved"] is True
    assert qa["planner_approved"] is True
    assert guardrail["approved"] is True


def test_invalid_criterion_repair_cannot_replace_valid_review():
    import unified_coaching_service as unified

    plan = normalize_manager_plan({})["criteria"]["alignment"]
    valid_review = _zero_review(unified, "alignment", plan)
    reviews = {"alignment": valid_review}
    warnings = []
    agent_status = {}
    invalid_candidate = normalize_criterion_review("alignment", {}, plan)

    accepted = unified._accept_valid_repair(
        key="alignment",
        candidate=invalid_candidate,
        reviews=reviews,
        essay_draft="I organized a weekly tutoring group.",
        warnings=warnings,
        agent_status=agent_status,
        attempt_name="alignment_retry",
    )

    assert accepted is False
    assert reviews["alignment"] is valid_review
    assert agent_status["alignment_retry"] == "invalid"
    assert warnings


def test_coaching_failure_preserves_verified_scores_but_withholds_priorities():
    import unified_coaching_service as unified

    manager_plan = normalize_manager_plan({})
    reviews = {
        key: _zero_review(unified, key, manager_plan["criteria"][key])
        for key in READINESS_DIMENSIONS
    }

    result = unified._build_review_result(
        manager_plan=manager_plan,
        reviews=reviews,
        revision_plan={"available": False, "priorities": []},
        qa={"approved": True},
        guardrail={"approved": True},
        essay_draft="I organized a weekly tutoring group.",
        scoring_hash="scoring-hash",
        coaching_hash="coaching-hash",
        previous_review={},
        scoring_reused=False,
    )

    assert result["status"] == "scoring_success_coaching_partial"
    assert isinstance(result["overall_score"], int)
    assert isinstance(result["overall_raw_score"], int)
    assert result["overall_level"] == "Minimal"
    assert result["quality_review"]["approved"] is False
    assert result["quality_review"]["scoring_approved"] is True
    assert result["quality_review"]["coaching_approved"] is False
    assert result["revision_priorities"] == []
    assert result["diagnostics"]["failure_stage"] == "revision_planner"


def test_scoring_failure_never_publishes_an_overall_score():
    import unified_coaching_service as unified

    manager_plan = normalize_manager_plan({})
    reviews = {
        key: _zero_review(unified, key, manager_plan["criteria"][key])
        for key in READINESS_DIMENSIONS
    }
    reviews["clarity_concision"] = normalize_criterion_review(
        "clarity_concision",
        {},
        manager_plan["criteria"]["clarity_concision"],
    )

    result = unified._build_review_result(
        manager_plan=manager_plan,
        reviews=reviews,
        revision_plan={"available": False, "priorities": []},
        qa={"approved": True},
        guardrail={"approved": True},
        essay_draft="I organized a weekly tutoring group.",
        scoring_hash="scoring-hash",
        coaching_hash="coaching-hash",
        previous_review={},
        scoring_reused=False,
        retry_attempts={"clarity_concision": 2},
    )

    assert result["status"] == "partial"
    assert result["overall_score"] is None
    assert result["overall_level"] == "Unavailable"
    assert result["quality_review"]["scoring_approved"] is False
    assert result["diagnostics"]["failure_stage"] == "criterion_validation"
    assert result["diagnostics"]["failed_components"] == ["clarity_concision"]
    assert "missing_rubric_answers" in result["diagnostics"]["error_codes"]
    assert result["diagnostics"]["retry_attempts"]["clarity_concision"] == 2


def test_guardrail_failure_withholds_coaching_not_verified_scores():
    import unified_coaching_service as unified

    manager_plan = normalize_manager_plan({})
    reviews = {
        key: _zero_review(unified, key, manager_plan["criteria"][key])
        for key in READINESS_DIMENSIONS
    }
    result = unified._build_review_result(
        manager_plan=manager_plan,
        reviews=reviews,
        revision_plan={
            "available": True,
            "priorities": [{"id": "priority_1", "title": "Revise safely"}],
        },
        qa={
            "scoring_approved": True,
            "planner_approved": True,
            "failed_criteria": [],
            "planner_failed": False,
        },
        guardrail={
            "approved": False,
            "planner_failed": True,
            "issues": ["The priority assumes an unverified fact."],
        },
        essay_draft="I organized a weekly tutoring group.",
        scoring_hash="scoring-hash",
        coaching_hash="coaching-hash",
        previous_review={},
        scoring_reused=False,
    )

    assert result["status"] == "scoring_success_coaching_partial"
    assert isinstance(result["overall_score"], int)
    assert result["revision_priorities"] == []
    assert result["diagnostics"]["failure_stage"] == "guardrail"
    assert "guardrail_rejected" in result["diagnostics"]["error_codes"]


def test_evidence_matching_normalizes_safe_typographic_differences():
    import unified_coaching_service as unified

    essay = 'I called the project “Fast Track”—and it worked.'
    quote = '"I called the project "Fast Track"-and it worked."'
    assert unified._evidence_quote_exists(essay, quote) is True


def test_backend_passage_ids_resolve_imperfect_model_transcription():
    import unified_coaching_service as unified

    essay = "I have organized tutoring for two years. Attendance improved."
    indexed = evidence_indexed_essay(essay)
    assert "[p1.s1] I have organized tutoring for two years." in indexed
    review = {
        "answers": [
            {
                "question_id": "E1",
                "value": 1.0,
                "evidence": [
                    {
                        "paragraph_id": "p1.s1",
                        "quote": "I organized tutoring for two years.",
                    }
                ],
            }
        ],
        "criterion_specific_gap": {"evidence": []},
    }

    unified._resolve_review_evidence(review, essay)

    evidence = review["answers"][0]["evidence"][0]
    assert evidence["quote"] == "I have organized tutoring for two years."
    assert evidence["resolved_from_passage_id"] is True
