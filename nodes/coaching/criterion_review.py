"""Manager-first, criterion-owned essay review for the Essay Workspace.

The Manager owns only the scholarship-specific rubric and weights. Six
criterion agents then independently act as scholarship coaches: each completes
a private structured audit, gives grounded reviewer-perspective feedback, scores
the criterion, and recommends one aligned revision action. QA and Guardrail
critics inspect the audit-to-output chain; Python owns normalization and the
weighted overall score.
"""

from __future__ import annotations

import json
import math
from typing import Any

from llm.client import llm
from nodes.coaching.readiness import READINESS_DIMENSIONS, READINESS_LABELS, clamp_score
from utils.parsing import safe_json_parse


CRITERION_DEFINITIONS: dict[str, dict[str, str]] = {
    "alignment": {
        "focus": (
            "Directly answers every prompt part and connects the student's goals, values, "
            "and experiences to the scholarship's stated priorities and specific opportunity."
        ),
        "reviewer_lens": "Does this answer what we asked and show fit with this scholarship?",
    },
    "evidence_strength": {
        "focus": (
            "Uses concrete, profile-grounded evidence, specific moments, responsibilities, names, "
            "details, numbers, and outcomes without unsupported or invented claims."
        ),
        "reviewer_lens": "Do I believe these claims, and can I see concrete evidence of impact?",
    },
    "insight": {
        "focus": (
            "Explains meaning, learning, realization, change, responsibility, significance to others, "
            "and connection to the student's future direction."
        ),
        "reviewer_lens": "What did the student genuinely learn or come to understand, and why does it matter?",
    },
    "narrative_structure_flow_coherence": {
        "focus": (
            "Uses purposeful organization, transitions, narrative progression, and logically consistent "
            "ideas, timeline, motivations, people, events, and claims."
        ),
        "reviewer_lens": "Can I follow the essay naturally, and do all of its ideas and events connect?",
    },
    "tone_authenticity": {
        "focus": (
            "Sounds sincere, thoughtful, confident, respectful, and genuinely student-written rather "
            "than generic, corporate, formulaic, performative, or AI-like."
        ),
        "reviewer_lens": "Does this sound like a real student I can trust and understand?",
    },
    "clarity_concision": {
        "focus": (
            "Uses direct, understandable sentences without filler, repetition, wordiness, unclear "
            "phrasing, or tangled sentence structure."
        ),
        "reviewer_lens": "Can I understand every point quickly without rereading?",
    },
}


