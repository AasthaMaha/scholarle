"""Fixed weighted rubric for Essay Review schema v5.

Models answer evidence-grounded questions with 0, 0.5, or 1. Python owns all
weights, rounding, safeguards, level assignment, and score arithmetic.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any


RUBRIC_VERSION = "essay-rubric-v1"
ANSWER_VALUES = (0.0, 0.5, 1.0)

LEVEL_RANGES = (
    ("Minimal", 0, 19),
    ("Limited", 20, 39),
    ("Developing", 40, 59),
    ("Effective", 60, 74),
    ("Strong", 75, 89),
    ("Exceptional", 90, 100),
)


def _question(
    question_id: str,
    text: str,
    weight: int,
    zero: str,
    partial: str,
    full: str,
    *,
    manager_may_mark_not_applicable: bool = False,
) -> dict[str, Any]:
    return {
        "id": question_id,
        "question": text,
        "weight": weight,
        "anchors": {"0": zero, "0.5": partial, "1": full},
        "manager_may_mark_not_applicable": manager_may_mark_not_applicable,
    }


ESSAY_RUBRIC: dict[str, dict[str, Any]] = {
    "alignment": {
        "label": "Alignment",
        "short_label": "Alignment",
        "reviewer_lens": (
            "Does the essay answer what was asked and demonstrate a grounded "
            "fit with this scholarship?"
        ),
        "description": (
            "Directly answers every material prompt part and connects the "
            "student's experiences, goals, or values to the opportunity."
        ),
        "questions": [
            _question(
                "A1",
                "Does the essay substantively answer every material part of the prompt?",
                30,
                "One or more central prompt asks are missing, contradicted, or replaced by an off-prompt response.",
                "Every central ask is acknowledged, but at least one is superficial or incomplete; alternatively, a minor ask is absent.",
                "Every material ask is directly and substantively answered.",
            ),
            _question(
                "A2",
                "Does the essay remain focused on the prompt rather than drifting into merely related material?",
                15,
                "Much of the essay is unrelated to the prompt, or the central response is difficult to identify.",
                "The essay generally addresses the prompt but contains noticeable tangents or material whose relevance is implicit.",
                "Nearly all content advances the response and its relevance is apparent.",
            ),
            _question(
                "A3",
                "Does the essay demonstrate the scholarship's stated values or selection priorities through relevant content?",
                25,
                "No stated value or selection priority is demonstrated, or fit relies only on unsupported claims.",
                "At least one relevant priority is present, but the connection is generic, implicit, or underdeveloped.",
                "The most relevant stated priorities are clearly demonstrated through grounded student content.",
                manager_may_mark_not_applicable=True,
            ),
            _question(
                "A4",
                "Does the essay explicitly connect the student's experiences, goals, or values to this specific opportunity?",
                20,
                "The response could be submitted unchanged to almost any scholarship.",
                "The opportunity is referenced, but the student's connection is broad, implied, or only partly supported.",
                "A specific, credible connection is made between the student and this opportunity.",
                manager_may_mark_not_applicable=True,
            ),
            _question(
                "A5",
                "Does the response establish a coherent purpose for why this student and this opportunity fit together?",
                10,
                "The reader cannot determine why the student's direction and the opportunity belong together.",
                "A plausible fit is visible, but its significance is incomplete or implicit.",
                "The response clearly establishes why the opportunity fits the student's direction and candidacy.",
            ),
        ],
        "score_safeguard": {"question_id": "A1", "value": 0.0, "cap": 59},
    },
    "evidence_strength": {
        "label": "Evidence Strength",
        "short_label": "Evidence",
        "reviewer_lens": (
            "Are the essay's important claims supported by concrete, credible, "
            "and relevant evidence?"
        ),
        "description": (
            "Supports important claims with relevant examples, clear student "
            "actions, credible specifics, and demonstrated outcomes."
        ),
        "questions": [
            _question(
                "E1",
                "Does the essay use at least one concrete, relevant example to support its important claims?",
                20,
                "Important claims rely on abstractions without a concrete relevant example.",
                "A relevant example is present but only mentioned, loosely connected, or insufficiently developed.",
                "At least one concrete, relevant example convincingly supports a central claim.",
            ),
            _question(
                "E2",
                "Is the student's own role, action, decision, or responsibility clear?",
                20,
                "A group, event, or outcome is described without clarifying what the student personally did.",
                "The student's role is identifiable but broad, shared, inconsistent, or missing key actions.",
                "The student's specific role, decisions, actions, or responsibilities are clear.",
            ),
            _question(
                "E3",
                "Are important examples developed with credible, relevant specifics?",
                20,
                "Examples lack the details needed to understand or believe the claim, or materially conflict within the essay.",
                "Some useful details are present, but important context, scope, process, duration, or scale remains vague.",
                "Relevant, internally credible specifics make the examples understandable and believable.",
            ),
            _question(
                "E4",
                "Does the essay demonstrate outcomes, impact, or what changed because of the student's actions or experience?",
                25,
                "Activity is reported without an outcome, consequence, effect, or change.",
                "An outcome is claimed, but who benefited, what changed, or how the result is known remains incomplete.",
                "An observable, appropriately supported outcome or impact is clearly connected to the experience.",
            ),
            _question(
                "E5",
                "Are major claims proportionately supported rather than merely asserted or overstated?",
                15,
                "A central claim is unsupported, contradicted, or substantially overstated.",
                "Most claims are plausible, but an important claim is only partly supported or too broad.",
                "Major claims are supported and their wording is proportional to the evidence presented.",
            ),
        ],
        "score_safeguard": {"question_id": "E1", "value": 0.0, "cap": 59},
    },
    "insight": {
        "label": "Insight",
        "short_label": "Insight",
        "reviewer_lens": (
            "Does the essay explain what the experience means, what the student "
            "came to understand, and why that understanding matters?"
        ),
        "description": (
            "Interprets experience through specific reflection, learning, "
            "change, significance, and grounded present or future direction."
        ),
        "questions": [
            _question(
                "I1",
                "Does the essay interpret the meaning of important experiences rather than only reporting events?",
                25,
                "The essay mainly reports events, duties, or outcomes without interpreting their meaning.",
                "Reflection appears but is brief, generic, disconnected, or secondary to summary.",
                "Key experiences are consistently interpreted and their meaning is clear.",
            ),
            _question(
                "I2",
                "Does it articulate a specific lesson, realization, tension, or question grounded in the experience?",
                20,
                "No meaningful lesson, realization, tension, question, or new understanding is articulated.",
                "A lesson is named but remains generic, broad, or weakly tied to the experience.",
                "A specific, credible insight grows naturally from the experience.",
            ),
            _question(
                "I3",
                "Does it show a credible change in understanding, behavior, values, goals, or responsibility?",
                20,
                "Growth is claimed without explaining what changed, or change is absent where central.",
                "A change is mentioned but not clearly demonstrated or developed.",
                "The essay credibly shows how the experience affected the student.",
            ),
            _question(
                "I4",
                "Does it explain why the experience matters to the student and, where relevant, to other people or a community?",
                15,
                "The essay does not explain why the experience matters beyond task completion.",
                "Personal or wider significance is present but generic, one-sided, exaggerated, or underexplored.",
                "Personal significance and any relevant significance to others are clearly explained.",
            ),
            _question(
                "I5",
                "Does the reflection connect meaningfully to the student's present choices or future direction?",
                20,
                "Reflection is isolated from current choices, commitments, or future direction.",
                "A present or future connection is mentioned but appended, broad, or weakly grounded.",
                "A specific, credible line connects the experience and insight to present or future direction.",
                manager_may_mark_not_applicable=True,
            ),
        ],
        "score_safeguard": {"question_id": "I1", "value": 0.0, "cap": 59},
    },
    "narrative_structure_flow_coherence": {
        "label": "Narrative Structure, Flow & Coherence",
        "short_label": "Flow",
        "reviewer_lens": (
            "Can the reviewer follow the essay naturally, and do its parts form "
            "a purposeful, logically connected whole?"
        ),
        "description": (
            "Uses purposeful paragraph roles, progression, transitions, "
            "continuity, and pacing to create a coherent whole."
        ),
        "questions": [
            _question(
                "F1",
                "Does each paragraph or section have a clear and useful role in the essay?",
                20,
                "Multiple paragraphs lack a clear function, combine unrelated purposes, or do not contribute.",
                "Most paragraphs have a useful role, but at least one is unfocused, overloaded, misplaced, or redundant.",
                "Each paragraph or section has a clear purpose and contributes to the whole.",
            ),
            _question(
                "F2",
                "Does the essay progress through ideas or events in a purposeful, logical sequence?",
                25,
                "Ideas or events are arranged in a confusing, arbitrary, or seriously fragmented sequence.",
                "The main progression can be followed, but a section arrives too early, too late, or without needed reasoning.",
                "The sequence creates a clear and purposeful progression.",
            ),
            _question(
                "F3",
                "Are transitions and connections between paragraphs or ideas clear and meaningful?",
                20,
                "Important shifts are abrupt, unexplained, or logically disconnected.",
                "Basic transitions exist, but some are generic, repetitive, or fail to explain the relationship.",
                "Transitions clearly express meaningful relationships between ideas or stages.",
            ),
            _question(
                "F4",
                "Are chronology, cause and effect, people, motivations, and claims internally consistent?",
                20,
                "Material contradictions or broken relationships make the essay difficult to trust or follow.",
                "The essay is mostly coherent, but at least one relationship requires inference or clarification.",
                "Chronology, people, motivations, claims, and causal relationships are consistent and easy to follow.",
            ),
            _question(
                "F5",
                "Is emphasis and pacing balanced so important moments receive appropriate space without structural repetition?",
                15,
                "Low-value material receives substantial space while central moments are rushed or omitted.",
                "Overall pacing works, but one section is overextended, compressed, repetitive, or disproportionate.",
                "Space and emphasis match importance without rushing key moments or repeating structural work.",
            ),
        ],
        "score_safeguard": {"question_id": "F2", "value": 0.0, "cap": 59},
    },
    "tone_authenticity": {
        "label": "Tone & Authenticity",
        "short_label": "Tone",
        "reviewer_lens": (
            "Does the language present a sincere, credible, distinctive student "
            "voice appropriate for a scholarship application?"
        ),
        "description": (
            "Communicates a personal, sincere, appropriately confident, "
            "consistent voice without generic or performative language."
        ),
        "questions": [
            _question(
                "T1",
                "Does the essay communicate a specific and recognizable personal perspective?",
                25,
                "The language is largely impersonal or interchangeable and reveals little perspective.",
                "Some personal perspective appears but is inconsistent, broad, or overshadowed by generic language.",
                "A specific, recognizable perspective is communicated consistently.",
            ),
            _question(
                "T2",
                "Does the voice feel sincere and credible rather than exaggerated, performative, or strategically manufactured?",
                25,
                "Exaggeration, forced emotion, or performative self-presentation materially undermines the voice.",
                "The essay is generally sincere, but some passages feel overstated, overly polished, or insufficiently grounded.",
                "The voice feels candid, proportionate, and credible.",
            ),
            _question(
                "T3",
                "Is the tone appropriately confident, thoughtful, and respectful for the subject and audience?",
                20,
                "The tone is dismissive, disrespectful, boastful, excessively uncertain, or otherwise inappropriate.",
                "The tone is mostly appropriate but occasionally overly formal, casual, promotional, apologetic, or detached.",
                "The tone is confident without boasting, thoughtful without performance, and respectful.",
            ),
            _question(
                "T4",
                "Is the voice reasonably consistent across the essay?",
                15,
                "Major shifts in diction, formality, personality, or stance create incompatible voices.",
                "The voice is generally consistent but contains noticeable passages that do not fit.",
                "The voice remains recognizably consistent while adapting naturally to purpose.",
            ),
            _question(
                "T5",
                "Does the wording avoid generic, formulaic, corporate, or interchangeable language where personal expression is needed?",
                15,
                "Central ideas depend heavily on clichés, templates, corporate language, or interchangeable phrases.",
                "Some distinctive language appears, but important moments still rely on generic or formulaic phrasing.",
                "Important ideas are expressed specifically with little reliance on generic application language.",
            ),
        ],
    },
    "clarity_concision": {
        "label": "Clarity & Concision",
        "short_label": "Clarity",
        "reviewer_lens": (
            "Can the reviewer understand each point quickly and precisely without "
            "unnecessary effort or wording?"
        ),
        "description": (
            "Uses understandable, precise, direct, concise, non-repetitive, and "
            "controlled sentences while preserving meaning and voice."
        ),
        "questions": [
            _question(
                "C1",
                "Are sentences and key ideas understandable on the first careful reading?",
                25,
                "Multiple important sentences or ideas require rereading or guessing.",
                "The main meaning is understandable, but several passages require rereading.",
                "Important sentences and ideas are readily understandable on the first careful reading.",
            ),
            _question(
                "C2",
                "Is wording precise enough that meanings, references, and relationships are unambiguous?",
                20,
                "Vague wording, unclear references, or imprecise relationships materially obscure meaning.",
                "Meaning is generally recoverable, but some references or relationships remain broad or ambiguous.",
                "Wording precisely identifies what happened, who or what is discussed, and how ideas relate.",
            ),
            _question(
                "C3",
                "Does the essay communicate directly without unnecessary filler, throat-clearing, or inflated phrasing?",
                20,
                "Filler, inflated phrasing, or indirect constructions regularly delay or obscure the point.",
                "The essay is generally direct, but several phrases use more words than needed or postpone the point.",
                "Ideas are stated directly and economically while preserving context, nuance, and voice.",
            ),
            _question(
                "C4",
                "Does it avoid unnecessary repetition of ideas, examples, or conclusions?",
                15,
                "The same idea, evidence, or conclusion is repeatedly restated without adding meaning.",
                "Some repetition reinforces a point, but at least one repetition could be removed or combined.",
                "Repetition is purposeful and limited; each part adds information, interpretation, or emphasis.",
            ),
            _question(
                "C5",
                "Are sentence structures controlled and readable rather than tangled, overloaded, or needlessly complex?",
                20,
                "Multiple sentences are tangled, overloaded, fragmented, or structurally obstruct meaning.",
                "Most sentences are readable, but some contain too many clauses or awkward nesting.",
                "Sentence structures are controlled, readable, and appropriately varied.",
            ),
        ],
    },
}


def round_half_up(value: float | Decimal) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def score_to_level(score: int | float | None) -> str:
    if score is None:
        return "Unavailable"
    canonical = max(0, min(100, round_half_up(score)))
    for label, lower, upper in LEVEL_RANGES:
        if lower <= canonical <= upper:
            return label
    return "Unavailable"


def normalized_question_weights(
    criterion: str,
    applicability: dict[str, bool] | None = None,
) -> dict[str, float]:
    applicability = applicability or {}
    applicable = [
        question
        for question in ESSAY_RUBRIC[criterion]["questions"]
        if applicability.get(question["id"], True)
    ]
    if len(applicable) < 4:
        raise ValueError(f"{criterion} must retain at least four applicable questions")
    total = sum(int(question["weight"]) for question in applicable)
    return {
        question["id"]: int(question["weight"]) / total
        for question in applicable
    }


def normalize_answer_value(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return next(
        (allowed for allowed in ANSWER_VALUES if abs(parsed - allowed) < 1e-9),
        None,
    )


def calculate_criterion_score(
    criterion: str,
    answers: list[dict[str, Any]],
    applicability: dict[str, bool] | None = None,
) -> dict[str, Any]:
    weights = normalized_question_weights(criterion, applicability)
    answer_map: dict[str, float] = {}
    for answer in answers:
        question_id = str(answer.get("question_id") or "").strip()
        value = normalize_answer_value(answer.get("value"))
        if question_id in answer_map or question_id not in weights or value is None:
            continue
        answer_map[question_id] = value

    missing = [question_id for question_id in weights if question_id not in answer_map]
    if missing:
        return {
            "available": False,
            "missing_question_ids": missing,
            "raw_score": None,
            "score": None,
            "level": "Unavailable",
            "applied_safeguards": [],
            "normalized_question_weights": weights,
        }

    raw_decimal = sum(
        Decimal(str(weights[question_id])) * Decimal(str(answer_map[question_id]))
        for question_id in weights
    ) * Decimal("100")
    raw_score = round_half_up(raw_decimal)
    final_score = raw_score
    safeguards: list[str] = []
    safeguard = ESSAY_RUBRIC[criterion].get("score_safeguard")
    if safeguard and answer_map.get(safeguard["question_id"]) == float(safeguard["value"]):
        cap = int(safeguard["cap"])
        if final_score > cap:
            final_score = cap
            safeguards.append(
                f"{criterion}:{safeguard['question_id']}_essential_requirement"
            )

    return {
        "available": True,
        "missing_question_ids": [],
        "raw_score": raw_score,
        "score": final_score,
        "level": score_to_level(final_score),
        "applied_safeguards": safeguards,
        "normalized_question_weights": weights,
    }


def rubric_question(criterion: str, question_id: str) -> dict[str, Any] | None:
    return next(
        (
            question
            for question in ESSAY_RUBRIC[criterion]["questions"]
            if question["id"] == question_id
        ),
        None,
    )


def validate_rubric() -> None:
    if len(ESSAY_RUBRIC) != 6:
        raise ValueError("The essay rubric must define exactly six criteria")
    for criterion, config in ESSAY_RUBRIC.items():
        questions = config["questions"]
        if len(questions) != 5:
            raise ValueError(f"{criterion} must define exactly five questions")
        if sum(int(question["weight"]) for question in questions) != 100:
            raise ValueError(f"{criterion} question weights must total 100")
        ids = [question["id"] for question in questions]
        if len(ids) != len(set(ids)):
            raise ValueError(f"{criterion} has duplicate question ids")


validate_rubric()
