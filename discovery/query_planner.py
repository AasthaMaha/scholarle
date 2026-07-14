from __future__ import annotations

from .schemas import DiscoveryContext


def plan_queries(context: DiscoveryContext, limit: int = 8) -> list[str]:
    profile = context.profile
    level = profile.education.current_level.value if profile.education.current_level.value != "unknown" else "student"
    field_terms = [profile.field.raw_label, *profile.field.aliases]
    field_terms = list(dict.fromkeys(term for term in field_terms if term)) or ["general"]
    opportunity = " ".join(context.opportunity_types) or "scholarship fellowship"
    written = context.free_text
    intent = context.preference_text
    queries = []

    def add(value: str) -> None:
        value = " ".join(value.split())
        if value and value.lower() not in {item.lower() for item in queries}:
            queries.append(value)

    if written:
        add(f"{level} {written} {opportunity} official")
    for field in field_terms[:2]:
        add(f"{level} {field} {opportunity} official")
        add(f"{field} {intent or opportunity} funding")
    for topic in profile.research_topics[:1]:
        add(f"{level} {topic} research funding official")
    add(f"{level} {field_terms[0]} scholarship fellowship database")
    if profile.student_type.value != "unknown":
        add(f"{profile.student_type.value} {level} {field_terms[0]} funding opportunities")
    return queries[:limit]
