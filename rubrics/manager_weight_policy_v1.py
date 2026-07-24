"""Deterministic criterion weighting from Manager-extracted source evidence."""

from __future__ import annotations

import math
import re
from typing import Any

from nodes.coaching.readiness import READINESS_DIMENSIONS
from rubrics.essay_rubric_v1 import (
    ESSAY_RUBRIC,
    RUBRIC_VERSION,
    normalized_question_weights,
)


WEIGHT_POLICY_VERSION = "manager-weight-policy-v1"

BASE_WEIGHTS = {
    "alignment": 25,
    "evidence_strength": 25,
    "insight": 20,
    "narrative_structure_flow_coherence": 15,
    "tone_authenticity": 8,
    "clarity_concision": 7,
}

SOURCE_POINTS = {
    "selection_criterion": 3,
    "prompt_ask": 2,
    "mission_or_description": 1,
}

MAX_SOURCE_POINTS = 7
MAX_DELTA_FROM_BASE = 5
ABSOLUTE_MIN_WEIGHT = 5
ABSOLUTE_MAX_WEIGHT = 30

ALLOWED_NA_REASONS = {
    "missing_official_context",
    "explicitly_excluded_by_prompt",
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _canonical(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def _verified_quote(quote: str, source_text: str) -> bool:
    canonical_quote = _canonical(quote)
    return bool(canonical_quote) and canonical_quote in _canonical(source_text)


def _largest_remainder(
    targets: dict[str, float],
    lower_bounds: dict[str, int],
    upper_bounds: dict[str, int],
) -> dict[str, int]:
    weights = {
        key: max(lower_bounds[key], min(upper_bounds[key], math.floor(targets[key])))
        for key in READINESS_DIMENSIONS
    }
    while sum(weights.values()) < 100:
        eligible = [key for key in READINESS_DIMENSIONS if weights[key] < upper_bounds[key]]
        if not eligible:
            break
        selected = max(
            eligible,
            key=lambda key: (
                targets[key] - weights[key],
                -READINESS_DIMENSIONS.index(key),
            ),
        )
        weights[selected] += 1
    while sum(weights.values()) > 100:
        eligible = [key for key in READINESS_DIMENSIONS if weights[key] > lower_bounds[key]]
        if not eligible:
            break
        selected = max(
            eligible,
            key=lambda key: (
                weights[key] - targets[key],
                READINESS_DIMENSIONS.index(key),
            ),
        )
        weights[selected] -= 1
    return weights if sum(weights.values()) == 100 else dict(BASE_WEIGHTS)


def _weights_from_points(points: dict[str, int]) -> tuple[dict[str, int], dict[str, float]]:
    average = sum(points.values()) / len(READINESS_DIMENSIONS)
    lower_bounds = {
        key: max(ABSOLUTE_MIN_WEIGHT, BASE_WEIGHTS[key] - MAX_DELTA_FROM_BASE)
        for key in READINESS_DIMENSIONS
    }
    upper_bounds = {
        key: min(ABSOLUTE_MAX_WEIGHT, BASE_WEIGHTS[key] + MAX_DELTA_FROM_BASE)
        for key in READINESS_DIMENSIONS
    }
    targets = {
        key: max(
            lower_bounds[key],
            min(upper_bounds[key], BASE_WEIGHTS[key] + points[key] - average),
        )
        for key in READINESS_DIMENSIONS
    }

    for _ in range(12):
        difference = 100 - sum(targets.values())
        if abs(difference) < 1e-9:
            break
        if difference > 0:
            eligible = [key for key in READINESS_DIMENSIONS if targets[key] < upper_bounds[key]]
            room = {key: upper_bounds[key] - targets[key] for key in eligible}
        else:
            eligible = [key for key in READINESS_DIMENSIONS if targets[key] > lower_bounds[key]]
            room = {key: targets[key] - lower_bounds[key] for key in eligible}
        total_room = sum(room.values())
        if not eligible or total_room <= 0:
            break
        for key in eligible:
            change = abs(difference) * room[key] / total_room
            targets[key] += change if difference > 0 else -change
            targets[key] = max(lower_bounds[key], min(upper_bounds[key], targets[key]))

    return (
        _largest_remainder(targets, lower_bounds, upper_bounds),
        targets,
    )


def _published_weights(
    raw: Any,
    source_text: str,
) -> tuple[dict[str, int] | None, list[dict[str, Any]]]:
    if not isinstance(raw, list):
        return None, []
    mapped: dict[str, float] = {}
    accepted: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        criterion = _text(item.get("criterion"))
        quote = _text(item.get("source_quote"))
        try:
            percentage = float(item.get("percentage"))
        except (TypeError, ValueError):
            continue
        if (
            criterion not in READINESS_DIMENSIONS
            or criterion in mapped
            or not math.isfinite(percentage)
            or percentage < 0
            or not _verified_quote(quote, source_text)
        ):
            continue
        mapped[criterion] = percentage
        accepted.append(
            {
                "criterion": criterion,
                "percentage": percentage,
                "source_field": _text(item.get("source_field")),
                "source_quote": quote,
            }
        )
    if set(mapped) != set(READINESS_DIMENSIONS) or abs(sum(mapped.values()) - 100) > 0.01:
        return None, []
    return (
        _largest_remainder(
            mapped,
            {key: 0 for key in READINESS_DIMENSIONS},
            {key: 100 for key in READINESS_DIMENSIONS},
        ),
        accepted,
    )


def build_manager_plan(raw: Any, source_text: str) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    points = {criterion: 0 for criterion in READINESS_DIMENSIONS}
    accepted_signals: list[dict[str, Any]] = []
    seen = set()
    for item in raw.get("signals") or []:
        if not isinstance(item, dict):
            continue
        criterion = _text(item.get("criterion"))
        signal_type = _text(item.get("signal_type"))
        quote = _text(item.get("source_quote"))
        if (
            criterion not in READINESS_DIMENSIONS
            or signal_type not in SOURCE_POINTS
            or not _verified_quote(quote, source_text)
        ):
            continue
        identity = (criterion, signal_type, _canonical(quote))
        if identity in seen:
            continue
        seen.add(identity)
        awarded = SOURCE_POINTS[signal_type]
        points[criterion] = min(MAX_SOURCE_POINTS, points[criterion] + awarded)
        accepted_signals.append(
            {
                "criterion": criterion,
                "signal_type": signal_type,
                "source_field": _text(item.get("source_field")),
                "source_quote": quote,
                "construct": _text(item.get("construct")),
                "points": awarded,
            }
        )

    weights, published = _published_weights(raw.get("published_weights"), source_text)
    if weights is None:
        weights, target_weights = _weights_from_points(points)
        weight_source = "deterministic_source_signals"
    else:
        target_weights = {key: float(value) for key, value in weights.items()}
        weight_source = "published"

    not_applicable: dict[str, dict[str, dict[str, Any]]] = {
        criterion: {} for criterion in READINESS_DIMENSIONS
    }
    for item in raw.get("not_applicable_questions") or []:
        if not isinstance(item, dict):
            continue
        criterion = _text(item.get("criterion"))
        question_id = _text(item.get("question_id"))
        reason = _text(item.get("reason"))
        reason_code = _text(item.get("reason_code"))
        source_quote = _text(item.get("source_quote"))
        if criterion not in READINESS_DIMENSIONS or reason_code not in ALLOWED_NA_REASONS:
            continue
        question = next(
            (
                candidate
                for candidate in ESSAY_RUBRIC[criterion]["questions"]
                if candidate["id"] == question_id
            ),
            None,
        )
        if (
            not question
            or not question.get("manager_may_mark_not_applicable")
            or not reason
            or (source_quote and not _verified_quote(source_quote, source_text))
        ):
            continue
        tentative = {
            **not_applicable[criterion],
            question_id: {
                "reason": reason,
                "reason_code": reason_code,
                "source_field": _text(item.get("source_field")),
                "source_quote": source_quote,
            },
        }
        try:
            normalized_question_weights(
                criterion,
                {key: False for key in tentative},
            )
        except ValueError:
            continue
        not_applicable[criterion] = tentative

    criteria: dict[str, dict[str, Any]] = {}
    for criterion in READINESS_DIMENSIONS:
        applicability = {
            question["id"]: question["id"] not in not_applicable[criterion]
            for question in ESSAY_RUBRIC[criterion]["questions"]
        }
        normalized = normalized_question_weights(criterion, applicability)
        criteria[criterion] = {
            "label": ESSAY_RUBRIC[criterion]["label"],
            "short_label": ESSAY_RUBRIC[criterion]["short_label"],
            "weight": weights[criterion],
            "base_weight": BASE_WEIGHTS[criterion],
            "weight_adjustment": weights[criterion] - BASE_WEIGHTS[criterion],
            "evidence_points": points[criterion],
            "weight_rationale": (
                "Published scholarship weighting."
                if weight_source == "published"
                else "Calculated from verified prompt, selection-criterion, and mission signals."
            ),
            "description": ESSAY_RUBRIC[criterion]["description"],
            "reviewer_lens": ESSAY_RUBRIC[criterion]["reviewer_lens"],
            "questions": [
                {
                    **question,
                    "applicable": applicability[question["id"]],
                    "normalized_weight": normalized.get(question["id"]),
                    "not_applicable": (
                        {
                            **not_applicable[criterion][question["id"]],
                            "applicable": False,
                        }
                        if question["id"] in not_applicable[criterion]
                        else None
                    ),
                }
                for question in ESSAY_RUBRIC[criterion]["questions"]
            ],
        }

    return {
        "rubric_version": RUBRIC_VERSION,
        "weight_policy_version": WEIGHT_POLICY_VERSION,
        "manager_summary": _text(raw.get("manager_summary")),
        "weight_source": weight_source,
        "weight_total": sum(weights.values()),
        "base_weights": dict(BASE_WEIGHTS),
        "evidence_points": points,
        "source_signals": accepted_signals,
        "published_weights": published,
        "unrounded_target_weights": target_weights,
        "criteria": criteria,
        "context_hash": _text(raw.get("context_hash")),
    }