# These playbooks are internal evidence inventories, not student-facing reports
# and not requests for hidden chain-of-thought. Each criterion coach completes
# its own concise audit before selecting the one strength and one gap that matter
# most for the public reviewer-voice feedback.
CRITERION_AUDIT_PLAYBOOKS: dict[str, dict[str, Any]] = {
    "alignment": {
        "instructions": (
            "Audit every distinct prompt ask and every scholarship value or priority explicitly supported "
            "by the submission. Map real student goals, values, and experiences to those priorities; flag "
            "generic fit claims and distinguish covered, weakly covered, and missing requirements."
        ),
        "schema": {
            "covered_prompt_parts": ["prompt ask and the draft evidence that answers it"],
            "weakly_covered_prompt_parts": ["prompt ask and what remains incomplete"],
            "missing_prompt_parts": ["unanswered prompt ask"],
            "stated_scholarship_values": ["value explicitly supported by scholarship materials"],
            "addressed_scholarship_values": ["value and grounded student connection"],
            "weak_or_missing_scholarship_values": ["value and missing connection"],
            "student_fit_connections": ["scholarship priority mapped to a real student fact"],
            "generic_or_unsupported_fit_claims": ["draft claim and why it is generic or unsupported"],
            "strongest_alignment_strength": "strongest grounded alignment already present",
            "highest_priority_alignment_gap": "single most consequential alignment gap",
        },
    },
    "evidence_strength": {
        "instructions": (
            "Compare the entire relevant student profile with the essay. Check claim support, specificity, "
            "credibility, and demonstrated impact. Rank profile experiences by relevance to this prompt and "
            "scholarship, identify the strongest relevant experience, and state whether the draft uses it well. "
            "Do not force a prestigious experience that fits less well than the draft's current evidence. If the "
            "strongest unused experience is the most consequential gap, surface it in the reviewer feedback and "
            "priority action. Treat unverified details as verification flags, never accusations."
        ),
        "schema": {
            "supported_claims": ["essay claim mapped to explicit profile evidence"],
            "unsupported_or_risky_claims": ["claim not supported by submitted material"],
            "invented_or_unverifiable_details": ["specific essay detail with no visible profile source"],
            "unused_relevant_profile_evidence": ["real profile evidence that could strengthen this essay"],
            "strongest_relevant_profile_evidence": "single strongest prompt-relevant profile experience, or none",
            "strongest_evidence_used": "yes, partly, no, or no relevant profile evidence",
            "vague_statements": ["exact or tightly paraphrased vague statement"],
            "places_to_add_detail": ["draft location and truthful detail type needed"],
            "impact_opportunities": ["action missing who benefited, what changed, or a measurable outcome"],
            "highest_priority_evidence_gap": "single most consequential evidence gap",
        },
    },
    "insight": {
        "instructions": (
            "Audit depth, meaning, reflection, learning, realization, change, responsibility, significance, and "
            "future direction. Separate genuine draft-supported reflection from generic lessons. Do not invent "
            "growth, prescribe an emotion, or rescore narrative placement, evidence strength, or alignment."
        ),
        "schema": {
            "meaningful_reflections": ["grounded reflection and the experience it interprets"],
            "surface_level_or_generic_reflections": ["shallow statement and why it lacks depth"],
            "lessons_realizations_or_questions": ["draft-supported learning, realization, or question"],
            "changes_in_mindset_or_behavior": ["explicit supported change"],
            "changes_in_values_goals_or_responsibility": ["explicit supported change"],
            "significance_to_self": ["why the experience mattered personally"],
            "significance_to_others_or_community": ["why it mattered beyond the student"],
            "future_direction_connections": ["grounded connection to future direction"],
            "missing_meaning_or_reflection": ["draft moment that reports events without explaining meaning"],
            "highest_priority_insight_gap": "single most consequential insight gap",
        },
    },
    "narrative_structure_flow_coherence": {
        "instructions": (
            "Audit the structural presence, placement, sequencing, and connection of context, motivation, action, "
            "reflection, and takeaway. Review paragraph roles, transitions, pacing, chronology, logical continuity, "
            "contradictions, and missing reasoning. Judge where reflection appears and how it connects, not how "
            "profound it is; Insight owns reflection depth."
        ),
        "schema": {
            "arc_progression": ["stage, status, draft evidence, and structural issue"],
            "paragraph_roles": ["paragraph number, purpose, strength, and structural issue"],
            "transition_and_flow_issues": ["exact paragraphs or ideas that do not flow"],
            "coherence_issues": ["ideas, motivations, people, events, or claims not logically connected"],
            "contradictions_or_timeline_issues": ["apparent inconsistency stated cautiously"],
            "missing_reasoning": ["logical step the reader needs"],
            "logical_connections_to_preserve": ["effective cause-and-effect link, transition, or callback"],
            "recommended_reordering": ["reordering only when clearly beneficial"],
            "highest_priority_narrative_gap": "single most consequential structure or coherence gap",
        },
    },
    "tone_authenticity": {
        "instructions": (
            "Audit sincerity, thoughtfulness, confidence, respect, and a genuinely student-written voice. Identify "
            "distinctive language worth preserving and flag only grounded examples of generic, overly polished, "
            "corporate, formulaic, performative, or AI-like wording. Do not assume polished writing is AI-generated."
        ),
        "schema": {
            "authentic_voice_strengths": ["distinctive sincere wording or voice quality to preserve"],
            "tone_quality_notes": ["grounded note on sincerity, confidence, thoughtfulness, or respect"],
            "ai_like_phrases": ["exact phrase and specific reason it feels AI-like"],
            "generic_phrases": ["cliche, filler, or interchangeable wording"],
            "overly_polished_or_corporate_phrases": ["exact wording and why it feels unnatural"],
            "formulaic_or_performative_phrases": ["exact wording and why it feels templated or performative"],
            "voice_preservation_notes": ["student voice qualities that revisions must retain"],
            "highest_priority_tone_gap": "single most consequential tone or authenticity gap",
        },
    },
    "clarity_concision": {
        "instructions": (
            "Audit sentence- and phrase-level directness and readability. Identify representative clear wording and "
            "specific filler, repetition, unnecessary wording, unclear phrasing, or convoluted sentence structure. "
            "Preserve meaning and voice; sentence-level Grammar Fixes owns correctness, and the Narrative "
            "Structure, Flow & Coherence criterion owns essay-level organization."
        ),
        "schema": {
            "clear_and_direct_sentences": ["representative wording that is already easy to understand"],
            "filler_or_repetition": ["exact wording and the repeated or unnecessary content"],
            "unnecessary_wording": ["wordy phrase and what makes it indirect"],
            "unclear_phrasing": ["exact wording and what a reader may not understand"],
            "convoluted_sentence_structure": ["sentence and the structural source of confusion"],
            "meaning_or_voice_to_preserve": ["meaning or distinctive wording that must survive revision"],
            "highest_priority_clarity_gap": "single most consequential clarity or concision gap",
        },
    },
}


