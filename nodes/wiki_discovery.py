from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen

from pydantic import BaseModel, Field

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


def _search_candidates(queries: list[str], limit_per_query: int = 3, max_total: int = 18) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    seen = set()
    for query in (queries or [])[:6]:
        for url in _search_urls(query, limit=limit_per_query):
            key = url.lower()
            if key in seen:
                continue
            seen.add(key)
            snippet = ""
            name = urlparse(url).netloc or url
            try:
                html = _fetch_raw(url, timeout=8)
                snippet = _snippet_from_html(html)
                if " — " in snippet:
                    name = snippet.split(" — ", 1)[0][:160] or name
            except Exception:
                snippet = f"Search hit for query: {query}"
            results.append(
                {
                    "candidate_id": key,
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
                    "status_note": "Verify current eligibility and deadlines on the official page.",
                    "award_amount": "",
                    "deadline_window": "",
                    "competitiveness": "",
                    "status": "unknown",
                    "last_verified_at": "",
                    "verification_notes": "",
                    "snippet": snippet[:500],
                    "search_query": query,
                }
            )
            if len(results) >= max_total:
                return results
    return results


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


class FundingCategory(BaseModel):
    category_name: str = Field(default="")
    description: str = Field(default="")
    best_for: list[str] = Field(default_factory=list)
    example_source_types: list[str] = Field(default_factory=list)
    suggested_queries: list[str] = Field(default_factory=list)


class WikiDraft(BaseModel):
    page_title: str = Field(default="Scholarship Discovery Wiki")
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


