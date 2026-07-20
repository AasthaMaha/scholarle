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


def test_unified_coaching_session_runs_both_branches_on_cleaned_draft(monkeypatch):
    from api import routes

    seen = {}

    def fake_analyze(request):
        seen["evaluation_draft"] = request.essay_text
        return {"readiness_index": {"alignment": {"score": 70}}}

    def fake_coach(**kwargs):
        seen["coach_draft"] = kwargs["essay_draft"]
        return {"status": "success", "sentence_suggestions": [], "warnings": []}

    monkeypatch.setattr(routes.settings, "openai_api_key", "test-key")
    monkeypatch.setattr(routes, "analyze_application", fake_analyze)
    monkeypatch.setattr(routes, "run_essay_workspace_coach", fake_coach)

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
    assert seen["evaluation_draft"] == result["cleaned_draft"]
    assert seen["coach_draft"] == result["cleaned_draft"]


def test_unified_coaching_session_keeps_coach_when_evaluation_fails(monkeypatch):
    from api import routes

    def failed_analyze(_request):
        raise RuntimeError("score provider timed out")

    def fake_coach(**_kwargs):
        return {
            "status": "success",
            "coach_summary": "Writing feedback is ready.",
            "sentence_suggestions": [],
            "warnings": [],
        }

    monkeypatch.setattr(routes.settings, "openai_api_key", "test-key")
    monkeypatch.setattr(routes, "analyze_application", failed_analyze)
    monkeypatch.setattr(routes, "run_essay_workspace_coach", fake_coach)

    result = routes.run_workspace_coaching_session(_coaching_session_request())

    assert result["status"] == "partial"
    assert result["components"]["coach"] == "success"
    assert result["components"]["evaluation"] == "error"
    assert result["coach_pack"]["coach_summary"] == "Writing feedback is ready."
    assert any("score provider timed out" in warning for warning in result["warnings"])
