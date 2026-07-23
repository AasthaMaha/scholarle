"""Versioned prompts for profile-blind scoring and profile-aware coaching."""

from __future__ import annotations

import json
from typing import Any


EVALUATION_GUARDRAILS = """EVALUATION RULES:
- Evaluate only the submitted essay and the criterion-specific reviewer context.
- You do not have access to the student profile. Never infer missing profile facts.
- Do not assign a numerical score or performance level. Backend code calculates both.
- Answer every applicable fixed rubric question with exactly 0, 0.5, or 1.
- A value of 0.5 is not uncertainty: identify both partial success and its limitation.
- For every 0.5 or 1, cite a supplied backend-owned evidence ID and copy its
  passage. For 0, identify the omission or a supplied passage that fails to
  demonstrate the requirement.
- Stay inside the assigned criterion and do not rescore another construct.
- Do not determine whether AI was used. Describe only observable language features.
- Preserve student ownership. Diagnose and coach; never write replacement essay text."""


COACHING_GUARDRAILS = """COACHING RULES:
- The six criterion scores and levels are locked and cannot be changed.
- Profile facts are coaching-only. Unused profile facts cannot lower a score.
- Never invent or exaggerate an experience, role, result, number, identity detail,
  hardship, motivation, emotion, or scholarship requirement.
- Use a profile fact only when it is explicitly present and relevant.
- Ask the student for a truthful missing detail rather than supplying it.
- Consolidate overlapping interventions instead of manufacturing distinct tasks.
- Produce exactly three priorities when three grounded priorities exist; never pad
  the plan with a low-value or duplicate action.
- Coach the student to revise their own writing. Do not provide replacement paragraphs."""


def build_manager_extraction_prompt(
    *,
    manager_context: str,
    rubric_summary: dict[str, Any],
) -> str:
    return f"""
You are the source-evidence Manager for Scholar-E Essay Review.

You see the fixed rubric and official scholarship/prompt context, but never a
student essay or profile. Extract only source-grounded evaluation emphasis. Do
not assign criterion weights, question weights, scores, levels, or thresholds.

FIXED RUBRIC:
{json.dumps(rubric_summary, indent=2, default=str)}

OFFICIAL MANAGER CONTEXT:
{manager_context}

SIGNAL TYPES:
- selection_criterion: an explicit judging or selection criterion.
- prompt_ask: a material requirement in the essay prompt.
- mission_or_description: an explicit mission or description emphasis.

MAPPING RULES:
- Use only the six criterion keys in the fixed rubric.
- A scholarship title or category alone is not a weighting signal.
- Eligibility alone is not an essay-quality signal.
- Quote the exact official source text supporting every signal.
- Do not duplicate the same source statement.
- If official numerical judging weights map one-to-one to all six criteria,
  return them under published_weights; otherwise leave that list empty.
- You may mark a fixed question not applicable only when it is explicitly marked
  manager_may_mark_not_applicable and official context makes it genuinely irrelevant
  before a student draft is seen.
- Missing student evidence is never a reason to mark a question not applicable.
- Keep at least four applicable questions in every criterion.

Return ONLY valid JSON:
{{
  "manager_summary": "brief source-grounded description",
  "signals": [
    {{
      "criterion": "one fixed criterion key",
      "signal_type": "selection_criterion|prompt_ask|mission_or_description",
      "source_field": "official field or prompt location",
      "source_quote": "short exact quote",
      "construct": "short description of the emphasized construct"
    }}
  ],
  "published_weights": [
    {{
      "criterion": "one fixed criterion key",
      "percentage": 25,
      "source_field": "published rubric field",
      "source_quote": "exact quote containing the published weight"
    }}
  ],
  "not_applicable_questions": [
    {{
      "criterion": "criterion key",
      "question_id": "fixed question id",
      "reason": "why official context makes this question irrelevant",
      "reason_code": "missing_official_context|explicitly_excluded_by_prompt",
      "source_field": "official field or none",
      "source_quote": "exact quote when available"
    }}
  ]
}}
"""


