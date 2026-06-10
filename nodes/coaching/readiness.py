# nodes/coaching/readiness.py

READINESS_DIMENSIONS = [
    "opportunity_fit",
    "evidence_strength",
    "narrative_quality",
    "authenticity",
    "competitiveness",
]

READINESS_LABELS = {
    "opportunity_fit": "Opportunity Fit",
    "evidence_strength": "Evidence Strength",
    "narrative_quality": "Narrative Quality",
    "authenticity": "Authenticity",
    "competitiveness": "Competitiveness",
    "revision_progress": "Revision Progress",
}


def clamp_score(value, lo=0, hi=100) -> int:
    try:
        value = int(round(float(value)))
    except (TypeError, ValueError):
        value = 0
    return max(lo, min(hi, value))


def score_to_level(score: int) -> str:
    if score >= 80:
        return "Strong"
    if score >= 60:
        return "Developing"
    if score >= 40:
        return "Emerging"
    return "Needs Work"


def overall_strength_level(readiness: dict) -> str:
    scores = [
        readiness[dim]["score"]
        for dim in READINESS_DIMENSIONS
        if dim in readiness and isinstance(readiness[dim], dict)
    ]
    if not scores:
        return "Developing"
    return score_to_level(round(sum(scores) / len(scores)))


def compute_growth_report(
    previous: dict,
    current: dict,
    draft_number: int,
) -> dict:
    """Growth Coach — compare readiness across drafts (Python, no LLM)."""
    if draft_number <= 1 or not previous:
        return {
            "draft_number": draft_number,
            "has_previous_draft": False,
            "overall_delta": 0,
            "dimension_changes": [],
            "growth_message": (
                "This is your first coached draft. Revise and analyse again "
                "to track how your application readiness improves."
            ),
        }

    changes = []
    total_delta = 0
    for dim in READINESS_DIMENSIONS:
        prev_score = clamp_score(previous.get(dim, 0))
        curr_score = clamp_score(current.get(dim, {}).get("score", 0))
        delta = curr_score - prev_score
        total_delta += delta
        if delta != 0:
            changes.append({
                "dimension": READINESS_LABELS[dim],
                "key": dim,
                "previous_level": score_to_level(prev_score),
                "current_level": score_to_level(curr_score),
                "previous_score": prev_score,
                "current_score": curr_score,
                "delta": delta,
            })

    avg_delta = round(total_delta / max(len(READINESS_DIMENSIONS), 1))

    improved = [c for c in changes if c["delta"] > 0]
    declined = [c for c in changes if c["delta"] < 0]

    parts = []
    if improved:
        top = max(improved, key=lambda c: c["delta"])
        parts.append(
            f"{top['dimension']}: {top['previous_level']} → {top['current_level']}"
        )
    if declined:
        worst = min(declined, key=lambda c: c["delta"])
        parts.append(
            f"{worst['dimension']} slipped — revisit your latest edits."
        )

    growth_message = (
        " · ".join(parts)
        if parts
        else "Scores are stable. Focus on the recommended action below."
    )

    return {
        "draft_number": draft_number,
        "has_previous_draft": True,
        "overall_delta": avg_delta,
        "dimension_changes": changes,
        "growth_message": growth_message,
        "improvements": [
            f"{c['dimension']}: {c['previous_level']} → {c['current_level']}"
            for c in sorted(improved, key=lambda x: -x["delta"])[:4]
        ],
    }


def build_readiness_entry(score: int, coaching: str = "") -> dict:
    score = clamp_score(score)
    return {
        "score": score,
        "level": score_to_level(score),
        "coaching": coaching or "",
    }
