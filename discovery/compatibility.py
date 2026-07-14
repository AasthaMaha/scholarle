from __future__ import annotations

from typing import Any

from .schemas import CompatibilityAssessment, DiscoveryContext, EducationLevel, StudentType, model_dict
from .taxonomy import normalize_field, normalize_level, normalize_student_type, normalized_text


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

    raw_fields = [str(value) for value in candidate.get("fields") or [] if str(value).strip()]
    normalized_fields = [normalize_field(value) for value in raw_fields]
    field_labels = {normalized_text(value) for value in raw_fields}
    general = bool(field_labels & {"general", "all fields", "any field"})
    stem = "stem" in field_labels
    stem_families = {
        "engineering", "computing", "physical_sciences", "life_sciences",
        "health_sciences", "mathematical_sciences", "agriculture",
    }
    if not profile.field.canonical_id or not raw_fields:
        field_match, field_score = "unknown", 0.0
        unknowns.append("field")
    elif general:
        field_match, field_score = "broad", 0.65
    elif stem and set(profile.field.parent_families) & stem_families:
        field_match, field_score = "broad_family", 0.75
    elif any(item.canonical_id == profile.field.canonical_id for item in normalized_fields):
        field_match, field_score = "exact", 1.0
    elif any(set(item.parent_families) & set(profile.field.parent_families) for item in normalized_fields):
        field_match, field_score = "related_family", 0.55
    else:
        # Field mismatch is a hard contradiction only for an explicitly restricted source.
        field_policy = str(candidate.get("field_policy") or "restricted" if candidate.get("origin") == "library" else "unknown")
        field_match, field_score = "unrelated", 0.0
        if field_policy == "restricted":
            contradictions.append("field")

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
    )


def assessment_dict(candidate: dict[str, Any], context: DiscoveryContext) -> dict[str, Any]:
    return model_dict(assess_candidate(candidate, context))