DEFAULT_WEIGHTS = {
    "alignment": 25,
    "evidence_strength": 25,
    "insight": 20,
    "narrative_structure_flow_coherence": 15,
    "tone_authenticity": 8,
    "clarity_concision": 7,
}


def _grounding_rules() -> str:
    return """
GROUNDING AND OWNERSHIP RULES:
- Use only the submitted essay, student profile, scholarship information, and prompt.
- Never invent an experience, achievement, responsibility, name, number, result, or motivation.
- Quote only short exact passages and otherwise tightly paraphrase the submission.
- If a needed detail is absent, tell the student what kind of real detail to supply; never supply it.
- Stay inside the assigned criterion. Do not score another criterion.
- Preserve the student's meaning and ownership. Give coaching, not a replacement essay.
"""


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _as_text(value: Any) -> str:
    return str(value or "").strip()


def _as_text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_as_text(item) for item in value if _as_text(item)]
    text = _as_text(value)
    return [text] if text else []


def _normalize_weights(raw_weights: dict[str, Any]) -> dict[str, int]:
    """Normalize Manager weights to six bounded integers totaling 100."""
    parsed: dict[str, float] = {}
    for key in READINESS_DIMENSIONS:
        try:
            parsed[key] = float(raw_weights.get(key))
        except (TypeError, ValueError):
            return dict(DEFAULT_WEIGHTS)
        if not math.isfinite(parsed[key]) or parsed[key] <= 0:
            return dict(DEFAULT_WEIGHTS)

    total = sum(parsed.values())
    targets = {key: parsed[key] * 100 / total for key in READINESS_DIMENSIONS}
    weights = {
        key: max(5, min(30, int(round(targets[key]))))
        for key in READINESS_DIMENSIONS
    }

    # Correct rounding and bounds deterministically while preserving the
    # Manager's relative priorities as closely as possible.
    while sum(weights.values()) != 100:
        add = sum(weights.values()) < 100
        eligible = [
            key
            for key in READINESS_DIMENSIONS
            if (weights[key] < 30 if add else weights[key] > 5)
        ]
        if not eligible:
            return dict(DEFAULT_WEIGHTS)
        key = max(
            eligible,
            key=lambda item: (
                targets[item] - weights[item]
                if add
                else weights[item] - targets[item]
            ),
        )
        weights[key] += 1 if add else -1
    return weights


