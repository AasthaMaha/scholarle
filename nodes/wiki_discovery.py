from __future__ import annotations

import re
from typing import Any


def _text(value: Any) -> str:
    return str(value or "").strip()


def _list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _profile_blob(profile: dict[str, Any]) -> str:
    return " ".join([str(profile), str(profile.get("profile_text", ""))]).lower()


def _education_label(profile: dict[str, Any]) -> str:
    raw = _text(profile.get("educationLevel") or profile.get("education_level"))
    grad = profile.get("graduate") or {}
    if raw == "phd" or str(grad.get("graduateLevel", "")).lower() == "phd":
        return "PhD"
    if raw == "grad":
        return "Graduate"
    if raw == "undergrad":
        return "Undergraduate"
    if raw == "high_school":
        return "High school"
    return ""


def _field(profile: dict[str, Any]) -> str:
    high = profile.get("highSchool") or {}
    undergrad = profile.get("undergrad") or {}
    graduate = profile.get("graduate") or {}
    return (
        _text(graduate.get("researchArea"))
        or _text(graduate.get("program"))
        or _text(graduate.get("department"))
        or _text(undergrad.get("major"))
        or _text(high.get("intendedMajor"))
        or _text(profile.get("careerGoal"))
    )


def _university(profile: dict[str, Any]) -> str:
    undergrad = profile.get("undergrad") or {}
    graduate = profile.get("graduate") or {}
    return _text(graduate.get("institution") or undergrad.get("institution"))


def _opportunity_types(profile: dict[str, Any]) -> list[str]:
    values = []
    for branch in ("highSchool", "undergrad", "graduate"):
        values.extend(_list((profile.get(branch) or {}).get("needsHelpWith")))
    blob = _profile_blob(profile)
    if "travel" in blob:
        values.append("Travel grant")
    if "research" in blob:
        values.append("Research funding")
    if "workshop" in blob or "summer school" in blob:
        values.append("Workshop")
    values.extend(["Scholarship", "Fellowship"])
    return _dedupe(values)[:8]


def _student_type(profile: dict[str, Any]) -> str:
    status = _text(profile.get("citizenshipStatus") or profile.get("nationality"))
    text = status.lower()
    if any(token in text for token in ["international", "student visa", "f-1", "j-1", "h-4", "tn"]):
        return "International student"
    if any(token in text for token in ["u.s. citizen", "us citizen", "american", "citizen", "permanent resident", "green card", "domestic"]):
        return "Domestic student"
    if status:
        return status
    return ""


def _profile_student_kind(profile: dict[str, Any]) -> str:
    student_type = _student_type(profile).lower()
    if "international" in student_type:
        return "International"
    if "domestic" in student_type or "citizen" in student_type or "permanent resident" in student_type:
        return "Domestic"
    return ""


def _source_allows_student_kind(source: dict[str, Any], profile: dict[str, Any]) -> bool:
    kind = _profile_student_kind(profile)
    if not kind:
        return True
    allowed = {str(item).strip().lower() for item in source.get("student_types", [])}
    return kind.lower() in allowed


def _current_country(profile: dict[str, Any]) -> str:
    location = _text(profile.get("location"))
    if re.search(r"\b(us|usa|united states|rice|houston|texas)\b", location.lower()):
        return "United States"
    return location


def _summary(profile: dict[str, Any]) -> dict[str, Any]:
    summary = {
        "degree_level": _education_label(profile),
        "field_of_study": _field(profile),
        "student_type": _student_type(profile),
        "current_country": _current_country(profile),
        "university": _university(profile),
        "opportunity_types": _opportunity_types(profile),
    }
    return {key: value for key, value in summary.items() if value}


def _dedupe(items: list[str]) -> list[str]:
    result = []
    seen = set()
    for item in items:
        clean = str(item or "").strip()
        key = clean.lower()
        if clean and key not in seen:
            result.append(clean)
            seen.add(key)
    return result


def _tokens(*values: Any) -> set[str]:
    words = re.findall(r"[a-z0-9]+", " ".join(str(value or "") for value in values).lower())
    aliases = set(words)
    if "phd" in aliases or "doctoral" in aliases:
        aliases.add("graduate")
    if "computer" in aliases or "computational" in aliases or "engineering" in aliases:
        aliases.add("stem")
    if "optimization" in aliases or "operations" in aliases or "analytics" in aliases:
        aliases.update({"operations research", "data science", "stem"})
    return aliases