def build_profile_blind_scoring_prompt(
    *,
    criterion: str,
    label: str,
    reviewer_lens: str,
    criterion_context: str,
    questions: list[dict[str, Any]],
    correction_guidance: str = "",
    prior_review: dict[str, Any] | None = None,
) -> str:
    correction = ""
    if correction_guidance:
        correction = f"""
QUALITY-CONTROL CORRECTION:
{correction_guidance}

PRIOR OUTPUT:
{json.dumps(prior_review or {}, indent=2, default=str)}

Correct only the identified problem. Do not change valid grounded answers.
"""
    return f"""
You are the {label} scoring specialist for Scholar-E.

REVIEWER QUESTION:
{reviewer_lens}

{EVALUATION_GUARDRAILS}

APPLICABLE FIXED RUBRIC QUESTIONS:
{json.dumps(questions, indent=2, default=str)}

CRITERION-SPECIFIC CONTEXT:
{criterion_context}

Complete the fixed questions first. Then derive one grounded strength, one
criterion-specific main gap, a controlled root-cause tag, and up to two candidate
revision actions. Praise and the gap must follow from the question answers.

Allowed root-cause tags:
missing_prompt_requirement, weak_scholarship_connection, unsupported_claim,
missing_specific_example, unclear_student_action, missing_result, missing_impact,
shallow_reflection, missing_personal_change, weak_future_connection, generic_voice,
performative_language, unclear_sentence, vague_takeaway, repetition,
weak_transition, illogical_order, timeline_confusion, wordiness.
{correction}

Return ONLY valid JSON:
{{
  "criterion": "{criterion}",
  "answers": [
    {{
      "question_id": "fixed id",
      "value": 0,
      "evidence": [{{"paragraph_id": "p1.s1", "quote": "passage at that exact evidence ID"}}],
      "explanation": "one checkable sentence explaining the answer"
    }}
  ],
  "coach_feedback": {{
    "grounded_praise": "specific restrained praise tied to essay evidence",
    "main_gap": "one criterion-specific gap tied to a passage or omission"
  }},
  "criterion_specific_gap": {{
    "statement": "same core gap stated for planning",
    "root_cause_tag": "one allowed tag",
    "severity": "high|medium|low",
    "evidence": [{{"paragraph_id": "p1.s1", "quote": "passage at that exact evidence ID"}}]
  }},
  "candidate_actions": [
    {{
      "action_type": "short controlled operation",
      "location": "paragraph, sentence, transition, or omission",
      "instruction": "one precise coaching action, not replacement prose",
      "completion_condition": "observable condition showing completion",
      "estimated_effort": "Quick|Moderate|Deep"
    }}
  ]
}}
"""


def build_revision_planner_prompt(
    *,
    coaching_context: str,
    verified_reviews: dict[str, Any],
    correction_guidance: str = "",
    prior_plan: dict[str, Any] | None = None,
) -> str:
    correction = ""
    if correction_guidance:
        correction = f"""
QUALITY-CONTROL CORRECTION:
{correction_guidance}

PRIOR PLAN:
{json.dumps(prior_plan or {}, indent=2, default=str)}
"""
    return f"""
You are the Revision Planner for Scholar-E.

{COACHING_GUARDRAILS}

VERIFIED, LOCKED CRITERION FINDINGS:
{json.dumps(verified_reviews, indent=2, default=str)}

PROFILE-AWARE COACHING CONTEXT:
{coaching_context}

Create the smallest high-impact portfolio of up to three distinct revisions.
Cluster findings that cite the same location, share a root cause, or can be
resolved by the same edit. Keep diagnoses distinct while unifying interventions.

Primary ownership:
- missing prompt requirement or fit -> alignment
- example, action, detail, result, or impact -> evidence_strength
- meaning, learning, change, or reflection -> insight
- ordering, transitions, pacing, or continuity -> narrative_structure_flow_coherence
- generic, performative, or inconsistent voice -> tone_authenticity
- ambiguity, repetition, wordiness, or tangled sentences -> clarity_concision
{correction}

Return ONLY valid JSON:
{{
  "priorities": [
    {{
      "title": "short action-oriented title",
      "action": "one atomic coaching action",
      "location": "specific paragraph, passage, transition, or omission",
      "completion_condition": "observable condition for completion",
      "primary_criterion": "one criterion key",
      "also_improves": ["other criterion key"],
      "source_gap_criteria": ["criterion key"],
      "impact": "High|Medium|Low",
      "estimated_effort": "Quick|Moderate|Deep",
      "evidence_safety": "truthfulness constraint when relevant",
      "profile_opportunity": {{
        "used": false,
        "fact": "exact relevant profile fact or empty",
        "included_in_score": false
      }}
    }}
  ]
}}
"""
