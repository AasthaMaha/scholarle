"""Quality-gate unit tests for essay coaching architecture."""

import essay_editor_service as editor_service

from essay_editor_service import (
    SentenceSuggestion,
    _clean_sentence_suggestions,
    _language_tool_suggestions,
    _resolve_writing_support_level,
    run_contextual_grammar_check,
    run_editor_check,
)
from nodes.coaching.readiness import READINESS_DIMENSIONS
from nodes.coaching.criterion_review import (
    CRITERION_AUDIT_PLAYBOOKS,
    build_criterion_review_prompt,
    criterion_audit_is_complete,
    normalize_criterion_review,
    normalize_manager_plan,
    weighted_overall_score,
)
from templates.essay_coach import (
    COACH_GUARDRAILS,
    EDIT_RISK_TIERS,
    build_grammar_prompt,
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


def test_contextual_grammar_does_not_capitalize_i_inside_abbreviation():
    cleaned = _clean_sentence_suggestions(
        "Use a concrete example (i.e., tutoring).",
        [_Item("i", "I", "grammar")],
        writing_support_level="grammar_only",
    )

    assert cleaned == []


def test_contextual_grammar_rejects_uncertain_independent_suggestion(monkeypatch):
    draft = "A luxury underrepresented students cannot afford."
    monkeypatch.setattr(editor_service, "language_tool_status", lambda: {"ready": True})
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        editor_service,
        "_run_grammar",
        lambda *_args, **_kwargs: {
            "grammar_score": 62,
            "sentence_suggestions": [
                SentenceSuggestion(
                    original_text="students",
                    suggested_text="student",
                    suggestion_type="grammar",
                    reason="The plural noun cannot be used here.",
                    severity="medium",
                )
            ],
        },
    )

    result = run_contextual_grammar_check(essay_draft=draft, draft_revision="draft-1")

    assert result["sentence_suggestions"] == []


def test_contextual_grammar_keeps_supported_grammar_fix_when_language_tool_matches(monkeypatch):
    draft = "This scholarship would gave me freedom."
    gave_start = draft.index("gave")
    monkeypatch.setattr(editor_service, "language_tool_status", lambda: {"ready": True})
    monkeypatch.setattr(
        editor_service,
        "_language_tool_suggestions",
        lambda *_args, **_kwargs: [
            {
                "original_text": "gave",
                "suggested_text": "give",
                "suggestion_type": "grammar",
                "reason": "Use the base form after a modal verb.",
                "severity": "high",
                "risk_tier": "C0",
                "source": "language_tool",
                "confidence": "high",
                "replacement_available": True,
                "start_offset": gave_start,
                "end_offset": gave_start + 4,
            }
        ],
    )
    monkeypatch.setattr(
        editor_service,
        "_run_grammar",
        lambda *_args, **_kwargs: {
            "grammar_score": 58,
            "sentence_suggestions": [
                SentenceSuggestion(
                    original_text="gave",
                    suggested_text="give",
                    suggestion_type="grammar",
                    reason="The modal verb requires the base form.",
                    severity="high",
                    confidence="high",
                )
            ],
        },
    )

    result = run_contextual_grammar_check(essay_draft=draft, draft_revision="draft-2")

    assert result["sentence_suggestions"][0]["suggested_text"] == "give"


def test_contextual_grammar_keeps_high_confidence_independent_finding(monkeypatch):
    draft = "I began using my knowledge to find solutions to problem."
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        editor_service,
        "_run_grammar",
        lambda *_args, **_kwargs: {
            "grammar_score": 70,
            "candidate_reviews": [],
            "sentence_suggestions": [
                SentenceSuggestion(
                    original_text="problem",
                    suggested_text="problems",
                    suggestion_type="grammar",
                    reason="A plural count noun is required after ‘solutions to’.",
                    severity="high",
                    confidence="high",
                )
            ],
        },
    )

    result = run_contextual_grammar_check(essay_draft=draft, draft_revision="draft-independent")

    assert result["sentence_suggestions"][0]["original_text"] == "problem"
    assert result["sentence_suggestions"][0]["suggested_text"] == "problems"
    assert result["replaces_language_tool"] is True
    assert result["contextual_route"] == "verified"
    assert result["ai_passes"] == 2


