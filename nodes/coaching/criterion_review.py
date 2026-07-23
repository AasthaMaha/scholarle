"""Schema-v5 fixed-rubric essay evaluation and revision planning."""

from __future__ import annotations

import json
import math
from typing import Any

from pydantic import BaseModel, Field

from llm.client import llm
from nodes.coaching.readiness import READINESS_DIMENSIONS
from rubrics.essay_rubric_v1 import (
    ESSAY_RUBRIC,
    LEVEL_RANGES,
    RUBRIC_VERSION,
    calculate_criterion_score,
    normalize_answer_value,
    rubric_question,
    score_to_level,
)
from rubrics.manager_weight_policy_v1 import (
    BASE_WEIGHTS,
    WEIGHT_POLICY_VERSION,
    build_manager_plan,
)
from templates.essay_evaluation import (
    build_manager_extraction_prompt,
    build_profile_blind_scoring_prompt,
    build_revision_planner_prompt,
)
from utils.parsing import safe_json_parse


EVALUATOR_VERSION = "criterion-evaluator-v5.2-stable"
REVISION_PLANNER_VERSION = "revision-planner-v1.1-structured"

CRITERION_AUDIT_PLAYBOOKS = {
    criterion: {
        "instructions": config["reviewer_lens"],
        "schema": {
            question["id"]: {
                "question": question["question"],
                "weight": question["weight"],
            }
            for question in config["questions"]
        },
    }
    for criterion, config in ESSAY_RUBRIC.items()
}

CRITERION_DEFINITIONS = {
    criterion: {
        "focus": config["description"],
        "reviewer_lens": config["reviewer_lens"],
    }
    for criterion, config in ESSAY_RUBRIC.items()
}

DEFAULT_WEIGHTS = BASE_WEIGHTS

ROOT_CAUSE_TAGS = {
    "missing_prompt_requirement",
    "weak_scholarship_connection",
    "unsupported_claim",
    "missing_specific_example",
    "unclear_student_action",
    "missing_result",
    "missing_impact",
    "shallow_reflection",
    "missing_personal_change",
    "weak_future_connection",
    "generic_voice",
    "performative_language",
    "unclear_sentence",
    "vague_takeaway",
    "repetition",
    "weak_transition",
    "illogical_order",
    "timeline_confusion",
    "wordiness",
}


class CriterionEvidenceOutput(BaseModel):
    paragraph_id: str = ""
    quote: str = ""


class CriterionAnswerOutput(BaseModel):
    question_id: str
    value: float
    evidence: list[CriterionEvidenceOutput] = Field(default_factory=list)
    explanation: str


class CriterionCoachFeedbackOutput(BaseModel):
    grounded_praise: str
    main_gap: str


class CriterionGapOutput(BaseModel):
    statement: str
    root_cause_tag: str
    severity: str
    evidence: list[CriterionEvidenceOutput] = Field(default_factory=list)


class CriterionActionOutput(BaseModel):
    action_type: str
    location: str
    instruction: str
    completion_condition: str
    estimated_effort: str


class CriterionReviewOutput(BaseModel):
    criterion: str
    answers: list[CriterionAnswerOutput]
    coach_feedback: CriterionCoachFeedbackOutput
    criterion_specific_gap: CriterionGapOutput
    candidate_actions: list[CriterionActionOutput]


class RevisionProfileOpportunityOutput(BaseModel):
    used: bool = False
    fact: str = ""
    included_in_score: bool = False


class RevisionPriorityOutput(BaseModel):
    title: str
    action: str
    location: str
    completion_condition: str
    primary_criterion: str
    also_improves: list[str] = Field(default_factory=list)
    source_gap_criteria: list[str] = Field(default_factory=list)
    impact: str
    estimated_effort: str
    evidence_safety: str = ""
    profile_opportunity: RevisionProfileOpportunityOutput = Field(
        default_factory=RevisionProfileOpportunityOutput
    )


class RevisionPlanOutput(BaseModel):
    priorities: list[RevisionPriorityOutput] = Field(default_factory=list)


class AuditCorrectionGuidanceOutput(BaseModel):
    criterion: str
    guidance: str


class QualityAuditOutput(BaseModel):
    scoring_approved: bool
    failed_criteria: list[str] = Field(default_factory=list)
    planner_approved: bool
    planner_failed: bool = False
    issues: list[str] = Field(default_factory=list)
    correction_guidance: list[AuditCorrectionGuidanceOutput] = Field(
        default_factory=list
    )
    planner_correction_guidance: str = ""


