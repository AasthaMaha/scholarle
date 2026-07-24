# nodes/coaching/readiness.py

READINESS_DIMENSIONS = [
    "alignment",
    "evidence_strength",
    "insight",
    "narrative_structure_flow_coherence",
    "tone_authenticity",
    "clarity_concision",
]

READINESS_LABELS = {
    "alignment": "Alignment",
    "evidence_strength": "Evidence Strength",
    "insight": "Insight",
    "narrative_structure_flow_coherence": "Narrative Structure, Flow & Coherence",
    "tone_authenticity": "Tone & Authenticity",
    "clarity_concision": "Clarity & Concision",
    "revision_progress": "Revision Progress",
}


def _previous_dimension_score(previous: dict, dimension: str) -> int | None:
    """Read current keys and bridge the former split narrative dimensions."""
    if dimension in previous:
        return clamp_score(previous.get(dimension), hi=100)
    if dimension == "narrative_structure_flow_coherence":
        legacy = [
            previous.get(key)
            for key in ("coherence_continuity", "flow_narrative_arc")
            if key in previous
        ]
        if legacy:
            return round(sum(clamp_score(value, hi=100) for value in legacy) / len(legacy))
    return None


def clamp_score(value, lo=0, hi=97) -> int:
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
    comparable_dimensions = 0
    for dim in READINESS_DIMENSIONS:
        prev_score = _previous_dimension_score(previous, dim)
        if prev_score is None:
            continue
        curr_score = clamp_score(current.get(dim, {}).get("score", 0), hi=100)
        delta = curr_score - prev_score
        total_delta += delta
        comparable_dimensions += 1
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

    avg_delta = round(total_delta / max(comparable_dimensions, 1))

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