def test_incremental_contextual_check_skips_ai_for_obvious_spelling(monkeypatch):
    draft = "I recieve support."
    start = draft.index("recieve")
    spelling = {
        "original_text": "recieve",
        "suggested_text": "receive",
        "suggestion_type": "spelling",
        "reason": "Possible spelling mistake.",
        "severity": "medium",
        "risk_tier": "C0",
        "source": "language_tool",
        "confidence": "high",
        "replacement_available": True,
        "start_offset": start,
        "end_offset": start + len("recieve"),
        "requires_contextual_review": False,
    }
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [spelling])
    monkeypatch.setattr(
        editor_service,
        "_run_grammar",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("AI should not run")),
    )

    result = run_contextual_grammar_check(essay_draft=draft, draft_revision="paragraph:spelling")

    assert result["sentence_suggestions"] == [spelling]
    assert result["contextual_route"] == "local_only"
    assert result["ai_passes"] == 0


def test_contextual_grammar_uses_one_pass_for_certain_language_tool_accept(monkeypatch):
    draft = "This scholarship would gave me freedom."
    start = draft.index("gave")
    candidate = {
        "original_text": "gave",
        "suggested_text": "give",
        "suggestion_type": "grammar",
        "reason": "Use the base form after a modal verb.",
        "severity": "high",
        "risk_tier": "C0",
        "source": "language_tool",
        "confidence": "high",
        "replacement_available": True,
        "start_offset": start,
        "end_offset": start + len("gave"),
        "requires_contextual_review": True,
    }
    calls = []
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [candidate])

    def accept_candidate(*_args, **_kwargs):
        calls.append(True)
        return {
            "grammar_score": 90,
            "sentence_suggestions": [],
            "candidate_reviews": [{
                "candidate_index": 0,
                "verdict": "accept",
                "reason": "A modal verb requires the base form.",
                "confidence": "high",
            }],
        }

    monkeypatch.setattr(editor_service, "_run_grammar", accept_candidate)

    result = run_contextual_grammar_check(essay_draft=draft, draft_revision="paragraph:grammar")

    assert len(calls) == 1
    assert result["sentence_suggestions"][0]["suggested_text"] == "give"
    assert result["contextual_route"] == "single_pass"
    assert result["ai_passes"] == 1


def test_full_contextual_scan_reviews_and_reanchors_every_paragraph(monkeypatch):
    draft = (
        "I began using my knowledge to find solutions to problem.\n\n"
        "Community is where that requirement come to life.\n\n"
        "This scholarship would support my education but also strengthened my service."
    )
    corrections = {
        "problem": ("problems", "Use a plural noun here."),
        "come": ("comes", "The singular subject requires a singular verb."),
        "strengthened": ("strengthen", "A modal requires the parallel base form."),
    }
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [])

    def grammar_for_segment(segment, *_args, **_kwargs):
        suggestions = []
        for original, (replacement, reason) in corrections.items():
            if original in segment:
                suggestions.append(SentenceSuggestion(
                    original_text=original,
                    suggested_text=replacement,
                    suggestion_type="grammar",
                    reason=reason,
                    severity="high",
                    confidence="high",
                ))
        return {"grammar_score": 70, "candidate_reviews": [], "sentence_suggestions": suggestions}

    monkeypatch.setattr(editor_service, "_run_grammar", grammar_for_segment)

    result = run_contextual_grammar_check(
        essay_draft=draft,
        draft_revision="full:replacement-draft",
    )

    assert [(item["original_text"], item["suggested_text"]) for item in result["sentence_suggestions"]] == [
        ("problem", "problems"),
        ("come", "comes"),
        ("strengthened", "strengthen"),
    ]
    for item in result["sentence_suggestions"]:
        assert draft[item["start_offset"]:item["end_offset"]] == item["original_text"]


