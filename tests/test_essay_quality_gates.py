"""Quality-gate unit tests for essay coaching architecture."""

from essay_coaching_service import (
    SentenceSuggestion,
    _clean_sentence_suggestions,
    _resolve_writing_support_level,
)
from essay_mechanics import apply_deterministic_mechanics
from nodes.critic import _programmatic_completeness
from nodes.combine import _normalize_revision_actions, _rank_global_actions
from nodes.routing import route_generators
from templates.essay_coach import COACH_GUARDRAILS, EDIT_RISK_TIERS


class _Item:
    def __init__(self, original, suggested, stype="grammar", severity="medium", reason=""):
        self.original_text = original
        self.suggested_text = suggested
        self.suggestion_type = stype
        self.severity = severity
        self.reason = reason


def test_resolve_writing_support_forces_grammar_for_evaluate_modes():
    assert _resolve_writing_support_level("workspace_refresh", "sentence_polish") == "grammar_only"
    assert _resolve_writing_support_level("auto_check", "rewrite_help") == "grammar_only"
    assert _resolve_writing_support_level("full", "sentence_polish") == "sentence_polish"
    assert _resolve_writing_support_level("full", "bogus") == "sentence_polish"


def test_clean_suggestions_filters_polish_in_grammar_only():
    draft = "I recieved an award for leadership."
    raw = [
        _Item("recieved", "received", "grammar"),
        _Item("I recieved an award for leadership.", "I earned recognition for leadership.", "word_choice"),
        _Item("leadership", "visionary leadership impact", "tone"),
    ]
    cleaned = _clean_sentence_suggestions(draft, raw, writing_support_level="grammar_only")
    assert len(cleaned) == 1
    assert cleaned[0]["suggestion_type"] == "grammar"
    assert cleaned[0]["risk_tier"] == "C0"


def test_clean_suggestions_assigns_risk_tiers():
    draft = "This is a very long sentence that could be clearer for readers."
    raw = [
        _Item(
            "This is a very long sentence that could be clearer for readers.",
            "This long sentence could be clearer.",
            "clarity",
        )
    ]
    cleaned = _clean_sentence_suggestions(draft, raw, writing_support_level="sentence_polish")
    assert cleaned[0]["risk_tier"] == EDIT_RISK_TIERS["clarity"]


def test_clean_suggestions_rejects_overlong_rewrites():
    draft = "Short."
    raw = [_Item("Short.", "Short. " + ("extra " * 80), "clarity")]
    cleaned = _clean_sentence_suggestions(draft, raw, writing_support_level="sentence_polish")
    assert cleaned == []


def test_programmatic_completeness_flags_missing_actions():
    readiness = {
        "alignment": {"score": 70, "justification": "ok", "revision_actions": []},
        "evidence_strength": {
            "score": 65,
            "justification": "ok",
            "revision_actions": [{
                "priority": "Add evidence",
                "how_to_fix": "In paragraph 2, add a profile-backed result.",
                "impact": "High",
                "estimated_effort": "Moderate",
            }],
        },
    }
    # Fill remaining dims with incomplete stubs so issues accumulate.
    for dim in (
        "insight",
        "coherence_continuity",
        "flow_narrative_arc",
        "tone_authenticity",
        "clarity_concision",
    ):
        readiness[dim] = {"score": 50, "justification": "", "revision_actions": []}
    issues = _programmatic_completeness(readiness, {"coach_message": ""})
    assert any("alignment" in i for i in issues)
    assert any("coach_message" in i for i in issues)


def test_normalize_revision_actions_keeps_one():
    actions = _normalize_revision_actions([
        {
            "priority": "A",
            "why_it_matters": "because",
            "how_to_fix": "do X in para 1",
            "impact": "high",
            "estimated_effort": "quick",
        },
        {
            "priority": "B",
            "how_to_fix": "do Y",
            "impact": "Low",
            "estimated_effort": "Deep",
        },
    ])
    assert len(actions) == 1
    assert actions[0]["impact"] == "High"
    assert actions[0]["estimated_effort"] == "Quick"


def test_rank_global_actions_orders_by_impact_then_score():
    readiness = {
        "alignment": {
            "score": 40,
            "revision_actions": [{
                "priority": "Fix alignment",
                "impact": "High",
                "how_to_fix": "Cover prompt part 2",
                "estimated_effort": "Moderate",
            }],
        },
        "clarity_concision": {
            "score": 80,
            "revision_actions": [{
                "priority": "Tighten sentence",
                "impact": "Low",
                "how_to_fix": "Cut filler in para 3",
                "estimated_effort": "Quick",
            }],
        },
        "evidence_strength": {
            "score": 55,
            "revision_actions": [{
                "priority": "Add metric",
                "impact": "High",
                "how_to_fix": "Add a profile-backed number",
                "estimated_effort": "Moderate",
            }],
        },
    }
    ranked = _rank_global_actions(readiness)
    assert ranked[0]["priority"] in {"Fix alignment", "Add metric"}
    assert ranked[0]["impact"] == "High"


