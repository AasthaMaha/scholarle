from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen

from pydantic import BaseModel, Field

from discovery.compatibility import assess_candidate, assessment_dict
from discovery.evidence import candidate_evidence
from discovery.normalization import build_discovery_context, context_dict
from discovery.query_planner import plan_queries
from discovery.ranking import score_candidate
from discovery.schemas import DiscoveryContext, model_dict
from llm.client import llm

STATUS_PATH = Path(__file__).resolve().parent.parent / "data" / "scholarship_source_status.json"
ALLOWED_STATUSES = {"active", "seasonal", "unknown", "expired", "removed"}
STALE_DAYS = 120


def _model_dump(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.dict()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_status_store() -> dict[str, Any]:
    try:
        if STATUS_PATH.exists():
            return json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_status_store(store: dict[str, Any]) -> None:
    try:
        STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATUS_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _status_key(item: dict[str, Any]) -> str:
    return _text(item.get("url") or item.get("name")).lower()


def _enrich_library_item(item: dict[str, Any], status_store: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(item)
    key = _status_key(enriched)
    saved = status_store.get(key) or {}
    status = _text(saved.get("status") or enriched.get("status") or "active").lower()
    if status not in ALLOWED_STATUSES:
        status = "active"
    enriched["status"] = status
    enriched["last_verified_at"] = _text(saved.get("last_verified_at") or enriched.get("last_verified_at"))
    enriched["verification_notes"] = _text(saved.get("verification_notes") or enriched.get("verification_notes"))
    enriched["candidate_id"] = key or f"library-{enriched.get('name', 'item')}".lower()
    enriched["origin"] = "library"
    return enriched


def _is_stale(last_verified_at: str) -> bool:
    if not last_verified_at:
        return False
    try:
        verified = datetime.fromisoformat(last_verified_at.replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - verified
        return age.days > STALE_DAYS
    except Exception:
        return False


def _library_candidates(source_library: list[dict[str, Any]]) -> list[dict[str, Any]]:
    store = _load_status_store()
    candidates = []
    for raw in source_library or []:
        item = _enrich_library_item(raw, store)
        status = item.get("status")
        if status in {"expired", "removed"}:
            continue
        if status == "unknown" and _is_stale(item.get("last_verified_at", "")):
            continue
        candidates.append(item)
    return candidates


def _fetch_raw(url: str, timeout: int = 10) -> str:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 Scholar-E-Wiki/0.1"})
    with urlopen(request, timeout=timeout) as response:
        return response.read(800_000).decode("utf-8", errors="ignore")


def _search_urls(query: str, limit: int = 4) -> list[str]:
    if not query.strip():
        return []

    endpoints = [
        f"https://lite.duckduckgo.com/lite/?q={quote_plus(query)}",
        f"https://duckduckgo.com/html/?q={quote_plus(query)}",
    ]
    urls: list[str] = []
    for search_url in endpoints:
        try:
            html = _fetch_raw(search_url)
        except Exception:
            continue

        patterns = [
            r'href="([^"]+)"[^>]*class="result__a"',
            r'class="result-link"[^>]*href="([^"]+)"',
            r'href="([^"]*uddg=[^"]+)"',
            r'href="(https?://[^"]+)"',
        ]
        for pattern in patterns:
            for match in re.finditer(pattern, html, flags=re.I):
                href = unescape(match.group(1))
                parsed = urlparse(href)
                if "uddg" in parsed.query:
                    target = parse_qs(parsed.query).get("uddg", [""])[0]
                    href = unquote(target) if target else href
                    parsed = urlparse(href)
                host = (parsed.netloc or "").lower()
                if not href.startswith("http"):
                    continue
                if any(bad in host for bad in ("duckduckgo.com", "duck.com")):
                    continue
                if href in urls:
                    continue
                urls.append(href)
                if len(urls) >= limit:
                    return urls
        if urls:
            break
    return urls


def _snippet_from_html(html: str) -> str:
    title = ""
    match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.I | re.S)
    if match:
        title = re.sub(r"\s+", " ", unescape(match.group(1))).strip()
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", unescape(text)).strip()
    body = text[:420]
    if title and body:
        return f"{title} — {body}"
    return title or body


def _search_candidates(queries: list[str], limit_per_query: int = 2, max_total: int = 12) -> list[dict[str, Any]]:
    """Search and preview candidates concurrently while keeping deterministic query order."""
    selected_queries = list(dict.fromkeys(query.strip() for query in (queries or []) if query.strip()))[:4]
    hits_by_query: dict[str, list[str]] = {}
    with ThreadPoolExecutor(max_workers=max(1, len(selected_queries))) as executor:
        futures = {executor.submit(_search_urls, query, limit_per_query): query for query in selected_queries}
        for future in as_completed(futures):
            query = futures[future]
            try:
                hits_by_query[query] = future.result()
            except Exception:
                hits_by_query[query] = []

    candidates: list[tuple[str, str]] = []
    seen = set()
    for query in selected_queries:
        for url in hits_by_query.get(query, []):
            key = url.lower()
            if key in seen:
                continue
            seen.add(key)
            candidates.append((query, url))
            if len(candidates) >= max_total:
                break

    def preview(candidate: tuple[str, str]) -> dict[str, Any]:
        query, url = candidate
        snippet = ""
        name = urlparse(url).netloc or url
        preview_ok = False
        try:
            html = _fetch_raw(url, timeout=6)
            snippet = _snippet_from_html(html)
            preview_ok = bool(snippet)
            if " — " in snippet:
                name = snippet.split(" — ", 1)[0][:160] or name
        except Exception:
            snippet = f"Search hit for query: {query}"
        return {
            "candidate_id": url.lower(),
            "origin": "web_search",
            "kind": "specific_source",
            "name": name,
            "url": url,
            "category": "Online search result",
            "cost": "Unknown",
            "best_for": [],
            "degree_levels": [],
            "student_types": [],
            "regions": [],
            "fields": [],
            "opportunity_types": [],
            "search_tips": [f"Found via search query: {query}"],
            "status_note": "Verify current details on the official provider page.",
            "award_amount": "",
            "deadline_window": "",
            "competitiveness": "",
            "status": "unknown",
            "last_verified_at": "",
            "verification_notes": "",
            "snippet": snippet[:500],
            "search_query": query,
            "preview_ok": preview_ok,
        }

    if not candidates:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(candidates))) as executor:
        results = list(executor.map(preview, candidates))
    return results


