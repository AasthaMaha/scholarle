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

FIELD_ALIASES: dict[str, tuple[str, str, list[str]]] = {
    "cs": ("computer_science", "Computer Science", ["computing"]),
    "computer science": ("computer_science", "Computer Science", ["computing"]),
    "political science": ("political_science", "Political Science", ["social_sciences", "public_affairs"]),
    "public policy": ("public_policy", "Public Policy", ["social_sciences", "public_affairs"]),
    "materials science": ("materials_science", "Materials Science", ["engineering", "physical_sciences"]),
    "materials science and engineering": ("materials_science", "Materials Science", ["engineering", "physical_sciences"]),
    "materials engineering": ("materials_science", "Materials Science", ["engineering", "physical_sciences"]),
    "mse": ("materials_science", "Materials Science", ["engineering", "physical_sciences"]),
    "public health": ("public_health", "Public Health", ["health_sciences"]),
    "data science": ("data_science", "Data Science", ["computing", "mathematical_sciences"]),
}

FAMILY_PHRASES: dict[str, tuple[str, ...]] = {
    "engineering": ("engineering", "materials science", "nanotechnology", "robotics"),
    "computing": ("computer science", "computing", "software", "cybersecurity", "informatics", "artificial intelligence"),
    "physical_sciences": ("physics", "chemistry", "materials science", "geology", "astronomy"),
    "life_sciences": ("biology", "biochemistry", "ecology", "neuroscience", "genetics"),
    "health_sciences": ("health", "medicine", "medical", "nursing", "pharmacy", "epidemiology"),
    "social_sciences": ("political science", "sociology", "psychology", "economics", "anthropology"),
    "public_affairs": ("public policy", "public administration", "political science", "government"),
    "humanities": ("history", "philosophy", "literature", "languages", "religion"),
    "arts": ("art", "design", "music", "theatre", "film", "dance", "architecture"),
    "business": ("business", "finance", "accounting", "management", "marketing", "entrepreneurship"),
    "education": ("education", "teaching", "curriculum", "pedagogy"),
    "law": ("law", "legal studies", "juris doctor"),
    "agriculture": ("agriculture", "agronomy", "food science", "forestry"),
    "mathematical_sciences": ("mathematics", "statistics", "operations research", "data science"),
    "trades": ("welding", "construction", "automotive", "electrician", "plumbing", "vocational"),
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
    raw = str(value or "").strip()
    clean = normalized_text(raw)
    if not clean:
        return CanonicalField()
    known = FIELD_ALIASES.get(clean)
    if known:
        canonical_id, label, parents = known
        aliases = sorted(alias for alias, target in FIELD_ALIASES.items() if target[0] == canonical_id)
        return CanonicalField(
            raw_label=raw,
            canonical_id=canonical_id,
            canonical_label=label,
            aliases=aliases,
            parent_families=parents,
            confidence=1.0,
        )
    parents = [
        family
        for family, phrases in FAMILY_PHRASES.items()
        if any(phrase == clean or phrase in clean for phrase in phrases)
    ]
    return CanonicalField(
        raw_label=raw,
        canonical_id=slug(raw),
        canonical_label=raw,
        aliases=[raw],
        parent_families=list(dict.fromkeys(parents)),
        confidence=0.75 if parents else 0.5,
    )
