"""On-demand, profile-aware Revision Coach with provenance and guardrail checks."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from pydantic import BaseModel, Field

from essay_context import scholarship_context
from llm.client import llm
from templates.revision_coach import (
    build_revision_coach_guardrail_prompt,
    build_revision_coach_prompt,
)


REVISION_COACH_VERSION = "revision-coach-v1.0-grounded"
ASSISTANCE_MODES = {
    "exact_edit",
    "evidence_grounded_edit",
    "student_input_scaffold",
    "structural_guidance",
}
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
    suggested_text: str = ""
    reason: str = ""
    selected_profile_facts: list[SelectedProfileFactOutput] = Field(
        default_factory=list
    )
    student_input_required: bool = False


class RevisionCoachGuardrailOutput(BaseModel):
    approved: bool = False
    addresses_priority: bool = False
    factual_claims_grounded: bool = False
    reflection_grounded: bool = False
    boundary_join_clean: bool = False
    voice_preserved: bool = False
    localized_scope: bool = False
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


def _validation_issues(
    proposal: dict[str, Any],
    *,
    selected_text: str,
    surrounding_text: str,
    fact_index: dict[str, dict[str, Any]],
    before_text: str = "",
    after_text: str = "",
) -> list[str]:
    mode = str(proposal.get("mode") or "")
    suggested = str(proposal.get("suggested_text") or "").strip()
    selected_refs = proposal.get("selected_profile_facts") or []
    selected_ids = [
        str(_plain_dict(item).get("fact_id") or "").strip() for item in selected_refs
    ]
    issues: list[str] = []

    if mode not in ASSISTANCE_MODES:
        issues.append("Select one allowed assistance mode.")
    if not suggested:
        issues.append("Provide a localized suggested revision.")
    if suggested == selected_text.strip():
        issues.append("The suggestion does not change the selected passage.")
    maximum_length = min(1200, max(360, len(selected_text) * 3 + 180))
    if len(suggested) > maximum_length:
        issues.append("The suggestion is too long for a localized revision.")
    if any(fact_id not in fact_index for fact_id in selected_ids):
        issues.append("Every selected profile fact must use an exact provided fact_id.")
    if mode == "evidence_grounded_edit" and not selected_ids:
        issues.append("An evidence-grounded edit must cite at least one profile fact.")

    has_placeholder = bool(_PLACEHOLDER_PATTERN.search(suggested))
    input_required = bool(proposal.get("student_input_required"))
    if mode == "student_input_scaffold" and not has_placeholder:
        issues.append("A student-input scaffold must include visible placeholders.")
    if has_placeholder and not input_required:
        issues.append("Suggestions with placeholders must require student input.")
    if mode != "student_input_scaffold" and has_placeholder:
        issues.append("Only student-input scaffolds may contain placeholders.")

    selected_fact_text = " ".join(
        fact_index[fact_id]["value"]
        for fact_id in selected_ids
        if fact_id in fact_index
    )
    allowed_numbers = set(
        _NUMBER_PATTERN.findall(
            " ".join([selected_text, surrounding_text, selected_fact_text])
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
                [selected_text, surrounding_text, selected_fact_text]
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
        return {
            token
            for token in _WORD_PATTERN.findall(text.casefold())
            if token not in _BOUNDARY_STOPWORDS and len(token) > 2
        }

    selected_words = content_words(selected_text)
    added_words = content_words(suggested) - selected_words
    adjacent_words = content_words(before_text[-300:]) | content_words(
        after_text[:300]
    )
    repeated_boundary_ideas = sorted(added_words & adjacent_words)
    if len(repeated_boundary_ideas) >= 2:
        issues.append(
            "Do not repeat or paraphrase ideas already beside the selected "
            "passage. Remove adjacent-context concepts: "
            + ", ".join(repeated_boundary_ideas)
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
    surrounding_text = f"{before_text} {after_text}".strip()
    profile_facts = normalize_profile_facts(student_profile)
    fact_index = {fact["fact_id"]: fact for fact in profile_facts}
    correction_guidance = ""
    last_issues: list[str] = []

    for attempt in range(2):
        prompt = build_revision_coach_prompt(
            priority=priority,
            selected_text=selected_text,
            before_text=before_text,
            after_text=after_text,
            essay_prompt=essay_prompt,
            scholarship_context=scholarship_context(clean_scholarship_record),
            profile_facts=profile_facts,
            correction_guidance=correction_guidance,
        )
        proposal = _structured_response(prompt, RevisionCoachOutput)
        issues = _validation_issues(
            proposal,
            selected_text=selected_text,
            surrounding_text=surrounding_text,
            fact_index=fact_index,
            before_text=before_text,
            after_text=after_text,
        )
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
                selected_text=selected_text,
                before_text=before_text,
                after_text=after_text,
                selected_profile_facts=selected_facts,
                proposal=proposal,
            )
            guardrail = _structured_response(
                guardrail_prompt, RevisionCoachGuardrailOutput
            )
            guardrail_checks = (
                "addresses_priority",
                "factual_claims_grounded",
                "reflection_grounded",
                "boundary_join_clean",
                "voice_preserved",
                "localized_scope",
            )
            if (
                proposal.get("mode") == "student_input_scaffold"
                and bool(proposal.get("student_input_required"))
                and _PLACEHOLDER_PATTERN.search(
                    str(proposal.get("suggested_text") or "")
                )
            ):
                # A visible placeholder is a request for the student's missing
                # reflection, not an assertion that needs source support.
                guardrail["reflection_grounded"] = True
            guardrail_approved = all(
                bool(guardrail.get(check)) for check in guardrail_checks
            )
            if guardrail_approved:
                return {
                    "status": "success",
                    "version": REVISION_COACH_VERSION,
                    "mode": proposal.get("mode"),
                    "original_text": selected_text,
                    "suggested_text": str(
                        proposal.get("suggested_text") or ""
                    ).strip(),
                    "reason": str(proposal.get("reason") or "").strip(),
                    "selected_profile_facts": selected_facts,
                    "student_input_required": bool(
                        proposal.get("student_input_required")
                    ),
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
            "unsupported reflection, emotion, or impact" in issue
            for issue in issues
        ):
            correction_guidance += (
                " REQUIRED MODE FOR THIS RETRY: student_input_scaffold. "
                "Keep supported wording, replace the unsupported claim with "
                "a concise visible [student-provided result, feeling, or "
                "reflection] placeholder, and set student_input_required true."
            )
        if attempt == 1:
            break

    return {
        "status": "error",
        "message": (
            "Scholar-E could not create a sufficiently grounded suggestion. "
            "Try adding the missing real detail to your profile or essay first."
        ),
        "issues": last_issues,
        "version": REVISION_COACH_VERSION,
        "draft_revision": draft_revision,
    }