def _score_source(source: dict[str, Any], profile: dict[str, Any], wanted_kind: str) -> int:
    if source.get("kind") != wanted_kind:
        return -999
    if not _source_allows_student_kind(source, profile):
        return -999
    summary = _summary(profile)
    degree = summary.get("degree_level", "")
    student_type = summary.get("student_type", "")
    country = summary.get("current_country", "")
    field = summary.get("field_of_study", "")
    opportunities = summary.get("opportunity_types", [])

    score = 0
    if degree and any(degree.lower() in item.lower() for item in source.get("degree_levels", [])):
        score += 25
    profile_kind = _profile_student_kind(profile)
    if profile_kind and profile_kind in source.get("student_types", []):
        score += 25
    if field:
        profile_tokens = _tokens(field)
        source_tokens = _tokens(source.get("fields", []), source.get("best_for", []), source.get("category", ""))
        if profile_tokens & source_tokens or "General" in source.get("fields", []):
            score += 20 if profile_tokens & source_tokens else 8
    if opportunities:
        source_ops = {item.lower() for item in source.get("opportunity_types", [])}
        if any(item.lower() in source_ops for item in opportunities):
            score += 15
    if country and any(country.lower() in item.lower() or item == "Global" for item in source.get("regions", [])):
        score += 10
    if "free" in str(source.get("cost", "")).lower():
        score += 5
    if source.get("category") in {"University funding pages", "Professional society awards"} and degree in {"Graduate", "PhD"}:
        score += 8
    return score


def _with_score(source: dict[str, Any], score: int) -> dict[str, Any]:
    return {
        "name": source.get("name", ""),
        "url": source.get("url", ""),
        "category": source.get("category", ""),
        "cost": source.get("cost", ""),
        "best_for": source.get("best_for", []),
        "search_tips": source.get("search_tips", []),
        "status_note": source.get("status_note", ""),
        "score": score,
    }


def extract_platform_recommendations(state):
    profile = state.get("student_profile") or {}
    scored = []
    for source in state.get("source_library", []):
        score = _score_source(source, profile, "platform")
        if score >= 20:
            scored.append(_with_score(source, score))
    scored.sort(key=lambda item: item["score"], reverse=True)
    return {"platform_sources": scored[:8]}


def extract_specific_opportunity_sources(state):
    profile = state.get("student_profile") or {}
    scored = []
    for source in state.get("source_library", []):
        score = _score_source(source, profile, "specific_source")
        if score >= 22:
            scored.append(_with_score(source, score))
    scored.sort(key=lambda item: item["score"], reverse=True)
    return {"specific_sources": scored[:8]}


def _priority(score: int) -> str:
    if score >= 65:
        return "High"
    if score >= 40:
        return "Medium"
    return "Low"


def _query_parts(profile: dict[str, Any]) -> dict[str, str]:
    summary = _summary(profile)
    return {
        "degree": summary.get("degree_level", "student"),
        "field": summary.get("field_of_study", "your field"),
        "student_type": summary.get("student_type", ""),
        "country": summary.get("current_country", ""),
        "university": summary.get("university", ""),
    }


def _source_queries(source: dict[str, Any], profile: dict[str, Any]) -> list[str]:
    parts = _query_parts(profile)
    base = []
    if parts["field"]:
        base.append(f"{source['name']} {parts['field']} funding")
    if parts["degree"]:
        base.append(f"{parts['degree']} {source['category']} {parts['field']}")
    if "travel" in " ".join(source.get("best_for", [])).lower():
        base.append(f"{parts['field']} graduate student travel grant")
    return _dedupe(base)[:3]