def normalize_manager_plan(raw: Any) -> dict:
    raw = _as_dict(raw)
    raw_criteria = _as_dict(raw.get("criteria") or raw.get("rubric"))
    raw_weights = {
        key: _as_dict(raw_criteria.get(key)).get("weight", DEFAULT_WEIGHTS[key])
        for key in READINESS_DIMENSIONS
    }
    weights = _normalize_weights(raw_weights)
    criteria: dict[str, dict[str, Any]] = {}
    for key in READINESS_DIMENSIONS:
        source = _as_dict(raw_criteria.get(key))
        definition = CRITERION_DEFINITIONS[key]
        criteria[key] = {
            "label": READINESS_LABELS[key],
            "weight": weights[key],
            "weight_rationale": _as_text(source.get("weight_rationale"))
            or "Balanced against the other required essay-quality criteria.",
            "description": _as_text(source.get("description")) or definition["focus"],
            "excellent": _as_text(source.get("excellent"))
            or f"The draft consistently satisfies this standard: {definition['focus']}",
            "developing": _as_text(source.get("developing"))
            or "The draft partly satisfies the standard but has a material, fixable gap.",
            "weak": _as_text(source.get("weak"))
            or "The draft provides little grounded evidence that it satisfies this standard.",
            "reviewer_lens": definition["reviewer_lens"],
        }
    return {
        "criteria": criteria,
        "weight_total": sum(item["weight"] for item in criteria.values()),
        "manager_summary": _as_text(raw.get("manager_summary")),
        "context_hash": _as_text(raw.get("context_hash")),
    }


def run_manager_agent(manager_context: str) -> dict:
    """Create weights and tailored rubrics without seeing the student draft."""
    prompt = f"""
You are the Manager Agent for a scholarship essay review system.

Using ONLY the scholarship information and essay prompt below, tailor all six
required criteria and assign their importance weights. You must not evaluate a
student essay. Weight means importance to this opportunity, not scoring leniency.

MANAGER CONTEXT (contains no student essay):
{manager_context}

REQUIRED CRITERIA:
{json.dumps(CRITERION_DEFINITIONS, indent=2)}

RULES:
- Include exactly the six required criterion keys.
- Give every criterion an integer weight from 5 through 30.
- All six weights must total exactly 100.
- Tailor each rubric to the scholarship's stated priorities and every prompt part.
- Grammar is handled separately as sentence-level Fixes and is not a scored criterion.
- Do not add eligibility as an essay-quality criterion.

Return ONLY valid JSON:
{{
  "manager_summary": "brief explanation of the opportunity's scoring emphasis",
  "criteria": {{
    "alignment": {{
      "weight": 25,
      "weight_rationale": "why this matters for this exact opportunity",
      "description": "tailored criterion standard",
      "excellent": "observable 80-100 performance",
      "developing": "observable 40-79 performance",
      "weak": "observable 0-39 performance"
    }},
    "evidence_strength": {{}},
    "insight": {{}},
    "narrative_structure_flow_coherence": {{}},
    "tone_authenticity": {{}},
    "clarity_concision": {{}}
  }}
}}
"""
    return normalize_manager_plan(safe_json_parse(llm.generate(prompt)))


