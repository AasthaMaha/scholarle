"""On-demand, profile-aware Revision Coach with provenance and guardrail checks."""

from __future__ import annotations

import hashlib
import json
import re
from difflib import SequenceMatcher
from typing import Any

from pydantic import BaseModel, Field

from essay_context import scholarship_context
from llm.client import llm
from templates.revision_coach import (
    build_revision_coach_guardrail_prompt,
    build_revision_coach_prompt,
)


REVISION_COACH_VERSION = "revision-coach-v2.0-generalized"
ASSISTANCE_MODES = {
    "exact_edit",
    "evidence_grounded_edit",
    "structural_guidance",
}
EDIT_ACTIONS = {"replace", "insert_before", "insert_after"}
REVISION_SCOPES = {"sentence_group", "paragraph"}
_EXCLUDED_PROFILE_KEYS = {
    "id",
    "email",
    "activeScholarship",
    "applications",
    "documents",
    "drafts",
    "essayDraft",
    "essayDraftHtml",
    "essayDraftsByPromptId",
    "essayDraftHtmlByPromptId",
    "essayFixesByPromptId",
    "ignoredEssayFixesByPromptId",
    "essayReviewResult",
    "essayReviewUpdatedAt",
    "essayReviewDraftAtRun",
    "essayReviewPromptAtRun",
    "essayReviewProfileFingerprintAtRun",
    "fitAnalysis",
    "wikiDiscovery",
    "savedWikiSources",
    "personalizedOutline",
    "personalDictionary",
    "lastStep",
    "journeyTutorialPending",
    "journeyTutorialCompleted",
    "journeyTutorialSkipped",
    "essayWorkspaceTutorialCompleted",
    "profileStartChoiceCompleted",
    "profileSetupCompleted",
    "academicOnboardingCompleted",
}
_SENSITIVE_PARTS = {
    "citizenship",
    "disability",
    "ethnicity",
    "extendedcontext",
    "financial",
    "firstgen",
    "gender",
    "hispanic",
    "identity",
    "immigration",
    "medical",
    "nationality",
    "pelleligible",
    "race",
    "religion",
    "sexual",
}
_PLACEHOLDER_PATTERN = re.compile(r"\[[^\[\]]+\]")
_NUMBER_PATTERN = re.compile(r"(?<!\w)(?:[$£€])?\d[\d,.]*(?:%|\b)")
_WORD_PATTERN = re.compile(r"[a-z0-9]+")
_CLARITY_PRIORITY_PATTERN = re.compile(
    r"\b(clarity|clearer|concision|concise|simplif(?:y|ies|ied)|"
    r"sentence structure|straightforward|easily understood)\b",
    re.IGNORECASE,
)
_INSERT_PRIORITY_PATTERN = re.compile(
    r"\b(add|insert|introduce)\b.{0,80}\b(sentence|passage|transition|connection)\b"
    r"|\b(narrative flow|transition)\b",
    re.IGNORECASE,
)
_SCHOLARSHIP_CONNECTION_PATTERN = re.compile(
    r"\b(scholarship connection|connect.{0,50}scholarship|"
    r"link.{0,50}scholarship|scholarship.{0,50}(enable|goal|future|community))\b",
    re.IGNORECASE,
)
_INSTRUCTIONAL_SUGGESTION_PATTERNS = (
    re.compile(
        r"^\s*(add|insert|write|replace|revise|develop|clarify|describe|"
        r"explain|include|use)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(two[- ]to[- ]four[- ]sentence|one real example|your own real detail|"
        r"this passage|this paragraph|placeholder|replace this with|"
        r"the student should)\b",
        re.IGNORECASE,
    ),
)
_GENERIC_AI_STYLE_PATTERN = re.compile(
    r"\b(profound|transformative|pivotal|tapestry|underscore|delve|"
    r"testament to|not only\b.{0,80}\bbut also)\b",
    re.IGNORECASE,
)
_INTERNAL_COACH_COPY_PATTERN = re.compile(
    r"\b(agent|backend|guardrail|grounding threshold|model output|pipeline|"
    r"prompt version|schema|structured output|validator|validation rule)\b",
    re.IGNORECASE,
)
_BOUNDARY_STOPWORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "be",
    "because",
    "but",
    "by",
    "for",
    "from",
    "had",
    "has",
    "have",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "so",
    "that",
    "the",
    "their",
    "them",
    "this",
    "to",
    "was",
    "we",
    "were",
    "which",
    "with",
}
_INFERRED_CLAIM_WORDS = {
    "believe",
    "belief",
    "benefited",
    "changed",
    "commitment",
    "confidence",
    "deepened",
    "determined",
    "empowered",
    "felt",
    "grew",
    "growth",
    "impact",
    "improved",
    "inspired",
    "learned",
    "motivated",
    "passion",
    "proud",
    "realized",
    "reinforced",
    "strengthened",
    "successful",
    "taught",
    "transformed",
    "understanding",
}


