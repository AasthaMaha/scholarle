"""Quality-gate unit tests for essay coaching architecture."""

from essay_editor_service import (
    SentenceSuggestion,
    _clean_sentence_suggestions,
    _resolve_writing_support_level,
)
from nodes.coaching.readiness import READINESS_DIMENSIONS
from nodes.coaching.criterion_review import (
    CRITERION_AUDIT_PLAYBOOKS,
    normalize_manager_plan,
    weighted_overall_score,
)
from templates.essay_coach import (
    COACH_GUARDRAILS,
    EDIT_RISK_TIERS,
    build_alignment_prompt,
    build_clarity_concision_prompt,
    build_evidence_strength_prompt,
    build_grammar_prompt,
    build_insight_prompt,
    build_narrative_structure_prompt,
    build_tone_authenticity_prompt,
)


class _Item:
    def __init__(self, original, suggested, stype="grammar", severity="medium", reason=""):
        self.original_text = original
        self.suggested_text = suggested
        self.suggestion_type = stype
        self.severity = severity
        self.reason = reason


def _complete_audit(criterion: str) -> dict:
    return {
        key: ([] if isinstance(example, list) else "none")
        for key, example in CRITERION_AUDIT_PLAYBOOKS[criterion]["schema"].items()
    }


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


def test_evidence_strength_prompt_merges_grounding_specificity_and_discovery():
    system, human = build_evidence_strength_prompt(
        essay_draft="I led our tutoring program.",
        profile_text="Tutored 12 students for 40 hours.",
        scholarship_context="Values community impact.",
    )

    assert "profile grounding, experience discovery, specificity, and impact" in system
    assert "unsupported_or_risky_claims" in system
    assert "invented_or_unverifiable_details" in system
    assert "unused_relevant_profile_evidence" in system
    assert "recommended_experience_to_feature" in system
    assert "never supply or imply answers" in system
    assert "Tutored 12 students for 40 hours." in human


def test_alignment_prompt_merges_prompt_coverage_and_scholarship_strategy():
    system, human = build_alignment_prompt(
        essay_draft="My research made me want to serve rural communities.",
        essay_prompt="Explain your goals and community impact.",
        profile_text="Research assistant in a rural health laboratory.",
        scholarship_context="Prioritizes service and rural health research.",
    )

    assert "prompt-coverage analysis and scholarship-strategy analysis" in system
    assert "covered_prompt_parts" in system
    assert "stated_scholarship_values" in system
    assert "student_fit_connections" in system
    assert "generic_or_unsupported_fit_claims" in system
    assert "unless stated" in system
    assert "Research assistant in a rural health laboratory." in human


def test_narrative_structure_prompt_merges_flow_arc_and_coherence():
    system, human = build_narrative_structure_prompt(
        essay_draft="I saw the problem. I started a program. It changed how I lead.",
        essay_prompt="Describe a challenge and what you learned.",
        personalized_outline="Context, action, reflection, takeaway",
        profile_text="Founded a peer tutoring program.",
    )

    assert "paragraph-structure analysis and narrative-arc analysis" in system
    assert "context and motivation to action, reflection, and" in system
    assert "contradictions_or_timeline_issues" in system
    assert "missing_reasoning" in system
    assert "ideas, timeline, motivations, people, events, and claims" in system
    assert "Do not judge how profound, meaningful, or transformative" in system
    assert "Founded a peer tutoring program." in human


def test_insight_prompt_owns_depth_meaning_change_and_reflection():
    system, human = build_insight_prompt(
        essay_draft="Mentoring changed how I listen before making decisions.",
        essay_prompt="Describe what you learned from serving others.",
        profile_text="Mentored twelve students.",
        scholarship_context="Values thoughtful community leadership.",
    )

    assert "depth, meaning, reflection, learning, change, and" in system
    assert "surface_level_or_generic_reflections" in system
    assert "changes_in_mindset_or_behavior" in system
    assert "significance_to_others_or_community" in system
    assert "future_direction_connections" in system
    assert "Narrative Structure owns where reflection appears" in system
    assert "Mentored twelve students." in human


def test_tone_authenticity_prompt_covers_voice_and_ai_language_risks():
    system, human = build_tone_authenticity_prompt(
        essay_draft="I leveraged transformative synergies to uplift my community.",
        profile_text="Volunteers at the neighborhood food pantry.",
        scholarship_context="Values sincere community service.",
    )

    assert "Tone & Authenticity Coach" in system
    assert "sincere" in system
    assert "thoughtful" in system
    assert "confident" in system
    assert "respectful" in system
    assert "genuinely student-written" in system
    assert "overly polished" in system
    assert "corporate" in system
    assert "formulaic" in system
    assert "performative" in system
    assert "AI-like" in system
    assert "overly_polished_or_corporate_phrases" in system
    assert "formulaic_or_performative_phrases" in system
    assert "Volunteers at the neighborhood food pantry." in human


