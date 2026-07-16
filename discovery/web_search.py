from __future__ import annotations

import json
import re
import ssl
from html import unescape
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen

from config import settings

TAVILY_ENDPOINT = "https://api.tavily.com/search"

# A corrupt certificate in the Windows system store can break Python's default
# SSL context entirely (ASN1: NOT_ENOUGH_DATA). Prefer the certifi bundle so
# web search works regardless of the machine's cert store.
def _build_ssl_context() -> ssl.SSLContext | None:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return None


SSL_CONTEXT = _build_ssl_context()


def open_url(request: Request | str, timeout: int = 10):
    """urlopen wrapper that survives a broken system certificate store."""
    return urlopen(request, timeout=timeout, context=SSL_CONTEXT)


def _fetch_raw(url: str, timeout: int = 10) -> str:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 Scholar-E-Wiki/0.1"})
    with open_url(request, timeout=timeout) as response:
        return response.read(800_000).decode("utf-8", errors="ignore")


def _tavily_search(query: str, limit: int) -> list[dict[str, str]]:
    body = json.dumps({"query": query, "max_results": max(1, min(limit, 10))}).encode("utf-8")
    request = Request(
        TAVILY_ENDPOINT,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.tavily_api_key}",
        },
        method="POST",
    )
    with open_url(request, timeout=12) as response:
        payload = json.loads(response.read(2_000_000).decode("utf-8", errors="ignore"))
    hits = []
    for item in payload.get("results") or []:
        url = str(item.get("url") or "").strip()
        if not url.startswith("http"):
            continue
        hits.append(
            {
                "url": url,
                "title": str(item.get("title") or "").strip()[:200],
                "snippet": str(item.get("content") or "").strip()[:500],
            }
        )
        if len(hits) >= limit:
            break
    return hits


def _ddg_search(query: str, limit: int) -> list[dict[str, str]]:
    endpoints = [
        f"https://lite.duckduckgo.com/lite/?q={quote_plus(query)}",
        f"https://duckduckgo.com/html/?q={quote_plus(query)}",
    ]
    hits: list[dict[str, str]] = []
    seen: set[str] = set()
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
                if href in seen:
                    continue
                seen.add(href)
                hits.append({"url": href, "title": "", "snippet": ""})
                if len(hits) >= limit:
                    return hits
        if hits:
            break
    return hits


def search_web(query: str, limit: int = 4) -> list[dict[str, str]]:
    """Search the live web, preferring Tavily when a key is configured.

    Returns hits shaped as {"url", "title", "snippet"}; DDG fallback hits carry
    empty title/snippet since only result links can be scraped reliably.
    """
    if not query.strip():
        return []
    if settings.tavily_api_key:
        try:
            hits = _tavily_search(query, limit)
            if hits:
                return hits
        except Exception:
            pass
    return _ddg_search(query, limit)