class SelectedProfileFactOutput(BaseModel):
    fact_id: str = ""
    relevance: str = ""


class RevisionCoachOutput(BaseModel):
    mode: str = "exact_edit"
    edit_action: str = "replace"
    scope: str = "sentence_group"
    development_goal: str = ""
    suggested_text: str = ""
    reason: str = ""
    selected_profile_facts: list[SelectedProfileFactOutput] = Field(
        default_factory=list
    )


class RevisionCoachGuardrailOutput(BaseModel):
    approved: bool = False
    addresses_priority: bool = False
    factual_claims_grounded: bool = False
    reflection_grounded: bool = False
    boundary_join_clean: bool = False
    voice_preserved: bool = False
    localized_scope: bool = False
    substantive_change: bool = False
    not_grammar_only: bool = False
    uses_best_available_evidence: bool = False
    issues: list[str] = Field(default_factory=list)


def _plain_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return {}


def _structured_response(prompt: str, schema: type[BaseModel]) -> dict[str, Any]:
    model = llm._get_client(temperature=0.0).with_structured_output(schema)
    response = model.invoke(prompt)
    return _plain_dict(response)


def _label(path: list[str]) -> str:
    value = path[-1] if path else "profile"
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value)
    value = value.replace("_", " ").replace("-", " ")
    if value.isdigit() and len(path) > 1:
        parent = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", path[-2])
        return f"{parent.replace('_', ' ')} item {int(value) + 1}"
    return " ".join(value.split()).strip().title()


def _fact_id(path: list[str]) -> str:
    normalized = [
        re.sub(r"[^a-z0-9]+", "_", part.casefold()).strip("_")
        for part in path
    ]
    return "profile." + ".".join(part or "item" for part in normalized)


def _sensitivity(path: list[str]) -> str:
    normalized = "".join(path).casefold().replace("_", "").replace("-", "")
    return (
        "sensitive"
        if any(part in normalized for part in _SENSITIVE_PARTS)
        else "standard"
    )


