"""Manager-first, criterion-owned essay review for the Essay Workspace.

The Manager owns only the scholarship-specific rubric and weights. Seven
criterion agents then independently act as scholarship coaches: each gives
grounded reviewer-perspective feedback, scores the criterion, and recommends
one aligned revision action. QA and Guardrail critics audit the resulting
criterion packages; Python owns normalization and the weighted overall score.
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
    "grammar": {
        "focus": (
            "Uses correct spelling, punctuation, capitalization, verb tense, agreement, grammar, and "
            "sentence-level mechanics."
        ),
        "reviewer_lens": "Do mechanical errors distract me or reduce confidence in the submission?",
    },
}


DEFAULT_WEIGHTS = {
    "alignment": 20,
    "evidence_strength": 20,
    "insight": 15,
    "narrative_structure_flow_coherence": 15,
    "tone_authenticity": 10,
    "clarity_concision": 10,
    "grammar": 10,
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
    """Normalize Manager weights to seven bounded integers totaling 100."""
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

Using ONLY the scholarship information and essay prompt below, tailor all seven
required criteria and assign their importance weights. You must not evaluate a
student essay. Weight means importance to this opportunity, not scoring leniency.

MANAGER CONTEXT (contains no student essay):
{manager_context}

REQUIRED CRITERIA:
{json.dumps(CRITERION_DEFINITIONS, indent=2)}

RULES:
- Include exactly the seven required criterion keys.
- Give every criterion an integer weight from 5 through 30.
- All seven weights must total exactly 100.
- Tailor each rubric to the scholarship's stated priorities and every prompt part.
- Keep Grammar as essay correctness; do not turn it into a content criterion.
- Do not add eligibility as an essay-quality criterion.

Return ONLY valid JSON:
{{
  "manager_summary": "brief explanation of the opportunity's scoring emphasis",
  "criteria": {{
    "alignment": {{
      "weight": 20,
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
    "clarity_concision": {{}},
    "grammar": {{}}
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


def run_criterion_review_agent(
    criterion: str,
    shared_context: str,
    criterion_plan: dict,
    *,
    correction_guidance: str = "",
    prior_review: dict | None = None,
) -> dict:
    definition = CRITERION_DEFINITIONS[criterion]
    correction_block = ""
    if correction_guidance:
        correction_block = f"""
QUALITY-CONTROL CORRECTION REQUIRED:
{correction_guidance}

PRIOR CRITERION OUTPUT:
{json.dumps(prior_review or {}, indent=2, default=str)}

Correct only the identified problems while preserving grounded valid findings.
"""
    prompt = f"""
You are the {READINESS_LABELS[criterion]} Scholarship Coach: an experienced
scholarship reviewer speaking directly and constructively to the student. You
are one combined role, not a separate specialist and reviewer simulation.
Complete the work in this exact order:

1. SCHOLARSHIP COACH FEEDBACK:
   - Start with grounded_praise. Give sincere, empathetic, confidence-building
     praise tied to a specific real detail, passage, or genuine foundation in
     the draft. Be restrained: never use generic or over-the-top enthusiasm.
   - Then identify exactly one main_gap: the most consequential gap for this
     criterion. Weave the exact draft passage, location, tight paraphrase, or
     clearly described omission into the explanation, and explain why it matters
     from a scholarship reviewer's perspective.
   - Do not create a separate evidence list or reviewer-reaction section.
   Reviewer question: {definition['reviewer_lens']}
2. RUBRIC SCORE: only after the feedback, assign a 0-100 score using the
   Manager's tailored rubric. The criterion weight must not change the raw score.
3. PRIORITY ACTION: give exactly one specific action that directly fixes the one
   main gap. Identify the exact revision location and the concrete change. Make
   it as specific as the essay, profile, prompt, and scholarship information
   allow. When a needed detail is absent, ask for the type of true detail the
   student should add; never invent the detail.

CRITERION FOCUS:
{definition['focus']}

MANAGER'S LOCKED CRITERION PLAN:
{json.dumps(criterion_plan, indent=2)}

SHARED SUBMISSION CONTEXT:
{shared_context}
{_grounding_rules()}
{correction_block}

Return ONLY valid JSON:
{{
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
    raw = safe_json_parse(llm.generate(prompt))
    return normalize_criterion_review(criterion, raw, criterion_plan)


def run_criterion_qa(shared_context: str, manager_plan: dict, reviews: dict) -> dict:
    prompt = f"""
You are the QA Critic for a scholarship essay review. Audit the seven criterion
packages; do not rescore the essay and do not create new feedback.

SUBMISSION CONTEXT:
{shared_context}

LOCKED MANAGER PLAN:
{json.dumps(manager_plan, indent=2, default=str)}

CRITERION PACKAGES:
{json.dumps(reviews, indent=2, default=str)}
{_grounding_rules()}

For every criterion check this chain:
submitted evidence -> grounded praise plus one main gap -> score -> priority action.
Confirm that the praise is specific, evidence-grounded, empathetic, restrained,
and not overenthusiastic. Confirm that there is exactly one criterion-specific
main gap, with its draft evidence, location, or omission woven into the feedback
from the scholarship reviewer's perspective. Confirm the score matches the
tailored rubric and is independent of the weight. Confirm the action is one
precise, executable revision that directly fixes that same gap, uses the essay,
profile, prompt, and scholarship context where relevant, and invents nothing.
Also confirm all seven criteria are present and distinct.

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
to execute, or fails to directly address its criterion's single main gap.

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