def test_grammar_prompt_owns_sentence_level_correctness_only():
    system, human = build_grammar_prompt(
        essay_draft="i has lead the club for two years",
        user_notes="Preserve my voice.",
    )

    assert "Grammar Coach" in system
    for responsibility in (
        "spelling",
        "punctuation",
        "capitalization",
        "verb tense",
        "agreement",
        "sentence-level correctness",
    ):
        assert responsibility in system
    assert '"suggestion_type" must be exactly "grammar"' in system
    assert "Do not evaluate clarity, concision" in system
    assert "i has lead the club for two years" in human


def test_clarity_concision_prompt_owns_directness_without_grammar_overlap():
    system, human = build_clarity_concision_prompt(
        essay_draft="In order to help, I was able to provide assistance.",
        writing_support_level="sentence_polish",
    )

    assert "Clarity & Concision Coach" in system
    assert "easy to understand, direct, and free of filler" in system
    assert "repetition" in system
    assert "wordiness" in system
    assert "unclear phrasing" in system
    assert "tangled sentence structure" in system
    assert "the Grammar Coach owns correctness" in system
    assert 'exactly "clarity" or "concision"' in system
    assert "In order to help" in human


def test_readiness_dimensions_match_standard_specialists():
    assert READINESS_DIMENSIONS == [
        "alignment",
        "evidence_strength",
        "insight",
        "narrative_structure_flow_coherence",
        "tone_authenticity",
        "clarity_concision",
    ]


def test_manager_weights_are_bounded_and_total_one_hundred():
    plan = normalize_manager_plan({
        "criteria": {
            key: {"weight": 99 if key == "alignment" else 1}
            for key in READINESS_DIMENSIONS
        }
    })
    weights = [plan["criteria"][key]["weight"] for key in READINESS_DIMENSIONS]
    assert sum(weights) == 100
    assert all(5 <= weight <= 30 for weight in weights)


def test_weighted_overall_score_is_deterministic():
    plan = normalize_manager_plan({})
    reviews = {
        key: {
            "available": True,
            "score": 80 if key == "alignment" else 60,
            "weight": plan["criteria"][key]["weight"],
        }
        for key in READINESS_DIMENSIONS
    }
    expected = round(
        sum(item["score"] * item["weight"] for item in reviews.values()) / 100
    )
    assert weighted_overall_score(reviews) == expected


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


def test_unified_coaching_session_reviews_submitted_draft_without_rewriting(monkeypatch):
    from api import routes

    seen = {}

    def fake_unified(**kwargs):
        seen["draft"] = kwargs["essay_draft"]
        return {
            "review": {
                "schema_version": 4,
                "status": "success",
                "overall_score": 70,
                "criteria": {},
                "manager_plan": {},
                "quality_review": {},
            },
            "outline_coverage": {"covered_point_ids": ["p-core"]},
            "warnings": [],
            "agent_status": {"alignment": "success", "manager": "success"},
        }

    monkeypatch.setattr(routes.settings, "openai_api_key", "test-key")
    monkeypatch.setattr(routes, "run_unified_coaching_session", fake_unified)

    result = routes.run_workspace_coaching_session(_coaching_session_request())

    assert result["status"] == "success"
    assert result["review"]["schema_version"] == 4
    assert result["review"]["overall_score"] == 70
    assert result["outline_coverage"]["covered_point_ids"] == ["p-core"]
    assert "components" not in result
    assert "evaluation" not in result
    assert "coach_pack" not in result
    assert result["session_id"].startswith("coach_")
    assert len(result["draft_hash"]) == 64
    assert seen["draft"] == _coaching_session_request().essay_text
    assert "mechanics" not in result
    assert "cleaned_draft" not in result
    assert result["agents"]["manager"] == "success"


def test_unified_coaching_session_preserves_partial_review_and_warning(monkeypatch):
    from api import routes

    def fake_unified(**_kwargs):
        return {
            "review": {
                "schema_version": 4,
                "status": "partial",
                "overall_score": 62,
                "criteria": {},
                "manager_plan": {},
                "quality_review": {"approved": False},
            },
            "outline_coverage": {},
            "warnings": ["clarity_concision criterion timed out"],
            "agent_status": {"clarity_concision": "error"},
        }

    monkeypatch.setattr(routes.settings, "openai_api_key", "test-key")
    monkeypatch.setattr(routes, "run_unified_coaching_session", fake_unified)

    result = routes.run_workspace_coaching_session(_coaching_session_request())

    assert result["status"] == "partial"
    assert result["review"]["overall_score"] == 62
    assert result["agents"]["clarity_concision"] == "error"
    assert any("clarity_concision criterion timed out" in warning for warning in result["warnings"])
    assert "evaluation" not in result
    assert "coach_pack" not in result