def normalize_criterion_review(
    criterion: str,
    raw: Any,
    criterion_plan: dict,
) -> dict:
    raw = _as_dict(raw)
    audit = _as_dict(raw.get("audit") or raw.get("_internal_audit"))
    feedback = _as_dict(raw.get("coach_feedback"))
    action = _as_dict(raw.get("priority_action"))
    score_value = raw.get("score")
    try:
        numeric_score = float(score_value)
        available = not isinstance(score_value, bool) and math.isfinite(numeric_score)
    except (TypeError, ValueError):
        numeric_score = 0
        available = False
    score = clamp_score(numeric_score, hi=100) if available else None

    grounded_praise = _as_text(feedback.get("grounded_praise"))
    main_gap = _as_text(feedback.get("main_gap"))
    how_to_fix = _as_text(action.get("how_to_fix"))
    title = _as_text(action.get("title")) or f"Strengthen {READINESS_LABELS[criterion]}"
    impact = _as_text(action.get("impact")).title()
    if impact not in {"High", "Medium", "Low"}:
        impact = "High"
    effort = _as_text(action.get("estimated_effort")).title()
    if effort not in {"Quick", "Moderate", "Deep"}:
        effort = "Moderate"
    return {
        # This evidence inventory is intentionally retained only while the
        # backend critics validate the result. The orchestration service strips
        # it before constructing the public Essay Review response.
        "_internal_audit": audit,
        "criterion": criterion,
        "label": READINESS_LABELS[criterion],
        "weight": int(criterion_plan.get("weight", DEFAULT_WEIGHTS[criterion])),
        "score": score,
        "level": (
            "Strong"
            if score is not None and score >= 80
            else "Developing"
            if score is not None and score >= 60
            else "Emerging"
            if score is not None and score >= 40
            else "Needs Work"
            if score is not None
            else "Unavailable"
        ),
        "coach_feedback": {
            "grounded_praise": grounded_praise,
            "main_gap": main_gap,
        },
        "priority_action": {
            "title": title,
            "location": _as_text(action.get("location")),
            "how_to_fix": how_to_fix,
            "why_this_fixes_the_gap": _as_text(action.get("why_this_fixes_the_gap")),
            "evidence_safety": _as_text(action.get("evidence_safety")),
            "impact": impact,
            "estimated_effort": effort,
        },
        "rubric": {
            key: criterion_plan.get(key, "")
            for key in ("description", "excellent", "developing", "weak")
        },
        "available": available,
    }


def criterion_audit_is_complete(criterion: str, review: Any) -> bool:
    """Return whether a normalized review contains its required private audit."""
    review = _as_dict(review)
    audit = _as_dict(review.get("_internal_audit"))
    required_keys = set(CRITERION_AUDIT_PLAYBOOKS[criterion]["schema"])
    return required_keys.issubset(audit)