def test_selective_verifier_turns_every_diagnosed_issue_into_a_suggestion(monkeypatch):
    draft = (
        "At my core, I am commmitted to service. This scholarship would not only "
        "support my education but also strengthened my ability to give back."
    )
    spelling_start = draft.index("commmitted")
    spelling = {
        "original_text": "commmitted",
        "suggested_text": "committed",
        "suggestion_type": "spelling",
        "reason": "Possible spelling mistake.",
        "severity": "medium",
        "risk_tier": "C0",
        "source": "language_tool",
        "confidence": "high",
        "replacement_available": True,
        "start_offset": spelling_start,
        "end_offset": spelling_start + len("commmitted"),
        "requires_contextual_review": False,
    }
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [spelling])
    calls = []

    def incomplete_then_complete(_draft, notes, *_args, **kwargs):
        calls.append((notes, kwargs.get("verification_mode", False)))
        base = {
            "grammar_score": 80,
            "spelling_issues": ["commmitted"],
            "verb_tense_issues": ["strengthened"],
            "candidate_reviews": [],
        }
        if len(calls) == 1:
            return {**base, "sentence_suggestions": []}
        return {
            **base,
            "sentence_suggestions": [SentenceSuggestion(
                original_text="strengthened",
                suggested_text="strengthen",
                suggestion_type="grammar",
                reason="The modal requires the parallel base form.",
                severity="high",
                confidence="high",
            )],
        }

    monkeypatch.setattr(editor_service, "_run_grammar", incomplete_then_complete)

    result = run_contextual_grammar_check(essay_draft=draft, draft_revision="full:retry")

    assert len(calls) == 2
    assert calls[0][1] is False
    assert calls[1][1] is True
    assert "SELECTIVE CONTEXTUAL QA" in calls[1][0]
    assert [(item["original_text"], item["suggested_text"]) for item in result["sentence_suggestions"]] == [
        ("commmitted", "committed"),
        ("strengthened", "strengthen"),
    ]


def test_contextual_qa_finds_missed_agreement_and_rejects_plural_false_positive(monkeypatch):
    draft = (
        "Community is where that requirement come to life. "
        "Waiting is a luxury underrepresented students cannot afford."
    )
    students_start = draft.index("a luxury underrepresented students")
    false_candidate = {
        "original_text": "a luxury underrepresented students",
        "suggested_text": "a luxury underrepresented student",
        "suggestion_type": "grammar",
        "reason": "Possible article agreement issue.",
        "severity": "high",
        "risk_tier": "C0",
        "source": "language_tool",
        "confidence": "high",
        "replacement_available": True,
        "start_offset": students_start,
        "end_offset": students_start + len("a luxury underrepresented students"),
        "requires_contextual_review": True,
    }
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [false_candidate])
    calls = []

    def initial_then_qa(_draft, notes, *_args, **_kwargs):
        calls.append(notes)
        if len(calls) == 1:
            return {"grammar_score": 100, "sentence_suggestions": [], "candidate_reviews": []}
        return {
            "grammar_score": 90,
            "agreement_issues": ["requirement come"],
            "sentence_suggestions": [SentenceSuggestion(
                original_text="come",
                suggested_text="comes",
                suggestion_type="grammar",
                reason="The singular subject requires a singular verb.",
                severity="high",
                confidence="high",
            )],
            "candidate_reviews": [{
                "candidate_index": 0,
                "verdict": "reject",
                "reason": "Students is the subject of cannot afford and is correctly plural.",
                "confidence": "high",
            }],
        }

    monkeypatch.setattr(editor_service, "_run_grammar", initial_then_qa)

    result = run_contextual_grammar_check(essay_draft=draft, draft_revision="paragraph:qa")

    assert len(calls) == 2
    assert "SELECTIVE CONTEXTUAL QA" in calls[1]
    assert [(item["original_text"], item["suggested_text"]) for item in result["sentence_suggestions"]] == [
        ("come", "comes"),
    ]


