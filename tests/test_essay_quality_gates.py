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
