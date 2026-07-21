# essay_coaching_service.py
"""Essay Workspace coaching pipeline — a specialized, lighter path than the big
`/api/analyze` graph.

`run_essay_workspace_coach` always returns the full coaching-package schema so
the UI contract stays stable across full runs and targeted modes. Alignment is
the single owner of prompt coverage and scholarship-values fit. Evidence
Strength owns profile grounding, experience discovery, specificity, and impact.
Narrative Structure, Flow & Coherence owns paragraph structure, transitions,
story progression, and logical continuity. Insight separately owns reflection
depth, meaning, learning, change, and significance. Legacy response fields are
projections rather than extra model calls.

Design notes:
- The LLM returns `original_text` verbatim; the FRONTEND anchors it to the draft
  (LLMs are unreliable at character offsets). We still validate here that each
  `original_text` is actually a substring of the draft and drop hallucinated or
  over-long ("full rewrite") suggestions — a lightweight guardrail ahead of the
  dedicated Guardrail Critic in a later phase.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from pydantic import BaseModel, Field

from llm.client import llm
from prompt_adaptation import format_brief_for_prompt, resolve_writing_brief
from templates.essay_coach import (
    EDIT_RISK_TIERS,
    REWRITE_ACTIONS,
    SENTENCE_SEVERITIES,
    SENTENCE_TYPES,
    WRITING_SUPPORT_LEVELS,
    build_clarity_concision_prompt,
    build_combiner_prompt,
    build_evidence_strength_prompt,
    build_final_check_prompt,
    build_grammar_prompt,
    build_guardrail_prompt,
    build_insight_prompt,
    build_outline_coverage_prompt,
    build_alignment_prompt,
    build_reviewer_prompt,
    build_rewrite_prompt,
    build_narrative_structure_prompt,
    build_tone_authenticity_prompt,
)

# Modes where Evaluate / paste should stay mechanics-safe by default.
_GRAMMAR_DEFAULT_MODES = frozenset({"workspace_refresh", "auto_check", "grammar_tone"})
# Modes that emit sentence suggestions and must pass the Guardrail Critic.
_GUARDED_SUGGESTION_MODES = frozenset({
    "full",
    "workspace_refresh",
    "grammar_tone",
    "auto_check",
})


def _clamp_score(value) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return 0


class SentenceSuggestion(BaseModel):
    original_text: str = ""
    suggested_text: str = ""
    suggestion_type: str = "clarity"
    reason: str = ""
    severity: str = "medium"


class GrammarOutput(BaseModel):
    grammar_score: int = 0
    spelling_issues: list[str] = Field(default_factory=list)
    punctuation_issues: list[str] = Field(default_factory=list)
    capitalization_issues: list[str] = Field(default_factory=list)
    verb_tense_issues: list[str] = Field(default_factory=list)
    agreement_issues: list[str] = Field(default_factory=list)
    other_grammar_issues: list[str] = Field(default_factory=list)
    sentence_level_correctness_issues: list[str] = Field(default_factory=list)
    revision_tasks: list[str] = Field(default_factory=list)
    sentence_suggestions: list[SentenceSuggestion] = Field(default_factory=list)


class ClarityConcisionOutput(BaseModel):
    clarity_concision_score: int = 0
    clear_and_direct_sentences: list[str] = Field(default_factory=list)
    filler_or_repetition: list[str] = Field(default_factory=list)
    wordiness: list[str] = Field(default_factory=list)
    unclear_phrasing: list[str] = Field(default_factory=list)
    tangled_sentence_structure: list[str] = Field(default_factory=list)
    revision_tasks: list[str] = Field(default_factory=list)
    sentence_suggestions: list[SentenceSuggestion] = Field(default_factory=list)


class AlignmentOutput(BaseModel):
    alignment_score: int = 0
    covered_prompt_parts: list[str] = Field(default_factory=list)
    weakly_covered_prompt_parts: list[str] = Field(default_factory=list)
    missing_prompt_parts: list[str] = Field(default_factory=list)
    stated_scholarship_values: list[str] = Field(default_factory=list)
    actual_evaluation_focus: list[str] = Field(default_factory=list)
    addressed_scholarship_values: list[str] = Field(default_factory=list)
    weak_or_missing_scholarship_values: list[str] = Field(default_factory=list)
    student_fit_connections: list[str] = Field(default_factory=list)
    generic_or_unsupported_fit_claims: list[str] = Field(default_factory=list)
    fit_summary: str = ""
    comments: list[str] = Field(default_factory=list)
    revision_tasks: list[str] = Field(default_factory=list)


class ParagraphFeedback(BaseModel):
    paragraph_number: int = 0
    main_issue: str = ""
    strength: str = ""
    suggestion: str = ""
    priority: str = "medium"


class NarrativeStageFeedback(BaseModel):
    stage: str = ""
    status: str = "missing"
    evidence: str = ""
    issue: str = ""
    suggestion: str = ""


class NarrativeStructureOutput(BaseModel):
    narrative_structure_score: int = 0
    structure_flow_score: int = 0
    coherence_score: int = 0
    narrative_arc_score: int = 0
    arc_progression: list[NarrativeStageFeedback] = Field(default_factory=list)
    paragraph_feedback: list[ParagraphFeedback] = Field(default_factory=list)
    transition_and_flow_issues: list[str] = Field(default_factory=list)
    coherence_issues: list[str] = Field(default_factory=list)
    contradictions_or_timeline_issues: list[str] = Field(default_factory=list)
    missing_reasoning: list[str] = Field(default_factory=list)
    logical_connections_to_preserve: list[str] = Field(default_factory=list)
    recommended_reordering: list[str] = Field(default_factory=list)
    overall_narrative_assessment: str = ""
    biggest_narrative_gap: str = ""
    revision_tasks: list[str] = Field(default_factory=list)


class InsightOutput(BaseModel):
    insight_score: int = 0
    meaningful_reflections: list[str] = Field(default_factory=list)
    surface_level_or_generic_reflections: list[str] = Field(default_factory=list)
    lessons_realizations_or_questions: list[str] = Field(default_factory=list)
    changes_in_mindset_or_behavior: list[str] = Field(default_factory=list)
    changes_in_values_goals_or_responsibility: list[str] = Field(default_factory=list)
    significance_to_self: list[str] = Field(default_factory=list)
    significance_to_others_or_community: list[str] = Field(default_factory=list)
    future_direction_connections: list[str] = Field(default_factory=list)
    missing_meaning_or_reflection: list[str] = Field(default_factory=list)
    recommended_reflection_questions: list[str] = Field(default_factory=list)
    revision_tasks: list[str] = Field(default_factory=list)


class EvidenceStrengthOutput(BaseModel):
    evidence_strength_score: int = 0
    supported_claims: list[str] = Field(default_factory=list)
    unsupported_or_risky_claims: list[str] = Field(default_factory=list)
    invented_or_unverifiable_details: list[str] = Field(default_factory=list)
    unused_relevant_profile_evidence: list[str] = Field(default_factory=list)
    vague_statements: list[str] = Field(default_factory=list)
    places_to_add_detail: list[str] = Field(default_factory=list)
    impact_opportunities: list[str] = Field(default_factory=list)
    recommended_experience_to_feature: str = ""
    recommended_questions: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


class ToneAuthenticityOutput(BaseModel):
    authenticity_score: int = 0
    tone_score: int = 0
    ai_like_phrases: list[str] = Field(default_factory=list)
    generic_phrases: list[str] = Field(default_factory=list)
    overly_polished_or_corporate_phrases: list[str] = Field(default_factory=list)
    formulaic_or_performative_phrases: list[str] = Field(default_factory=list)
    tone_quality_notes: list[str] = Field(default_factory=list)
    voice_preservation_notes: list[str] = Field(default_factory=list)
    tone_improvement_suggestions: list[str] = Field(default_factory=list)


class ReviewerOutput(BaseModel):
    reviewer_reaction: str = ""
    competitiveness_score: int = 0
    likely_strengths_seen_by_reviewer: list[str] = Field(default_factory=list)
    likely_concerns_seen_by_reviewer: list[str] = Field(default_factory=list)
    questions_reviewer_may_have: list[str] = Field(default_factory=list)
    competitiveness_notes: list[str] = Field(default_factory=list)


class RevisionPriority(BaseModel):
    priority: str = ""
    why_it_matters: str = ""
    how_to_fix: str = ""
    estimated_effort: str = ""
    impact: str = ""


class CombinerOutput(BaseModel):
    coach_summary: str = ""
    top_revision_priorities: list[RevisionPriority] = Field(default_factory=list)
    quick_fixes: list[str] = Field(default_factory=list)
    deeper_revision_tasks: list[str] = Field(default_factory=list)


class GuardrailOutput(BaseModel):
    approved: bool = True
    unsafe_suggestion_indices: list[int] = Field(default_factory=list)
    issues_found: list[str] = Field(default_factory=list)
    final_notes: list[str] = Field(default_factory=list)


class FinalCheckOutput(BaseModel):
    remaining_blockers: list[str] = Field(default_factory=list)
    final_polish_notes: list[str] = Field(default_factory=list)
    submission_warning: str = ""


class OutlineCoverageOutput(BaseModel):
    covered_point_ids: list[str] = Field(default_factory=list)


class RewriteOutput(BaseModel):
    rewritten_text: str = ""
    note: str = ""


def _empty_package(status: str = "success") -> dict:
    return {
        "status": status,
        "overall_scores": {},
        "sentence_suggestions": [],
        "grammar_feedback": {},
        "clarity_concision_feedback": {},
        "paragraph_feedback": [],
        "tone_feedback": {},
        "structure_feedback": {},
        "narrative_structure": {},
        "insight": {},
        "specificity_feedback": {},
        "prompt_alignment": {},
        "alignment": {},
        "profile_grounding": {},
        "evidence_strength": {},
        "reviewer_simulation": {},
        "outline_coverage": {},
        "guardrail": {},
        "final_check": {},
        "revision_priorities": [],
        "quick_fixes": [],
        "deeper_revision_tasks": [],
        "warnings": [],
        "coach_summary": "",
    }


def _scholarship_context(record: Optional[dict]) -> str:
    if not record:
        return ""
    keys = (
        "name",
        "organization",
        "type",
        "description",
        "selectionCriteria",
        "benefits",
        "financialNeedRequirement",
        "eligibleMajors",
        "otherEligibilityRules",
        "eligibilityRequirements",
        "essayPrompts",
        "otherRequiredMaterials",
        "requirementsPreview",
        "importantNotes",
        "additionalNotes",
        "fullText",
    )
    parts = []
    for key in keys:
        value = record.get(key)
        if not value:
            continue
        if isinstance(value, list):
            value = "; ".join(str(item) for item in value)
        parts.append(f"{key}: {value}")
    return "\n".join(parts)[:8000]


def _resolve_writing_support_level(mode: str, writing_support_level: str) -> str:
    """Prefer grammar_only for Evaluate/auto paths unless the caller opts in."""
    level = (writing_support_level or "").strip()
    if level not in WRITING_SUPPORT_LEVELS:
        level = "grammar_only" if mode in _GRAMMAR_DEFAULT_MODES else "sentence_polish"
    if mode in _GRAMMAR_DEFAULT_MODES and level != "grammar_only":
        # Evaluate / paste safety contract: mechanics first unless explicitly full coaching.
        if mode in ("workspace_refresh", "auto_check"):
            return "grammar_only"
    return level


def _clean_sentence_suggestions(
    draft: str,
    raw: list,
    max_suggestions: int = 40,
    writing_support_level: str = "grammar_only",
    allowed_types: Optional[set[str]] = None,
) -> list[dict]:
    """Drop hallucinated anchors, over-long rewrites, and duplicates."""
    draft_lower = draft.lower()
    seen: set = set()
    cleaned: list[dict] = []
    grammar_only = writing_support_level == "grammar_only"
    for item in raw:
        def item_value(key: str, default=""):
            return item.get(key, default) if isinstance(item, dict) else getattr(item, key, default)

        original = (item_value("original_text") or "").strip()
        suggested = (item_value("suggested_text") or "").strip()
        if not original or not suggested or original == suggested:
            continue
        # The anchor must exist verbatim in the draft.
        if original.lower() not in draft_lower:
            continue
        raw_type = item_value("suggestion_type")
        stype = raw_type if raw_type in SENTENCE_TYPES else "clarity"
        if allowed_types is not None and stype not in allowed_types:
            continue
        if grammar_only and stype not in ("grammar",):
            # Hard filter: grammar_only must not leak polish/voice edits.
            continue
        # Blast-radius budgets by risk tier (minimal-edit principle).
        risk = EDIT_RISK_TIERS.get(stype, "C1")
        max_ratio = 1.35 if risk == "C0" else (1.8 if risk == "C1" else 2.2)
        max_extra = 40 if risk == "C0" else (80 if risk == "C1" else 120)
        if len(suggested) > max(int(len(original) * max_ratio), len(original) + max_extra):
            continue
        # Absolute ceiling against over-rewrites / full-essay generation.
        if len(suggested) > max(len(original) * 3, len(original) + 160):
            continue
        raw_severity = item_value("severity")
        severity = raw_severity if raw_severity in SENTENCE_SEVERITIES else "medium"
        key = (original.lower(), suggested.lower())
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(
            {
                "original_text": original,
                "suggested_text": suggested,
                "suggestion_type": stype,
                "reason": (item_value("reason") or "").strip(),
                "severity": severity,
                "risk_tier": risk,
            }
        )
        if len(cleaned) >= max_suggestions:
            break
    return cleaned


def _run_grammar(
    essay_draft: str,
    user_notes: str,
) -> dict:
    system, human = build_grammar_prompt(
        essay_draft=essay_draft,
        user_notes=user_notes,
    )
    model = llm._get_client().with_structured_output(GrammarOutput)
    result = model.invoke([("system", system), ("human", human)])
    data = result.model_dump()
    data["grammar_score"] = _clamp_score(data.get("grammar_score"))
    return data


def _run_clarity_concision(
    essay_draft: str,
    user_notes: str,
    writing_support_level: str = "sentence_polish",
) -> dict:
    system, human = build_clarity_concision_prompt(
        essay_draft=essay_draft,
        user_notes=user_notes,
        writing_support_level=writing_support_level,
    )
    model = llm._get_client().with_structured_output(ClarityConcisionOutput)
    result = model.invoke([("system", system), ("human", human)])
    data = result.model_dump()
    data["clarity_concision_score"] = _clamp_score(data.get("clarity_concision_score"))
    return data


def _merge_sentence_suggestions(*groups: list[dict], max_suggestions: int = 40) -> list[dict]:
    """Merge parallel sentence-coach results, preferring the earlier coach on duplicates."""
    merged: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for group in groups:
        for suggestion in group:
            key = (
                str(suggestion.get("original_text") or "").lower(),
                str(suggestion.get("suggested_text") or "").lower(),
            )
            if key in seen:
                continue
            seen.add(key)
            merged.append(suggestion)
            if len(merged) >= max_suggestions:
                return merged
    return merged


def _prepare_sentence_suggestions(
    draft: str,
    grammar_feedback: dict,
    clarity_feedback: dict,
    writing_support_level: str,
) -> list[dict]:
    """Clean each coach independently, then merge its safe suggestions."""
    grammar = _clean_sentence_suggestions(
        draft,
        grammar_feedback.get("sentence_suggestions") or [],
        writing_support_level="grammar_only",
        allowed_types={"grammar"},
    )
    clarity = []
    if writing_support_level != "grammar_only":
        clarity = _clean_sentence_suggestions(
            draft,
            clarity_feedback.get("sentence_suggestions") or [],
            writing_support_level="sentence_polish",
            allowed_types={"clarity", "concision"},
        )
    return _merge_sentence_suggestions(grammar, clarity)


def _sentence_feedback_view(report: dict) -> dict:
    """Expose the specialist assessment without duplicating inline suggestions."""
    return {key: value for key, value in (report or {}).items() if key != "sentence_suggestions"}


def _profile_text(student_profile: Optional[dict]) -> str:
    if not student_profile:
        return ""
    text = student_profile.get("profile_text")
    if isinstance(text, str) and text.strip():
        return text[:8000]
    parts = []
    for key, value in student_profile.items():
        if isinstance(value, (str, int, float)) and str(value).strip():
            parts.append(f"{key}: {value}")
    return "\n".join(parts)[:8000]


def _run_alignment(
    essay_draft: str,
    essay_prompt: str,
    profile_text: str,
    scholarship_context: str,
) -> dict:
    """Run the merged prompt-coverage and scholarship-values alignment audit."""
    system, human = build_alignment_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        profile_text=profile_text,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(AlignmentOutput)
    result = model.invoke([("system", system), ("human", human)])
    data = result.model_dump()
    data["alignment_score"] = _clamp_score(data.get("alignment_score"))
    return data


def _prompt_alignment_view(alignment: dict) -> dict:
    """Project merged Alignment into the legacy prompt-alignment response field."""
    if not alignment:
        return {}
    return {
        "alignment_score": alignment.get("alignment_score", 0),
        "covered_requirements": [
            *(alignment.get("covered_prompt_parts") or []),
            *(alignment.get("addressed_scholarship_values") or []),
        ],
        "weakly_covered_requirements": [
            *(alignment.get("weakly_covered_prompt_parts") or []),
            *(alignment.get("weak_or_missing_scholarship_values") or []),
        ],
        "missing_requirements": alignment.get("missing_prompt_parts") or [],
        "comments": alignment.get("comments") or [],
        "revision_tasks": alignment.get("revision_tasks") or [],
    }


def _outline_text(personalized_outline: Optional[dict]) -> str:
    outline = (personalized_outline or {}).get("outline") if isinstance(personalized_outline, dict) else None
    if not isinstance(outline, dict):
        return ""
    parts = []
    if outline.get("thesis_or_core_message"):
        parts.append(f"Core message: {outline['thesis_or_core_message']}")
    for i, section in enumerate(outline.get("sections") or [], start=1):
        if isinstance(section, dict) and section.get("section_name"):
            parts.append(f"{i}. {section['section_name']}: {section.get('purpose', '')}")
    return "\n".join(parts)[:3000]


def _run_narrative_structure(
    essay_draft: str,
    essay_prompt: str,
    personalized_outline_text: str,
    profile_text: str,
) -> dict:
    """Run the merged narrative structure, flow, arc, and coherence audit."""
    system, human = build_narrative_structure_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        personalized_outline=personalized_outline_text,
        profile_text=profile_text,
    )
    model = llm._get_client().with_structured_output(NarrativeStructureOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    for key in (
        "narrative_structure_score",
        "structure_flow_score",
        "coherence_score",
        "narrative_arc_score",
    ):
        data[key] = _clamp_score(data.get(key))
    return data


def _run_insight(
    essay_draft: str,
    essay_prompt: str,
    profile_text: str,
    scholarship_context: str,
) -> dict:
    """Run the dedicated depth, meaning, change, and reflection audit."""
    system, human = build_insight_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        profile_text=profile_text,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(InsightOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    data["insight_score"] = _clamp_score(data.get("insight_score"))
    return data


def _structure_flow_view(narrative: dict) -> dict:
    """Project the merged narrative report into the legacy structure field."""
    if not narrative:
        return {}
    flow_issues = list(narrative.get("transition_and_flow_issues") or [])
    flow_issues.extend(narrative.get("coherence_issues") or [])
    flow_issues.extend(narrative.get("contradictions_or_timeline_issues") or [])
    flow_issues.extend(narrative.get("missing_reasoning") or [])
    return {
        "structure_score": narrative.get("narrative_structure_score", 0),
        "paragraph_feedback": narrative.get("paragraph_feedback") or [],
        "flow_issues": list(dict.fromkeys(flow_issues)),
        "recommended_reordering": narrative.get("recommended_reordering") or [],
        "revision_tasks": narrative.get("revision_tasks") or [],
    }


def _run_evidence_strength(essay_draft: str, profile_text: str, scholarship_context: str) -> dict:
    """Run the merged profile-grounding, discovery, specificity, and impact audit."""
    system, human = build_evidence_strength_prompt(
        essay_draft=essay_draft,
        profile_text=profile_text,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(EvidenceStrengthOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    data["evidence_strength_score"] = _clamp_score(data.get("evidence_strength_score"))
    return data


def _profile_grounding_view(evidence: dict) -> dict:
    """Project Evidence Strength into the legacy profile-grounding field."""
    if not evidence:
        return {}
    verification_flags = list(evidence.get("unsupported_or_risky_claims") or [])
    verification_flags.extend(evidence.get("invented_or_unverifiable_details") or [])
    return {
        "grounding_score": evidence.get("evidence_strength_score", 0),
        "supported_claims": evidence.get("supported_claims") or [],
        "unsupported_or_risky_claims": list(dict.fromkeys(verification_flags)),
        "unused_relevant_profile_evidence": evidence.get("unused_relevant_profile_evidence") or [],
        "recommendations": evidence.get("recommendations") or [],
    }


def _specificity_view(evidence: dict) -> dict:
    """Project Evidence Strength into the legacy specificity field."""
    if not evidence:
        return {}
    return {
        "specificity_score": evidence.get("evidence_strength_score", 0),
        "vague_statements": evidence.get("vague_statements") or [],
        "places_to_add_detail": evidence.get("places_to_add_detail") or [],
        "impact_opportunities": evidence.get("impact_opportunities") or [],
        "recommended_questions": evidence.get("recommended_questions") or [],
    }


def _run_tone_authenticity(essay_draft: str, profile_text: str, scholarship_context: str) -> dict:
    system, human = build_tone_authenticity_prompt(
        essay_draft=essay_draft,
        profile_text=profile_text,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(ToneAuthenticityOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    data["authenticity_score"] = _clamp_score(data.get("authenticity_score"))
    data["tone_score"] = _clamp_score(data.get("tone_score"))
    return data


def _run_reviewer(essay_draft: str, essay_prompt: str, scholarship_context: str) -> dict:
    system, human = build_reviewer_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(ReviewerOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    data["competitiveness_score"] = _clamp_score(data.get("competitiveness_score"))
    return data


def _run_combiner(specialist_summary: str) -> dict:
    system, human = build_combiner_prompt(specialist_summary=specialist_summary)
    model = llm._get_client().with_structured_output(CombinerOutput)
    return model.invoke([("system", system), ("human", human)]).model_dump()


def _run_guardrail_critic(essay_draft: str, profile_text: str, sentence_suggestions: list) -> dict:
    suggestions_json = json.dumps(
        [
            {
                "index": i,
                "original": s.get("original_text", ""),
                "suggested": s.get("suggested_text", ""),
                "type": s.get("suggestion_type", ""),
                "risk_tier": s.get("risk_tier", ""),
            }
            for i, s in enumerate(sentence_suggestions)
        ],
        default=str,
    )[:8000]
    system, human = build_guardrail_prompt(
        essay_draft=essay_draft,
        profile_text=profile_text,
        suggestions_json=suggestions_json,
    )
    model = llm._get_client().with_structured_output(GuardrailOutput)
    return model.invoke([("system", system), ("human", human)]).model_dump()


def _run_final_check(
    essay_draft: str,
    essay_prompt: str,
    scholarship_context: str,
    profile_text: str,
    word_count: int,
    word_limit: str,
) -> dict:
    system, human = build_final_check_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        scholarship_context=scholarship_context,
        profile_text=profile_text,
        word_count=word_count,
        word_limit=word_limit,
    )
    model = llm._get_client().with_structured_output(FinalCheckOutput)
    return model.invoke([("system", system), ("human", human)]).model_dump()


def _word_limit_number(word_limit: str) -> Optional[int]:
    import re

    nums = re.findall(r"\d{2,5}", word_limit or "")
    return max(int(n) for n in nums) if nums else None


def _run_outline_coverage(essay_draft: str, outline_points: list, scholarship_context: str) -> dict:
    points = [{"id": p.get("id", ""), "label": p.get("label", "")} for p in (outline_points or []) if p.get("id")]
    if not points:
        return {"covered_point_ids": []}
    system, human = build_outline_coverage_prompt(
        essay_draft=essay_draft,
        outline_points_json=json.dumps(points, default=str)[:6000],
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(OutlineCoverageOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    valid = {p["id"] for p in points}
    # Defense in depth: drop any id the model invented (the frontend also intersects).
    data["covered_point_ids"] = [i for i in (data.get("covered_point_ids") or []) if i in valid]
    return data


def run_selection_rewrite(
    action: str,
    selected_text: str,
    surrounding_text: str = "",
    essay_prompt: str = "",
    clean_scholarship_record: Optional[dict] = None,
    student_profile: Optional[dict] = None,
) -> dict:
    """Rewrite/shorten/expand/improve-tone a selected passage. Never fabricates facts."""
    selected_text = (selected_text or "").strip()
    if not selected_text:
        return {"status": "error", "rewritten_text": "", "note": "No text was selected."}
    action = action if action in REWRITE_ACTIONS else "rewrite"
    system, human = build_rewrite_prompt(
        action=action,
        selected_text=selected_text,
        surrounding_text=(surrounding_text or "")[:4000],
        essay_prompt=essay_prompt,
        scholarship_context=_scholarship_context(clean_scholarship_record),
        profile_text=_profile_text(student_profile),
    )
    try:
        model = llm._get_client().with_structured_output(RewriteOutput)
        data = model.invoke([("system", system), ("human", human)]).model_dump()
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "rewritten_text": "", "note": f"Rewrite failed: {exc}"}

    rewritten = (data.get("rewritten_text") or "").strip()
    note = (data.get("note") or "").strip()
    if not rewritten:
        return {"status": "success", "rewritten_text": selected_text, "note": note or "Kept your original text."}
    # Length guardrail — an implausibly large expansion is likely fabrication; keep the original.
    if len(rewritten) > max(len(selected_text) * 3, len(selected_text) + 300):
        return {
            "status": "success",
            "rewritten_text": selected_text,
            "note": note or "The rewrite added too much, so your original was kept — add the detail yourself to stay grounded.",
        }
    return {"status": "success", "rewritten_text": rewritten, "note": note}


def _derive_writing_scores(sentence_suggestions: list) -> tuple[int, int]:
    """Derive clarity and grammar/mechanics scores from the sentence suggestions."""
    weight = {"low": 3, "medium": 6, "high": 10}
    grammar_types = {"grammar"}
    clarity_types = {"clarity", "flow", "transition", "concision", "word_choice"}
    grammar_penalty = 0
    clarity_penalty = 0
    for item in sentence_suggestions:
        w = weight.get(item.get("severity"), 6)
        if item.get("suggestion_type") in grammar_types:
            grammar_penalty += w
        if item.get("suggestion_type") in clarity_types:
            clarity_penalty += w
    return _clamp_score(100 - clarity_penalty), _clamp_score(100 - grammar_penalty)


def _compose_summary(package: dict) -> str:
    parts = []
    align = package.get("alignment") or package.get("prompt_alignment") or {}
    ground = package.get("profile_grounding") or {}
    evidence = package.get("evidence_strength") or {}
    insight = package.get("insight") or {}
    grammar_feedback = package.get("grammar_feedback") or {}
    clarity_feedback = package.get("clarity_concision_feedback") or {}
    count = len(package.get("sentence_suggestions") or [])

    if align:
        missing = align.get("missing_prompt_parts") or align.get("missing_requirements") or []
        weak = align.get("weakly_covered_prompt_parts") or align.get("weakly_covered_requirements") or []
        weak_values = align.get("weak_or_missing_scholarship_values") or []
        gap = (missing[:1] or weak[:1] or weak_values[:1] or [""])[0]
        parts.append(
            f"Prompt and scholarship alignment is {align.get('alignment_score', 0)}/100"
            + (f" — the biggest gap is: {gap}." if gap else ".")
        )
    if evidence:
        risky = evidence.get("unsupported_or_risky_claims") or []
        vague = evidence.get("vague_statements") or []
        note = ""
        if risky:
            note = f" Verify or soften {len(risky)} unsupported claim(s)."
        elif vague:
            note = f" Add concrete support to {len(vague)} vague statement(s)."
        parts.append(f"Evidence strength is {evidence.get('evidence_strength_score', 0)}/100.{note}")
    elif ground:
        risky = ground.get("unsupported_or_risky_claims") or []
        unused = ground.get("unused_relevant_profile_evidence") or []
        note = ""
        if risky:
            note = f" Double-check {len(risky)} claim(s) your profile doesn't yet support."
        elif unused:
            note = f" You could strengthen it with unused evidence like: {unused[0]}"
        parts.append(f"Profile grounding is {ground.get('grounding_score', 0)}/100.{note}")
    if insight:
        missing_meaning = insight.get("missing_meaning_or_reflection") or []
        note = (
            f" Develop the meaning behind {len(missing_meaning)} descriptive moment(s)."
            if missing_meaning
            else ""
        )
        parts.append(f"Insight depth is {insight.get('insight_score', 0)}/100.{note}")
    if clarity_feedback:
        parts.append(
            f"Clarity and concision is {clarity_feedback.get('clarity_concision_score', 0)}/100."
        )
    if grammar_feedback:
        parts.append(f"Grammar correctness is {grammar_feedback.get('grammar_score', 0)}/100.")
    if count:
        parts.append(f"There {'is' if count == 1 else 'are'} {count} sentence-level fix{'' if count == 1 else 'es'} in Sentence Fixes.")

    if not parts:
        return "No major issues stood out. Keep drafting and run the coach again as your essay grows."
    return " ".join(parts)


def run_essay_workspace_coach(
    student_profile: Optional[dict] = None,
    clean_scholarship_record: Optional[dict] = None,
    essay_prompt: str = "",
    essay_draft: str = "",
    personalized_outline: Optional[dict] = None,
    user_notes: Optional[str] = None,
    word_limit: str = "",
    outline_points: Optional[list] = None,
    mode: str = "full",
    writing_support_level: str = "grammar_only",
) -> dict:
    """Coordinate the Essay Workspace coaching specialists and return one package.

    Specialists run concurrently so even a "full" run stays close to one call's
    latency, then the Combiner synthesizes them into one action plan:
      - Grammar Coach (full, workspace_refresh, grammar_tone, auto_check)
      - Clarity & Concision Coach (full, workspace_refresh, grammar_tone)
      - Alignment (Prompt + Scholarship Values) Coach (full, prompt_alignment, workspace_refresh)
      - Evidence Strength Coach (full, prompt_alignment, structure, workspace_refresh)
      - Narrative Structure, Flow & Coherence Coach (full, structure, workspace_refresh)
      - Insight (Depth + Meaning + Reflection) Coach (full, structure, workspace_refresh)
      - Tone & Authenticity Coach (full, workspace_refresh)
      - Outline Coverage Coach   (full, workspace_refresh, auto_check; conditional on outline)
      - Reviewer Simulation     (reviewer only)
      - Revision Combiner       (full, workspace_refresh)
      - Guardrail Critic        (any mode that emits sentence suggestions)
    Each specialist fails independently into a warning rather than failing the run.
    """
    essay_draft = (essay_draft or "").strip()
    package = _empty_package()

    if not essay_draft:
        package["status"] = "error"
        package["coach_summary"] = "Add an essay draft, then run the coach."
        package["warnings"] = ["No essay draft provided."]
        return package

    warnings: list[str] = []
    if not clean_scholarship_record:
        warnings.append("No cleaned scholarship record found, so scholarship-specific coaching is limited.")
    if not student_profile:
        warnings.append("No student profile found, so evidence-strength feedback is limited.")

    writing_brief = resolve_writing_brief(
        essay_prompt=essay_prompt,
        clean_scholarship_record=clean_scholarship_record,
        allow_scholarship_fallback=True,
    )
    package["writing_brief"] = {
        "mode": writing_brief.get("mode"),
        "has_formal_prompt": writing_brief.get("has_formal_prompt"),
        "prompt_asks": writing_brief.get("prompt_asks") or [],
    }
    if writing_brief.get("mode") == "scholarship_guided":
        warnings.append(
            "No formal essay prompt was provided, so coaching adapts to the scholarship mission and selection criteria."
        )
    elif writing_brief.get("mode") == "empty":
        warnings.append(
            "No essay prompt or scholarship writing focus was found. Add a prompt for stronger adaptive coaching."
        )

    scholarship_context = _scholarship_context(clean_scholarship_record)
    # Specialists receive the adaptive brief + original prompt text so they can
    # dynamically tailor alignment/structure/tone to this exact writing task.
    essay_prompt_for_agents = (
        f"{format_brief_for_prompt(writing_brief)}\n\n"
        f"SELECTED ESSAY PROMPT TEXT:\n{(essay_prompt or '').strip() or '(none — use scholarship-guided brief)'}"
    )
    profile_text = _profile_text(student_profile)
    outline_text = _outline_text(personalized_outline)
    word_count = len(essay_draft.split())

    # Final readiness check is a standalone, holistic pass (no specialist battery).
    if mode == "final_check":
        try:
            final = _run_final_check(
                essay_draft, essay_prompt_for_agents, scholarship_context, profile_text, word_count, word_limit
            )
        except Exception as exc:  # noqa: BLE001
            package["status"] = "error"
            package["warnings"] = warnings + [f"final check failed: {exc}"]
            package["coach_summary"] = "Scholar-E could not run the final check this time. Please try again."
            return package

        limit = _word_limit_number(word_limit)
        if limit and word_count > limit and not final.get("submission_warning"):
            final["submission_warning"] = f"Your essay is {word_count} words, over the {limit}-word limit."
        blockers = final.get("remaining_blockers") or []
        polish_notes = final.get("final_polish_notes") or []
        package["final_check"] = final
        package["warnings"] = warnings
        package["coach_summary"] = (
            f"Final check completed: {len(blockers)} blocker(s) and "
            f"{len(polish_notes)} polish note(s) found."
        )
        return package

    outline_points = outline_points or []
    support_level = _resolve_writing_support_level(mode, writing_support_level)
    package["writing_support_level"] = support_level

    # workspace_refresh = coaching-session companion pack. Maximize template use
    # (grammar, clarity/concision, alignment, evidence strength, narrative
    # structure, insight, tone, coverage) in parallel.
    # Reviewer simulation is opt-in via mode=="reviewer" only (not full).
    # Deep 7-criterion scores still come from /api/analyze.
    enabled = {
        "grammar": mode in ("full", "workspace_refresh", "grammar_tone", "auto_check"),
        "clarity_concision": mode in ("full", "workspace_refresh", "grammar_tone"),
        "alignment": mode in ("full", "prompt_alignment", "workspace_refresh"),
        "evidence_strength": mode in ("full", "prompt_alignment", "structure", "workspace_refresh"),
        "narrative_structure": mode in ("full", "structure", "workspace_refresh"),
        "insight": mode in ("full", "structure", "workspace_refresh"),
        "tone": mode in ("full", "workspace_refresh"),
        "reviewer": mode == "reviewer",
        "coverage": mode in ("full", "auto_check", "workspace_refresh") and bool(outline_points),
    }
    runners = {
        "grammar": lambda: _run_grammar(essay_draft, user_notes or ""),
        "clarity_concision": lambda: _run_clarity_concision(
            essay_draft, user_notes or "", support_level
        ),
        "alignment": lambda: _run_alignment(
            essay_draft,
            essay_prompt_for_agents,
            profile_text,
            scholarship_context,
        ),
        "evidence_strength": lambda: _run_evidence_strength(essay_draft, profile_text, scholarship_context),
        "narrative_structure": lambda: _run_narrative_structure(
            essay_draft,
            essay_prompt_for_agents,
            outline_text,
            profile_text,
        ),
        "insight": lambda: _run_insight(
            essay_draft,
            essay_prompt_for_agents,
            profile_text,
            scholarship_context,
        ),
        "tone": lambda: _run_tone_authenticity(essay_draft, profile_text, scholarship_context),
        "reviewer": lambda: _run_reviewer(essay_draft, essay_prompt_for_agents, scholarship_context),
        "coverage": lambda: _run_outline_coverage(essay_draft, outline_points, scholarship_context),
    }

    jobs = {name: run for name, run in runners.items() if enabled[name]}
    results: dict = {}
    with ThreadPoolExecutor(max_workers=max(1, len(jobs))) as pool:
        futures = {name: pool.submit(run) for name, run in jobs.items()}
        for name, future in futures.items():
            try:
                results[name] = future.result()
            except Exception as exc:  # noqa: BLE001 — degrade one specialist, keep the rest
                results[name] = None
                warnings.append(f"{name} coaching failed: {exc}")

    scores: dict = {}
    grammar_feedback = results.get("grammar") or {}
    clarity_feedback = results.get("clarity_concision") or {}
    package["grammar_feedback"] = _sentence_feedback_view(grammar_feedback)
    package["clarity_concision_feedback"] = _sentence_feedback_view(clarity_feedback)
    if results.get("grammar") is not None or results.get("clarity_concision") is not None:
        package["sentence_suggestions"] = _prepare_sentence_suggestions(
            essay_draft,
            grammar_feedback,
            clarity_feedback,
            support_level,
        )
        scores["clarity_concision"] = clarity_feedback.get("clarity_concision_score", 0)
        scores["grammar_mechanics"] = grammar_feedback.get("grammar_score", 0)
    if results.get("alignment"):
        package["alignment"] = results["alignment"]
        package["prompt_alignment"] = _prompt_alignment_view(results["alignment"])
        scores["alignment"] = results["alignment"].get("alignment_score", 0)
    if results.get("evidence_strength"):
        package["evidence_strength"] = results["evidence_strength"]
        package["profile_grounding"] = _profile_grounding_view(results["evidence_strength"])
        package["specificity_feedback"] = _specificity_view(results["evidence_strength"])
        scores["evidence_strength"] = results["evidence_strength"].get("evidence_strength_score", 0)
    if results.get("narrative_structure"):
        package["narrative_structure"] = results["narrative_structure"]
        package["structure_feedback"] = _structure_flow_view(results["narrative_structure"])
        package["paragraph_feedback"] = results["narrative_structure"].get("paragraph_feedback", [])
        scores["narrative_structure_flow_coherence"] = results["narrative_structure"].get(
            "narrative_structure_score", 0
        )
    if results.get("insight"):
        package["insight"] = results["insight"]
        scores["insight"] = results["insight"].get("insight_score", 0)
    if results.get("tone"):
        package["tone_feedback"] = results["tone"]
        scores["authenticity"] = results["tone"].get("authenticity_score", 0)
    if results.get("reviewer"):
        package["reviewer_simulation"] = results["reviewer"]
        scores["competitiveness"] = results["reviewer"].get("competitiveness_score", 0)
    if results.get("coverage"):
        package["outline_coverage"] = results["coverage"]

    package["overall_scores"] = scores
    package["warnings"] = warnings

    if jobs and all(results.get(name) is None for name in jobs):
        package["status"] = "error"
        package["coach_summary"] = "Scholar-E could not analyze the draft this time. Please try again."
        return package

    # Post-processing: Guardrail Critic audits sentence suggestions; Combiner
    # synthesizes an action plan for full / workspace_refresh — run concurrently.
    def _combiner_job():
        summary_input = json.dumps(
            {
                "overall_scores": scores,
                "sentence_suggestion_count": len(package["sentence_suggestions"]),
                "grammar_feedback": package["grammar_feedback"],
                "clarity_concision_feedback": package["clarity_concision_feedback"],
                "alignment": package["alignment"],
                "evidence_strength": package["evidence_strength"],
                "narrative_structure": package["narrative_structure"],
                "insight": package["insight"],
                "tone_feedback": package["tone_feedback"],
                "reviewer_simulation": package["reviewer_simulation"],
            },
            default=str,
        )[:12000]
        return _run_combiner(summary_input)

    post_jobs = {}
    if package["sentence_suggestions"] and mode in _GUARDED_SUGGESTION_MODES:
        post_jobs["guardrail"] = lambda: _run_guardrail_critic(
            essay_draft, profile_text, package["sentence_suggestions"]
        )
    if mode in ("full", "workspace_refresh") and any(results.get(name) is not None for name in results):
        post_jobs["combiner"] = _combiner_job

    post_results: dict = {}
    if post_jobs:
        with ThreadPoolExecutor(max_workers=len(post_jobs)) as pool:
            post_futures = {name: pool.submit(run) for name, run in post_jobs.items()}
            for name, future in post_futures.items():
                try:
                    post_results[name] = future.result()
                except Exception as exc:  # noqa: BLE001
                    post_results[name] = None
                    warnings.append(f"{name} failed: {exc}")

    # Apply the Guardrail Critic: drop any suggestion it flagged as unsafe.
    guardrail = post_results.get("guardrail")
    if guardrail:
        unsafe = {int(i) for i in guardrail.get("unsafe_suggestion_indices", []) if isinstance(i, int) or str(i).isdigit()}
        if unsafe:
            removed = [s.get("suggested_text", "") for i, s in enumerate(package["sentence_suggestions"]) if i in unsafe]
            package["sentence_suggestions"] = [s for i, s in enumerate(package["sentence_suggestions"]) if i not in unsafe]
            package["overall_scores"] = scores
            guardrail["removed_or_revised_suggestions"] = removed
            if removed:
                warnings.append(f"Guardrail removed {len(removed)} suggestion(s) that risked adding unsupported claims.")
        package["guardrail"] = guardrail

    combined = post_results.get("combiner")
    if combined:
        package["revision_priorities"] = combined.get("top_revision_priorities", [])
        package["quick_fixes"] = combined.get("quick_fixes", [])
        package["deeper_revision_tasks"] = combined.get("deeper_revision_tasks", [])
        package["coach_summary"] = combined.get("coach_summary") or _compose_summary(package)
    else:
        package["coach_summary"] = _compose_summary(package)

    package["warnings"] = warnings
    return package