class GuardrailAuditOutput(BaseModel):
    approved: bool
    unsafe_criteria: list[str] = Field(default_factory=list)
    planner_failed: bool = False
    issues: list[str] = Field(default_factory=list)
    correction_guidance: list[AuditCorrectionGuidanceOutput] = Field(
        default_factory=list
    )
    planner_correction_guidance: str = ""


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _as_text(value: Any) -> str:
    return str(value or "").strip()


def _as_text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_as_text(item) for item in value if _as_text(item)]
    text = _as_text(value)
    return [text] if text else []


def _evidence_list(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    output = []
    for item in value[:3]:
        item = _as_dict(item)
        quote = _as_text(item.get("quote"))
        paragraph_id = _as_text(item.get("paragraph_id"))
        if quote or paragraph_id:
            output.append({"paragraph_id": paragraph_id, "quote": quote})
    return output


def _correction_guidance_map(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        return {
            key: _as_text(guidance)
            for key, guidance in value.items()
            if key in READINESS_DIMENSIONS and _as_text(guidance)
        }
    output: dict[str, str] = {}
    for item in value or []:
        item = _as_dict(item)
        criterion = _as_text(item.get("criterion"))
        guidance = _as_text(item.get("guidance"))
        if criterion in READINESS_DIMENSIONS and guidance:
            output[criterion] = guidance
    return output


def _structured_response(prompt: str, schema: type[BaseModel]) -> dict:
    """Invoke a deterministic structured-output model and return a plain dict."""
    structured_model = llm._get_client(temperature=0.0).with_structured_output(schema)
    response = structured_model.invoke(prompt)
    raw = (
        response.model_dump()
        if hasattr(response, "model_dump")
        else response.dict()
        if hasattr(response, "dict")
        else _as_dict(response)
    )
    if raw:
        return raw
    return safe_json_parse(
        response.content if hasattr(response, "content") else str(response)
    )


def _manager_rubric_summary() -> dict[str, Any]:
    return {
        criterion: {
            "label": config["label"],
            "description": config["description"],
            "questions": [
                {
                    "id": question["id"],
                    "question": question["question"],
                    "manager_may_mark_not_applicable": question[
                        "manager_may_mark_not_applicable"
                    ],
                }
                for question in config["questions"]
            ],
        }
        for criterion, config in ESSAY_RUBRIC.items()
    }


def normalize_manager_plan(raw: Any, source_text: str = "") -> dict:
    raw_dict = _as_dict(raw)
    if raw_dict.get("rubric_version") == RUBRIC_VERSION and raw_dict.get("criteria"):
        if not source_text:
            return raw_dict
        extraction = {
            "manager_summary": raw_dict.get("manager_summary"),
            "signals": raw_dict.get("source_signals") or [],
            "published_weights": raw_dict.get("published_weights") or [],
            "not_applicable_questions": [
                {
                    "criterion": criterion,
                    "question_id": question.get("id"),
                    **_as_dict(question.get("not_applicable")),
                }
                for criterion, plan in _as_dict(raw_dict.get("criteria")).items()
                for question in _as_dict(plan).get("questions") or []
                if _as_dict(question).get("applicable") is False
            ],
        }
        rebuilt = build_manager_plan(extraction, source_text)
        rebuilt["context_hash"] = _as_text(raw_dict.get("context_hash"))
        return rebuilt
    return build_manager_plan(raw_dict, source_text)


def run_manager_agent(manager_context: str) -> dict:
    raw = safe_json_parse(
        llm.generate(
            build_manager_extraction_prompt(
                manager_context=manager_context,
                rubric_summary=_manager_rubric_summary(),
            )
        )
    )
    return normalize_manager_plan(raw, manager_context)


def _applicability_for_plan(criterion_plan: dict) -> dict[str, bool]:
    return {
        _as_text(_as_dict(question).get("id")): bool(
            _as_dict(question).get("applicable", True)
        )
        for question in criterion_plan.get("questions") or []
        if _as_text(_as_dict(question).get("id"))
    }


def _applicable_questions(criterion: str, criterion_plan: dict) -> list[dict[str, Any]]:
    planned = {
        _as_text(_as_dict(question).get("id")): _as_dict(question)
        for question in criterion_plan.get("questions") or []
    }
    return [
        {
            **question,
            "normalized_weight": planned.get(question["id"], {}).get(
                "normalized_weight"
            ),
        }
        for question in ESSAY_RUBRIC[criterion]["questions"]
        if planned.get(question["id"], {}).get("applicable", True)
    ]


def build_criterion_review_prompt(
    criterion: str,
    criterion_context: str,
    criterion_plan: dict,
    *,
    correction_guidance: str = "",
    prior_review: dict | None = None,
) -> str:
    config = ESSAY_RUBRIC[criterion]
    return build_profile_blind_scoring_prompt(
        criterion=criterion,
        label=config["label"],
        reviewer_lens=config["reviewer_lens"],
        criterion_context=criterion_context,
        questions=_applicable_questions(criterion, criterion_plan),
        correction_guidance=correction_guidance,
        prior_review=prior_review,
    )


def normalize_criterion_review(
    criterion: str,
    raw: Any,
    criterion_plan: dict,
) -> dict:
    raw = _as_dict(raw)
    expected_questions = _applicable_questions(criterion, criterion_plan)
    expected_ids = {question["id"] for question in expected_questions}
    answers: list[dict[str, Any]] = []
    seen = set()
    for item in raw.get("answers") or []:
        item = _as_dict(item)
        question_id = _as_text(item.get("question_id"))
        value = normalize_answer_value(item.get("value"))
        if question_id not in expected_ids or question_id in seen or value is None:
            continue
        seen.add(question_id)
        question = rubric_question(criterion, question_id) or {}
        answers.append(
            {
                "question_id": question_id,
                "question": question.get("question", ""),
                "value": value,
                "answer_label": (
                    "Not demonstrated"
                    if value == 0
                    else "Partly demonstrated"
                    if value == 0.5
                    else "Clearly demonstrated"
                ),
                "evidence": _evidence_list(item.get("evidence")),
                "explanation": _as_text(item.get("explanation")),
            }
        )

    score_result = calculate_criterion_score(
        criterion,
        answers,
        _applicability_for_plan(criterion_plan),
    )
    feedback = _as_dict(raw.get("coach_feedback"))
    gap = _as_dict(raw.get("criterion_specific_gap"))
    root_cause = _as_text(gap.get("root_cause_tag"))
    if root_cause not in ROOT_CAUSE_TAGS:
        root_cause = "vague_takeaway"
    severity = _as_text(gap.get("severity")).lower()
    if severity not in {"high", "medium", "low"}:
        severity = "medium"

    candidate_actions = []
    for action in (raw.get("candidate_actions") or [])[:2]:
        action = _as_dict(action)
        instruction = _as_text(action.get("instruction"))
        if not instruction:
            continue
        effort = _as_text(action.get("estimated_effort")).title()
        if effort not in {"Quick", "Moderate", "Deep"}:
            effort = "Moderate"
        candidate_actions.append(
            {
                "action_type": _as_text(action.get("action_type")),
                "location": _as_text(action.get("location")),
                "instruction": instruction,
                "completion_condition": _as_text(action.get("completion_condition")),
                "estimated_effort": effort,
            }
        )

    return {
        "criterion": criterion,
        "label": ESSAY_RUBRIC[criterion]["label"],
        "short_label": ESSAY_RUBRIC[criterion]["short_label"],
        "weight": int(criterion_plan.get("weight", BASE_WEIGHTS[criterion])),
        "raw_score": score_result["raw_score"],
        "score": score_result["score"],
        "level": score_result["level"],
        "applied_safeguards": score_result["applied_safeguards"],
        "answers": answers,
        "missing_question_ids": score_result["missing_question_ids"],
        "normalized_question_weights": score_result["normalized_question_weights"],
        "coach_feedback": {
            "grounded_praise": _as_text(feedback.get("grounded_praise")),
            "main_gap": _as_text(feedback.get("main_gap")),
        },
        "criterion_specific_gap": {
            "statement": _as_text(gap.get("statement"))
            or _as_text(feedback.get("main_gap")),
            "root_cause_tag": root_cause,
            "severity": severity,
            "evidence": _evidence_list(gap.get("evidence")),
        },
        "candidate_actions": candidate_actions,
        "related_priority_ids": [],
        "rubric": {
            "version": RUBRIC_VERSION,
            "description": ESSAY_RUBRIC[criterion]["description"],
            "levels": [
                {"label": label, "minimum": lower, "maximum": upper}
                for label, lower, upper in LEVEL_RANGES
            ],
            "questions": criterion_plan.get("questions") or [],
        },
        "available": bool(score_result["available"]),
    }


def criterion_audit_is_complete(criterion: str, review: Any) -> bool:
    review = _as_dict(review)
    if not review.get("available"):
        return False
    expected = {
        question_id
        for question_id, applicable in _applicability_for_plan(
            {"questions": _as_dict(review.get("rubric")).get("questions") or []}
        ).items()
        if applicable
    }
    if not expected:
        expected = {question["id"] for question in ESSAY_RUBRIC[criterion]["questions"]}
    actual = {
        _as_text(_as_dict(answer).get("question_id"))
        for answer in review.get("answers") or []
    }
    return actual == expected and not review.get("missing_question_ids")


def _merge_repair_with_prior(raw: Any, prior_review: dict | None) -> dict:
    """Overlay a targeted repair on the prior complete structured package."""
    raw = dict(_as_dict(raw))
    prior = _as_dict(prior_review)
    if not prior:
        return raw
    prior_answers = {
        _as_text(_as_dict(answer).get("question_id")): _as_dict(answer)
        for answer in prior.get("answers") or []
        if _as_text(_as_dict(answer).get("question_id"))
    }
    repaired_answers = {
        _as_text(_as_dict(answer).get("question_id")): _as_dict(answer)
        for answer in raw.get("answers") or []
        if _as_text(_as_dict(answer).get("question_id"))
    }
    raw["answers"] = [
        repaired_answers.get(question_id, answer)
        for question_id, answer in prior_answers.items()
    ] + [
        answer
        for question_id, answer in repaired_answers.items()
        if question_id not in prior_answers
    ]
    for field in (
        "coach_feedback",
        "criterion_specific_gap",
        "candidate_actions",
    ):
        if not raw.get(field) and prior.get(field):
            raw[field] = prior[field]
    return raw


def run_criterion_review_agent(
    criterion: str,
    criterion_context: str,
    criterion_plan: dict,
    *,
    correction_guidance: str = "",
    prior_review: dict | None = None,
) -> dict:
    prompt = build_criterion_review_prompt(
        criterion,
        criterion_context,
        criterion_plan,
        correction_guidance=correction_guidance,
        prior_review=prior_review,
    )
    # Scoring is classification, not creative writing. A dedicated zero-
    # temperature structured-output client reduces run-to-run drift and prevents
    # malformed free-form JSON from silently dropping rubric questions.
    raw = _structured_response(prompt, CriterionReviewOutput)
    if prior_review:
        raw = _merge_repair_with_prior(raw, prior_review)
    return normalize_criterion_review(criterion, raw, criterion_plan)


def _public_review_for_planner(review: dict) -> dict:
    return {
        "criterion": review.get("criterion"),
        "label": review.get("label"),
        "score": review.get("score"),
        "level": review.get("level"),
        "weight": review.get("weight"),
        "coach_feedback": review.get("coach_feedback"),
        "criterion_specific_gap": review.get("criterion_specific_gap"),
        "candidate_actions": review.get("candidate_actions"),
    }


def normalize_revision_plan(raw: Any, reviews: dict) -> dict:
    raw = _as_dict(raw)
    for review in reviews.values():
        if isinstance(review, dict):
            review["related_priority_ids"] = []

    priorities: list[dict[str, Any]] = []
    for index, item in enumerate((raw.get("priorities") or [])[:3], start=1):
        item = _as_dict(item)
        primary = _as_text(item.get("primary_criterion"))
        action = _as_text(item.get("action"))
        if primary not in READINESS_DIMENSIONS or not action:
            continue
        also_improves = [
            key
            for key in _as_text_list(item.get("also_improves"))
            if key in READINESS_DIMENSIONS and key != primary
        ]
        source_gaps = [
            key
            for key in _as_text_list(item.get("source_gap_criteria"))
            if key in READINESS_DIMENSIONS
        ]
        impact = _as_text(item.get("impact")).title()
        if impact not in {"High", "Medium", "Low"}:
            impact = "High"
        effort = _as_text(item.get("estimated_effort")).title()
        if effort not in {"Quick", "Moderate", "Deep"}:
            effort = "Moderate"
        profile_opportunity = _as_dict(item.get("profile_opportunity"))
        priorities.append(
            {
                "id": f"priority_{index}",
                "title": _as_text(item.get("title"))
                or f"Strengthen {ESSAY_RUBRIC[primary]['short_label']}",
                "action": action,
                "location": _as_text(item.get("location")),
                "completion_condition": _as_text(item.get("completion_condition")),
                "primary_criterion": primary,
                "also_improves": list(dict.fromkeys(also_improves)),
                "source_gap_criteria": list(dict.fromkeys(source_gaps or [primary])),
                "impact": impact,
                "estimated_effort": effort,
                "evidence_safety": _as_text(item.get("evidence_safety")),
                "profile_opportunity": {
                    "used": bool(profile_opportunity.get("used")),
                    "fact": _as_text(profile_opportunity.get("fact")),
                    "included_in_score": False,
                },
            }
        )

    for priority in priorities:
        for key in {priority["primary_criterion"], *priority["also_improves"]}:
            if key in reviews:
                related = reviews[key].setdefault("related_priority_ids", [])
                if priority["id"] not in related:
                    related.append(priority["id"])
    return {
        "version": REVISION_PLANNER_VERSION,
        "priorities": priorities,
        "available": bool(priorities),
    }


def run_revision_planner(
    coaching_context: str,
    reviews: dict,
    *,
    correction_guidance: str = "",
    prior_plan: dict | None = None,
) -> dict:
    prompt = build_revision_planner_prompt(
        coaching_context=coaching_context,
        verified_reviews={
            key: _public_review_for_planner(review)
            for key, review in reviews.items()
            if key in READINESS_DIMENSIONS
        },
        correction_guidance=correction_guidance,
        prior_plan=prior_plan,
    )
    raw = _structured_response(prompt, RevisionPlanOutput)
    return normalize_revision_plan(raw, reviews)


def run_criterion_qa(
    scoring_contexts: dict[str, str],
    manager_plan: dict,
    reviews: dict,
    revision_plan: dict,
) -> dict:
    compact_reviews = {
        key: {
            "answers": review.get("answers"),
            "score": review.get("score"),
            "level": review.get("level"),
            "coach_feedback": review.get("coach_feedback"),
            "criterion_specific_gap": review.get("criterion_specific_gap"),
        }
        for key, review in reviews.items()
    }
    prompt = f"""
You are the semantic QA Critic for Scholar-E Essay Review. Do not rescore the
essay, change weights, create feedback, or alter the revision plan.

PROFILE-BLIND SCORING CONTEXTS:
{json.dumps(scoring_contexts, indent=2, default=str)}

LOCKED MANAGER PLAN:
{json.dumps(manager_plan, indent=2, default=str)}

CALCULATED CRITERION PACKAGES:
{json.dumps(compact_reviews, indent=2, default=str)}

CONSOLIDATED REVISION PLAN:
{json.dumps(revision_plan, indent=2, default=str)}

Make two independent decisions. A revision-plan problem must never make an
otherwise valid scoring decision fail.

SCORING QA checks only:
- cited evidence supports each 0/0.5/1 answer;
- praise and the gap follow from the answers;
- each gap belongs to its assigned criterion;
- the six diagnoses remain construct-specific.

PLANNER QA checks only:
- final priorities are distinct, grounded, atomic, and correctly consolidate overlap;
- primary and secondary ownership is plausible.

Return ONLY valid JSON:
{{
  "scoring_approved": true,
  "failed_criteria": [],
  "planner_approved": true,
  "planner_failed": false,
  "issues": [],
  "correction_guidance": [
    {{"criterion": "criterion_key", "guidance": "specific correction"}}
  ],
  "planner_correction_guidance": ""
}}
"""
    raw = _structured_response(prompt, QualityAuditOutput)
    result = _as_dict(raw)
    result["failed_criteria"] = [
        key
        for key in _as_text_list(result.get("failed_criteria"))
        if key in READINESS_DIMENSIONS
    ]
    result["issues"] = _as_text_list(result.get("issues"))
    result["correction_guidance"] = _correction_guidance_map(
        result.get("correction_guidance")
    )
    result["planner_failed"] = bool(result.get("planner_failed"))
    result["planner_correction_guidance"] = _as_text(
        result.get("planner_correction_guidance")
    )
    result["scoring_approved"] = (
        bool(result.get("scoring_approved", result.get("approved")))
        and not result["failed_criteria"]
    )
    result["planner_approved"] = (
        bool(result.get("planner_approved", result.get("approved")))
        and not result["planner_failed"]
    )
    result["approved"] = bool(
        result["scoring_approved"] and result["planner_approved"]
    )
    return result


def run_action_guardrail(
    coaching_context: str,
    reviews: dict,
    revision_plan: dict,
) -> dict:
    prompt = f"""
You are the Guardrail Critic for Scholar-E revision coaching. Do not score,
rescore, or rewrite the essay.

PROFILE-AWARE COACHING CONTEXT:
{coaching_context}

VERIFIED CRITERION GAPS:
{json.dumps({
    key: review.get("criterion_specific_gap")
    for key, review in reviews.items()
}, indent=2, default=str)}

PROPOSED CONSOLIDATED PRIORITIES:
{json.dumps(revision_plan, indent=2, default=str)}

Reject a priority if it invents or assumes facts, encourages exaggeration,
supplies missing reflection or emotions, pressures sensitive disclosure,
replaces the student's voice, ghostwrites, is too vague to execute, or cannot
be traced to a verified gap. Profile facts are coaching opportunities only and
must always state included_in_score=false.

Return ONLY valid JSON:
{{
  "approved": true,
  "unsafe_criteria": [],
  "planner_failed": false,
  "issues": [],
  "correction_guidance": [
    {{"criterion": "criterion_key", "guidance": "specific safe correction"}}
  ],
  "planner_correction_guidance": ""
}}
"""
    raw = _structured_response(prompt, GuardrailAuditOutput)
    result = _as_dict(raw)
    result["unsafe_criteria"] = [
        key
        for key in _as_text_list(result.get("unsafe_criteria"))
        if key in READINESS_DIMENSIONS
    ]
    result["issues"] = _as_text_list(result.get("issues"))
    result["correction_guidance"] = _correction_guidance_map(
        result.get("correction_guidance")
    )
    result["planner_failed"] = bool(result.get("planner_failed"))
    result["planner_correction_guidance"] = _as_text(
        result.get("planner_correction_guidance")
    )
    result["approved"] = (
        bool(result.get("approved"))
        and not result["unsafe_criteria"]
        and not result["planner_failed"]
    )
    return result


def audit_failed_criteria(qa: dict, guardrail: dict) -> list[str]:
    del guardrail  # Guardrail findings belong to coaching, never score repair.
    failed = set(_as_text_list(_as_dict(qa).get("failed_criteria")))
    return [key for key in READINESS_DIMENSIONS if key in failed]


def correction_guidance_for(criterion: str, qa: dict, guardrail: dict) -> str:
    del guardrail  # Safety guidance is applied by the Revision Planner.
    notes = []
    guidance = _as_dict(_as_dict(qa).get("correction_guidance"))
    if _as_text(guidance.get(criterion)):
        notes.append(_as_text(guidance[criterion]))
    return " ".join(notes)


def planner_correction_guidance(qa: dict, guardrail: dict) -> str:
    return " ".join(
        note
        for note in (
            _as_text(_as_dict(qa).get("planner_correction_guidance")),
            _as_text(_as_dict(guardrail).get("planner_correction_guidance")),
        )
        if note
    )


def calculate_overall_result(reviews: dict) -> dict[str, Any]:
    if any(
        not _as_dict(reviews.get(key)).get("available")
        for key in READINESS_DIMENSIONS
    ):
        return {
            "available": False,
            "raw_score": None,
            "score": None,
            "level": "Unavailable",
            "applied_safeguards": [],
        }
    total = sum(
        int(_as_dict(reviews[key]).get("score", 0))
        * int(_as_dict(reviews[key]).get("weight", 0))
        for key in READINESS_DIMENSIONS
    )
    raw_score = math.floor(total / 100 + 0.5)
    final_score = raw_score
    safeguards = []
    if _as_text(reviews["alignment"].get("level")) in {"Minimal", "Limited"}:
        if final_score > 59:
            final_score = 59
            safeguards.append("alignment_below_required_minimum")
    if _as_text(reviews["evidence_strength"].get("level")) == "Minimal":
        if final_score > 59:
            final_score = 59
            safeguards.append("evidence_below_required_minimum")

    exceptional_prerequisites = (
        all(
            _as_text(reviews[key].get("level")) in {"Strong", "Exceptional"}
            for key in ("alignment", "evidence_strength", "insight")
        )
        and all(
            _as_text(reviews[key].get("level"))
            in {"Effective", "Strong", "Exceptional"}
            for key in READINESS_DIMENSIONS
        )
    )
    if final_score >= 90 and not exceptional_prerequisites:
        final_score = 89
        safeguards.append("exceptional_prerequisites_not_met")
    return {
        "available": True,
        "raw_score": raw_score,
        "score": final_score,
        "level": score_to_level(final_score),
        "applied_safeguards": safeguards,
    }


def weighted_overall_score(reviews: dict) -> int | None:
    return calculate_overall_result(reviews)["score"]