def build_criterion_review_prompt(
    criterion: str,
    shared_context: str,
    criterion_plan: dict,
    *,
    correction_guidance: str = "",
    prior_review: dict | None = None,
) -> str:
    """Build the active coach prompt, including its private structured audit."""
    definition = CRITERION_DEFINITIONS[criterion]
    playbook = CRITERION_AUDIT_PLAYBOOKS[criterion]
    correction_block = ""
    if correction_guidance:
        correction_block = f"""
QUALITY-CONTROL CORRECTION REQUIRED:
{correction_guidance}

PRIOR CRITERION OUTPUT:
{json.dumps(prior_review or {}, indent=2, default=str)}

Correct only the identified problems while preserving grounded valid findings.
"""
    return f"""
You are the {READINESS_LABELS[criterion]} Scholarship Coach: an experienced
scholarship reviewer speaking directly and constructively to the student. You
are one combined role, not a separate specialist and reviewer simulation.
Complete the work in this exact order:

1. PRIVATE CRITERION AUDIT:
   - First complete the entire criterion-specific evidence inventory below.
   - This audit contains concise, checkable findings, not hidden reasoning or a
     transcript of your thought process. Use empty lists or "none" when there is
     no grounded finding; never omit a required key.
   - Use the audit to compare the submission against the Manager's tailored
     rubric and decide which strength and gap matter most.
   - Never refer to this audit or your process in the student-facing fields.

   AUDIT METHOD:
   {playbook['instructions']}

   REQUIRED AUDIT SHAPE:
   {json.dumps(playbook['schema'], indent=2)}
   Replace the descriptions in this shape with actual grounded findings. Do not
   echo the example descriptions as if they were findings.

2. ESSAY COACH FEEDBACK:
   - Start with grounded_praise. Select the strongest relevant positive finding
     from the audit and give sincere, empathetic, confidence-building praise
     tied to a specific real detail, passage, or genuine foundation in the
     draft. Be restrained: never use generic or over-the-top enthusiasm.
   - Then identify exactly one main_gap: the most consequential audited gap for
     this criterion. Weave the exact draft passage, location, tight paraphrase,
     or clearly described omission into the explanation, and explain why it
     matters from a scholarship reviewer's perspective.
   - Do not create a separate evidence list or reviewer-reaction section.
   Reviewer question: {definition['reviewer_lens']}
3. RUBRIC SCORE: only after the audit and feedback, assign a 0-100 score using
   the Manager's tailored rubric. The criterion weight must not change the raw
   score, and the score must be traceable to the audit.
4. PRIORITY ACTION: give exactly one specific action that directly fixes the one
   main gap selected from the audit. Identify the exact revision location and
   the concrete change. Make it as specific as the essay, profile, prompt, and
   scholarship information allow. When a needed detail is absent, ask for the
   type of true detail the student should add; never invent the detail.

CRITERION FOCUS:
{definition['focus']}

MANAGER'S LOCKED CRITERION PLAN:
{json.dumps(criterion_plan, indent=2)}

SHARED SUBMISSION CONTEXT:
{shared_context}
{_grounding_rules()}
{correction_block}

Return ONLY valid JSON. Include every key in the criterion's required audit
shape, then the student-facing package:
{{
  "audit": {json.dumps(playbook['schema'], indent=2)},
  "score": 0,
  "coach_feedback": {{
    "grounded_praise": "specific, restrained, empathetic praise with draft evidence woven in",
    "main_gap": "one criterion-specific gap with its exact evidence or omission woven in"
  }},
  "priority_action": {{
    "title": "short action-oriented title",
    "location": "paragraph, sentence, transition, passage, or clearly described omission",
    "how_to_fix": "one precise change grounded across the draft, profile, prompt, and scholarship",
    "why_this_fixes_the_gap": "explicit connection to the single main gap",
    "evidence_safety": "real-detail constraint when relevant",
    "impact": "High|Medium|Low",
    "estimated_effort": "Quick|Moderate|Deep"
  }}
}}
"""


def run_criterion_review_agent(
    criterion: str,
    shared_context: str,
    criterion_plan: dict,
    *,
    correction_guidance: str = "",
    prior_review: dict | None = None,
) -> dict:
    prompt = build_criterion_review_prompt(
        criterion,
        shared_context,
        criterion_plan,
        correction_guidance=correction_guidance,
        prior_review=prior_review,
    )
    raw = safe_json_parse(llm.generate(prompt))
    return normalize_criterion_review(criterion, raw, criterion_plan)


def run_criterion_qa(shared_context: str, manager_plan: dict, reviews: dict) -> dict:
    prompt = f"""
You are the QA Critic for a scholarship essay review. Audit the six criterion
packages; do not rescore the essay and do not create new feedback.

SUBMISSION CONTEXT:
{shared_context}

LOCKED MANAGER PLAN:
{json.dumps(manager_plan, indent=2, default=str)}

CRITERION PACKAGES:
{json.dumps(reviews, indent=2, default=str)}
{_grounding_rules()}

For every criterion check this chain:
submitted evidence -> complete private criterion audit -> grounded praise plus
one main gap -> score -> priority action.
Confirm that every required audit field is present and contains concise,
checkable findings grounded in the submitted materials. Confirm that the audit
actually applies the criterion's full playbook rather than jumping directly to
the visible feedback. Confirm that the praise selects the strongest relevant
positive finding and the main gap selects the single most consequential issue
under the tailored rubric. Confirm that all visible conclusions are traceable
to that audit.
Confirm that the praise is specific, evidence-grounded, empathetic, restrained,
and not overenthusiastic. Confirm that there is exactly one criterion-specific
main gap, with its draft evidence, location, or omission woven into the feedback
from the scholarship reviewer's perspective. Confirm the score matches the
tailored rubric and is independent of the weight. Confirm the action is one
precise, executable revision that directly fixes that same gap, uses the essay,
profile, prompt, and scholarship context where relevant, and invents nothing.
Also confirm all six criteria are present and distinct.

Return ONLY valid JSON:
{{
  "approved": true,
  "failed_criteria": [],
  "issues": [],
  "correction_guidance": {{"criterion_key": "specific correction required"}},
  "confidence": 0
}}
"""
    result = _as_dict(safe_json_parse(llm.generate(prompt)))
    result["failed_criteria"] = [
        key for key in _as_text_list(result.get("failed_criteria")) if key in READINESS_DIMENSIONS
    ]
    result["issues"] = _as_text_list(result.get("issues"))
    result["correction_guidance"] = _as_dict(result.get("correction_guidance"))
    result["approved"] = bool(result.get("approved")) and not result["failed_criteria"]
    return result


