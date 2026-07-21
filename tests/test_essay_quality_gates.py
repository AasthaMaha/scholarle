"""Quality-gate unit tests for essay coaching architecture."""

from essay_coaching_service import (
    SentenceSuggestion,
    _clean_sentence_suggestions,
    _resolve_writing_support_level,
)
from essay_mechanics import apply_deterministic_mechanics
from nodes.critic import _programmatic_completeness
from nodes.combine import _build_eligibility_matrix, _normalize_revision_actions, _rank_global_actions
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


def test_empty_eligibility_report_is_not_mislabeled_eligible():
    assert _build_eligibility_matrix({}) == {}


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
    monkeypatch.setattr(
        unified,
        "_run_grammar",
        lambda *_args: {
            "grammar_score": 92,
            "spelling_issues": [],
            "punctuation_issues": [],
            "capitalization_issues": [],
            "verb_tense_issues": [],
            "agreement_issues": [],
            "other_grammar_issues": [],
            "sentence_level_correctness_issues": [],
            "revision_tasks": [],
            "sentence_suggestions": [],
        },
    )
    monkeypatch.setattr(
        unified,
        "_run_clarity_concision",
        lambda *_args: {
            "clarity_concision_score": 76,
            "clear_and_direct_sentences": ["I mentor younger robotics students each week."],
            "filler_or_repetition": [],
            "wordiness": [],
            "unclear_phrasing": ["have learned to lead"],
            "tangled_sentence_structure": [],
            "revision_tasks": ["Clarify what leading by listening means."],
            "sentence_suggestions": [],
        },
    )
    monkeypatch.setattr(
        unified,
        "_run_alignment",
        lambda *_args: {
            "alignment_score": 72,
            "covered_prompt_parts": ["Leadership"],
            "weakly_covered_prompt_parts": ["Impact"],
            "missing_prompt_parts": [],
            "stated_scholarship_values": ["Community impact"],
            "actual_evaluation_focus": ["Leadership with demonstrated impact"],
            "addressed_scholarship_values": ["Leadership"],
            "weak_or_missing_scholarship_values": ["Community impact"],
            "student_fit_connections": ["Robotics mentoring supports leadership"],
            "generic_or_unsupported_fit_claims": [],
            "fit_summary": "The draft shows leadership but needs a clearer impact connection.",
            "comments": [],
            "revision_tasks": ["Answer the impact question."],
        },
    )
    monkeypatch.setattr(
        unified,
        "_run_evidence_strength",
        lambda *_args: {
            "evidence_strength_score": 80,
            "supported_claims": ["Robotics mentoring"],
            "unsupported_or_risky_claims": [],
            "invented_or_unverifiable_details": [],
            "unused_relevant_profile_evidence": ["Weekly mentoring"],
            "vague_statements": ["learned to lead"],
            "places_to_add_detail": ["Explain what changed for the students."],
            "impact_opportunities": ["Show the result of the mentoring."],
            "recommended_experience_to_feature": "Weekly robotics mentoring",
            "recommended_questions": ["How many students did you mentor?"],
            "recommendations": ["Add one verified result."],
        },
    )
    monkeypatch.setattr(
        unified,
        "_run_narrative_structure",
        lambda *_args: {
            "narrative_structure_score": 75,
            "structure_flow_score": 78,
            "coherence_score": 74,
            "narrative_arc_score": 72,
            "arc_progression": [],
            "paragraph_feedback": [],
            "transition_and_flow_issues": ["The impact appears before the action is explained."],
            "coherence_issues": [],
            "contradictions_or_timeline_issues": [],
            "missing_reasoning": ["Explain why mentoring changed the student's leadership approach."],
            "logical_connections_to_preserve": ["Mentoring connects to listening."],
            "recommended_reordering": [],
            "overall_narrative_assessment": "The arc is visible but the reflection needs a clearer bridge.",
            "biggest_narrative_gap": "Connect the mentoring result to the leadership lesson.",
            "revision_tasks": ["Add the missing action-to-reflection bridge."],
        },
    )
    monkeypatch.setattr(
        unified,
        "_run_insight",
        lambda *_args: {
            "insight_score": 70,
            "meaningful_reflections": ["Listening changed the student's approach to leadership."],
            "surface_level_or_generic_reflections": [],
            "lessons_realizations_or_questions": ["Leadership begins with listening."],
            "changes_in_mindset_or_behavior": ["The student now listens before deciding."],
            "changes_in_values_goals_or_responsibility": [],
            "significance_to_self": ["Mentoring reshaped the student's leadership practice."],
            "significance_to_others_or_community": [],
            "future_direction_connections": [],
            "missing_meaning_or_reflection": ["Explain why the students' result mattered."],
            "recommended_reflection_questions": ["What responsibility did the result create?"],
            "revision_tasks": ["Deepen the action-to-learning reflection."],
        },
    )
    monkeypatch.setattr(unified, "_run_tone_authenticity", lambda *_args: {"authenticity_score": 85})
    monkeypatch.setattr(unified, "_run_outline_coverage", lambda *_args: {"covered_point_ids": ["p-core"]})
    monkeypatch.setattr(
        unified,
        "run_reviewer_simulation_coach",
        lambda *_args: {"scholarship_reviewer": {"comment": "Promising but incomplete."}},
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
    assert evaluator_inputs[0]["alignment"]["alignment_score"] == 72
    assert "prompt_alignment" not in evaluator_inputs[0]
    assert evaluator_inputs[0]["evidence_strength"]["evidence_strength_score"] == 80
    assert evaluator_inputs[0]["narrative_structure_flow_coherence"]["narrative_structure_score"] == 75
    assert evaluator_inputs[0]["insight"]["insight_score"] == 70
    assert evaluator_inputs[0]["grammar"]["grammar_score"] == 92
    assert "sentence_suggestions" not in evaluator_inputs[0]["grammar"]
    assert evaluator_inputs[0]["clarity_concision"]["clarity_concision_score"] == 76
    assert "sentence_suggestions" not in evaluator_inputs[0]["clarity_concision"]
    assert "profile_grounding" not in evaluator_inputs[0]
    assert "specificity" not in evaluator_inputs[0]
    assert result["evaluation"]["readiness_index"]["alignment"]["score"] == 72
    assert result["evaluation"]["eligibility_matrix"] == {}
    assert result["coach_pack"]["revision_priorities"][0]["priority"] == "Answer the impact question"
    assert result["coach_pack"]["outline_coverage"]["covered_point_ids"] == ["p-core"]
    assert result["coach_pack"]["evidence_strength"]["evidence_strength_score"] == 80
    assert result["coach_pack"]["alignment"]["alignment_score"] == 72
    assert result["coach_pack"]["prompt_alignment"]["alignment_score"] == 72
    assert result["coach_pack"]["profile_grounding"]["grounding_score"] == 80
    assert result["coach_pack"]["specificity_feedback"]["specificity_score"] == 80
    assert result["coach_pack"]["narrative_structure"]["narrative_structure_score"] == 75
    assert result["coach_pack"]["structure_feedback"]["structure_score"] == 75
    assert result["coach_pack"]["insight"]["insight_score"] == 70
    assert result["coach_pack"]["grammar_feedback"]["grammar_score"] == 92
    assert result["coach_pack"]["clarity_concision_feedback"]["clarity_concision_score"] == 76
    assert result["agent_status"]["grammar"] == "success"
    assert result["agent_status"]["clarity_concision"] == "success"
    assert result["agent_status"]["evidence_strength"] == "success"
    assert "grounding" not in result["agent_status"]
    assert "specificity" not in result["agent_status"]
    assert "discovery" not in result["agent_status"]
    assert "strategy" not in result["agent_status"]
    assert "structure" not in result["agent_status"]
    assert "narrative" not in result["agent_status"]
    assert result["agent_status"]["narrative_structure"] == "success"
    assert "eligibility" not in result["agent_status"]
    assert result["agent_status"]["insight"] == "success"