def test_contextual_grammar_rejects_language_tool_false_positive(monkeypatch):
    draft = "Waiting is a luxury underrepresented students cannot afford."
    start = draft.index("students")
    candidate = {
        "original_text": "students",
        "suggested_text": "student",
        "suggestion_type": "grammar",
        "reason": "Possible article agreement issue.",
        "severity": "high",
        "risk_tier": "C0",
        "source": "language_tool",
        "confidence": "high",
        "replacement_available": True,
        "start_offset": start,
        "end_offset": start + len("students"),
        "requires_contextual_review": True,
    }
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [candidate])
    monkeypatch.setattr(
        editor_service,
        "_run_grammar",
        lambda *_args, **_kwargs: {
            "grammar_score": 100,
            "sentence_suggestions": [],
            "candidate_reviews": [
                {
                    "candidate_index": 0,
                    "verdict": "reject",
                    "reason": "Students is the subject of cannot afford and is correctly plural.",
                    "confidence": "high",
                }
            ],
        },
    )

    result = run_contextual_grammar_check(essay_draft=draft, draft_revision="draft-reject")

    assert result["sentence_suggestions"] == []
    assert result["replaces_language_tool"] is True


class _LanguageToolMatch:
    def __init__(
        self,
        offset,
        length,
        replacements,
        *,
        category="TYPOS",
        issue_type="misspelling",
        message="Possible spelling mistake.",
        rule_id="MORFOLOGIK_RULE_EN_US",
    ):
        self.offset = offset
        self.error_length = length
        self.replacements = replacements
        self.category = category
        self.rule_issue_type = issue_type
        self.message = message
        self.rule_id = rule_id


class _LanguageTool:
    def __init__(self, matches):
        self.matches = matches

    def check(self, _text):
        return self.matches


def test_language_tool_returns_individually_reviewable_spelling_and_grammar(monkeypatch):
    draft = "I recieve support. This scholarship would gave me freedom."
    matches = [
        _LanguageToolMatch(2, 7, ["receive"]),
        _LanguageToolMatch(
            draft.index("gave"),
            4,
            ["give"],
            category="GRAMMAR",
            issue_type="grammar",
            message="The modal verb requires the base form.",
            rule_id="MD_BASEFORM",
        ),
    ]
    monkeypatch.setattr(editor_service, "_get_language_tool", lambda: _LanguageTool(matches))

    suggestions = _language_tool_suggestions(draft)

    assert [item["suggested_text"] for item in suggestions] == ["receive", "give"]
    assert all(item["source"] == "language_tool" for item in suggestions)
    assert all(item["replacement_available"] is True for item in suggestions)
    assert suggestions[1]["start_offset"] == draft.index("gave")


def test_language_tool_detects_accidentally_split_word(monkeypatch):
    draft = "We repaired the syst em together."
    start = draft.index("syst em")
    monkeypatch.setattr(
        editor_service,
        "_get_language_tool",
        lambda: _LanguageTool([_LanguageToolMatch(start, 7, ["system"])]),
    )

    suggestion = _language_tool_suggestions(draft)[0]

    assert suggestion["original_text"] == "syst em"
    assert suggestion["suggested_text"] == "system"


def test_language_tool_unknown_word_is_review_only_without_replacement(monkeypatch):
    draft = "The intvghjm mattered."
    start = draft.index("intvghjm")
    monkeypatch.setattr(
        editor_service,
        "_get_language_tool",
        lambda: _LanguageTool([_LanguageToolMatch(start, 8, [])]),
    )

    unknown = _language_tool_suggestions(draft)[0]

    assert unknown["suggested_text"] == ""
    assert unknown["replacement_available"] is False
    assert unknown["confidence"] == "low"


def test_profile_and_personal_dictionary_terms_are_protected(monkeypatch):
    draft = "Brianna led SEGA students."
    matches = [
        _LanguageToolMatch(0, 7, ["Brian"]),
        _LanguageToolMatch(draft.index("SEGA"), 4, ["SAGA"]),
    ]
    monkeypatch.setattr(editor_service, "_get_language_tool", lambda: _LanguageTool(matches))

    assert _language_tool_suggestions(draft, protected_terms=["Brianna", "SEGA"]) == []