def _platform_search_queries(brief: dict[str, Any], focus: str) -> list[str]:
    """Build focused searches for reusable discovery platforms, not individual awards."""
    degree = _text(brief.get("degree_level") or "student")
    field = _text(brief.get("field_of_study") or "general")
    student_type = _text(brief.get("student_type"))
    opportunity_types = " ".join(brief.get("opportunity_types") or ["scholarship", "fellowship"])
    intent = focus or f"{field} {opportunity_types}"
    return list(
        dict.fromkeys(
            query.strip()
            for query in [
                f"{degree} {field} {opportunity_types} scholarship database finder",
                f"{intent} funding database scholarship search platform",
                f"{student_type} {degree} scholarship fellowship database" if student_type else "",
            ]
            if query.strip()
        )
    )[:3]


def _looks_like_reusable_platform(candidate: dict[str, Any]) -> bool:
    """Require fetched-page evidence that a web hit is a reusable search/listing source."""
    if not candidate.get("preview_ok"):
        return False
    url = _text(candidate.get("url")).lower()
    snippet = _text(candidate.get("snippet")).lower()
    name = _text(candidate.get("name")).lower()
    evidence = f"{name} {url} {snippet}"
    platform_phrases = (
        "scholarship search",
        "search scholarships",
        "scholarship database",
        "funding database",
        "fellowship database",
        "scholarship directory",
        "scholarship finder",
        "find scholarships",
        "browse scholarships",
        "browse opportunities",
        "opportunity platform",
        "funding opportunities",
    )
    return any(phrase in evidence for phrase in platform_phrases)


def _search_platform_candidates(brief: dict[str, Any], focus: str) -> list[dict[str, Any]]:
    """Discover and validate live platform candidates for this specific search."""
    queries = _platform_search_queries(brief, focus)
    raw = _search_candidates(queries, limit_per_query=3, max_total=8)
    result = []
    for candidate in raw:
        if not _looks_like_reusable_platform(candidate):
            continue
        result.append(
            {
                **candidate,
                "origin": "web_platform_search",
                "kind": "platform",
                "category": "Online scholarship search platform",
                # Retrieval relevance and source assertions are deliberately separate.
                # The student's profile must never be copied into source evidence.
                "best_for": [],
                "degree_levels": [],
                "student_types": [],
                "fields": [],
                "opportunity_types": [],
                "search_tips": [
                    f"Discovered through a live search for: {candidate.get('search_query', '')}",
                    "Confirm individual opportunities on the official provider page.",
                ],
                "status_note": "Live web discovery result; verify the platform and each linked award before applying.",
            }
        )
    return _dedupe_candidates(result)