def normalize_profile_facts(
    student_profile: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Flatten the reviewed profile into a complete, auditable fact inventory."""
    facts: list[dict[str, Any]] = []

    def visit(value: Any, path: list[str]) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in _EXCLUDED_PROFILE_KEYS or key.lower().endswith("filename"):
                    continue
                visit(child, [*path, str(key)])
            return
        if isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, [*path, str(index)])
            return
        if value is None or value == "":
            return
        if not isinstance(value, (str, int, float, bool)):
            return
        display_value = str(value).strip()
        if not display_value:
            return
        facts.append(
            {
                "fact_id": _fact_id(path),
                "category": path[0] if path else "profile",
                "field": ".".join(path),
                "fact": f"{_label(path)}: {display_value}",
                "value": display_value,
                "source": "student_profile",
                "confirmation_status": "student_confirmed",
                "sensitivity": _sensitivity(path),
            }
        )

    visit(student_profile or {}, [])
    return facts


_DEVELOPMENT_PRIORITY_WORDS = {
    "action",
    "add",
    "connect",
    "context",
    "develop",
    "evidence",
    "example",
    "explain",
    "impact",
    "motivation",
    "outcome",
    "reflection",
    "result",
    "show",
    "specific",
    "story",
    "why",
}
_EXPERIENCE_CATEGORY_PARTS = {
    "education",
    "optional",
    "prompts",
    "research",
    "work",
}


def _content_tokens(value: object) -> set[str]:
    return {
        token
        for token in _WORD_PATTERN.findall(str(value or "").casefold())
        if token not in _BOUNDARY_STOPWORDS and len(token) > 2
    }


def rank_profile_fact_candidates(
    profile_facts: list[dict[str, Any]],
    *,
    priority: dict[str, Any],
    essay_prompt: str,
    selected_text: str,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Put likely useful profile evidence first without inventing relevance."""
    priority_text = json.dumps(priority, default=str)
    query_tokens = _content_tokens(
        " ".join([priority_text, essay_prompt, selected_text])
    )
    development_requested = bool(query_tokens & _DEVELOPMENT_PRIORITY_WORDS)
    ranked: list[tuple[int, int, dict[str, Any]]] = []
    for index, fact in enumerate(profile_facts):
        fact_tokens = _content_tokens(
            " ".join(
                [
                    str(fact.get("category") or ""),
                    str(fact.get("field") or ""),
                    str(fact.get("fact") or ""),
                    str(fact.get("value") or ""),
                ]
            )
        )
        overlap = len(query_tokens & fact_tokens)
        category = str(fact.get("category") or "").casefold()
        experience_bonus = (
            2
            if development_requested
            and any(part in category for part in _EXPERIENCE_CATEGORY_PARTS)
            else 0
        )
        sensitivity_penalty = 2 if fact.get("sensitivity") == "sensitive" else 0
        score = (overlap * 3) + experience_bonus - sensitivity_penalty
        ranked.append(
            (
                score,
                -index,
                {
                    **fact,
                    "candidate_relevance_score": max(0, score),
                },
            )
        )
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [fact for _, _, fact in ranked[: max(1, limit)]]


def _priority_text(priority: dict[str, Any] | None) -> str:
    return " ".join(
        str(value or "")
        for value in (
            (priority or {}).get("title"),
            (priority or {}).get("action"),
            (priority or {}).get("completion_condition"),
            (priority or {}).get("primary_criterion"),
        )
    )


def is_clarity_priority(priority: dict[str, Any] | None) -> bool:
    return bool(_CLARITY_PRIORITY_PATTERN.search(_priority_text(priority)))


def is_connection_priority(priority: dict[str, Any] | None) -> bool:
    text = _priority_text(priority)
    return bool(
        _INSERT_PRIORITY_PATTERN.search(text)
        or _SCHOLARSHIP_CONNECTION_PATTERN.search(text)
    )


def preferred_revision_action(priority: dict[str, Any] | None) -> str:
    text = _priority_text(priority)
    if _CLARITY_PRIORITY_PATTERN.search(text):
        return "replace"
    if is_connection_priority(priority):
        return "insert_after"
    return "replace"


def _instructional_suggestion_issue(suggested: str) -> str | None:
    if _PLACEHOLDER_PATTERN.search(suggested):
        return "Return finished essay prose without bracketed placeholders."
    if "?" in suggested:
        return "Return a direct revision, not a question."
    if any(pattern.search(suggested) for pattern in _INSTRUCTIONAL_SUGGESTION_PATTERNS):
        return "Return essay-ready prose, not instructions about what to write."
    return None


def _word_count(value: str) -> int:
    return len(_WORD_PATTERN.findall(value.casefold()))


def _public_coach_copy(value: object, fallback: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"\bgrounded\b", "supported", text, flags=re.IGNORECASE)
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", text)
        if sentence.strip() and not _INTERNAL_COACH_COPY_PATTERN.search(sentence)
    ]
    return " ".join(sentences).strip() or fallback