def test_capitalized_unknown_is_treated_as_a_possible_name(monkeypatch):
    draft = "I volunteered in Morogoro, Tanzania."
    start = draft.index("Morogoro")
    monkeypatch.setattr(
        editor_service,
        "_get_language_tool",
        lambda: _LanguageTool([_LanguageToolMatch(start, 8, ["Morocco"])]),
    )

    suggestion = _language_tool_suggestions(draft)[0]

    assert suggestion["original_text"] == "Morogoro"
    assert suggestion["suggested_text"] == "Morocco"
    assert suggestion["suggestion_type"] == "spelling_name"
    assert suggestion["confidence"] == "low"
    assert suggestion["risk_tier"] == "C1"
    assert "name or place" in suggestion["reason"]


def test_possible_name_is_suppressed_when_added_to_dictionary(monkeypatch):
    draft = "I volunteered in Morogoro, Tanzania."
    start = draft.index("Morogoro")
    monkeypatch.setattr(
        editor_service,
        "_get_language_tool",
        lambda: _LanguageTool([_LanguageToolMatch(start, 8, ["Morocco"])]),
    )

    assert _language_tool_suggestions(draft, protected_terms=["Morogoro"]) == []


def test_language_tool_spelling_does_not_depend_on_contextual_ai(monkeypatch):
    deterministic = [{
        "original_text": "recieve",
        "suggested_text": "receive",
        "suggestion_type": "spelling",
        "reason": "Possible spelling mistake.",
        "severity": "medium",
        "risk_tier": "C0",
        "source": "language_tool",
        "confidence": "high",
        "replacement_available": True,
        "start_offset": 2,
        "end_offset": 9,
    }]
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: deterministic)
    monkeypatch.setattr(
        editor_service,
        "_run_grammar",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("AI unavailable")),
    )

    language_tool_result = run_editor_check(essay_draft="I recieve support.", draft_revision="draft-7")
    contextual_result = run_contextual_grammar_check(essay_draft="I recieve support.", draft_revision="draft-7")

    assert language_tool_result["status"] == "success"
    assert language_tool_result["sentence_suggestions"] == deterministic
    assert language_tool_result["draft_revision"] == "draft-7"
    assert contextual_result["status"] == "success"
    assert contextual_result["sentence_suggestions"] == deterministic
    assert contextual_result["contextual_route"] == "local_only"
    assert contextual_result["ai_passes"] == 0
    assert contextual_result["warnings"] == []


def test_ambiguous_contextual_failure_leaves_fast_spelling_available(monkeypatch):
    draft = "I recieve support that would gave me freedom."
    spelling = {
        "original_text": "recieve",
        "suggested_text": "receive",
        "suggestion_type": "spelling",
        "reason": "Possible spelling mistake.",
        "severity": "medium",
        "risk_tier": "C0",
        "source": "language_tool",
        "confidence": "high",
        "replacement_available": True,
        "start_offset": draft.index("recieve"),
        "end_offset": draft.index("recieve") + len("recieve"),
        "requires_contextual_review": False,
    }
    grammar = {
        "original_text": "gave",
        "suggested_text": "give",
        "suggestion_type": "grammar",
        "reason": "Use the base form after a modal verb.",
        "severity": "high",
        "risk_tier": "C0",
        "source": "language_tool",
        "confidence": "high",
        "replacement_available": True,
        "start_offset": draft.index("gave"),
        "end_offset": draft.index("gave") + len("gave"),
        "requires_contextual_review": True,
    }
    monkeypatch.setattr(editor_service, "_language_tool_suggestions", lambda *_args, **_kwargs: [spelling, grammar])
    monkeypatch.setattr(
        editor_service,
        "_run_grammar",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("AI unavailable")),
    )

    language_tool_result = run_editor_check(essay_draft=draft, draft_revision="draft-8")
    contextual_result = run_contextual_grammar_check(essay_draft=draft, draft_revision="draft-8")

    assert language_tool_result["sentence_suggestions"] == [spelling]
    assert contextual_result["status"] == "error"
    assert any("Contextual grammar check unavailable" in warning for warning in contextual_result["warnings"])


