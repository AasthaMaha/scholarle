from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EducationLevel(str, Enum):
    SECONDARY = "secondary"
    CERTIFICATE = "certificate"
    ASSOCIATE = "associate"
    BACHELORS = "bachelors"
    GRADUATE = "graduate"
    MASTERS = "masters"
    PROFESSIONAL = "professional"
    DOCTORAL = "doctoral"
    POSTDOCTORAL = "postdoctoral"
    VOCATIONAL = "vocational"
    CONTINUING = "continuing_education"
    UNKNOWN = "unknown"


class StudentType(str, Enum):
    DOMESTIC = "domestic"
    INTERNATIONAL = "international"
    UNKNOWN = "unknown"


class CanonicalField(BaseModel):
    raw_label: str = ""
    canonical_id: str = ""
    canonical_label: str = ""
    aliases: list[str] = Field(default_factory=list)
    parent_families: list[str] = Field(default_factory=list)
    expanded_terms: list[str] = Field(default_factory=list)
    funder_terms: list[str] = Field(default_factory=list)
    confidence: float = 0.0


class CanonicalEducation(BaseModel):
    current_level: EducationLevel = EducationLevel.UNKNOWN
    target_level: EducationLevel = EducationLevel.UNKNOWN
    institution: str = ""
    raw_level: str = ""


class CanonicalProfile(BaseModel):
    education: CanonicalEducation = Field(default_factory=CanonicalEducation)
    field: CanonicalField = Field(default_factory=CanonicalField)
    student_type: StudentType = StudentType.UNKNOWN
    current_country: str = ""
    citizenship_status: str = ""
    gender: str = "unknown"
    race_ethnicity: str = "unknown"
    identity_context: list[str] = Field(default_factory=list)
    enrollment_statuses: list[str] = Field(default_factory=list)
    first_generation: bool = False
    current_gpa: float | None = None
    career_goal: str = ""
    research_topics: list[str] = Field(default_factory=list)
    opportunity_preferences: list[str] = Field(default_factory=list)
    financial_need: bool = False
    provenance: dict[str, list[str]] = Field(default_factory=dict)


class DiscoveryIntent(BaseModel):
    id: str
    label: str
    dimension: str
    value: str
    canonical_values: list[str] = Field(default_factory=list)
    derived_from: list[str] = Field(default_factory=list)


class DiscoveryContext(BaseModel):
    profile: CanonicalProfile
    selected_intents: list[DiscoveryIntent] = Field(default_factory=list)
    free_text: str = ""
    preference_text: str = ""
    opportunity_types: list[str] = Field(default_factory=list)
    funding_outcomes: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    provenance: dict[str, list[str]] = Field(default_factory=dict)


class CompatibilityAssessment(BaseModel):
    compatible: bool = True
    hard_contradictions: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    field_match: str = "unknown"
    field_score: float = 0.0
    level_match: str = "unknown"
    student_type_match: str = "unknown"
    gender_match: str = "unknown"
    race_ethnicity_match: str = "unknown"
    identity_match: str = "unknown"
    financial_need_match: str = "unknown"
    enrollment_status_match: str = "unknown"
    gpa_match: str = "unknown"


class CandidateEvidence(BaseModel):
    origin: str = ""
    retrieval_query: str = ""
    page_snippet: str = ""
    fetched: bool = False
    asserted_fields: list[str] = Field(default_factory=list)
    asserted_levels: list[str] = Field(default_factory=list)
    asserted_student_types: list[str] = Field(default_factory=list)
    asserted_opportunity_types: list[str] = Field(default_factory=list)
    asserted_eligibility_constraints: dict[str, Any] = Field(default_factory=dict)
    evidence_quality: float = 0.0
    attribute_provenance: dict[str, str] = Field(default_factory=dict)


def model_dict(value: BaseModel | dict[str, Any]) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return value.model_dump() if hasattr(value, "model_dump") else value.dict()