def _unavailable_suggestion(
    *,
    priority: dict[str, Any],
    target_start: int,
    target_end: int,
    draft_revision: str,
    current_word_count: int,
    word_limit: int | None,
    issues: list[str],
) -> dict[str, Any]:
    priority_text = _priority_text(priority)
    location = str(priority.get("location") or "the highlighted passage").strip()
    completion_condition = str(
        priority.get("completion_condition")
        or "The revision directly addresses this priority with a truthful, specific detail."
    ).strip()
    lowered = priority_text.casefold()

    if re.search(r"\b(financial|cost|tuition|afford|funding|need)\b", lowered):
        guidance = (
            f"At {location}, add one or two sentences naming the real education "
            "cost or constraint this scholarship would address and what the "
            "support would make possible. Include an amount only if it is verified."
        )
        evidence_needed = (
            "A truthful cost, financial constraint, or use of the scholarship "
            "that the student has already confirmed."
        )
    elif re.search(r"\b(result|outcome|impact|measur|number|specific)\b", lowered):
        guidance = (
            f"At {location}, add one specific outcome the student personally "
            "observed. A concrete qualitative change is useful; include a number "
            "only when it is verified in the essay or profile."
        )
        evidence_needed = (
            "A verified result, observed response, or concrete change connected "
            "to the experience."
        )
    elif re.search(r"\b(reflect|insight|learn|growth|change|meaning)\b", lowered):
        guidance = (
            f"At {location}, connect the experience to one lesson or change the "
            "student has actually expressed. Keep the reflection specific to "
            "what happened rather than adding a general inspirational statement."
        )
        evidence_needed = (
            "A student-confirmed lesson, realization, or change connected to the experience."
        )
    elif re.search(r"\b(transition|flow|connect|structure|order)\b", lowered):
        guidance = (
            f"At {location}, add a brief factual bridge showing how the ideas on "
            "both sides relate. Do not claim that one experience caused the other "
            "unless the draft or profile says so."
        )
        evidence_needed = "The two existing ideas the transition needs to connect."
    elif re.search(r"\b(scholarship|future|goal|alignment|prompt)\b", lowered):
        guidance = (
            f"At {location}, connect the student’s established goal to the "
            "specific opportunity this scholarship provides. Name a concrete "
            "next step rather than describing the scholarship as generally helpful."
        )
        evidence_needed = (
            "A verified student goal and a confirmed scholarship benefit or opportunity."
        )
    else:
        guidance = (
            f"At {location}, develop the priority with one concrete action, "
            "example, or observation already supported by the essay or profile. "
            "Keep the addition focused and in the student’s existing voice."
        )
        evidence_needed = "One truthful, specific detail that directly supports the priority."

    return {
        "status": "success",
        "version": REVISION_COACH_VERSION,
        "assistance_type": "advice",
        "can_apply": False,
        "advice": guidance,
        "placement": location,
        "evidence_needed": evidence_needed,
        "target_length": (
            "Replace or shorten existing text so the full draft moves closer to the word limit."
            if word_limit and current_word_count > word_limit
            else "Keep the change to one or two focused sentences."
        ),
        "completion_condition": completion_condition,
        "reason": (
            "A complete edit would require a personal detail that is not verified "
            "in the current essay or profile."
        ),
        "target": {"start": target_start, "end": target_end},
        "draft_revision": draft_revision,
        "current_word_count": current_word_count,
        "word_limit": word_limit,
        # Internal validation details stay available to server-side diagnostics.
        # The interface deliberately never renders this field.
        "diagnostics": {"issues": issues},
    }


def _specialist_focus(priority: dict[str, Any]) -> str:
    """Route one priority to the most relevant revision lens."""
    primary = str(priority.get("primary_criterion") or "").casefold()
    text = _priority_text(priority).casefold()
    if primary == "alignment" or re.search(
        r"\b(prompt|scholarship|requirement|future goal|financial)\b", text
    ):
        return (
            "Prompt-alignment editor: directly answer the verified prompt or "
            "scholarship requirement without assuming an unstated requirement."
        )
    if primary in {"evidence_strength", "insight"} or re.search(
        r"\b(evidence|example|result|impact|reflection|outcome)\b", text
    ):
        return (
            "Evidence editor: develop only verified actions, outcomes, and "
            "reflection; prefer a qualitative result when no verified number exists."
        )
    if primary == "narrative_structure_flow_coherence" or re.search(
        r"\b(flow|transition|structure|conclusion|introduction|order)\b", text
    ):
        return (
            "Narrative editor: repair the local structure, transition, opening, "
            "or conclusion while preserving the student’s meaning."
        )
    if primary == "clarity_concision":
        return (
            "Clarity editor: rewrite the selected passage for directness and "
            "concision without reducing the work to grammar correction."
        )
    return (
        "Voice-aware scholarship editor: make one high-value revision that "
        "preserves the student’s style and uses only verified information."
    )