def test_editor_check_reports_warming_without_showing_an_error(monkeypatch):
    def warming(*_args, **_kwargs):
        raise editor_service.LanguageToolNotReadyError("warming")

    monkeypatch.setattr(editor_service, "_language_tool_suggestions", warming)

    result = run_editor_check(essay_draft="A draft is available.", draft_revision="warm-1")

    assert result["status"] == "warming"
    assert result["warnings"] == []
    assert result["retry_after_ms"] == 750
    assert result["draft_revision"] == "warm-1"


def test_language_tool_warmup_starts_once_without_waiting(monkeypatch):
    started = []

    class _BackgroundThread:
        def __init__(self, *, target, name, daemon):
            self.target = target
            self.name = name
            self.daemon = daemon
            self._alive = False

        def start(self):
            self._alive = True
            started.append(self.name)

        def is_alive(self):
            return self._alive

    monkeypatch.setattr(editor_service, "Thread", _BackgroundThread)
    monkeypatch.setattr(editor_service, "_language_tool_instance", None)
    monkeypatch.setattr(editor_service, "_language_tool_error", None)
    monkeypatch.setattr(editor_service, "_language_tool_state", "idle")
    monkeypatch.setattr(editor_service, "_language_tool_warmup_thread", None)

    first = editor_service.start_language_tool_warmup()
    second = editor_service.start_language_tool_warmup()

    assert first == {"status": "warming", "ready": False, "error": None}
    assert second["status"] == "warming"
    assert started == ["scholar-e-language-tool-warmup"]


def _complete_audit(criterion: str) -> dict:
    return {
        key: ([] if isinstance(example, list) else "none")
        for key, example in CRITERION_AUDIT_PLAYBOOKS[criterion]["schema"].items()
    }


def test_active_specialists_use_fixed_profile_blind_question_contracts():
    assert set(CRITERION_AUDIT_PLAYBOOKS) == set(READINESS_DIMENSIONS)
    for criterion in READINESS_DIMENSIONS:
        playbook = CRITERION_AUDIT_PLAYBOOKS[criterion]
        assert playbook["instructions"]
        assert playbook["schema"]
        prompt = build_criterion_review_prompt(
            criterion,
            "STUDENT ESSAY: Real essay evidence",
            normalize_manager_plan({})["criteria"][criterion],
        )
        assert "APPLICABLE FIXED RUBRIC QUESTIONS" in prompt
        assert "Do not assign a numerical score or performance level" in prompt
        assert "You do not have access to the student profile" in prompt
        assert "criterion-specific main gap" in prompt
        for field in playbook["schema"]:
            assert field in prompt


def test_active_evidence_scorer_is_strictly_profile_blind():
    prompt = build_criterion_review_prompt(
        "evidence_strength",
        (
            "ESSAY PROMPT: Describe your community impact.\n"
            "SCHOLARSHIP: Values sustained service.\n"
            "DRAFT: I led our tutoring program."
        ),
        normalize_manager_plan({})["criteria"]["evidence_strength"],
    )

    assert "You do not have access to the student profile" in prompt
    assert "Answer every applicable fixed rubric question with exactly 0, 0.5, or 1" in prompt
    assert "Tutored 12 students for 40 hours." not in prompt
    assert "Do not assign a numerical score or performance level" in prompt


def test_normalized_fixed_questions_are_available_to_backend_validation():
    criterion = "evidence_strength"
    plan = normalize_manager_plan({})["criteria"][criterion]
    review = normalize_criterion_review(
        criterion,
        {
            "answers": [
                {
                    "question_id": question["id"],
                    "value": 0,
                    "evidence": [],
                    "explanation": "The requirement is not demonstrated in the draft.",
                }
                for question in plan["questions"]
                if question["applicable"]
            ],
            "coach_feedback": {
                "grounded_praise": "The tutoring claim gives the draft a real foundation.",
                "main_gap": "The draft does not yet ground the tutoring claim in an action or result.",
            },
            "criterion_specific_gap": {
                "statement": "The claim lacks a concrete action or result.",
                "root_cause_tag": "unsupported_claim",
                "severity": "high",
                "evidence": [],
            },
            "candidate_actions": [{
                "action_type": "add_concrete_evidence",
                "location": "Tutoring paragraph",
                "instruction": "Add one truthful action and observable result.",
                "completion_condition": "The paragraph states what happened and what changed.",
                "estimated_effort": "Moderate",
            }],
        },
        plan,
    )

    assert criterion_audit_is_complete(criterion, review)
    assert len(review["answers"]) == 5
    assert review["score"] == 0
    assert review["level"] == "Minimal"


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


