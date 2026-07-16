from __future__ import annotations

import re
from typing import Any


def _text(value: Any) -> str:
    return str(value or "").strip()


def _values(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        return [_text(item) for item in value if _text(item)]
    return [_text(value)] if _text(value) else []


def normalize_gender(value: Any) -> str:
    text = _text(value).lower().replace("_", "-")
    if text in {"female", "woman", "women"}:
        return "female"
    if text in {"male", "man", "men"}:
        return "male"
    if text in {"nonbinary", "non-binary", "non binary"}:
        return "non_binary"
    if text == "transgender":
        return "transgender"
    if text in {"other", "prefer not to say", "prefer not to disclose", "unknown", ""}:
        return "unknown"
    return text.replace(" ", "_")


def normalize_race_ethnicity(value: Any) -> str:
    text = _text(value).lower()
    if not text or "prefer not" in text:
        return "unknown"
    if "white" in text and "not hispanic" in text:
        return "white_non_hispanic"
    if "hispanic" in text or "latino" in text or "latina" in text or "latinx" in text:
        return "hispanic_latino"
    if "black" in text or "african american" in text:
        return "black_african_american"
    if "asian" in text:
        return "asian"
    if "native american" in text or "alaskan native" in text or "american indian" in text:
        return "native_american_alaska_native"
    if "two or more" in text or "multiracial" in text:
        return "multiracial"
    if "white" in text:
        return "white_non_hispanic"
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_") or "unknown"


IDENTITY_ALIASES = {
    "first-generation college student": "first_generation",
    "student with disability": "disability",
    "foster care experience": "foster_care",
    "student with dependents": "has_dependents",
    "veteran": "veteran",
    "military dependent": "military_dependent",
    "daca / undocumented student": "daca_undocumented",
    "daca student": "daca_undocumented",
    "undocumented student": "daca_undocumented",
    "low-income background": "low_income",
    "pell grant eligible": "pell_eligible",
    "fafsa completed": "fafsa_completed",
    "u.s. citizen": "us_citizen",
    "us citizen": "us_citizen",
    "permanent resident": "permanent_resident",
    "international student": "international_student",
    "full-time student": "full_time",
    "part-time student": "part_time",
}


def normalize_identity(value: Any) -> str:
    text = _text(value).lower().replace("’", "'")
    if text in IDENTITY_ALIASES:
        return IDENTITY_ALIASES[text]
    if "first-generation" in text or "first generation" in text:
        return "first_generation"
    if "pell" in text:
        return "pell_eligible"
    if "low-income" in text or "low income" in text or "financial need" in text:
        return "low_income"
    if "disab" in text:
        return "disability"
    if "foster" in text:
        return "foster_care"
    if "dependent" in text and "military" in text:
        return "military_dependent"
    if "dependent" in text:
        return "has_dependents"
    if "veteran" in text:
        return "veteran"
    if "daca" in text or "undocumented" in text:
        return "daca_undocumented"
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def profile_identity_context(profile: dict[str, Any]) -> list[str]:
    values = list(profile.get("identity") or [])
    values.extend(
        key
        for key, selected in (profile.get("extendedContext") or {}).items()
        if selected
    )
    if profile.get("firstGen"):
        values.append("First-generation college student")
    if profile.get("pellEligible"):
        values.append("Pell Grant eligible")
    normalized = [normalize_identity(value) for value in values]
    return list(dict.fromkeys(value for value in normalized if value))


def profile_enrollment_statuses(profile: dict[str, Any]) -> list[str]:
    identities = set(profile_identity_context(profile))
    return [value for value in ("full_time", "part_time") if value in identities]


def _candidate_text(candidate: dict[str, Any]) -> str:
    evidence = candidate.get("source_evidence") or {}
    return " ".join(
        [
            _text(candidate.get("name")),
            _text(candidate.get("category")),
            " ".join(_values(candidate.get("best_for"))),
            _text(candidate.get("status_note")),
            _text(candidate.get("snippet")),
            _text(evidence.get("page_snippet")),
        ]
    ).lower().replace("’", "'")


def _has_audience_phrase(text: str, audience: str) -> bool:
    lead = r"(?:open to|available to|awarded to|aimed at|intended for|eligible (?:to|for)|applicants? must be|for)"
    return bool(
        re.search(rf"\b{lead}\s+(?:[a-z-]+\s+){{0,4}}{audience}\b", text)
        or re.search(rf"\b{audience}\s+(?:students?|applicants?)\s+(?:only|are eligible|may apply)\b", text)
    )


def _has_gender_audience(text: str, audience: str) -> bool:
    lead = r"(?:open to|available to|awarded to|aimed at|intended for|eligible (?:to|for)|applicants? must be|for)"
    modifier = r"(?:international|domestic|undergraduate|graduate|doctoral|postdoctoral|college|university|high[- ]school)"
    return bool(
        re.search(rf"\b{lead}\s+(?:{modifier}\s+){{0,3}}{audience}", text)
        or re.search(rf"\b{audience}\s+(?:students?|applicants?)\s+(?:only|are eligible|may apply)\b", text)
    )


def candidate_eligibility_constraints(candidate: dict[str, Any]) -> dict[str, Any]:
    """Return only explicit or strongly evidenced applicant constraints.

    Platform pages list many audiences, so inferred restrictions are limited to
    specific opportunities. Explicit structured metadata is honored for either.
    """
    explicit_genders = {
        normalize_gender(value)
        for value in _values(candidate.get("eligible_genders") or candidate.get("gender_eligibility"))
        if normalize_gender(value) != "unknown"
    }
    explicit_races = {
        normalize_race_ethnicity(value)
        for value in _values(candidate.get("race_ethnicity_requirements"))
        if normalize_race_ethnicity(value) != "unknown"
    }
    required_identities = {
        normalize_identity(value)
        for value in _values(candidate.get("identity_requirements"))
        if normalize_identity(value)
    }
    enrollment_statuses = {
        normalize_identity(value)
        for value in _values(candidate.get("enrollment_statuses"))
        if normalize_identity(value) in {"full_time", "part_time"}
    }
    text = _candidate_text(candidate)
    infer = _text(candidate.get("kind")).lower() != "platform"
    minimum_gpa = None
    raw_minimum_gpa = candidate.get("minimum_gpa") or candidate.get("minimumGpa")
    if raw_minimum_gpa is not None and _text(raw_minimum_gpa):
        match = re.search(r"\b([0-4](?:\.\d{1,2})?)\b", _text(raw_minimum_gpa))
        if match:
            minimum_gpa = float(match.group(1))
    if infer and minimum_gpa is None:
        for pattern in (
            r"\bminimum\s+(?:cumulative\s+)?gpa(?:\s+of)?\s*[:=]?\s*([0-4](?:\.\d{1,2})?)\b",
            r"\bgpa\s+(?:of\s+)?(?:at least|minimum)\s+([0-4](?:\.\d{1,2})?)\b",
            r"\b([0-4](?:\.\d{1,2})?)\s+(?:minimum\s+)?gpa\b",
        ):
            match = re.search(pattern, text)
            if match:
                minimum_gpa = float(match.group(1))
                break

    if infer and not explicit_genders:
        if _has_gender_audience(text, r"(?:women(?!['’]s)|female(?: students?| applicants?)?)\b"):
            explicit_genders.add("female")
        if _has_gender_audience(text, r"(?:men(?!['’]s)|male(?: students?| applicants?)?)\b"):
            explicit_genders.add("male")

    if infer and not explicit_races:
        if _has_audience_phrase(text, r"(?:hispanic|latino|latina|latinx)(?: students?| applicants?)?"):
            explicit_races.add("hispanic_latino")
        if _has_audience_phrase(text, r"(?:black|african american)(?: students?| applicants?)?"):
            explicit_races.add("black_african_american")
        if _has_audience_phrase(text, r"(?:native american|american indian|alaska(?:n)? native)(?: students?| applicants?)?"):
            explicit_races.add("native_american_alaska_native")

    if infer:
        for phrase, tag in (
            (r"first[- ]generation", "first_generation"),
            (r"students? with disabilit", "disability"),
            (r"foster (?:care|youth)", "foster_care"),
            (r"military dependents?", "military_dependent"),
            (r"veterans?", "veteran"),
            (r"daca|undocumented students?", "daca_undocumented"),
        ):
            if _has_audience_phrase(text, phrase):
                required_identities.add(tag)
        if _has_audience_phrase(text, r"full[- ]time students?"):
            enrollment_statuses.add("full_time")
        if _has_audience_phrase(text, r"part[- ]time students?"):
            enrollment_statuses.add("part_time")

    financial_need_required = bool(candidate.get("financial_need_required"))
    first_generation_required = bool(candidate.get("first_generation_required"))
    if infer and not financial_need_required:
        financial_need_required = bool(
            re.search(r"\b(?:must demonstrate|based on|requires?|with) (?:significant )?financial need\b", text)
            or _has_audience_phrase(text, r"(?:pell[- ]eligible|low[- ]income)(?: students?| applicants?)?")
        )
    if infer and not first_generation_required:
        first_generation_required = _has_audience_phrase(text, r"first[- ]generation(?: students?| applicants?)?")

    return {
        "eligible_genders": sorted(explicit_genders),
        "race_ethnicity_requirements": sorted(explicit_races),
        "identity_requirements": sorted(required_identities),
        "enrollment_statuses": sorted(enrollment_statuses),
        "financial_need_required": financial_need_required,
        "first_generation_required": first_generation_required,
        "minimum_gpa": minimum_gpa,
    }