def _dedupe_candidates(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    seen = set()
    for item in items:
        key = _text(item.get("url") or item.get("name")).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


# --- Agent schemas ---


class ProfileSummary(BaseModel):
    degree_level: str = Field(default="", description="High school, Undergraduate, Graduate, PhD, Postdoctoral, or empty.")
    field_of_study: str = Field(default="", description="Primary field/major/research area, or empty.")
    student_type: str = Field(default="", description="Domestic student, International student, or empty.")
    current_country: str = Field(default="", description="Current country/region, or empty.")
    university: str = Field(default="", description="Institution if known, or empty.")
    opportunity_types: str = Field(default="", description="Comma-separated opportunity types, or empty.")


class DiscoveryBriefIntent(BaseModel):
    id: str = Field(default="")
    label: str = Field(default="")
    dimension: str = Field(default="")
    value: str = Field(default="")
    canonical_values: list[str] = Field(default_factory=list)
    derived_from: list[str] = Field(default_factory=list)


class DiscoveryBrief(BaseModel):
    degree_level: str = Field(default="", description="High school, Undergraduate, Graduate, PhD, Postdoctoral, or empty.")
    field_of_study: str = Field(default="", description="Primary field/major/research area, or empty.")
    student_type: str = Field(default="", description="Domestic student, International student, or empty/unclear.")
    current_country: str = Field(default="", description="Current country/region, or empty.")
    university: str = Field(default="", description="Institution if known, or empty.")
    opportunity_types: list[str] = Field(default_factory=list, description="Scholarship, Fellowship, Grant, Travel grant, etc.")
    constraints: list[str] = Field(default_factory=list, description="Only constraints supported by the profile.")
    missing_fields: list[str] = Field(default_factory=list, description="Profile fields that would improve discovery.")
    search_queries: list[str] = Field(default_factory=list, description="5-10 concrete web search queries for funding sources.")
    profile_summary: ProfileSummary = Field(default_factory=ProfileSummary, description="Compact summary fields for the Wiki UI.")
    selected_intents: list[DiscoveryBriefIntent] = Field(default_factory=list)
    free_text_intent: str = Field(default="")


class RankedSource(BaseModel):
    candidate_id: str = Field(description="Must match a candidate_id from the provided pool.")
    name: str = Field(default="")
    url: str = Field(default="")
    kind: str = Field(default="specific_source", description="platform or specific_source")
    category: str = Field(default="")
    cost: str = Field(default="")
    priority: str = Field(default="Medium", description="High, Medium, or Low")
    why_recommended: str = Field(default="")
    best_for: list[str] = Field(default_factory=list)
    search_tips: list[str] = Field(default_factory=list)
    suggested_queries: list[str] = Field(default_factory=list)
    status_estimate: str = Field(default="unknown", description="active, seasonal, unknown, expired, or removed")
    evidence: str = Field(default="", description="Short grounding evidence from candidate data/snippet.")
    caveats: str = Field(default="")
    award_amount: str = Field(default="")
    deadline_window: str = Field(default="")
    competitiveness: str = Field(default="")
    status_note: str = Field(default="")


class RejectedSource(BaseModel):
    candidate_id: str = Field(default="")
    reason: str = Field(default="")


class RankerResult(BaseModel):
    accepted: list[RankedSource] = Field(default_factory=list, description="Grounded recommendations only from the candidate pool.")
    rejected: list[RejectedSource] = Field(default_factory=list)


class SourceGroupItem(BaseModel):
    name: str = Field(default="")
    url: str = Field(default="")
    category: str = Field(default="")
    cost: str = Field(default="")
    best_for: list[str] = Field(default_factory=list)
    why_recommended: str = Field(default="")
    search_tips: list[str] = Field(default_factory=list)
    suggested_queries: list[str] = Field(default_factory=list)
    award_amount: str = Field(default="")
    deadline_window: str = Field(default="")
    competitiveness: str = Field(default="")


class SourceGroup(BaseModel):
    group_name: str = Field(default="")
    match_reason: str = Field(default="")
    priority: str = Field(default="Medium", description="High, Medium, or Low")
    sources: list[SourceGroupItem] = Field(default_factory=list)


class PlatformItem(BaseModel):
    name: str = Field(default="")
    url: str = Field(default="")
    category: str = Field(default="")
    best_for: list[str] = Field(default_factory=list)
    search_tips: list[str] = Field(default_factory=list)
    why_recommended: str = Field(default="")
    access_note: str = Field(default="Check the platform for current account requirements.")
    source_authority: str = Field(default="Discovery platform")


class SpecificOpportunityItem(BaseModel):
    name: str = Field(default="")
    url: str = Field(default="")
    category: str = Field(default="")
    cost: str = Field(default="")
    best_for: list[str] = Field(default_factory=list)
    why_recommended: str = Field(default="")
    status_note: str = Field(default="")
    award_amount: str = Field(default="")
    deadline_window: str = Field(default="")
    competitiveness: str = Field(default="")
    search_tips: list[str] = Field(default_factory=list)
    suggested_queries: list[str] = Field(default_factory=list)
    source_authority: str = Field(default="Official provider page")


class FundingCategory(BaseModel):
    category_name: str = Field(default="")
    description: str = Field(default="")
    best_for: list[str] = Field(default_factory=list)
    example_source_types: list[str] = Field(default_factory=list)
    suggested_queries: list[str] = Field(default_factory=list)


class WikiDraft(BaseModel):
    page_title: str = Field(default="Scholarship Discovery")
    profile_summary: ProfileSummary = Field(default_factory=ProfileSummary)
    recommended_source_groups: list[SourceGroup] = Field(default_factory=list)
    top_free_platforms: list[PlatformItem] = Field(default_factory=list)
    specific_opportunities: list[SpecificOpportunityItem] = Field(default_factory=list)
    funding_categories: list[FundingCategory] = Field(default_factory=list)
    personalized_search_queries: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    missing_profile_fields: list[str] = Field(default_factory=list)


class CriticAction(BaseModel):
    item_type: str = Field(default="specific_opportunity", description="platform, specific_opportunity, or group_source")
    name: str = Field(default="")
    url: str = Field(default="")
    action: str = Field(default="keep", description="keep, drop, or downgrade")
    reason: str = Field(default="")


class CriticResult(BaseModel):
    actions: list[CriticAction] = Field(default_factory=list)
    overall_notes: str = Field(default="")


def _summary_dict(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        return {str(k): _text(v) for k, v in value.items() if _text(v)}
    data = _model_dump(value) if value is not None else {}
    if not isinstance(data, dict):
        return {}
    return {str(k): _text(v) for k, v in data.items() if _text(v)}


def _selected_intents(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [model_dict(intent) for intent in _context_from_state(state).selected_intents]


def _context_from_state(state: dict[str, Any]) -> DiscoveryContext:
    saved = state.get("discovery_context")
    if isinstance(saved, dict) and saved.get("profile"):
        if hasattr(DiscoveryContext, "model_validate"):
            return DiscoveryContext.model_validate(saved)
        return DiscoveryContext.parse_obj(saved)
    return build_discovery_context(
        state.get("student_profile") or {},
        state.get("selected_intents") or [],
        _text(state.get("free_text_intent") or state.get("discovery_focus")),
    )


def _combined_intent_text(state: dict[str, Any]) -> str:
    return _context_from_state(state).preference_text


def interpret_profile(state):
    """Agent 1: Profile Interpreter."""
    profile = state.get("student_profile") or {}
    context = build_discovery_context(
        profile,
        state.get("selected_intents") or [],
        _text(state.get("free_text_intent") or state.get("discovery_focus")),
    )
    selected_intents = [model_dict(intent) for intent in context.selected_intents]
    free_text_intent = context.free_text
    focus = context.preference_text
    feedback = state.get("discovery_feedback") or []
    model = llm._get_client().with_structured_output(DiscoveryBrief)
    result = model.invoke(
        [
            (
                "system",
                "You are the Scholarship Discovery Profile Interpreter. Build a discovery brief "
                "from the student profile, selected discovery intents, and optional written request. "
                "Do not recommend scholarships. Do not invent "
                "profile facts. If citizenship, field, or degree level is missing, list it under "
                "missing_fields. Produce 5-10 practical web search queries for finding funding "
                "platforms and official award pages. Apply this hierarchy: explicit written request "
                "is the strongest preference, selected intents are next, and the general profile "
                "provides context. Degree, citizenship/student type, and geography remain hard "
                "constraints when explicitly known. Feedback is preference evidence, not profile fact.",
            ),
            (
                "human",
                f"Student profile JSON:\n{json.dumps(profile, default=str)[:10000]}\n\n"
                f"Canonical profile and constraints:\n{json.dumps(model_dict(context.profile), default=str)[:5000]}\n\n"
                f"Selected discovery intents with profile provenance:\n{json.dumps(selected_intents, default=str)[:3000]}\n\n"
                f"Student-written request:\n{free_text_intent or 'No additional written request supplied.'}\n\n"
                f"Prior not-relevant feedback:\n{json.dumps(feedback, default=str)[:2000]}",
            ),
        ]
    )
    brief = _model_dump(result)
    summary = _summary_dict(brief.get("profile_summary"))
    if not summary:
        summary = {
            key: _text(brief.get(key))
            for key in ("degree_level", "field_of_study", "student_type", "current_country", "university")
            if _text(brief.get(key))
        }
        if brief.get("opportunity_types"):
            summary["opportunity_types"] = ", ".join(brief.get("opportunity_types") or [])
    brief["selected_intents"] = selected_intents
    brief["free_text_intent"] = free_text_intent
    brief["canonical_context"] = context_dict(context)
    brief["exclusions"] = context.exclusions
    selected_opportunity_types = [
        intent["value"] for intent in selected_intents if intent["dimension"] == "opportunity_type"
    ]
    brief["opportunity_types"] = list(
        dict.fromkeys([*(brief.get("opportunity_types") or []), *selected_opportunity_types])
    )
    canonical_queries = plan_queries(context)
    queries = canonical_queries + [
        query for query in (brief.get("search_queries") or [])
        if query.lower() not in {item.lower() for item in canonical_queries}
    ]
    if focus:
        degree = _text(brief.get("degree_level"))
        # A written request can intentionally move beyond the profile's primary
        # field. Include the profile field only when the student did not supply
        # a stronger free-text direction; a selected field intent remains in focus.
        field = "" if free_text_intent else _text(brief.get("field_of_study"))
        focused_query = " ".join(
            part for part in [degree, field, focus, "scholarships fellowships official"] if part
        )
        queries = [focused_query] + [query for query in queries if query.lower() != focused_query.lower()]
    return {
        "discovery_brief": {**brief, "profile_summary": summary},
        "search_queries": queries[:8],
        "canonical_profile": model_dict(context.profile),
        "discovery_context": context_dict(context),
    }


def _normalized_terms(value: Any) -> set[str]:
    text = " ".join(value) if isinstance(value, list) else _text(value)
    return {
        token
        for token in re.findall(r"[a-z0-9]+", text.lower())
        if len(token) > 2 and token not in {"student", "students", "scholarship", "scholarships", "funding"}
    }


def _candidate_matches_brief(item: dict[str, Any], brief: dict[str, Any], focus: str) -> bool:
    """Compatibility wrapper retained for callers while using canonical policies."""
    profile = {
        "educationLevel": _text(brief.get("degree_level")),
        "citizenshipStatus": _text(brief.get("student_type")),
        "educationHistory": [{"majorField": _text(brief.get("field_of_study"))}],
    }
    context = build_discovery_context(profile, [], focus)
    curated_item = {**item, "origin": item.get("origin") or "library"}
    return assess_candidate(curated_item, context).compatible


def build_candidate_pool(state):
    """Code: merge curated sources with parallel live award and platform searches."""
    brief = state.get("discovery_brief") or {}
    context = _context_from_state(state)
    focus = context.preference_text
    excluded = {_text(url).lower() for url in (state.get("excluded_urls") or []) if _text(url)}
    library = [
        item
        for item in _library_candidates(state.get("source_library") or [])
        if _text(item.get("url")).lower() not in excluded and assess_candidate(item, context).compatible
    ]
    queries = state.get("search_queries") or []
    if not queries:
        degree = _text(brief.get("degree_level") or "student")
        field = _text(brief.get("field_of_study") or "scholarship")
        queries = [
            f"{degree} scholarships {field}",
            f"{degree} fellowships {field}",
            f"official scholarship database {field}",
        ]
    with ThreadPoolExecutor(max_workers=2) as executor:
        award_future = executor.submit(_search_candidates, queries)
        platform_future = executor.submit(_search_platform_candidates, brief, focus)
        try:
            web = award_future.result()
        except Exception:
            web = []
        try:
            web_platforms = platform_future.result()
        except Exception:
            web_platforms = []
    web = [item for item in web if _text(item.get("url")).lower() not in excluded]
    web_platforms = [item for item in web_platforms if _text(item.get("url")).lower() not in excluded]
    pool = []
    for item in _dedupe_candidates(library + web_platforms + web)[:36]:
        enriched = {**item, "source_evidence": candidate_evidence(item)}
        assessment = assessment_dict(enriched, context)
        score, components = score_candidate(enriched, context)
        pool.append({
            **enriched,
            "compatibility": assessment,
            "semantic_score": round(score, 4),
            "score_components": components,
        })
    return {"candidate_pool": pool}


def _as_platform_item(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(source.get("name")),
        "url": _text(source.get("url")),
        "category": _text(source.get("category")),
        "best_for": source.get("best_for") or [],
        "search_tips": (source.get("search_tips") or [])[:3],
        "why_recommended": _text(source.get("why_recommended"))
        or "A trusted place to continue searching beyond the opportunities shown here.",
        "access_note": _text(source.get("access_note"))
        or "Check the platform for current account requirements.",
        "source_authority": (
            "Live web-discovered platform"
            if source.get("origin") == "web_platform_search"
            else "Curated discovery platform"
        ),
    }


def _as_specific_item(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(source.get("name")),
        "url": _text(source.get("url")),
        "category": _text(source.get("category")),
        "cost": _text(source.get("cost")),
        "best_for": source.get("best_for") or [],
        "why_recommended": _text(source.get("why_recommended"))
        or "Matches the current profile and is grounded in the discovery candidate pool.",
        "status_note": _text(source.get("status_note"))
        or "Verify current status on the official source page.",
        "award_amount": _text(source.get("award_amount")),
        "deadline_window": _text(source.get("deadline_window")),
        "competitiveness": _text(source.get("competitiveness")),
        "search_tips": (source.get("search_tips") or [])[:3],
        "suggested_queries": (source.get("suggested_queries") or [])[:3],
        "source_authority": "Official provider page" if source.get("origin") == "library" else "Web discovery result",
    }


def _is_platform(item: dict[str, Any]) -> bool:
    kind = _text(item.get("kind")).lower()
    category = _text(item.get("category")).lower()
    if kind == "platform":
        return True
    if kind == "specific_source":
        return False
    return any(token in category for token in ("platform", "database", "finder", "search"))


def _dedupe_by_url(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    seen = set()
    for item in items or []:
        url = _text(item.get("url")).lower()
        if not url or url in seen:
            continue
        seen.add(url)
        result.append(item)
    return result


def _platform_semantic_score(source: dict[str, Any], brief: dict[str, Any], focus: str) -> int:
    """Rank grounded discovery platforms by profile and request meaning."""
    profile_text = " ".join(
        [
            _text(brief.get("field_of_study")),
            " ".join(brief.get("opportunity_types") or []),
            _text(brief.get("degree_level")),
            _text(brief.get("student_type")),
            focus,
        ]
    )
    platform_text = " ".join(
        [
            _text(source.get("name")),
            _text(source.get("category")),
            " ".join(source.get("best_for") or []),
            " ".join(source.get("fields") or []),
            " ".join(source.get("opportunity_types") or []),
            " ".join(source.get("regions") or []),
            _text(source.get("search_query")),
            _text(source.get("snippet")),
        ]
    )
    profile_terms = _normalized_terms(profile_text)
    platform_terms = _normalized_terms(platform_text)
    score = len(profile_terms & platform_terms) * 8
    field = _text(brief.get("field_of_study"))
    fields = " ".join(source.get("fields") or []).lower()
    category = _text(source.get("category")).lower()
    if field and _normalized_terms(field) & platform_terms:
        score += 18
    if "general" in fields or "general" in category:
        score += 4
    if _text(brief.get("degree_level")):
        score += 3
    if _text(brief.get("student_type")):
        score += 3
    if source.get("origin") == "web_platform_search":
        score += 5
    canonical_score = float(source.get("semantic_score") or 0.0)
    return score + round(canonical_score * 100)


def _platform_match_reason(source: dict[str, Any], brief: dict[str, Any], focus: str) -> str:
    field = _text(brief.get("field_of_study"))
    degree = _text(brief.get("degree_level"))
    student_type = _text(brief.get("student_type"))
    metadata = _normalized_terms(
        " ".join(
            [
                _text(source.get("category")),
                " ".join(source.get("fields") or []),
                " ".join(source.get("best_for") or []),
                " ".join(source.get("opportunity_types") or []),
                _text(source.get("search_query")),
                _text(source.get("snippet")),
            ]
        )
    )
    focus_matches = sorted(_normalized_terms(focus) & metadata)[:2]
    if field and _normalized_terms(field) & metadata:
        return f"Selected for {field} and related funding opportunities."
    if focus_matches:
        return f"Selected for opportunities related to {' and '.join(focus_matches)}."
    if student_type:
        return f"Selected for {student_type.lower()} scholarship discovery."
    if degree:
        return f"Selected for {degree.lower()} scholarship discovery."
    best_for = [_text(value) for value in (source.get("best_for") or []) if _text(value)][:1]
    if best_for:
        return f"Selected for {best_for[0].lower()}."
    return "Selected as a broad, trusted place to continue this scholarship search."


def _select_semantic_platforms(
    pool: list[dict[str, Any]],
    brief: dict[str, Any],
    focus: str,
    *,
    limit: int = 3,
) -> list[dict[str, Any]]:
    candidates = [source for source in pool if _is_platform(source)]
    ranked = sorted(
        enumerate(candidates),
        key=lambda pair: (-_platform_semantic_score(pair[1], brief, focus), pair[0]),
    )
    selected = []
    seen_families = set()

    def add(source: dict[str, Any]) -> None:
        selected.append(
            {
                **source,
                "kind": "platform",
                "priority": "High" if not selected else "Medium",
                "why_recommended": _platform_match_reason(source, brief, focus),
                "status_estimate": _text(source.get("status") or "active"),
                "evidence": (
                    "Selected from a validated live platform page found for this profile and discovery request."
                    if source.get("origin") == "web_platform_search"
                    else "Selected from curated platform metadata using the student profile and discovery request."
                ),
            }
        )

    for _, source in ranked:
        category = _text(source.get("category")).lower()
        family = next(
            (token for token in ("international", "fellowship", "global", "general") if token in category),
            category,
        )
        if family in seen_families and len(ranked) > limit:
            continue
        add(source)
        seen_families.add(family)
        if len(selected) >= limit:
            return selected

    selected_urls = {_text(item.get("url")).lower() for item in selected}
    for _, source in ranked:
        if _text(source.get("url")).lower() in selected_urls:
            continue
        add(source)
        if len(selected) >= limit:
            break
    return selected


def rank_and_verify_sources(state):
    """Agent 2: Ranker + Freshness Verifier over grounded candidates only."""
    brief = state.get("discovery_brief") or {}
    focus = _combined_intent_text(state)
    pool = state.get("candidate_pool") or []
    compact_pool = [
        {
            "candidate_id": item.get("candidate_id"),
            "origin": item.get("origin"),
            "kind": item.get("kind"),
            "name": item.get("name"),
            "url": item.get("url"),
            "category": item.get("category"),
            "cost": item.get("cost"),
            "best_for": item.get("best_for"),
            "degree_levels": item.get("degree_levels"),
            "student_types": item.get("student_types"),
            "fields": item.get("fields"),
            "opportunity_types": item.get("opportunity_types"),
            "regions": item.get("regions"),
            "status": item.get("status"),
            "status_note": item.get("status_note"),
            "award_amount": item.get("award_amount"),
            "deadline_window": item.get("deadline_window"),
            "competitiveness": item.get("competitiveness"),
            "search_tips": item.get("search_tips"),
            "snippet": item.get("snippet", ""),
            "compatibility": item.get("compatibility"),
            "semantic_score": item.get("semantic_score"),
            "score_components": item.get("score_components"),
            "source_evidence": item.get("source_evidence"),
        }
        for item in pool
    ]
    model = llm._get_client().with_structured_output(RankerResult)
    result = model.invoke(
        [
            (
                "system",
                "You are the Scholarship Source Ranker and Freshness Verifier. Choose only from "
                "the provided candidate pool. Never invent scholarships or URLs. Separate "
                "platforms from specific award pages. Reject clear degree, field, citizenship, "
                "student-type, and unsupported identity-restricted mismatches. Estimate status as active, seasonal, "
                "unknown, expired, or removed. Do not recommend expired or removed items. "
                "Quality and relevance are more important than list size. Return 2-4 useful "
                "platforms when available and only specific opportunities with affirmative "
                "profile or discovery-intent evidence. Treat explicit free_text_intent as the "
                "strongest preference, selected_intents as the next relevance signal, and field/career "
                "profile data as context after hard eligibility constraints. Never fill a quota with a weak match.",
            ),
            (
                "human",
                "Discovery brief:\n"
                f"{json.dumps(brief, default=str)[:6000]}\n\n"
                "Candidate pool:\n"
                f"{json.dumps(compact_pool, default=str)[:18000]}",
            ),
        ]
    )
    data = _model_dump(result)
    pool_by_id = {item.get("candidate_id"): item for item in pool}
    accepted = []
    for item in data.get("accepted") or []:
        cid = _text(item.get("candidate_id"))
        source = pool_by_id.get(cid)
        if not source:
            continue
        status = _text(item.get("status_estimate") or "unknown").lower()
        if status not in ALLOWED_STATUSES:
            status = "unknown"
        if status in {"expired", "removed"}:
            continue
        # Prefer pool kind/url so LLM mislabels and duplicate rows cannot break grounding.
        merged = {
            **item,
            "candidate_id": cid,
            "name": _text(item.get("name") or source.get("name")),
            "url": _text(source.get("url") or item.get("url")),
            "kind": _text(source.get("kind") or item.get("kind") or "specific_source"),
            "category": _text(source.get("category") or item.get("category")),
            "cost": _text(item.get("cost") or source.get("cost")),
            "best_for": item.get("best_for") or source.get("best_for") or [],
            "search_tips": item.get("search_tips") or source.get("search_tips") or [],
            "award_amount": _text(item.get("award_amount") or source.get("award_amount")),
            "deadline_window": _text(item.get("deadline_window") or source.get("deadline_window")),
            "competitiveness": _text(item.get("competitiveness") or source.get("competitiveness")),
            "status_note": _text(item.get("status_note") or source.get("status_note")),
            "status_estimate": status,
            "origin": source.get("origin"),
            "compatibility": source.get("compatibility") or {},
            "semantic_score": source.get("semantic_score") or 0,
            "score_components": source.get("score_components") or {},
            "source_evidence": source.get("source_evidence") or {},
        }
        if not merged["url"] or not (merged.get("compatibility") or {}).get("compatible", True):
            continue
        accepted.append(merged)
    accepted = _dedupe_by_url(accepted)
    accepted_by_url = {_text(item.get("url")).lower(): item for item in accepted}
    semantic_platforms = []
    for source in _select_semantic_platforms(pool, brief, focus, limit=3):
        existing = accepted_by_url.get(_text(source.get("url")).lower()) or {}
        semantic_platforms.append(
            {
                **source,
                **existing,
                "name": _text(source.get("name")),
                "url": _text(source.get("url")),
                "kind": "platform",
                "category": _text(source.get("category")),
                "best_for": source.get("best_for") or [],
                "search_tips": source.get("search_tips") or [],
                "why_recommended": _text(source.get("why_recommended")),
                "origin": source.get("origin"),
            }
        )
    accepted = semantic_platforms + [item for item in accepted if not _is_platform(item)][:3]

    # Persist freshness estimates for library-origin items.
    store = _load_status_store()
    for item in accepted:
        if item.get("origin") != "library":
            continue
        key = _status_key(item)
        store[key] = {
            "status": item.get("status_estimate") or "unknown",
            "last_verified_at": _now_iso(),
            "verification_notes": _text(item.get("evidence"))[:500],
            "name": item.get("name"),
            "url": item.get("url"),
        }
    for item in data.get("rejected") or []:
        cid = _text(item.get("candidate_id"))
        source = pool_by_id.get(cid)
        if not source or source.get("origin") != "library":
            continue
        reason = _text(item.get("reason")).lower()
        status = "unknown"
        if "expir" in reason:
            status = "expired"
        elif "removed" in reason or "not found" in reason or "404" in reason:
            status = "removed"
        store[_status_key(source)] = {
            "status": status,
            "last_verified_at": _now_iso(),
            "verification_notes": _text(item.get("reason"))[:500],
            "name": source.get("name"),
            "url": source.get("url"),
        }
    _save_status_store(store)

    return {
        "ranked_sources": accepted,
        "rejected_sources": data.get("rejected") or [],
    }


def verify_ranked_sources(state):
    """Deterministic post-ranker gate for constraints, provenance, and fetch evidence."""
    context = _context_from_state(state)
    verified = []
    rejected = []
    for item in _dedupe_by_url(state.get("ranked_sources") or []):
        url = _text(item.get("url"))
        assessment = assess_candidate(item, context)
        evidence = item.get("source_evidence") or candidate_evidence(item)
        origin = _text(item.get("origin"))
        reason = ""
        if not url:
            reason = "missing_url"
        elif not assessment.compatible:
            reason = ",".join(assessment.hard_contradictions) or "hard_constraint"
        elif origin.startswith("web") and not evidence.get("fetched"):
            reason = "unfetched_live_source"
        if reason:
            rejected.append({"name": item.get("name", ""), "url": url, "reason": reason})
            continue
        verified.append({
            **item,
            "compatibility": model_dict(assessment),
            "source_evidence": evidence,
        })
    return {
        "ranked_sources": verified,
        "verification_report": {
            "accepted_count": len(verified),
            "rejected_count": len(rejected),
            "rejected": rejected,
        },
    }


def normalize_wiki_fields(state):
    """Agent 3: Wiki Field Normalizer."""
    brief = state.get("discovery_brief") or {}
    ranked = state.get("ranked_sources") or []
    model = llm._get_client().with_structured_output(WikiDraft)
    result = model.invoke(
        [
            (
                "system",
                "You are the Scholarship Wiki Field Normalizer. Convert accepted ranked sources "
                "into the discovery UI schema. Do not add scholarships beyond the accepted set. "
                "Keep platforms and specific opportunities separate. IMPORTANT: include ALL "
                "accepted platforms in top_free_platforms (up to 5) and ALL accepted specific "
                "sources in specific_opportunities (up to 5). Do not omit accepted items. "
                "Use student-friendly language and honest verify-on-official-page caveats. "
                "Explain why each item was discovered, without claiming fit or eligibility. "
                "Also provide funding_categories, personalized_search_queries, and next_steps.",
            ),
            (
                "human",
                "Discovery brief:\n"
                f"{json.dumps(brief, default=str)[:6000]}\n\n"
                "Accepted ranked sources:\n"
                f"{json.dumps(ranked, default=str)[:14000]}",
            ),
        ]
    )
    draft = _model_dump(result)
    summary = _summary_dict(draft.get("profile_summary"))
    if not summary:
        summary = _summary_dict((state.get("discovery_brief") or {}).get("profile_summary"))
    draft["profile_summary"] = summary
    if not draft.get("missing_profile_fields"):
        draft["missing_profile_fields"] = (state.get("discovery_brief") or {}).get("missing_fields") or []
    if not draft.get("personalized_search_queries"):
        draft["personalized_search_queries"] = (state.get("search_queries") or [])[:5]
    if not draft.get("page_title"):
        draft["page_title"] = "Scholarship Discovery"
    # Code owns membership/count; LLM may only improve wording for the same URLs.
    ranked_platforms, ranked_specifics = _lists_from_ranked(ranked)
    draft["top_free_platforms"] = _overlay_wording(ranked_platforms, draft.get("top_free_platforms") or [])
    draft["specific_opportunities"] = _overlay_wording(ranked_specifics, draft.get("specific_opportunities") or [])
    return {"wiki_draft": draft}


def critique_wiki_output(state):
    """Agent 4: Grounding Critic (always on)."""
    brief = state.get("discovery_brief") or {}
    ranked = state.get("ranked_sources") or []
    draft = state.get("wiki_draft") or {}
    allowed = {
        (_text(item.get("name")).lower(), _text(item.get("url")).lower())
        for item in ranked
    }
    model = llm._get_client().with_structured_output(CriticResult)
    result = model.invoke(
        [
            (
                "system",
                "You are the Scholarship Discovery Grounding Critic. Audit the draft output. "
                "ONLY drop items that are invented, missing from the accepted grounded set, "
                "field-mismatched, degree-mismatched, identity-mismatched, or clearly expired/removed. "
                "Thin evidence is a reason to downgrade wording, not claim relevance. Never preserve "
                "an item merely to keep a list full. Always run this audit.",
            ),
            (
                "human",
                "Discovery brief:\n"
                f"{json.dumps(brief, default=str)[:4000]}\n\n"
                "Accepted grounded sources:\n"
                f"{json.dumps(ranked, default=str)[:10000]}\n\n"
                "Wiki draft:\n"
                f"{json.dumps(draft, default=str)[:12000]}\n\n"
                f"Allowed name/url pairs: {json.dumps(list(allowed))[:4000]}",
            ),
        ]
    )
    return {"critic_result": _model_dump(result)}


def _apply_critic(
    draft: dict[str, Any],
    critic: dict[str, Any],
    *,
    protected_urls: set[str] | None = None,
) -> dict[str, Any]:
    actions = critic.get("actions") or []
    protected = {url.lower() for url in (protected_urls or set()) if url}
    drop_keys = set()
    downgrade_names = set()
    for action in actions:
        act = _text(action.get("action")).lower()
        name = _text(action.get("name")).lower()
        url = _text(action.get("url")).lower()
        key = (name, url)
        if act == "drop":
            drop_keys.add(key)
            drop_keys.add((name, ""))
        elif act == "downgrade":
            downgrade_names.add(name)

    def keep_item(item: dict[str, Any]) -> bool:
        name = _text(item.get("name")).lower()
        url = _text(item.get("url")).lower()
        return (name, url) not in drop_keys and (name, "") not in drop_keys

    platforms = [item for item in (draft.get("top_free_platforms") or []) if keep_item(item)][:3]
    specifics = [item for item in (draft.get("specific_opportunities") or []) if keep_item(item)][:3]

    groups = []
    for group in draft.get("recommended_source_groups") or []:
        sources = [item for item in (group.get("sources") or []) if keep_item(item)]
        if not sources:
            continue
        priority = _text(group.get("priority") or "Medium")
        if _text(group.get("group_name")).lower() in downgrade_names and priority == "High":
            priority = "Medium"
        groups.append({**group, "priority": priority, "sources": sources[:3]})

    return {
        **draft,
        "top_free_platforms": platforms,
        "specific_opportunities": specifics,
        "recommended_source_groups": groups,
        "personalized_search_queries": (draft.get("personalized_search_queries") or [])[:8],
        "next_steps": draft.get("next_steps")
        or [
            "Explore a scholarship or open a trusted platform to continue searching.",
            "Bring back a scholarship name, listing, link, or copied details.",
            "Continue to Step 3 when you want Scholar-E to collect the official requirements.",
        ],
        "missing_profile_fields": draft.get("missing_profile_fields") or [],
        "funding_categories": draft.get("funding_categories") or [],
        "page_title": draft.get("page_title") or "Scholarship Discovery",
        "profile_summary": draft.get("profile_summary") or {},
    }


def _merge_by_url(preferred: list[dict[str, Any]], fallback: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    merged = []
    seen = set()
    for item in list(preferred or []) + list(fallback or []):
        url = _text(item.get("url")).lower()
        if not url or url in seen:
            continue
        seen.add(url)
        merged.append(item)
        if len(merged) >= limit:
            break
    return merged


def _overlay_wording(base_items: list[dict[str, Any]], wording_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep base membership/order; copy non-empty fields from matching wording items."""
    by_url = {_text(item.get("url")).lower(): item for item in (wording_items or []) if _text(item.get("url"))}
    overlaid = []
    for item in base_items or []:
        url = _text(item.get("url")).lower()
        wording = by_url.get(url) or {}
        merged = dict(item)
        for key, value in wording.items():
            if value in (None, "", [], {}):
                continue
            merged[key] = value
        overlaid.append(merged)
    return overlaid


def _ground_urls(ranked: list[dict[str, Any]]) -> set[str]:
    return {_text(item.get("url")).lower() for item in ranked if _text(item.get("url"))}


def _lists_from_ranked(ranked: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    platforms = [_as_platform_item(item) for item in ranked if _is_platform(item)]
    specifics = [_as_specific_item(item) for item in ranked if not _is_platform(item)]
    return _dedupe_by_url(platforms)[:3], _dedupe_by_url(specifics)[:3]


def finalize_wiki_output(state):
    """Code gates: apply critic and enforce grounding without quota-based backfill."""
    draft = state.get("wiki_draft") or {}
    critic = state.get("critic_result") or {}
    ranked = _dedupe_by_url(state.get("ranked_sources") or [])
    # Platforms are a guaranteed part of discovery, not optional model output.
    # Rebuild any missing platform slots from the curated library before the
    # response is normalized. This also protects requests processed from an
    # older or incomplete ranker result.
    existing_platforms = [item for item in ranked if _is_platform(item)]
    if len(existing_platforms) < 3:
        excluded_urls = {
            _text(url).lower()
            for url in (state.get("excluded_urls") or [])
            if _text(url)
        }
        fallback_pool = [
            item
            for item in _library_candidates(state.get("source_library") or [])
            if _is_platform(item) and _text(item.get("url")).lower() not in excluded_urls
        ]
        fallback_platforms = _select_semantic_platforms(
            fallback_pool,
            state.get("discovery_brief") or {},
            _combined_intent_text(state),
            limit=3,
        )
        ranked = _dedupe_by_url(existing_platforms + fallback_platforms)[:3] + [
            item for item in ranked if not _is_platform(item)
        ]
    drop_urls = {
        _text(action.get("url")).lower()
        for action in (critic.get("actions") or [])
        if _text(action.get("action")).lower() == "drop" and _text(action.get("url"))
    }
    drop_names = {
        _text(action.get("name")).lower()
        for action in (critic.get("actions") or [])
        if _text(action.get("action")).lower() == "drop" and _text(action.get("name"))
    }
    ranked = [
        item
        for item in ranked
        if _text(item.get("url")).lower() not in drop_urls
        and _text(item.get("name")).lower() not in drop_names
    ]
    protected = _ground_urls(ranked)
    cleaned = _apply_critic(draft, critic)
    brief = state.get("discovery_brief") or {}
    if not cleaned.get("profile_summary"):
        cleaned["profile_summary"] = _summary_dict(brief.get("profile_summary"))
    if not cleaned.get("missing_profile_fields"):
        cleaned["missing_profile_fields"] = brief.get("missing_fields") or []
    if not cleaned.get("personalized_search_queries"):
        cleaned["personalized_search_queries"] = (state.get("search_queries") or [])[:5]
    ranked_platforms, ranked_specifics = _lists_from_ranked(ranked)

    # Ranked/code owns membership; draft may only improve wording.
    cleaned["top_free_platforms"] = _overlay_wording(
        ranked_platforms,
        cleaned.get("top_free_platforms") or [],
    )
    cleaned["specific_opportunities"] = _overlay_wording(
        ranked_specifics,
        cleaned.get("specific_opportunities") or [],
    )

    groups = []
    for group in cleaned.get("recommended_source_groups") or []:
        sources = [
            item
            for item in (group.get("sources") or [])
            if _text(item.get("url")).lower() in protected
        ]
        if sources:
            groups.append({**group, "sources": _dedupe_by_url(sources)[:3]})
    if not groups:
        # Build simple groups from final lists so UI still has structure.
        if cleaned["top_free_platforms"]:
            groups.append(
                {
                    "group_name": "Scholarship platforms",
                    "match_reason": "Trusted platforms for continuing discovery from this profile.",
                    "priority": "High",
                    "sources": [
                        {
                            **item,
                            "cost": item.get("cost", "Free"),
                            "why_recommended": "Useful platform for finding opportunities that match this profile.",
                            "suggested_queries": [],
                        }
                        for item in cleaned["top_free_platforms"][:3]
                    ],
                }
            )
        if cleaned["specific_opportunities"]:
            groups.append(
                {
                    "group_name": "Direct scholarship sources",
                    "match_reason": "Specific official pages grounded for this profile.",
                    "priority": "High",
                    "sources": [
                        {
                            "name": item.get("name", ""),
                            "url": item.get("url", ""),
                            "category": item.get("category", ""),
                            "cost": item.get("cost", ""),
                            "best_for": item.get("best_for") or [],
                            "why_recommended": item.get("why_recommended") or "",
                            "search_tips": item.get("search_tips") or [],
                            "suggested_queries": item.get("suggested_queries") or [],
                            "award_amount": item.get("award_amount", ""),
                            "deadline_window": item.get("deadline_window", ""),
                            "competitiveness": item.get("competitiveness", ""),
                        }
                        for item in cleaned["specific_opportunities"][:3]
                    ],
                }
            )
    cleaned["recommended_source_groups"] = groups

    for item in cleaned["specific_opportunities"]:
        if not item.get("status_note"):
            item["status_note"] = "Verify current status on the official source page."

    specifics = cleaned.get("specific_opportunities") or []
    platforms = cleaned.get("top_free_platforms") or []
    if specifics:
        result_note = "A few opportunities appear relevant to your profile or search focus. Confirm details on the provider page."
    elif platforms:
        result_note = "We did not find a close scholarship yet, so these trusted places can help you continue searching."
    else:
        result_note = "We could not confirm a useful result yet. You can still bring an opportunity you found elsewhere."

    return {
        "page_title": cleaned.get("page_title") or "Scholarship Discovery",
        "profile_summary": cleaned.get("profile_summary") or {},
        "recommended_source_groups": cleaned.get("recommended_source_groups") or [],
        "top_free_platforms": cleaned.get("top_free_platforms") or [],
        "specific_opportunities": cleaned.get("specific_opportunities") or [],
        "funding_categories": cleaned.get("funding_categories") or [],
        "personalized_search_queries": cleaned.get("personalized_search_queries") or [],
        "next_steps": cleaned.get("next_steps") or [],
        "missing_profile_fields": cleaned.get("missing_profile_fields") or [],
        "discovery_focus": _text(state.get("free_text_intent") or state.get("discovery_focus")),
        "selected_intents": _selected_intents(state),
        "free_text_intent": _text(state.get("free_text_intent") or state.get("discovery_focus")),
        "generated_at": _now_iso(),
        "result_note": result_note,
        "ranked_sources": ranked,
    }