def test_resolve_writing_brief_separates_compound_questions_and_option_heading():
    from prompt_adaptation import resolve_writing_brief

    brief = resolve_writing_brief(
        essay_prompt=(
            "Choose one of the following: 1. Personal Commitment to Mediation and Peacebuilding: "
            "Describe a time when you helped resolve a disagreement. What steps did you take? "
            "What was the outcome, and what did you learn from the experience?"
        ),
        clean_scholarship_record={"name": "Demo Scholarship"},
    )

    assert brief["prompt_asks"] == [
        "Describe a time when you helped resolve a disagreement.",
        "What steps did you take?",
        "What was the outcome?",
        "What did you learn from the experience?",
    ]


def test_outline_contract_repairs_imperative_with_question_mark():
    from api.routes import _normalize_outline_requirement_questions, _outline_contract_violations

    data = {
        "outline": {
            "sections": [
                {
                    "section_name": "Conflict Resolution Experience",
                    "scholarship_requirement_addressed": [
                        "Describe a time when you helped resolve a disagreement?"
                    ],
                }
            ]
        }
    }
    brief = {
        "mode": "prompt_driven",
        "prompt_asks": ["Describe a time when you helped resolve a disagreement."],
    }

    assert any("malformed prompt question" in issue for issue in _outline_contract_violations(data, brief))
    repaired = _normalize_outline_requirement_questions(data)
    assert repaired["outline"]["sections"][0]["scholarship_requirement_addressed"] == [
        "What experience shows how you helped resolve a disagreement?"
    ]


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
        outline_points=[{"id": "p-sec-0", "label": "Leadership impact"}],
    )


def test_unified_coaching_session_reviews_submitted_draft_without_rewriting(monkeypatch):
    from api import routes

    seen = {}

    def fake_unified(**kwargs):
        seen["draft"] = kwargs["essay_draft"]
        return {
            "review": {
                "schema_version": 5,
                "status": "success",
                "overall_score": 70,
                "criteria": {},
                "manager_plan": {},
                "quality_review": {},
            },
            "outline_coverage": {"covered_point_ids": ["p-sec-0"]},
            "warnings": [],
            "agent_status": {"alignment": "success", "manager": "success"},
        }

    monkeypatch.setattr(routes.settings, "openai_api_key", "test-key")
    monkeypatch.setattr(routes, "run_unified_coaching_session", fake_unified)

    result = routes.run_workspace_coaching_session(_coaching_session_request())

    assert result["status"] == "success"
    assert result["review"]["schema_version"] == 5
    assert result["review"]["overall_score"] == 70
    assert result["outline_coverage"]["covered_point_ids"] == ["p-sec-0"]
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
                "schema_version": 5,
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
    monkeypatch.setattr(unified, "run_outline_coverage", lambda *_args: {"covered_point_ids": ["p-sec-0"]})
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
        outline_points=[{"id": "p-sec-0", "label": "Leadership impact"}],
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
        assert criterion["coach_feedback"]["grounded_praise"] == f"Grounded praise for {key}"
        assert criterion["coach_feedback"]["main_gap"] == f"Gap {key}"
        assert criterion["priority_action"]["how_to_fix"] == f"Specific fix for {key}"
        assert "Directly fixes gap" in criterion["priority_action"]["why_this_fixes_the_gap"]
        assert "_internal_audit" not in criterion
    assert result["outline_coverage"]["covered_point_ids"] == ["p-sec-0"]
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