def test_manager_first_review_runs_six_criterion_lanes_and_weights_once(monkeypatch):
    import unified_coaching_service as unified

    monkeypatch.setattr(
        unified,
        "analyze_opportunity_text",
        lambda _text: {
            "opportunity_type": "Scholarship",
            "requirements": ["Leadership"],
            "evaluation_themes": ["Community impact"],
            "deadlines": [],
        },
    )
    weights = {
        "alignment": 25,
        "evidence_strength": 25,
        "insight": 20,
        "narrative_structure_flow_coherence": 15,
        "tone_authenticity": 8,
        "clarity_concision": 7,
    }
    scores = {
        "alignment": 60,
        "evidence_strength": 70,
        "insight": 80,
        "narrative_structure_flow_coherence": 90,
        "tone_authenticity": 85,
        "clarity_concision": 75,
    }
    manager_contexts = []

    def fake_manager(context):
        manager_contexts.append(context)
        return unified.normalize_manager_plan({
            "manager_summary": "Leadership and impact carry the most weight.",
            "criteria": {
                key: {
                    "weight": weight,
                    "description": f"Tailored {key}",
                    "excellent": "Excellent",
                    "developing": "Developing",
                    "weak": "Weak",
                }
                for key, weight in weights.items()
            },
        })

    criterion_calls = []

    def fake_criterion(key, context, plan, **_kwargs):
        criterion_calls.append((key, plan["weight"], context))
        return unified.normalize_criterion_review(
            key,
            {
                "audit": _complete_audit(key),
                "score": scores[key],
                "coach_feedback": {
                    "grounded_praise": f"Grounded praise for {key}",
                    "main_gap": f"Gap {key}",
                },
                "priority_action": {
                    "title": f"Fix {key}",
                    "location": "Paragraph 1",
                    "how_to_fix": f"Specific fix for {key}",
                    "why_this_fixes_the_gap": f"Directly fixes gap for {key}",
                    "evidence_safety": "Use only a real detail.",
                    "impact": "High",
                    "estimated_effort": "Moderate",
                },
            },
            plan,
        )

    monkeypatch.setattr(unified, "run_manager_agent", fake_manager)
    monkeypatch.setattr(unified, "run_criterion_review_agent", fake_criterion)
    monkeypatch.setattr(unified, "run_outline_coverage", lambda *_args: {"covered_point_ids": ["p-core"]})
    monkeypatch.setattr(
        unified,
        "run_criterion_qa",
        lambda _context, _plan, reviews: {
            "approved": len(reviews) == 6,
            "failed_criteria": [],
            "issues": [],
        },
    )
    monkeypatch.setattr(
        unified,
        "run_action_guardrail",
        lambda _context, reviews: {
            "approved": len(reviews) == 6,
            "unsafe_criteria": [],
            "issues": [],
        },
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

    assert len(manager_contexts) == 1
    assert "I mentor younger robotics students" not in manager_contexts[0]
    assert len(criterion_calls) == 6
    assert {call[0] for call in criterion_calls} == set(READINESS_DIMENSIONS)
    assert result["review"]["schema_version"] == 4
    assert result["review"]["overall_score"] == 74
    assert result["review"]["manager_plan"]["weight_total"] == 100
    assert len(result["review"]["criteria"]) == 6
    for key, criterion in result["review"]["criteria"].items():
        assert criterion["score"] == scores[key]
        assert criterion["weight"] == weights[key]
        assert criterion["coach_feedback"]["main_gap"] == f"Gap {key}"
        assert criterion["priority_action"]["how_to_fix"] == f"Specific fix for {key}"
        assert "Directly fixes gap" in criterion["priority_action"]["why_this_fixes_the_gap"]
    assert result["outline_coverage"]["covered_point_ids"] == ["p-core"]
    assert "evaluation" not in result
    assert "coach_pack" not in result
    assert result["agent_status"]["manager"] == "success"
    assert result["agent_status"]["clarity_concision"] == "success"
    assert result["agent_status"]["evidence_strength"] == "success"
    assert result["agent_status"]["narrative_structure_flow_coherence"] == "success"
    assert result["agent_status"]["insight"] == "success"
    assert result["agent_status"]["qa_critic"] == "success"
    assert result["agent_status"]["guardrail_critic"] == "success"
    assert "evaluator" not in result["agent_status"]
    assert "reviewer" not in result["agent_status"]

    second = unified.run_unified_coaching_session(
        student_profile={"profile_text": "I mentor students through a robotics club."},
        clean_scholarship_record={"name": "Engineering Award"},
        essay_prompt="Describe your leadership and impact.",
        essay_draft="I mentor younger robotics students and now explain the result more clearly.",
        scholarship_name="Engineering Award",
        opportunity_prompt="Describe your leadership and impact.",
        previous_manager_plan=result["review"]["manager_plan"],
    )
    assert len(manager_contexts) == 1
    assert second["agent_status"]["manager"] == "reused"
    assert second["review"]["manager_plan"]["criteria"] == result["review"]["manager_plan"]["criteria"]