def _group_sources(sources: list[dict[str, Any]], profile: dict[str, Any]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for source in sources:
        grouped.setdefault(source["category"], []).append(source)
    result = []
    for category, items in grouped.items():
        top_score = max(item.get("score", 0) for item in items)
        rendered = []
        for item in items[:3]:
            rendered.append({
                "name": item["name"],
                "url": item["url"],
                "category": item["category"],
                "cost": item["cost"],
                "best_for": item.get("best_for", []),
                "why_recommended": _why(item, profile),
                "search_tips": item.get("search_tips", [])[:3],
                "suggested_queries": _source_queries(item, profile),
            })
        result.append({
            "group_name": category,
            "match_reason": _group_reason(category, profile),
            "priority": _priority(top_score),
            "sources": rendered,
        })
    return sorted(result, key=lambda item: {"High": 0, "Medium": 1, "Low": 2}[item["priority"]])


def _why(source: dict[str, Any], profile: dict[str, Any]) -> str:
    summary = _summary(profile)
    field = summary.get("field_of_study")
    degree = summary.get("degree_level")
    if field and degree:
        return f"Matches {degree} level discovery needs and has useful coverage for {field} or adjacent fields."
    if degree:
        return f"Useful for {degree} level scholarship and funding discovery."
    return "Useful as a trusted starting point for scholarship discovery."


def _group_reason(category: str, profile: dict[str, Any]) -> str:
    summary = _summary(profile)
    if "International" in category or "international" in summary.get("student_type", "").lower():
        return "Prioritized because the profile may need international-student friendly funding sources."
    if "Graduate" in category or "PhD" in category or summary.get("degree_level") in {"Graduate", "PhD"}:
        return "Prioritized because the profile points to graduate-level funding, research, or fellowship needs."
    if "Professional" in category:
        return "Prioritized because field-specific societies often list awards, travel support, and research opportunities."
    return "Recommended as a trusted source category for finding opportunities."


def _funding_categories(profile: dict[str, Any]) -> list[dict[str, Any]]:
    parts = _query_parts(profile)
    field = parts["field"]
    degree = parts["degree"]
    return [
        {
            "category_name": "General scholarship platforms",
            "description": "Large free directories that help build an initial list of scholarships and grants.",
            "best_for": ["Broad discovery", "Students comparing many options"],
            "example_source_types": ["Search platforms", "College planning portals"],
            "suggested_queries": [f"{degree} scholarships {field}", f"free scholarship search {field}"],
        },
        {
            "category_name": "International student databases",
            "description": "Sources that focus on funding across borders and study-abroad contexts.",
            "best_for": ["International students", "Global funding searches"],
            "example_source_types": ["International scholarship databases", "Study abroad funding portals"],
            "suggested_queries": [f"international {degree} scholarships {field}", f"{field} funding for international students"],
        },
        {
            "category_name": "Graduate and PhD fellowships",
            "description": "Funding for advanced study, research, dissertation work, and professional development.",
            "best_for": ["Graduate students", "PhD students", "Research-focused applicants"],
            "example_source_types": ["Fellowship databases", "Foundation awards", "Graduate school funding pages"],
            "suggested_queries": [f"{degree} fellowships {field}", f"dissertation fellowship {field}"],
        },
        {
            "category_name": "Professional society awards",
            "description": "Awards and travel support from academic or professional organizations.",
            "best_for": ["Field-specific awards", "Conference presenters", "Research students"],
            "example_source_types": ["Society award pages", "Conference student travel grants"],
            "suggested_queries": [f"{field} professional society student award", f"{field} conference travel grant"],
        },
        {
            "category_name": "Research workshops and summer schools",
            "description": "Training programs and workshops that may offer scholarships, fee waivers, or travel support.",
            "best_for": ["Skill building", "Research networking", "Summer training"],
            "example_source_types": ["Workshop pages", "Summer school funding pages"],
            "suggested_queries": [f"{field} summer school scholarship", f"{field} workshop travel support"],
        },
    ]


def _personalized_queries(profile: dict[str, Any]) -> list[str]:
    parts = _query_parts(profile)
    degree = parts["degree"]
    field = parts["field"]
    student_type = parts["student_type"]
    country = parts["country"]
    queries = [
        f"{degree} scholarships {field}",
        f"{degree} fellowships {field}",
        f"travel grants for {degree} students in {field}",
        f"research workshops in {field} for graduate students",
        f"professional society awards {field} students",
        f"university graduate funding {field}",
    ]
    if student_type:
        queries.insert(0, f"{degree} scholarships for {student_type.lower()}s in {field}")
    if country:
        queries.append(f"{degree} funding {field} {country}")
    return _dedupe(queries)[:12]


def _missing_fields(summary: dict[str, Any]) -> list[str]:
    needed = {
        "degree_level": "Degree level",
        "field_of_study": "Field of study",
        "student_type": "Citizenship or student type",
        "current_country": "Current country or region",
        "opportunity_types": "Opportunity types",
    }
    return [label for key, label in needed.items() if not summary.get(key)]


def clean_wiki_discovery_output(state):
    profile = state.get("student_profile") or {}
    summary = _summary(profile)
    platforms = state.get("platform_sources") or []
    specifics = state.get("specific_sources") or []
    all_sources = platforms + specifics
    top_free = [
        {
            "name": item["name"],
            "url": item["url"],
            "category": item["category"],
            "best_for": item.get("best_for", []),
            "search_tips": item.get("search_tips", [])[:3],
        }
        for item in platforms
        if "free" in item.get("cost", "").lower()
    ][:6]
    specific_output = [
        {
            "name": item["name"],
            "url": item["url"],
            "category": item["category"],
            "cost": item.get("cost", ""),
            "best_for": item.get("best_for", []),
            "status_note": item.get("status_note") or "Verify current status on the official source page.",
            "search_tips": item.get("search_tips", [])[:3],
            "suggested_queries": _source_queries(item, profile),
        }
        for item in specifics
    ]
    return {
        "page_title": "Scholarship Discovery Wiki",
        "profile_summary": summary,
        "recommended_source_groups": _group_sources(all_sources, profile),
        "top_free_platforms": top_free,
        "specific_opportunities": specific_output,
        "funding_categories": _funding_categories(profile),
        "personalized_search_queries": _personalized_queries(profile),
        "next_steps": [
            "Open two high-priority source groups and search with the personalized queries.",
            "Save useful platform or award pages to the Wiki.",
            "When you find a specific scholarship page, send it to the requirement extractor.",
            "Add missing profile details to improve recommendations.",
        ],
        "missing_profile_fields": _missing_fields(summary),
    }
