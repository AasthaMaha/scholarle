from __future__ import annotations

from typing import Any

from .schemas import CompatibilityAssessment, DiscoveryContext, EducationLevel, StudentType, model_dict
from .taxonomy import normalize_level, normalize_student_type, normalized_text
from .eligibility import candidate_eligibility_constraints


LEVEL_COMPATIBILITY: dict[EducationLevel, set[EducationLevel]] = {
    EducationLevel.SECONDARY: {EducationLevel.SECONDARY},
    EducationLevel.CERTIFICATE: {EducationLevel.CERTIFICATE, EducationLevel.CONTINUING},
    EducationLevel.ASSOCIATE: {EducationLevel.ASSOCIATE, EducationLevel.BACHELORS},
    EducationLevel.BACHELORS: {EducationLevel.BACHELORS},
    EducationLevel.GRADUATE: {EducationLevel.GRADUATE, EducationLevel.MASTERS, EducationLevel.DOCTORAL},
    EducationLevel.MASTERS: {EducationLevel.MASTERS, EducationLevel.GRADUATE},
    EducationLevel.PROFESSIONAL: {EducationLevel.PROFESSIONAL, EducationLevel.GRADUATE},
    EducationLevel.DOCTORAL: {EducationLevel.DOCTORAL, EducationLevel.GRADUATE},
    EducationLevel.POSTDOCTORAL: {EducationLevel.POSTDOCTORAL},
    EducationLevel.VOCATIONAL: {EducationLevel.VOCATIONAL, EducationLevel.CERTIFICATE},
    EducationLevel.CONTINUING: {EducationLevel.CONTINUING, EducationLevel.CERTIFICATE},
}


GENERIC_FIELD_TOKENS = {"science", "sciences", "studies", "study", "technology", "research", "general", "and", "the"}

STEM_TERMS = {
    "engineering", "science", "sciences", "technology", "mathematics", "math",
    "computing", "computer", "physics", "chemistry", "biology", "materials",
    "data", "statistics", "health", "medicine", "agriculture", "robotics",
}


def _field_terms(values: list[str]) -> set[str]:
    terms: set[str] = set()
    for value in values:
        terms |= set(normalized_text(value).split())
    return {term for term in terms if len(term) > 2}


def compatible_levels(student: EducationLevel, supported: set[EducationLevel]) -> bool:
    if student == EducationLevel.UNKNOWN or not supported or supported == {EducationLevel.UNKNOWN}:
        return True
    accepted = LEVEL_COMPATIBILITY.get(student, {student})
    return bool(accepted & supported)