def _evidence_sources(
    *,
    priority: dict[str, Any],
    selected_text: str,
    selected_facts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    if selected_text.strip():
        sources.append(
            {
                "source": "essay",
                "label": "Current essay passage",
                "detail": selected_text.strip()[:800],
                "sensitivity": "student_authored",
            }
        )
    requirement_quote = str(priority.get("requirement_quote") or "").strip()
    if requirement_quote:
        sources.append(
            {
                "source": "scholarship",
                "label": "Scholarship requirement",
                "detail": requirement_quote[:800],
                "sensitivity": "official_source",
            }
        )
    for fact in selected_facts:
        sources.append(
            {
                "source": "profile",
                "label": "Student profile detail",
                "detail": str(fact.get("fact") or fact.get("value") or "")[:800],
                "sensitivity": str(fact.get("sensitivity") or "standard"),
            }
        )
    return sources


def _extractive_shortening_suggestion(
    *,
    priority: dict[str, Any],
    selected_text: str,
    target_start: int,
    target_end: int,
    draft_revision: str,
    profile_facts: list[dict[str, Any]],
    current_word_count: int,
    word_limit: int,
    issues: list[str],
) -> dict[str, Any] | None:
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", selected_text.strip())
        if sentence.strip()
    ]
    if len(sentences) < 2:
        return None

    query_tokens = _content_tokens(
        " ".join(
            [
                _priority_text(priority),
                " ".join(str(fact.get("value") or "") for fact in profile_facts[:12]),
            ]
        )
    )
    keep_count = 2 if len(sentences) >= 3 else 1
    ranked = sorted(
        enumerate(sentences),
        key=lambda item: (
            len(_content_tokens(item[1]) & query_tokens),
            _word_count(item[1]),
        ),
        reverse=True,
    )
    kept_indexes = sorted(index for index, _ in ranked[:keep_count])
    suggested = " ".join(sentences[index] for index in kept_indexes)
    original_word_count = _word_count(selected_text)
    suggested_word_count = _word_count(suggested)
    if (
        suggested == selected_text.strip()
        or suggested_word_count < 10
        or suggested_word_count >= original_word_count
    ):
        return None

    word_delta = suggested_word_count - original_word_count
    return {
        "status": "success",
        "version": REVISION_COACH_VERSION,
        "assistance_type": "edit",
        "mode": "exact_edit",
        "edit_action": "replace",
        "scope": "paragraph",
        "development_goal": str(
            priority.get("title") or "Shorten the priority passage"
        ).strip(),
        "original_text": selected_text,
        "suggested_text": suggested,
        "reason": (
            "Shortens the over-limit draft by preserving the most relevant "
            "sentences already written in the student's own voice."
        ),
        "selected_profile_facts": [],
        "evidence_sources": _evidence_sources(
            priority=priority,
            selected_text=selected_text,
            selected_facts=[],
        ),
        "can_apply": True,
        "word_delta": word_delta,
        "projected_word_count": current_word_count + word_delta,
        "word_limit": word_limit,
        "target": {"start": target_start, "end": target_end},
        "draft_revision": draft_revision,
        "profile_inventory_hash": hashlib.sha256(
            json.dumps(profile_facts, sort_keys=True).encode("utf-8")
        ).hexdigest(),
        "guardrail": {
            "approved": True,
            "programmatic_extractive_shortening": True,
            "issues": issues,
        },
    }