def interpret_profile(state):
    """Agent 1: Profile Interpreter."""
    profile = state.get("student_profile") or {}
    model = llm._get_client().with_structured_output(DiscoveryBrief)
    result = model.invoke(
        [
            (
                "system",
                "You are the Scholarship Discovery Profile Interpreter. Build a discovery brief "
                "from the student profile only. Do not recommend scholarships. Do not invent "
                "profile facts. If citizenship, field, or degree level is missing, list it under "
                "missing_fields. Produce 5-10 practical web search queries for finding funding "
                "platforms and official award pages.",
            ),
            (
                "human",
                f"Student profile JSON:\n{json.dumps(profile, default=str)[:12000]}",
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
    return {
        "discovery_brief": {**brief, "profile_summary": summary},
        "search_queries": brief.get("search_queries") or [],
    }


def build_candidate_pool(state):
    """Code: merge curated library + online search hits."""
    library = _library_candidates(state.get("source_library") or [])
    queries = state.get("search_queries") or []
    brief = state.get("discovery_brief") or {}
    if not queries:
        degree = _text(brief.get("degree_level") or "student")
        field = _text(brief.get("field_of_study") or "scholarship")
        queries = [
            f"{degree} scholarships {field}",
            f"{degree} fellowships {field}",
            f"official scholarship database {field}",
        ]
    web = _search_candidates(queries)
    pool = _dedupe_candidates(library + web)[:36]
    return {"candidate_pool": pool}


def _as_platform_item(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(source.get("name")),
        "url": _text(source.get("url")),
        "category": _text(source.get("category")),
        "best_for": source.get("best_for") or [],
        "search_tips": (source.get("search_tips") or [])[:3],
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


def _fill_ranked_quota(
    accepted: list[dict[str, Any]],
    pool: list[dict[str, Any]],
    *,
    platform_target: int = 5,
    specific_target: int = 5,
) -> list[dict[str, Any]]:
    """Ensure we keep up to 5 unique platforms and 5 unique specifics when candidates exist."""
    accepted = _dedupe_by_url(accepted)
    platforms = [item for item in accepted if _is_platform(item)]
    specifics = [item for item in accepted if not _is_platform(item)]
    used = {_text(item.get("url")).lower() for item in accepted if _text(item.get("url"))}

    def add_from_pool(wanted_platform: bool, target: int, bucket: list[dict[str, Any]]) -> None:
        if len(bucket) >= target:
            return
        for source in pool:
            if len(bucket) >= target:
                break
            url = _text(source.get("url")).lower()
            if not url or url in used:
                continue
            if _is_platform(source) != wanted_platform:
                continue
            status = _text(source.get("status") or "active").lower()
            if status in {"expired", "removed"}:
                continue
            kind = _text(source.get("kind")) or ("platform" if wanted_platform else "specific_source")
            filled = {
                "candidate_id": source.get("candidate_id") or url,
                "name": source.get("name"),
                "url": source.get("url"),
                "kind": kind,
                "category": source.get("category", ""),
                "cost": source.get("cost", ""),
                "priority": "Medium",
                "why_recommended": "Additional grounded profile match from the candidate pool.",
                "best_for": source.get("best_for") or [],
                "search_tips": source.get("search_tips") or [],
                "suggested_queries": [],
                "status_estimate": status if status in ALLOWED_STATUSES else "unknown",
                "evidence": "Backfilled from grounded candidate pool to meet recommendation quota.",
                "caveats": "Verify current eligibility and deadlines on the official page.",
                "award_amount": source.get("award_amount", ""),
                "deadline_window": source.get("deadline_window", ""),
                "competitiveness": source.get("competitiveness", ""),
                "status_note": source.get("status_note", "")
                or "Verify current status on the official source page.",
                "origin": source.get("origin"),
            }
            bucket.append(filled)
            used.add(url)

    add_from_pool(True, platform_target, platforms)
    add_from_pool(False, specific_target, specifics)

    platforms = _dedupe_by_url(platforms)[:platform_target]
    specifics = _dedupe_by_url(specifics)[:specific_target]
    merged = platforms + specifics
    merged.sort(key=lambda row: {"High": 0, "Medium": 1, "Low": 2}.get(row.get("priority"), 3))
    return merged


def rank_and_verify_sources(state):
    """Agent 2: Ranker + Freshness Verifier over grounded candidates only."""
    brief = state.get("discovery_brief") or {}
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
                "platforms from specific award pages. Reject only clear degree mismatches and "
                "unsupported identity-restricted awards. Estimate status as active, seasonal, "
                "unknown, expired, or removed. Do not recommend expired or removed items. "
                "IMPORTANT: When enough candidates exist, return about 5 platforms AND about 5 "
                "specific_source items in accepted (10 total when possible). Prefer filling both "
                "quotas with reasonable matches over returning only 1-2 elite items.",
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
        # Prefer pool kind/url so LLM mislabels and duplicate rows cannot break quotas.
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
        }
        if not merged["url"]:
            continue
        accepted.append(merged)
    accepted = _dedupe_by_url(accepted)

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

    accepted = _fill_ranked_quota(accepted, pool, platform_target=5, specific_target=5)
    return {
        "ranked_sources": accepted,
        "rejected_sources": data.get("rejected") or [],
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
                "into the Wiki UI schema. Do not add scholarships beyond the accepted set. "
                "Keep platforms and specific opportunities separate. IMPORTANT: include ALL "
                "accepted platforms in top_free_platforms (up to 5) and ALL accepted specific "
                "sources in specific_opportunities (up to 5). Do not omit accepted items. "
                "Use student-friendly language and honest verify-on-official-page caveats. "
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
        draft["page_title"] = "Scholarship Discovery Wiki"
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
                "You are the Scholarship Wiki Grounding Critic. Audit the draft Wiki output. "
                "ONLY drop items that are invented, missing from the accepted grounded set, "
                "clearly degree-mismatched, or clearly expired/removed. Prefer keep or "
                "downgrade over drop. Do not shrink the lists just because evidence is thin. "
                "Grounded accepted items should usually be kept. Always run this audit.",
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
            # Never drop grounded accepted/ranked URLs; quota backfill owns membership.
            if url and url in protected:
                continue
            drop_keys.add(key)
            drop_keys.add((name, ""))
        elif act == "downgrade":
            downgrade_names.add(name)

    def keep_item(item: dict[str, Any]) -> bool:
        name = _text(item.get("name")).lower()
        url = _text(item.get("url")).lower()
        if url and url in protected:
            return True
        return (name, url) not in drop_keys and (name, "") not in drop_keys

    platforms = [item for item in (draft.get("top_free_platforms") or []) if keep_item(item)][:5]
    specifics = [item for item in (draft.get("specific_opportunities") or []) if keep_item(item)][:5]

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
            "Open two high-priority sources and search with the personalized queries.",
            "Verify deadlines and eligibility on each official page.",
            "When you find a specific scholarship page, send it to the requirement extractor.",
            "Add missing profile details to improve recommendations.",
        ],
        "missing_profile_fields": draft.get("missing_profile_fields") or [],
        "funding_categories": draft.get("funding_categories") or [],
        "page_title": draft.get("page_title") or "Scholarship Discovery Wiki",
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
    return _dedupe_by_url(platforms)[:5], _dedupe_by_url(specifics)[:5]


def finalize_wiki_output(state):
    """Code gates: apply critic, enforce grounding, backfill to 5/5 when possible."""
    draft = state.get("wiki_draft") or {}
    critic = state.get("critic_result") or {}
    pool = state.get("candidate_pool") or state.get("source_library") or []
    ranked = _fill_ranked_quota(
        _dedupe_by_url(state.get("ranked_sources") or []),
        pool,
        platform_target=5,
        specific_target=5,
    )
    protected = _ground_urls(ranked)
    cleaned = _apply_critic(draft, critic, protected_urls=protected)
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

    return {
        "page_title": cleaned.get("page_title") or "Scholarship Discovery Wiki",
        "profile_summary": cleaned.get("profile_summary") or {},
        "recommended_source_groups": cleaned.get("recommended_source_groups") or [],
        "top_free_platforms": cleaned.get("top_free_platforms") or [],
        "specific_opportunities": cleaned.get("specific_opportunities") or [],
        "funding_categories": cleaned.get("funding_categories") or [],
        "personalized_search_queries": cleaned.get("personalized_search_queries") or [],
        "next_steps": cleaned.get("next_steps") or [],
        "missing_profile_fields": cleaned.get("missing_profile_fields") or [],
        "ranked_sources": ranked,
    }
