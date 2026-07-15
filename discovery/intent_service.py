from __future__ import annotations

from typing import Any

from .normalization import normalize_profile
from .schemas import DiscoveryIntent, EducationLevel, StudentType, model_dict


STAGE_INTENTS: dict[EducationLevel, tuple[str, str, list[str]]] = {
    EducationLevel.SECONDARY: ("College scholarships", "college scholarship", ["scholarship"]),
    EducationLevel.ASSOCIATE: ("Transfer scholarships", "associate and transfer scholarship", ["scholarship"]),
    EducationLevel.BACHELORS: ("Undergraduate scholarships", "undergraduate scholarship", ["scholarship"]),
    EducationLevel.GRADUATE: ("Graduate fellowships", "graduate fellowship", ["fellowship"]),
    EducationLevel.MASTERS: ("Master’s funding", "masters scholarship and fellowship", ["scholarship", "fellowship"]),
    EducationLevel.PROFESSIONAL: ("Professional degree funding", "professional degree scholarship", ["scholarship"]),
    EducationLevel.DOCTORAL: ("Doctoral fellowships", "doctoral research fellowship", ["fellowship", "research_grant"]),
    EducationLevel.POSTDOCTORAL: ("Postdoctoral funding", "postdoctoral fellowship", ["fellowship", "research_grant"]),
    EducationLevel.VOCATIONAL: ("Trade and training grants", "vocational training grant", ["grant"]),
    EducationLevel.CERTIFICATE: ("Certificate funding", "certificate program funding", ["grant", "scholarship"]),
    EducationLevel.CONTINUING: ("Professional development", "continuing education funding", ["professional_development"]),
}


FUNDING_INTENTS: dict[EducationLevel, tuple[str, str, list[str]]] = {
    EducationLevel.SECONDARY: ("Tuition scholarships", "tuition scholarship", ["tuition_support"]),
    EducationLevel.BACHELORS: ("Tuition support", "tuition and education cost support", ["tuition_support"]),
    EducationLevel.GRADUATE: ("Tuition & stipend", "graduate tuition and stipend funding", ["tuition_waiver", "stipend"]),
    EducationLevel.MASTERS: ("Tuition & stipend", "masters tuition and stipend funding", ["tuition_waiver", "stipend"]),
    EducationLevel.DOCTORAL: ("Research stipend", "doctoral research stipend and tuition", ["stipend", "tuition_waiver"]),
    EducationLevel.POSTDOCTORAL: ("Research salary support", "postdoctoral research salary funding", ["stipend"]),
}


def _short(value: str, suffix: str = "") -> str:
    clean = " ".join(str(value or "").replace("_", " ").split())
    available = max(12, 38 - len(suffix))
    return f"{clean[:available].rstrip()}{'…' if len(clean) > available else ''}{suffix}"


def generate_intent_options(raw_profile: dict[str, Any], limit: int = 4) -> list[dict[str, Any]]:
    profile = normalize_profile(raw_profile)
    result: list[DiscoveryIntent] = []
    seen = set()

    def add(intent: DiscoveryIntent) -> None:
        key = (intent.dimension, tuple(intent.canonical_values or [intent.value]))
        if key not in seen and len(result) < limit:
            seen.add(key)
            result.append(intent)

    for preference in profile.opportunity_preferences[:1]:
        add(DiscoveryIntent(
            id="profile-preference",
            label=_short(preference),
            dimension="opportunity_type",
            value=preference,
            canonical_values=[preference.lower().replace(" ", "_")],
            derived_from=["opportunityPreferences"],
        ))

    if profile.education.current_level in STAGE_INTENTS:
        label, value, canonical = STAGE_INTENTS[profile.education.current_level]
        add(DiscoveryIntent(
            id="education-stage",
            label=label,
            dimension="opportunity_type",
            value=value,
            canonical_values=canonical,
            derived_from=profile.provenance.get("education", ["educationLevel"]),
        ))

    if profile.field.raw_label:
        add(DiscoveryIntent(
            id="field-funding",
            label=_short(profile.field.canonical_label, " funding"),
            dimension="field",
            value=profile.field.raw_label,
            canonical_values=[profile.field.canonical_id],
            derived_from=profile.provenance.get("field", ["education field"]),
        ))

    if profile.student_type == StudentType.INTERNATIONAL:
        add(DiscoveryIntent(
            id="international-funding",
            label="International student funding",
            dimension="student_context",
            value="international student funding",
            canonical_values=["international"],
            derived_from=["citizenshipStatus"],
        ))
    elif profile.financial_need:
        add(DiscoveryIntent(
            id="need-based-funding",
            label="Need-based funding",
            dimension="funding_outcome",
            value="need-based tuition funding",
            canonical_values=["need_based", "tuition_support"],
            derived_from=["pellEligible"],
        ))
    elif profile.research_topics:
        add(DiscoveryIntent(
            id="research-direction",
            label=_short(profile.research_topics[0], " research"),
            dimension="career_direction",
            value=profile.research_topics[0],
            canonical_values=[],
            derived_from=["researchExperience", "graduate.researchArea"],
        ))

    if len(result) < limit and profile.education.current_level in FUNDING_INTENTS:
        label, value, canonical = FUNDING_INTENTS[profile.education.current_level]
        add(DiscoveryIntent(
            id="funding-outcome",
            label=label,
            dimension="funding_outcome",
            value=value,
            canonical_values=canonical,
            derived_from=["educationLevel"],
        ))

    return [model_dict(intent) for intent in result[:limit]]