def _validation_issues(
    proposal: dict[str, Any],
    *,
    selected_text: str,
    surrounding_text: str,
    fact_index: dict[str, dict[str, Any]],
    before_text: str = "",
    after_text: str = "",
    priority: dict[str, Any] | None = None,
    preferred_edit_action: str | None = None,
    current_word_count: int = 0,
    word_limit: int | None = None,
) -> list[str]:
    mode = str(proposal.get("mode") or "")
    edit_action = str(proposal.get("edit_action") or "")
    scope = str(proposal.get("scope") or "")
    development_goal = str(proposal.get("development_goal") or "").strip()
    suggested = str(proposal.get("suggested_text") or "").strip()
    selected_refs = proposal.get("selected_profile_facts") or []
    selected_ids = [
        str(_plain_dict(item).get("fact_id") or "").strip() for item in selected_refs
    ]
    issues: list[str] = []

    if mode not in ASSISTANCE_MODES:
        issues.append("Select one allowed assistance mode.")
    if edit_action not in EDIT_ACTIONS:
        issues.append("Select one allowed edit action.")
    if scope not in REVISION_SCOPES:
        issues.append("Select sentence_group or paragraph scope.")
    if not development_goal:
        issues.append("Name the substantive development goal.")
    if not suggested:
        issues.append("Provide a substantive suggested revision.")
    if edit_action == "replace" and suggested == selected_text.strip():
        issues.append("The suggestion does not change the selected passage.")
    if (
        edit_action in {"insert_before", "insert_after"}
        and selected_text.strip()
        and selected_text.strip().casefold() in suggested.casefold()
    ):
        issues.append("An insertion must not repeat its anchor passage.")
    maximum_length = min(1800, max(700, len(selected_text) * 2 + 700))
    if len(suggested) > maximum_length:
        issues.append("The suggestion is longer than one focused paragraph.")
    if any(fact_id not in fact_index for fact_id in selected_ids):
        issues.append("Every selected profile fact must use an exact provided fact_id.")
    if mode == "evidence_grounded_edit" and not selected_ids:
        issues.append("An evidence-grounded edit must cite at least one profile fact.")
    if selected_ids and mode != "evidence_grounded_edit":
        issues.append("Edits that use profile facts must use evidence_grounded_edit mode.")

    instruction_issue = _instructional_suggestion_issue(suggested)
    if instruction_issue:
        issues.append(instruction_issue)
    generic_ai_phrases = {
        match.group(0).casefold()
        for match in _GENERIC_AI_STYLE_PATTERN.finditer(suggested)
        if match.group(0).casefold() not in surrounding_text.casefold()
    }
    if generic_ai_phrases:
        issues.append(
            "Remove generic AI-style phrasing not used by the student: "
            + ", ".join(sorted(generic_ai_phrases))
        )

    preferred_action = preferred_edit_action or preferred_revision_action(priority)
    if edit_action in EDIT_ACTIONS and edit_action != preferred_action:
        issues.append(
            f"Use {preferred_action} for this priority instead of {edit_action}."
        )

    suggested_word_count = _word_count(suggested)
    minimum_words = 4 if is_clarity_priority(priority) else 10
    if suggested_word_count < minimum_words:
        issues.append(
            "Develop the idea substantively; do not return a grammar-level or fragmentary edit."
        )

    original_word_count = _word_count(selected_text) if edit_action == "replace" else 0
    word_delta = suggested_word_count - original_word_count
    projected_word_count = current_word_count + word_delta
    if word_limit:
        if current_word_count > word_limit and word_delta >= 0:
            issues.append(
                "The essay is already over its word limit; replace or shorten "
                "existing text so this suggestion reduces the word count."
            )
        elif current_word_count <= word_limit and projected_word_count > word_limit:
            issues.append(
                "Shorten the suggestion so the revised essay remains within "
                "the word limit."
            )

    selected_fact_text = " ".join(
        fact_index[fact_id]["value"]
        for fact_id in selected_ids
        if fact_id in fact_index
    )
    allowed_numbers = set(
        _NUMBER_PATTERN.findall(
            " ".join(
                [selected_text, surrounding_text, selected_fact_text]
            )
        )
    )
    proposed_numbers = set(_NUMBER_PATTERN.findall(suggested))
    unsupported_numbers = proposed_numbers - allowed_numbers
    if unsupported_numbers:
        issues.append(
            "Remove unsupported numeric claims: "
            + ", ".join(sorted(unsupported_numbers))
        )

    source_words = {
        token
        for token in _WORD_PATTERN.findall(
            " ".join(
                [
                    selected_text,
                    surrounding_text,
                    selected_fact_text,
                    _priority_text(priority),
                ]
            ).casefold()
        )
    }
    introduced_inferred_claims = sorted(
        (
            set(_WORD_PATTERN.findall(suggested.casefold()))
            & _INFERRED_CLAIM_WORDS
        )
        - source_words
    )
    if introduced_inferred_claims:
        issues.append(
            "Remove unsupported reflection, emotion, or impact language: "
            + ", ".join(introduced_inferred_claims)
        )

    def content_words(text: str) -> set[str]:
        return _content_tokens(text)

    selected_words = content_words(selected_text)
    added_words = content_words(suggested) - selected_words
    adjacent_words = content_words(before_text[-300:]) | content_words(
        after_text[:300]
    )
    repeated_boundary_ideas = sorted(added_words & adjacent_words)
    if len(repeated_boundary_ideas) >= 2 and not is_connection_priority(priority):
        issues.append(
            "Do not repeat or paraphrase ideas already beside the selected "
            "passage. Remove adjacent-context concepts: "
            + ", ".join(repeated_boundary_ideas)
        )

    normalized_selected = " ".join(selected_text.casefold().split())
    normalized_suggested = " ".join(suggested.casefold().split())
    similarity = SequenceMatcher(
        None, normalized_selected, normalized_suggested
    ).ratio()
    if (
        not is_clarity_priority(priority)
        and edit_action == "replace"
        and similarity >= 0.82
        and len(added_words) < 4
    ):
        issues.append(
            "The edit is too close to the original and appears to be wording "
            "or grammar polish rather than substantive coaching."
        )
    if edit_action in {"insert_before", "insert_after"} and suggested_word_count < 12:
        issues.append("An inserted passage must develop at least one complete idea.")

    if mode == "evidence_grounded_edit" and selected_ids:
        selected_fact_words = _content_tokens(selected_fact_text)
        suggestion_words = _content_tokens(suggested)
        if selected_fact_words and not (selected_fact_words & suggestion_words):
            issues.append(
                "The suggestion cites profile evidence but does not meaningfully use it."
            )
    return issues


