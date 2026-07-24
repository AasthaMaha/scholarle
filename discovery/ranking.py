from __future__ import annotations

import re
from typing import Any

from .compatibility import assess_candidate
from .schemas import DiscoveryContext


STOP = {"student", "students", "scholarship", "scholarships", "funding", "official", "program"}


def _terms(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", value.lower()) if len(token) > 2 and token not in STOP}


def score_candidate(candidate: dict[str, Any], context: DiscoveryContext) -> tuple[float, dict[str, float]]:
    assessment = assess_candidate(candidate, context)
    if not assessment.compatible:
        return 0.0, {"compatibility": 0.0}
    candidate_text = " ".join([
        str(candidate.get("name") or ""),
        str(candidate.get("category") or ""),
        " ".join(candidate.get("best_for") or []),
        " ".join(candidate.get("opportunity_types") or []),
        str(candidate.get("snippet") or ""),
        str(candidate.get("search_query") or ""),
    ])
    desired = _terms(" ".join([
        context.preference_text,
        context.profile.field.raw_label,
        context.profile.career_goal,
        *context.profile.research_topics,
    ]))
    overlap = len(desired & _terms(candidate_text)) / max(1, len(desired))
    authority = 1.0 if candidate.get("origin") == "library" else 0.7 if candidate.get("preview_ok") else 0.35
    evidence = float((candidate.get("source_evidence") or {}).get("evidence_quality") or authority)
    field = assessment.field_score
    intent = min(1.0, overlap * 2)
    total = 0.30 * field + 0.30 * intent + 0.20 * authority + 0.20 * evidence
    return total, {
        "field": round(field, 3),
        "intent": round(intent, 3),
        "authority": round(authority, 3),
        "evidence": round(evidence, 3),
    }