def assess_candidate(candidate: dict[str, Any], context: DiscoveryContext) -> CompatibilityAssessment:
    profile = context.profile
    contradictions = []
    unknowns = []
    supported_levels = {
        level for value in candidate.get("degree_levels") or []
        if (level := normalize_level(str(value))) != EducationLevel.UNKNOWN
    }
    if supported_levels:
        if not compatible_levels(profile.education.current_level, supported_levels):
            contradictions.append("education_level")
            level_match = "incompatible"
        else:
            level_match = "compatible"
    else:
        level_match = "unknown"
        unknowns.append("education_level")

    supported_types = {
        student_type for value in candidate.get("student_types") or []
        if (student_type := normalize_student_type(str(value))) != StudentType.UNKNOWN
    }
    if supported_types and profile.student_type != StudentType.UNKNOWN:
        if profile.student_type not in supported_types:
            contradictions.append("student_type")
            student_type_match = "incompatible"
        else:
            student_type_match = "compatible"
    else:
        student_type_match = "unknown"
        unknowns.append("student_type")

    eligibility = candidate_eligibility_constraints(candidate)
    eligible_genders = set(eligibility["eligible_genders"])
    if eligible_genders:
        if profile.gender in eligible_genders:
            gender_match = "compatible"
        elif profile.gender in {"male", "female"}:
            contradictions.append("gender")
            gender_match = "incompatible"
        else:
            gender_match = "unknown"
            unknowns.append("gender")
    else:
        gender_match = "not_restricted"

    required_races = set(eligibility["race_ethnicity_requirements"])
    if required_races:
        if profile.race_ethnicity in required_races:
            race_ethnicity_match = "compatible"
        elif profile.race_ethnicity not in {"unknown", "multiracial"}:
            contradictions.append("race_ethnicity")
            race_ethnicity_match = "incompatible"
        else:
            race_ethnicity_match = "unknown"
            unknowns.append("race_ethnicity")
    else:
        race_ethnicity_match = "not_restricted"

    required_identities = set(eligibility["identity_requirements"])
    known_identities = set(profile.identity_context)
    missing_identities = required_identities - known_identities
    if required_identities and not missing_identities:
        identity_match = "compatible"
    elif required_identities:
        identity_match = "unknown"
        unknowns.extend(f"identity:{value}" for value in sorted(missing_identities))
    else:
        identity_match = "not_restricted"

    need_required = bool(eligibility["financial_need_required"])
    if need_required and profile.financial_need:
        financial_need_match = "compatible"
    elif need_required:
        financial_need_match = "unknown"
        unknowns.append("financial_need")
    else:
        financial_need_match = "not_restricted"

    if eligibility["first_generation_required"] and profile.first_generation:
        identity_match = "compatible" if identity_match == "not_restricted" else identity_match
    elif eligibility["first_generation_required"]:
        if identity_match == "not_restricted":
            identity_match = "unknown"
        unknowns.append("first_generation")

    supported_enrollment = set(eligibility["enrollment_statuses"])
    known_enrollment = set(profile.enrollment_statuses)
    if supported_enrollment and known_enrollment:
        if supported_enrollment & known_enrollment:
            enrollment_status_match = "compatible"
        else:
            contradictions.append("enrollment_status")
            enrollment_status_match = "incompatible"
    elif supported_enrollment:
        enrollment_status_match = "unknown"
        unknowns.append("enrollment_status")
    else:
        enrollment_status_match = "not_restricted"

    minimum_gpa = eligibility["minimum_gpa"]
    if minimum_gpa is not None and profile.current_gpa is not None:
        if profile.current_gpa + 1e-9 < float(minimum_gpa):
            contradictions.append("minimum_gpa")
            gpa_match = "incompatible"
        else:
            gpa_match = "compatible"
    elif minimum_gpa is not None:
        gpa_match = "unknown"
        unknowns.append("gpa")
    else:
        gpa_match = "not_restricted"

    # Field relevance is advisory: the LLM ranker judges it semantically, so a
    # mismatch here lowers the score but never hard-rejects a candidate. Hard
    # gates remain the true eligibility constraints: level, student type, and
    # explicit exclusions.
    raw_fields = [str(value) for value in candidate.get("fields") or [] if str(value).strip()]
    field_labels = {normalized_text(value) for value in raw_fields}
    general = bool(field_labels & {"general", "all fields", "any field"})
    stem = "stem" in field_labels
    profile_labels = {
        normalized_text(value)
        for value in [
            profile.field.canonical_label,
            profile.field.raw_label,
            *profile.field.aliases,
            *profile.field.expanded_terms,
        ]
        if normalized_text(value)
    }
    profile_terms = _field_terms([
        *profile_labels,
        *profile.field.parent_families,
        *profile.field.funder_terms,
    ])
    candidate_terms = _field_terms(raw_fields)
    if not profile.field.canonical_id or not raw_fields:
        field_match, field_score = "unknown", 0.0
        unknowns.append("field")
    elif general:
        field_match, field_score = "broad", 0.65
    elif field_labels & profile_labels:
        field_match, field_score = "exact", 1.0
    elif stem and profile_terms & STEM_TERMS:
        field_match, field_score = "broad_family", 0.75
    elif (profile_terms & candidate_terms) - GENERIC_FIELD_TOKENS:
        field_match, field_score = "related_terms", 0.6
    else:
        field_match, field_score = "unrelated", 0.0

    candidate_text = normalized_text(" ".join([
        str(candidate.get("name") or ""),
        str(candidate.get("category") or ""),
        " ".join(candidate.get("best_for") or []),
        str(candidate.get("status_note") or ""),
        str(candidate.get("snippet") or ""),
    ]))
    candidate_terms = set(candidate_text.split())
    for exclusion in context.exclusions:
        exclusion_terms = {
            term for term in normalized_text(exclusion).split()
            if term not in {"the", "and", "with", "requirement", "required"}
        }
        if exclusion_terms and exclusion_terms <= candidate_terms:
            contradictions.append("excluded_requirement")
            break

    return CompatibilityAssessment(
        compatible=not contradictions,
        hard_contradictions=list(dict.fromkeys(contradictions)),
        unknowns=list(dict.fromkeys(unknowns)),
        field_match=field_match,
        field_score=field_score,
        level_match=level_match,
        student_type_match=student_type_match,
        gender_match=gender_match,
        race_ethnicity_match=race_ethnicity_match,
        identity_match=identity_match,
        financial_need_match=financial_need_match,
        enrollment_status_match=enrollment_status_match,
        gpa_match=gpa_match,
    )


def assessment_dict(candidate: dict[str, Any], context: DiscoveryContext) -> dict[str, Any]:
    return model_dict(assess_candidate(candidate, context))
