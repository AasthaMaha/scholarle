from __future__ import annotations

import re
import unicodedata

from .schemas import CanonicalField, EducationLevel, StudentType


LEVEL_ALIASES: dict[str, EducationLevel] = {
    "high school": EducationLevel.SECONDARY,
    "secondary": EducationLevel.SECONDARY,
    "high_school": EducationLevel.SECONDARY,
    "certificate": EducationLevel.CERTIFICATE,
    "associate": EducationLevel.ASSOCIATE,
    "associate degree": EducationLevel.ASSOCIATE,
    "undergrad": EducationLevel.BACHELORS,
    "undergraduate": EducationLevel.BACHELORS,
    "bachelor": EducationLevel.BACHELORS,
    "bachelors": EducationLevel.BACHELORS,
    "bachelor's degree": EducationLevel.BACHELORS,
    "graduate": EducationLevel.GRADUATE,
    "grad": EducationLevel.GRADUATE,
    "master": EducationLevel.MASTERS,
    "masters": EducationLevel.MASTERS,
    "master's degree": EducationLevel.MASTERS,
    "professional": EducationLevel.PROFESSIONAL,
    "professional degree": EducationLevel.PROFESSIONAL,
    "doctoral": EducationLevel.DOCTORAL,
    "doctoral degree": EducationLevel.DOCTORAL,
    "doctorate": EducationLevel.DOCTORAL,
    "phd": EducationLevel.DOCTORAL,
    "postdoctoral": EducationLevel.POSTDOCTORAL,
    "postdoc": EducationLevel.POSTDOCTORAL,
    "vocational": EducationLevel.VOCATIONAL,
    "trade": EducationLevel.VOCATIONAL,
    "continuing education": EducationLevel.CONTINUING,
}


def normalized_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def slug(value: str) -> str:
    return normalized_text(value).replace(" ", "_")


def normalize_level(value: str) -> EducationLevel:
    clean = normalized_text(value)
    if clean in LEVEL_ALIASES:
        return LEVEL_ALIASES[clean]
    # Exact word/phrase rules avoid the graduate/undergraduate substring bug.
    if re.search(r"\bph\.?d\.?\b|\bdoctor", clean):
        return EducationLevel.DOCTORAL
    if re.search(r"\bmaster", clean):
        return EducationLevel.MASTERS
    if re.search(r"\bbachelor|\bundergraduate\b|\bundergrad\b", clean):
        return EducationLevel.BACHELORS
    if re.search(r"\bassociate\b", clean):
        return EducationLevel.ASSOCIATE
    if re.search(r"\bhigh school\b|\bsecondary\b", clean):
        return EducationLevel.SECONDARY
    return EducationLevel.UNKNOWN


def normalize_student_type(value: str) -> StudentType:
    clean = normalized_text(value)
    if any(term in clean for term in ("international", "visa", "nonresident", "f 1", "j 1")):
        return StudentType.INTERNATIONAL
    if any(term in clean for term in ("u s citizen", "us citizen", "permanent resident", "domestic", "green card", "refugee", "asylee")):
        return StudentType.DOMESTIC
    return StudentType.UNKNOWN


def normalize_field(value: str) -> CanonicalField:
    """Preserve the student's exact field; semantic expansion is added later by
    the LLM profile interpreter (see nodes.wiki_discovery.interpret_profile)."""
    raw = str(value or "").strip()
    clean = normalized_text(raw)
    if not clean:
        return CanonicalField()
    return CanonicalField(
        raw_label=raw,
        canonical_id=slug(raw),
        canonical_label=raw,
        aliases=[raw],
        parent_families=[],
        confidence=0.6,
    )