def test_route_generators_skips_section_coaching_by_default():
    state = {
        "student_draft": " ".join(["word"] * 40),
        "profile_text": " ".join(["profile"] * 40),
        "include_section_coaching": False,
    }
    targets = route_generators(state)
    assert "narrative_agent" in targets
    assert "coach_sections" not in targets

    state["include_section_coaching"] = True
    targets = route_generators(state)
    assert "coach_sections" in targets


def test_deterministic_mechanics_applies_spelling_and_spacing():
    draft = "I recieve awards  becuase i lead."
    result = apply_deterministic_mechanics(draft)
    assert "received" in result["draft"] or "receive" in result["draft"]
    assert "because" in result["draft"]
    assert " I " in f" {result['draft']} " or result["draft"].startswith("I ")
    assert result["applied_count"] >= 2


def test_deterministic_mechanics_preserves_clean_draft():
    draft = "I believe mentoring helped my classmates succeed."
    result = apply_deterministic_mechanics(draft)
    assert result["draft"] == draft
    assert result["applied_count"] == 0


def test_coach_guardrails_require_fact_traceability():
    assert "EVIDENCE LOCK" in COACH_GUARDRAILS
    assert "FACT TRACEABILITY" in COACH_GUARDRAILS
    assert "ACTION QUALITY" in COACH_GUARDRAILS
    assert "ADAPTIVE COACHING" in COACH_GUARDRAILS


def test_resolve_writing_brief_is_prompt_driven():
    from prompt_adaptation import resolve_writing_brief

    brief = resolve_writing_brief(
        essay_prompt="1. Describe your leadership.\n2. Explain a challenge you overcame.",
        clean_scholarship_record={"name": "Demo Scholarship"},
    )
    assert brief["mode"] == "prompt_driven"
    assert brief["has_formal_prompt"] is True
    assert len(brief["prompt_asks"]) >= 2


def test_resolve_writing_brief_scholarship_guided_without_prompt():
    from prompt_adaptation import resolve_writing_brief

    brief = resolve_writing_brief(
        essay_prompt="",
        clean_scholarship_record={
            "name": "Mission Fund",
            "description": "Supports community health leaders.",
            "selectionCriteria": ["Service", "Leadership potential"],
        },
    )
    assert brief["mode"] == "scholarship_guided"
    assert brief["has_formal_prompt"] is False
    assert "Mission Fund" in brief["writing_brief"]


def _coaching_session_request():
    from api.routes import CoachingSessionRequest

    return CoachingSessionRequest(
        user_id="student@example.com",
        cv_text="Engineering student with tutoring and robotics experience.",
        essay_text="I recieve support  becuase i mentor younger students in our robotics club.",
        scholarship_name="Engineering Scholars Award",
        scholarship_type="Scholarship",
        prompt="Describe your leadership and community impact.",
        student_profile={"careerGoal": "Mechanical engineer"},
        clean_scholarship_record={"name": "Engineering Scholars Award"},
        essay_prompt="Describe your leadership and community impact.",
        outline_points=[{"id": "p-core", "label": "Leadership impact"}],
    )


def test_unified_coaching_session_runs_one_merged_graph_on_cleaned_draft(monkeypatch):
    from api import routes

    seen = {}

    def fake_unified(**kwargs):
        seen["draft"] = kwargs["essay_draft"]
        return {
            "evaluation": {"readiness_index": {"alignment": {"score": 70}}},
            "coach_pack": {"status": "success", "sentence_suggestions": [], "warnings": []},
            "warnings": [],
            "agent_status": {"alignment": "success", "evaluator": "success"},
        }

    def legacy_pipeline_must_not_run(*_args, **_kwargs):
        raise AssertionError("legacy lightweight/deep pipeline was called")

    monkeypatch.setattr(routes.settings, "openai_api_key", "test-key")
    monkeypatch.setattr(routes, "run_unified_coaching_session", fake_unified)
    monkeypatch.setattr(routes, "analyze_application", legacy_pipeline_must_not_run)
    monkeypatch.setattr(routes, "run_essay_workspace_coach", legacy_pipeline_must_not_run)

    result = routes.run_workspace_coaching_session(_coaching_session_request())

    assert result["status"] == "success"
    assert result["components"] == {
        "mechanics": "success",
        "evaluation": "success",
        "coach": "success",
    }
    assert result["session_id"].startswith("coach_")
    assert len(result["draft_hash"]) == 64
    assert "receive" in result["cleaned_draft"]
    assert seen["draft"] == result["cleaned_draft"]
    assert result["agents"]["evaluator"] == "success"