def run_revision_coach(
    *,
    priority: dict[str, Any],
    essay_text: str,
    target_start: int,
    target_end: int,
    essay_prompt: str = "",
    clean_scholarship_record: dict[str, Any] | None = None,
    student_profile: dict[str, Any] | None = None,
    draft_revision: str = "",
    current_word_count: int = 0,
    word_limit: int | None = None,
) -> dict[str, Any]:
    if (
        target_start < 0
        or target_end <= target_start
        or target_end > len(essay_text)
    ):
        return {
            "status": "error",
            "message": "The essay passage could not be located. Refresh the review and try again.",
        }

    selected_text = essay_text[target_start:target_end]
    context_start = max(0, target_start - 1800)
    context_end = min(len(essay_text), target_end + 1800)
    before_text = essay_text[context_start:target_start]
    after_text = essay_text[target_end:context_end]
    surrounding_text = essay_text
    profile_facts = normalize_profile_facts(student_profile)
    fact_index = {fact["fact_id"]: fact for fact in profile_facts}
    profile_fact_candidates = rank_profile_fact_candidates(
        profile_facts,
        priority=priority,
        essay_prompt=essay_prompt,
        selected_text=selected_text,
    )
    correction_guidance = ""
    last_issues: list[str] = []
    over_word_limit = bool(word_limit and current_word_count > word_limit)
    preferred_action = (
        "replace" if over_word_limit else preferred_revision_action(priority)
    )

    for attempt in range(3):
        prompt = build_revision_coach_prompt(
            priority=priority,
            full_essay=essay_text,
            selected_text=selected_text,
            before_text=before_text,
            after_text=after_text,
            essay_prompt=essay_prompt,
            scholarship_context=scholarship_context(clean_scholarship_record),
            profile_facts=profile_fact_candidates,
            preferred_edit_action=preferred_action,
            current_word_count=current_word_count,
            word_limit=word_limit,
            correction_guidance=correction_guidance,
            specialist_focus=_specialist_focus(priority),
        )
        try:
            proposal = _structured_response(prompt, RevisionCoachOutput)
        except Exception:
            last_issues = [
                "The substantive revision model was temporarily unavailable."
            ]
            correction_guidance = last_issues[0]
            continue
        if (
            proposal.get("selected_profile_facts")
            and proposal.get("mode") != "evidence_grounded_edit"
        ):
            proposal["mode"] = "evidence_grounded_edit"
        issues = _validation_issues(
            proposal,
            selected_text=selected_text,
            surrounding_text=surrounding_text,
            fact_index=fact_index,
            before_text=before_text,
            after_text=after_text,
            priority=priority,
            preferred_edit_action=preferred_action,
            current_word_count=current_word_count,
            word_limit=word_limit,
        )
        if attempt == 2:
            # Style-language detection is a coaching quality signal, not a
            # safety failure. After two repair attempts, do not withhold an
            # otherwise grounded, complete, word-budget-compliant edit.
            issues = [
                issue
                for issue in issues
                if "generic AI-style phrasing" not in issue
            ]
        selected_refs = proposal.get("selected_profile_facts") or []
        selected_facts = [
            {
                **fact_index[fact_id],
                "relevance": str(_plain_dict(item).get("relevance") or "").strip(),
            }
            for item in selected_refs
            if (fact_id := str(_plain_dict(item).get("fact_id") or "").strip())
            in fact_index
        ]
        if not issues:
            guardrail_prompt = build_revision_coach_guardrail_prompt(
                priority=priority,
                full_essay=essay_text,
                selected_text=selected_text,
                before_text=before_text,
                after_text=after_text,
                profile_fact_candidates=profile_fact_candidates,
                selected_profile_facts=selected_facts,
                proposal=proposal,
                preferred_edit_action=preferred_action,
            )
            try:
                guardrail = _structured_response(
                    guardrail_prompt, RevisionCoachGuardrailOutput
                )
            except Exception:
                last_issues = [
                    "The revision safety review was temporarily unavailable."
                ]
                correction_guidance = last_issues[0]
                continue
            guardrail_checks = [
                "addresses_priority",
                "factual_claims_grounded",
                "reflection_grounded",
                "voice_preserved",
                "localized_scope",
                "uses_best_available_evidence",
            ]
            if not is_clarity_priority(priority):
                guardrail_checks.extend(
                    ["substantive_change", "not_grammar_only"]
                )
            guardrail_approved = all(
                bool(guardrail.get(check)) for check in guardrail_checks
            )
            if guardrail_approved:
                suggestion_text = str(
                    proposal.get("suggested_text") or ""
                ).strip()
                suggestion_word_count = _word_count(suggestion_text)
                original_word_count = (
                    _word_count(selected_text)
                    if proposal.get("edit_action") == "replace"
                    else 0
                )
                word_delta = suggestion_word_count - original_word_count
                return {
                    "status": "success",
                    "version": REVISION_COACH_VERSION,
                    "assistance_type": "edit",
                    "mode": proposal.get("mode"),
                    "edit_action": proposal.get("edit_action"),
                    "scope": proposal.get("scope"),
                    "development_goal": _public_coach_copy(
                        proposal.get("development_goal"),
                        str(priority.get("title") or "Strengthen this passage"),
                    ),
                    "original_text": selected_text,
                    "suggested_text": suggestion_text,
                    "reason": _public_coach_copy(
                        proposal.get("reason"),
                        "This revision makes the priority more specific while preserving the student’s meaning.",
                    ),
                    "selected_profile_facts": selected_facts,
                    "evidence_sources": _evidence_sources(
                        priority=priority,
                        selected_text=selected_text,
                        selected_facts=selected_facts,
                    ),
                    "can_apply": True,
                    "word_delta": word_delta,
                    "projected_word_count": current_word_count + word_delta,
                    "word_limit": word_limit,
                    "target": {"start": target_start, "end": target_end},
                    "draft_revision": draft_revision,
                    "profile_inventory_hash": hashlib.sha256(
                        json.dumps(profile_facts, sort_keys=True).encode("utf-8")
                    ).hexdigest(),
                    "guardrail": {
                        "approved": True,
                        "issues": [],
                        **{
                            check: True
                            for check in guardrail_checks
                        },
                    },
                }
            issues = [
                str(issue).strip()
                for issue in guardrail.get("issues") or []
                if str(issue).strip()
            ]
            if not issues:
                issues = [
                    "The proposed revision did not pass these Guardrail QA "
                    "checks: "
                    + ", ".join(
                        check
                        for check in guardrail_checks
                        if not bool(guardrail.get(check))
                    )
                ]

        last_issues = issues
        correction_guidance = " ".join(issues)
        if any(
            "essay-ready prose" in issue
            or "bracketed placeholders" in issue
            or "direct revision, not a question" in issue
            for issue in issues
        ):
            correction_guidance += (
                " REQUIRED: Return only the finished words that can be inserted "
                "into the essay immediately. Do not describe the revision."
            )
        if any("for this priority instead of" in issue for issue in issues):
            correction_guidance += (
                f" REQUIRED EDIT ACTION: {preferred_action}."
            )
        if any("word limit" in issue for issue in issues):
            correction_guidance += (
                " REQUIRED: The essay is over budget. Use replace and return a "
                "shorter finished passage that reduces the total word count while "
                "still addressing the priority."
            )
        if any("generic AI-style phrasing" in issue for issue in issues):
            correction_guidance += (
                " REQUIRED: Rewrite in the student's existing vocabulary and "
                "sentence rhythm. Use plain, direct language from the essay."
            )
        if any(
            "grammar-level" in issue
            or "wording or grammar polish" in issue
            or "substantive coaching" in issue
            for issue in issues
        ):
            correction_guidance += (
                " REQUIRED: Make a content-level change. Add or develop a "
                "grounded example, action, result, reflection, narrative "
                "connection, or prompt connection. Do not polish mechanics."
            )
        if any(
            "unsupported reflection, emotion, or impact" in issue
            for issue in issues
        ):
            correction_guidance += (
                " REQUIRED: Remove the unsupported claim and return the strongest "
                "complete revision supported by the essay and profile. Do not ask "
                "a question and do not use placeholders."
            )
        if attempt == 2:
            break

    if over_word_limit and word_limit:
        extractive_suggestion = _extractive_shortening_suggestion(
            priority=priority,
            selected_text=selected_text,
            target_start=target_start,
            target_end=target_end,
            draft_revision=draft_revision,
            profile_facts=profile_fact_candidates,
            current_word_count=current_word_count,
            word_limit=word_limit,
            issues=last_issues,
        )
        if extractive_suggestion:
            return extractive_suggestion
    return _unavailable_suggestion(
        priority=priority,
        target_start=target_start,
        target_end=target_end,
        draft_revision=draft_revision,
        current_word_count=current_word_count,
        word_limit=word_limit,
        issues=last_issues,
    )
