# nodes/scoring/metrics.py

METRIC_KEYS = [
    "evidence_coverage",
    "requirement_coverage",
    "authenticity",
    "tone",
    "grammar",
    "length",
    "ai_likeness",
    "competitiveness",
]

METRIC_LABELS = {
    "evidence_coverage": "Evidence Coverage",
    "requirement_coverage": "Requirement Coverage",
    "authenticity": "Authenticity",
    "tone": "Tone",
    "grammar": "Grammar",
    "length": "Length Fit",
    "ai_likeness": "AI-Likeness",
    "competitiveness": "Competitiveness",
}

INVERTED_METRICS = {"ai_likeness"}


def clamp_score(value, lo=0, hi=100) -> int:
    try:
        value = int(round(float(value)))
    except (TypeError, ValueError):
        value = 0
    return max(lo, min(hi, value))


def compute_authenticity_score(agent_data: dict) -> int:
    evidence_support = clamp_score(agent_data.get("evidence_support_score", 0))
    reflection = clamp_score(agent_data.get("reflection_depth_score", 0))
    specific = clamp_score(agent_data.get("specific_detail_score", 0))
    generic_penalty = clamp_score(agent_data.get("generic_phrase_penalty", 0))
    return clamp_score(
        0.40 * evidence_support
        + 0.30 * reflection
        + 0.20 * specific
        - 0.10 * generic_penalty
    )


def compute_final_score(
    requirement_coverage: int,
    evidence_coverage: int,
    authenticity: int,
    competitiveness: int,
    tone: int,
    grammar: int,
    length: int,
) -> int:
    writing_readiness = (tone + grammar + length) / 3
    return clamp_score(
        0.20 * requirement_coverage
        + 0.20 * evidence_coverage
        + 0.20 * authenticity
        + 0.20 * competitiveness
        + 0.20 * writing_readiness
    )


def metric_detail(score: int, feedback: str, suggestion: str) -> dict:
    return {
        "score": clamp_score(score),
        "feedback": feedback or "",
        "suggestion": suggestion or "",
    }