def run_action_guardrail(shared_context: str, reviews: dict) -> dict:
    action_packages = {
        key: {
            "criterion_audit": _as_dict(review).get("_internal_audit", {}),
            "coach_feedback": _as_dict(review).get("coach_feedback", {}),
            "priority_action": _as_dict(review).get("priority_action", {}),
        }
        for key, review in reviews.items()
        if key in READINESS_DIMENSIONS
    }
    prompt = f"""
You are the Guardrail Critic for scholarship essay revision advice. Audit each
criterion's one priority action. Do not score the essay and do not rewrite it.

SUBMISSION CONTEXT:
{shared_context}

COACH GAPS AND PRIORITY ACTIONS:
{json.dumps(action_packages, indent=2, default=str)}
{_grounding_rules()}

Reject an action if it invents or assumes facts, encourages exaggeration,
replaces the student's voice, supplies missing personal reflection, is too vague
to execute, fails to directly address its criterion's single main gap, or cannot
be traced to the criterion audit and submission context.

Return ONLY valid JSON:
{{
  "approved": true,
  "unsafe_criteria": [],
  "issues": [],
  "correction_guidance": {{"criterion_key": "specific safe correction required"}}
}}
"""
    result = _as_dict(safe_json_parse(llm.generate(prompt)))
    result["unsafe_criteria"] = [
        key for key in _as_text_list(result.get("unsafe_criteria")) if key in READINESS_DIMENSIONS
    ]
    result["issues"] = _as_text_list(result.get("issues"))
    result["correction_guidance"] = _as_dict(result.get("correction_guidance"))
    result["approved"] = bool(result.get("approved")) and not result["unsafe_criteria"]
    return result


def audit_failed_criteria(qa: dict, guardrail: dict) -> list[str]:
    failed = set(_as_text_list(_as_dict(qa).get("failed_criteria")))
    failed.update(_as_text_list(_as_dict(guardrail).get("unsafe_criteria")))
    return [key for key in READINESS_DIMENSIONS if key in failed]


def correction_guidance_for(criterion: str, qa: dict, guardrail: dict) -> str:
    notes = []
    for audit in (qa, guardrail):
        guidance = _as_dict(_as_dict(audit).get("correction_guidance"))
        if _as_text(guidance.get(criterion)):
            notes.append(_as_text(guidance[criterion]))
    return " ".join(notes)


def weighted_overall_score(reviews: dict) -> int | None:
    """Calculate the sole overall score; never ask an LLM to estimate it."""
    if any(not _as_dict(reviews.get(key)).get("available") for key in READINESS_DIMENSIONS):
        return None
    total = sum(
        int(_as_dict(reviews[key]).get("score", 0))
        * int(_as_dict(reviews[key]).get("weight", 0))
        for key in READINESS_DIMENSIONS
    )
    return round(total / 100)