def test_unified_coaching_session_keeps_coach_when_evaluation_fails(monkeypatch):
    from api import routes

    def fake_unified(**_kwargs):
        return {
            "evaluation": None,
            "coach_pack": {
                "status": "success",
                "coach_summary": "Writing feedback is ready.",
                "sentence_suggestions": [],
                "warnings": [],
            },
            "warnings": ["unified evaluation failed: score provider timed out"],
            "agent_status": {"evaluator": "error"},
        }

    monkeypatch.setattr(routes.settings, "openai_api_key", "test-key")
    monkeypatch.setattr(routes, "run_unified_coaching_session", fake_unified)

    result = routes.run_workspace_coaching_session(_coaching_session_request())

    assert result["status"] == "partial"
    assert result["components"]["coach"] == "success"
    assert result["components"]["evaluation"] == "error"
    assert result["coach_pack"]["coach_summary"] == "Writing feedback is ready."
    assert any("score provider timed out" in warning for warning in result["warnings"])


def test_merged_graph_feeds_shared_specialists_to_single_evaluator(monkeypatch):
    import unified_coaching_service as unified

    monkeypatch.setattr(
        unified,
        "analyze_opportunity",
        lambda _state: {
            "opportunity_analysis": {
                "opportunity_type": "Scholarship",
                "requirements": ["Leadership"],
                "evaluation_themes": ["Community impact"],
                "deadlines": [],
            }
        },
    )
    monkeypatch.setattr(unified, "_run_sentence_corrector", lambda *_args: [])
    monkeypatch.setattr(
        unified,
        "_run_prompt_alignment",
        lambda *_args: {"alignment_score": 72, "revision_tasks": ["Answer the impact question."]},
    )
    monkeypatch.setattr(
        unified,
        "_run_profile_grounding",
        lambda *_args: {"grounding_score": 80, "supported_claims": ["Robotics mentoring"]},
    )
    monkeypatch.setattr(
        unified,
        "_run_structure_flow",
        lambda *_args: {"structure_score": 75, "paragraph_feedback": []},
    )
    monkeypatch.setattr(unified, "_run_specificity", lambda *_args: {"specificity_score": 68})
    monkeypatch.setattr(unified, "_run_tone_authenticity", lambda *_args: {"authenticity_score": 85})
    monkeypatch.setattr(unified, "run_strategy_coach", lambda _context: {"strategic_insight": "Show impact."})
    monkeypatch.setattr(unified, "run_eligibility_matrix", lambda _context: {"rows": []})
    monkeypatch.setattr(unified, "run_narrative_coach", lambda _context: {"biggest_narrative_gap": "Reflect."})
    monkeypatch.setattr(unified, "run_discovery_coach", lambda _context: {"hidden_strengths": []})
    monkeypatch.setattr(unified, "_run_outline_coverage", lambda *_args: {"covered_point_ids": ["p-core"]})
    monkeypatch.setattr(
        unified,
        "run_reviewer_simulation_coach",
        lambda *_args: {"scholarship_reviewer": {"comment": "Promising but incomplete."}},
    )
    monkeypatch.setattr(
        unified,
        "build_essay_alignment_matrix",
        lambda _state: {"overall_alignment_status": "Needs revision", "matrix": []},
    )

    evaluator_inputs = []

    def fake_evaluator(state):
        evaluator_inputs.append(state["specialist_reports"])
        action = {
            "priority": "Answer the impact question",
            "why_it_matters": "The prompt asks for impact.",
            "how_to_fix": "Add the mentoring result after paragraph two.",
            "impact": "High",
            "estimated_effort": "Moderate",
        }
        return {
            "coaching_brief": {"coach_message": "Focus on the missing impact explanation."},
            "readiness_index": {"alignment": {"score": 72}},
            "growth_report": {},
            "reviewer_comments": [],
            "coaching_reports": {},
            "eligibility_matrix": {},
            "feedback": "Focus on impact.",
            "revision_priorities": ["Answer the impact question"],
            "ranked_revision_actions": [action],
            "scores": {"overall_score": 72},
        }

    monkeypatch.setattr(unified, "combine_coaching", fake_evaluator)
    monkeypatch.setattr(
        unified,
        "critic_review",
        lambda _state: {"critique": {"verdict": "approved"}, "critic_attempts": 1, "needs_revision": False},
    )

    result = unified.run_unified_coaching_session(
        student_profile={"profile_text": "I mentor students through a robotics club."},
        clean_scholarship_record={"name": "Engineering Award"},
        essay_prompt="Describe your leadership and impact.",
        essay_draft="I mentor younger robotics students each week and have learned to lead by listening.",
        outline_points=[{"id": "p-core", "label": "Leadership impact"}],
        scholarship_name="Engineering Award",
        opportunity_prompt="Describe your leadership and impact.",
    )

    assert len(evaluator_inputs) == 1
    assert evaluator_inputs[0]["prompt_alignment"]["alignment_score"] == 72
    assert evaluator_inputs[0]["profile_grounding"]["grounding_score"] == 80
    assert result["evaluation"]["readiness_index"]["alignment"]["score"] == 72
    assert result["coach_pack"]["revision_priorities"][0]["priority"] == "Answer the impact question"
    assert result["coach_pack"]["outline_coverage"]["covered_point_ids"] == ["p-core"]
