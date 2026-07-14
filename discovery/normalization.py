from __future__ import annotations

import re
from typing import Any

from .schemas import CanonicalEducation, CanonicalProfile, DiscoveryContext, DiscoveryIntent, EducationLevel, model_dict
from .taxonomy import normalize_field, normalize_level, normalize_student_type


def _text(value: Any) -> str:
    return str(value or "").strip()


def _primary_education(profile: dict[str, Any]) -> tuple[str, str, str, list[str]]:
    history = [item for item in (profile.get("educationHistory") or []) if isinstance(item, dict)]
    current = history[-1] if history else {}
    profile_level = _text(profile.get("educationLevel"))
    history_level = _text(current.get("educationLevel"))
    profile_normalized = normalize_level(profile_level)
    history_normalized = normalize_level(history_level)
    raw_level = profile_level or history_level
    if profile_normalized == EducationLevel.GRADUATE and history_normalized in {
        EducationLevel.MASTERS, EducationLevel.PROFESSIONAL, EducationLevel.DOCTORAL
    }:
        raw_level = history_level
    field = _text(
        (profile.get("undergrad") or {}).get("major")
        or (profile.get("graduate") or {}).get("program")
        or (profile.get("highSchool") or {}).get("intendedMajor")
        or current.get("majorField")
        or current.get("degreeProgram")
    )
    institution = _text(
        (profile.get("undergrad") or {}).get("institution")
        or (profile.get("graduate") or {}).get("institution")
        or current.get("institution")
    )
    sources = ["educationLevel" if profile.get("educationLevel") else "educationHistory.educationLevel"]
    return raw_level, field, institution, sources


def normalize_profile(profile: dict[str, Any]) -> CanonicalProfile:
    raw_level, field, institution, education_sources = _primary_education(profile)
    research_topics = []
    graduate = profile.get("graduate") or {}
    if _text(graduate.get("researchArea")):
        research_topics.append(_text(graduate.get("researchArea")))
    for item in profile.get("researchExperience") or []:
        if isinstance(item, dict) and _text(item.get("researchAreas")):
            research_topics.append(_text(item.get("researchAreas")))
    student_type = normalize_student_type(
        f"{_text(profile.get('citizenshipStatus'))} {_text(profile.get('nationality'))}"
    )
    current_level = normalize_level(raw_level)
    target_level = current_level
    return CanonicalProfile(
        education=CanonicalEducation(
            current_level=current_level,
            target_level=target_level,
            institution=institution,
            raw_level=raw_level,
        ),
        field=normalize_field(field),
        student_type=student_type,
        current_country=_text(profile.get("location")),
        citizenship_status=_text(profile.get("citizenshipStatus")),
        career_goal=_text(profile.get("careerGoal")),
        research_topics=list(dict.fromkeys(research_topics)),
        opportunity_preferences=[_text(value) for value in profile.get("opportunityPreferences") or [] if _text(value)],
        financial_need=bool(profile.get("pellEligible")),
        provenance={
            "education": education_sources,
            "field": [
                "undergrad.major" if (profile.get("undergrad") or {}).get("major")
                else "graduate.program" if (profile.get("graduate") or {}).get("program")
                else "highSchool.intendedMajor" if (profile.get("highSchool") or {}).get("intendedMajor")
                else "educationHistory.majorField"
            ] if field else [],
            "student_type": ["citizenshipStatus", "nationality"],
            "career": ["careerGoal", "graduate.researchArea", "researchExperience.researchAreas"],
        },
    )


def _intent(raw: dict[str, Any]) -> DiscoveryIntent | None:
    value = _text(raw.get("value"))[:200]
    dimension = _text(raw.get("dimension"))[:50]
    if not value or dimension not in {
        "opportunity_type", "field", "funding_outcome", "student_context", "career_direction"
    }:
        return None
    return DiscoveryIntent(
        id=_text(raw.get("id"))[:80] or f"{dimension}-{value.lower().replace(' ', '-')[:40]}",
        label=_text(raw.get("label") or value)[:120],
        dimension=dimension,
        value=value,
        canonical_values=[_text(item) for item in raw.get("canonical_values") or [] if _text(item)],
        derived_from=[_text(item) for item in raw.get("derived_from") or [] if _text(item)][:10],
    )


def build_discovery_context(
    profile: dict[str, Any],
    selected_intents: list[dict[str, Any]] | None = None,
    free_text: str = "",
) -> DiscoveryContext:
    canonical_profile = normalize_profile(profile)
    intents = []
    seen = set()
    for raw in (selected_intents or [])[:4]:
        parsed = _intent(raw) if isinstance(raw, dict) else None
        if not parsed:
            continue
        key = (parsed.dimension, parsed.value.lower())
        if key in seen:
            continue
        seen.add(key)
        intents.append(parsed)
    opportunity_types = [
        canonical
        for intent in intents if intent.dimension == "opportunity_type"
        for canonical in (intent.canonical_values or [intent.value])
    ]
    funding_outcomes = [
        canonical
        for intent in intents if intent.dimension == "funding_outcome"
        for canonical in (intent.canonical_values or [intent.value])
    ]
    written = _text(free_text)[:1000]
    exclusions = []
    for match in re.finditer(r"(?:without|no|exclude|excluding)\s+([^,.;]+)", written, flags=re.I):
        exclusions.append(match.group(1).strip())
    preference_text = " ".join(
        part for part in [written, *(intent.value for intent in intents)] if part
    )
    return DiscoveryContext(
        profile=canonical_profile,
        selected_intents=intents,
        free_text=written,
        preference_text=preference_text,
        opportunity_types=list(dict.fromkeys(opportunity_types)),
        funding_outcomes=list(dict.fromkeys(funding_outcomes)),
        exclusions=list(dict.fromkeys(exclusions)),
        provenance={
            "hard_constraints": ["student_profile"],
            "selected_preferences": ["selected_intents"],
            "written_preferences": ["free_text_intent"],
        },
    )


def context_dict(context: DiscoveryContext) -> dict[str, Any]:
    return model_dict(context)