# Schema-v5 replacement for the legacy test above. Reusing the name deliberately
# replaces the retired schema-v4 contract during pytest collection.
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
    manager_contexts = []
    scorer_calls = []
    planner_contexts = []

    def fake_manager(context):
        manager_contexts.append(context)
        return unified.normalize_manager_plan({})

    def fake_scorer(key, context, plan, **_kwargs):
        scorer_calls.append((key, context))
        return unified.normalize_criterion_review(
            key,
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
                    "grounded_praise": f"The draft names a relevant focus for {key}.",
                    "main_gap": f"The {key} requirement is not yet demonstrated.",
                },
                "criterion_specific_gap": {
                    "statement": f"The {key} requirement is not yet demonstrated.",
                    "root_cause_tag": "vague_takeaway",
                    "severity": "high",
                    "evidence": [],
                },
                "candidate_actions": [{
                    "action_type": "clarify",
                    "location": "Paragraph 1",
                    "instruction": f"Add grounded support for {key}.",
                    "completion_condition": "The requirement is directly demonstrated.",
                    "estimated_effort": "Moderate",
                }],
            },
            plan,
        )

    def fake_planner(context, reviews, **_kwargs):
        planner_contexts.append(context)
        assert len(reviews) == 6
        return {
            "available": True,
            "priorities": [{
                "id": "priority_1",
                "title": "Ground the central claim",
                "action": "Add one truthful action and result.",
                "primary_criterion": "evidence_strength",
                "also_improves": ["insight"],
            }],
        }

    monkeypatch.setattr(unified, "run_manager_agent", fake_manager)
    monkeypatch.setattr(unified, "run_criterion_review_agent", fake_scorer)
    monkeypatch.setattr(unified, "run_revision_planner", fake_planner)
    monkeypatch.setattr(
        unified, "run_outline_coverage",
        lambda *_args: {"covered_point_ids": ["p-sec-0"]},
    )
    monkeypatch.setattr(
        unified,
        "run_criterion_qa",
        lambda _contexts, _plan, reviews, _revision_plan: {
            "approved": len(reviews) == 6,
            "failed_criteria": [],
            "planner_failed": False,
            "issues": [],
        },
    )
    monkeypatch.setattr(
        unified,
        "run_action_guardrail",
        lambda _context, reviews, _revision_plan: {
            "approved": len(reviews) == 6,
            "unsafe_criteria": [],
            "planner_failed": False,
            "issues": [],
        },
    )

    result = unified.run_unified_coaching_session(
        student_profile={"profile_text": "PRIVATE PROFILE: mentors robotics students."},
        clean_scholarship_record={"name": "Engineering Award"},
        essay_prompt="Describe your leadership and impact.",
        essay_draft="I mentor younger robotics students each week.",
        outline_points=[{"id": "p-sec-0", "label": "Leadership impact"}],
        scholarship_name="Engineering Award",
        opportunity_prompt="Describe your leadership and impact.",
    )

    assert len(manager_contexts) == 1
    assert "PRIVATE PROFILE" not in manager_contexts[0]
    assert len(scorer_calls) == 6
    assert {key for key, _context in scorer_calls} == set(READINESS_DIMENSIONS)
    assert all("PRIVATE PROFILE" not in context for _key, context in scorer_calls)
    assert "PRIVATE PROFILE" in planner_contexts[0]
    assert result["review"]["schema_version"] == 5
    assert result["review"]["overall_score"] == 0
    assert result["review"]["overall_level"] == "Minimal"
    assert result["review"]["manager_plan"]["weight_total"] == 100
    assert len(result["review"]["criteria"]) == 6
    assert len(result["review"]["revision_priorities"]) == 1
    assert result["outline_coverage"]["covered_point_ids"] == ["p-sec-0"]

    second = unified.run_unified_coaching_session(
        student_profile={"profile_text": "PRIVATE PROFILE: mentors robotics students."},
        clean_scholarship_record={"name": "Engineering Award"},
        essay_prompt="Describe your leadership and impact.",
        essay_draft="I mentor younger robotics students and now explain the result.",
        scholarship_name="Engineering Award",
        opportunity_prompt="Describe your leadership and impact.",
        previous_manager_plan=result["review"]["manager_plan"],
    )
    assert len(manager_contexts) == 1
    assert second["agent_status"]["manager"] == "reused"
