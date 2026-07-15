from __future__ import annotations

import io
import ipaddress
import re
import socket
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from html import unescape
from html.parser import HTMLParser
from typing import Callable, Iterable
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

import pypdf


MAX_RESPONSE_BYTES = 2_000_000
MAX_SOURCE_CHARS = 16_000
MAX_TOTAL_SOURCE_CHARS = 48_000
SPARSE_SOURCE_CHARS = 650
MAX_SUPPORTING_SOURCES = 4
MAX_SEARCH_RESULTS = 4
CACHE_TTL_SECONDS = 15 * 60
CACHE_MAX_ITEMS = 128

_CACHE_LOCK = Lock()
_FETCH_CACHE: OrderedDict[str, tuple[float, "SourceDocument"]] = OrderedDict()
_SEARCH_CACHE: OrderedDict[str, tuple[float, list[str]]] = OrderedDict()

_RELEVANT_LINK_TERMS = {
    "apply": 8,
    "application": 8,
    "eligibility": 9,
    "eligible": 8,
    "requirements": 8,
    "deadline": 7,
    "timeline": 6,
    "faq": 6,
    "guidelines": 7,
    "scholarship": 5,
    "fellowship": 5,
    "award": 4,
    "selection": 5,
    "essay": 5,
    "materials": 5,
}
_IRRELEVANT_LINK_TERMS = {
    "privacy",
    "cookie",
    "login",
    "sign in",
    "facebook",
    "instagram",
    "linkedin",
    "twitter",
    "donate",
    "news",
    "contact",
}
_GENERIC_NAME_TERMS = {
    "scholarship",
    "scholarships",
    "fellowship",
    "fellowships",
    "program",
    "award",
    "grant",
    "application",
    "official",
}
_KNOWN_AGGREGATORS = {
    "bold.org",
    "scholarships.com",
    "fastweb.com",
    "niche.com",
    "unigo.com",
    "goingmerry.com",
    "careeronestop.org",
}


@dataclass
class SourceDocument:
    url: str
    final_url: str = ""
    title: str = ""
    text: str = ""
    content_type: str = ""
    links: list[tuple[str, str]] = field(default_factory=list)
    authority: str = "supporting"
    fetched: bool = True
    error: str = ""

    def metadata(self) -> dict:
        data = asdict(self)
        data.pop("text", None)
        data.pop("links", None)
        data["url"] = self.final_url or self.url
        data["textChars"] = len(self.text)
        return data


@dataclass
class SourceResolution:
    source_text: str
    source_urls: list[str]
    source_metadata: list[dict]
    warnings: list[str]
    resolution_status: str
    primary_url: str = ""


class _PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self._in_title = False
        self._in_json_ld = False
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self.structured_parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._active_href = ""
        self._active_link_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag == "script" and "ld+json" in str(attrs_dict.get("type") or "").lower():
            self._in_json_ld = True
        elif tag in {"script", "style", "noscript", "svg", "template"}:
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag == "a" and not self._skip_depth:
            self._active_href = str(attrs_dict.get("href") or "").strip()
            self._active_link_text = []
        if tag == "meta" and not self._skip_depth:
            meta_name = str(attrs_dict.get("name") or attrs_dict.get("property") or "").lower()
            content = str(attrs_dict.get("content") or "").strip()
            if content and meta_name in {"description", "og:title", "og:description", "twitter:title", "twitter:description"}:
                self.parts.append(content)
                if meta_name.endswith("title") and not self.title_parts:
                    self.title_parts.append(content)
        if tag in {"p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4", "section"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "a" and self._active_href:
            self.links.append((self._active_href, " ".join(self._active_link_text).strip()))
            self._active_href = ""
            self._active_link_text = []
        if tag == "title":
            self._in_title = False
        if tag == "script" and self._in_json_ld:
            self._in_json_ld = False
        elif tag in {"script", "style", "noscript", "svg", "template"} and self._skip_depth:
            self._skip_depth -= 1
        if tag in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "section"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_json_ld:
            structured = data.strip()
            if structured:
                self.structured_parts.append(structured)
            return
        if self._skip_depth:
            return
        text = unescape(data).strip()
        if not text:
            return
        self.parts.append(text)
        if self._in_title:
            self.title_parts.append(text)
        if self._active_href:
            self._active_link_text.append(text)

    def text(self) -> str:
        raw = " ".join(self.parts)
        if self.structured_parts:
            raw += "\n\nSTRUCTURED PAGE DATA:\n" + "\n".join(self.structured_parts)
        raw = re.sub(r"[ \t]+", " ", raw)
        raw = re.sub(r"\n\s*\n+", "\n\n", raw)
        return raw.strip()

    def title(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.title_parts)).strip()


def normalize_url(value: str) -> str:
    text = str(value or "").strip()
    if text and not text.startswith(("http://", "https://")):
        text = f"https://{text}"
    return text


def is_fetchable_url(value: str) -> bool:
    parsed = urlparse(normalize_url(value))
    return parsed.scheme in {"http", "https"} and bool(parsed.hostname and "." in parsed.hostname)


def _is_safe_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def assert_safe_public_url(url: str) -> str:
    normalized = normalize_url(url)
    if not is_fetchable_url(normalized):
        raise ValueError("Only complete public HTTP(S) URLs are supported.")
    parsed = urlparse(normalized)
    host = parsed.hostname or ""
    if parsed.username or parsed.password:
        raise ValueError("URLs containing embedded credentials are not allowed.")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("The source URL contains an invalid port.") from exc
    if port not in {None, 80, 443}:
        raise ValueError("Only standard HTTP and HTTPS ports are allowed.")
    if host.lower() in {"localhost", "localhost.localdomain"}:
        raise ValueError("Local and private network URLs are not allowed.")
    try:
        default_port = 443 if parsed.scheme == "https" else 80
        addresses = {item[4][0] for item in socket.getaddrinfo(host, port or default_port, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve source host: {host}") from exc
    if not addresses or any(not _is_safe_ip(address) for address in addresses):
        raise ValueError("Local, private, reserved, and metadata network URLs are not allowed.")
    return normalized


class _SafeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        assert_safe_public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open_url(url: str, timeout: int = 7):
    safe_url = assert_safe_public_url(url)
    request = Request(
        safe_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/124.0 Scholar-E/0.2"
            ),
            "Accept": "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.3",
        },
    )
    return build_opener(_SafeRedirectHandler()).open(request, timeout=timeout)


def _pdf_text(body: bytes) -> str:
    reader = pypdf.PdfReader(io.BytesIO(body))
    pages = []
    for page in reader.pages[:80]:
        text = page.extract_text()
        if text:
            pages.append(text)
    return "\n".join(pages).strip()


def _fetch_source_uncached(url: str, timeout: int = 7) -> SourceDocument:
    normalized = normalize_url(url)
    try:
        with _open_url(normalized, timeout=timeout) as response:
            content_type = str(response.headers.get("content-type") or "").lower()
            final_url = str(response.geturl() or normalized)
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("Source response exceeded the 2 MB safety limit.")
        if "pdf" in content_type or final_url.lower().endswith(".pdf"):
            return SourceDocument(
                url=normalized,
                final_url=final_url,
                title=final_url.rsplit("/", 1)[-1],
                text=_pdf_text(body),
                content_type=content_type or "application/pdf",
            )
        if not any(kind in content_type for kind in ("html", "text/plain", "xhtml", "")):
            raise ValueError(f"Unsupported source content type: {content_type}")
        decoded = body.decode("utf-8", errors="ignore")
        if "html" not in content_type and "<html" not in decoded[:1000].lower():
            return SourceDocument(
                url=normalized,
                final_url=final_url,
                title=final_url.rsplit("/", 1)[-1],
                text=decoded.strip(),
                content_type=content_type or "text/plain",
            )
        parser = _PageParser()
        parser.feed(decoded)
        links = [(urljoin(final_url, href), label) for href, label in parser.links if href]
        return SourceDocument(
            url=normalized,
            final_url=final_url,
            title=parser.title(),
            text=parser.text(),
            content_type=content_type or "text/html",
            links=links,
        )
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, pypdf.errors.PdfReadError) as exc:
        return SourceDocument(url=normalized, final_url=normalized, fetched=False, error=str(exc)[:500])


def _cache_get(cache, key):
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = cache.get(key)
        if not cached:
            return None
        created_at, value = cached
        if now - created_at > CACHE_TTL_SECONDS:
            cache.pop(key, None)
            return None
        cache.move_to_end(key)
        return deepcopy(value)


def _cache_put(cache, key, value):
    with _CACHE_LOCK:
        cache[key] = (time.monotonic(), deepcopy(value))
        cache.move_to_end(key)
        while len(cache) > CACHE_MAX_ITEMS:
            cache.popitem(last=False)


def fetch_source(url: str, timeout: int = 7) -> SourceDocument:
    key = normalize_url(url).lower()
    cached = _cache_get(_FETCH_CACHE, key)
    if cached is not None:
        return cached
    document = _fetch_source_uncached(url, timeout=timeout)
    if document.fetched:
        _cache_put(_FETCH_CACHE, key, document)
    return deepcopy(document)


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def _same_organization_host(left: str, right: str) -> bool:
    left_host, right_host = _host(left), _host(right)
    return bool(left_host and right_host and (left_host == right_host or left_host.endswith(f".{right_host}") or right_host.endswith(f".{left_host}")))


def _authority(url: str, primary_url: str, *, from_search: bool = False) -> str:
    host = _host(url)
    if primary_url and _same_organization_host(url, primary_url):
        return "primary" if normalize_url(url) == normalize_url(primary_url) else "official_supporting"
    if any(host == item or host.endswith(f".{item}") for item in _KNOWN_AGGREGATORS):
        return "aggregator"
    if host.endswith((".gov", ".edu")):
        return "institutional"
    return "search_result" if from_search else "supporting"


def _is_aggregator_url(url: str) -> bool:
    host = _host(url)
    return any(host == item or host.endswith(f".{item}") for item in _KNOWN_AGGREGATORS)


def _name_tokens(name: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", str(name or "").lower())
        if len(token) >= 4 and token not in _GENERIC_NAME_TERMS
    }


def _looks_mismatched(document: SourceDocument, scholarship_name: str) -> bool:
    tokens = _name_tokens(scholarship_name)
    if not tokens or not document.fetched:
        return False
    haystack = f"{document.title} {document.text[:5000]}".lower()
    matches = sum(token in haystack for token in tokens)
    required = 1 if len(tokens) <= 2 else 2
    return matches < required


def _is_sparse(document: SourceDocument) -> bool:
    return not document.fetched or len(document.text.strip()) < SPARSE_SOURCE_CHARS


def _important_coverage(document: SourceDocument) -> int:
    text = document.text.lower()
    groups = [
        ("eligib", "applicants must", "requirements"),
        ("deadline", "due date", "applications close"),
        ("award amount", "stipend", "tuition", "$"),
        ("transcript", "recommendation", "essay", "required materials"),
        ("apply", "application portal", "application process"),
    ]
    return sum(any(term in text for term in group) for group in groups)


def _link_score(url: str, label: str, primary_url: str) -> int:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not _same_organization_host(url, primary_url):
        return -100
    blob = f"{url} {label}".lower().replace("_", "-")
    if any(term in blob for term in _IRRELEVANT_LINK_TERMS):
        return -100
    score = sum(weight for term, weight in _RELEVANT_LINK_TERMS.items() if term in blob)
    if parsed.path.lower().endswith(".pdf"):
        score += 7
    if normalize_url(url).rstrip("/") == normalize_url(primary_url).rstrip("/"):
        return -100
    return score


def select_supporting_links(document: SourceDocument, limit: int = MAX_SUPPORTING_SOURCES) -> list[str]:
    primary_url = document.final_url or document.url
    scored: list[tuple[int, str]] = []
    seen = set()
    for url, label in document.links:
        clean = url.split("#", 1)[0]
        key = clean.lower().rstrip("/")
        if not key or key in seen:
            continue
        seen.add(key)
        score = _link_score(clean, label, primary_url)
        if score > 0:
            scored.append((score, clean))
    scored.sort(key=lambda item: (-item[0], len(item[1])))
    return [url for _, url in scored[:limit]]


def _search_opportunity_urls_uncached(query: str, limit: int = MAX_SEARCH_RESULTS) -> list[str]:
    if not query.strip():
        return []
    search_url = f"https://duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        with _open_url(search_url, timeout=6) as response:
            html = response.read(MAX_RESPONSE_BYTES).decode("utf-8", errors="ignore")
    except Exception:
        return []
    urls: list[str] = []
    patterns = [
        r'href="([^"]+)"[^>]*class="result__a"',
        r'class="result__a"[^>]*href="([^"]+)"',
        r'href="([^"]*uddg=[^"]+)"',
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, html, flags=re.I):
            href = unescape(match.group(1))
            parsed = urlparse(href)
            if "uddg" in parsed.query:
                target = parse_qs(parsed.query).get("uddg", [""])[0]
                href = unquote(target) if target else href
            if not is_fetchable_url(href):
                continue
            host = _host(href)
            if host.endswith(("duckduckgo.com", "duck.com")) or href in urls:
                continue
            urls.append(href)
            if len(urls) >= limit:
                return urls
    return urls


def search_opportunity_urls(query: str, limit: int = MAX_SEARCH_RESULTS) -> list[str]:
    key = re.sub(r"\s+", " ", query.strip().lower())
    cached = _cache_get(_SEARCH_CACHE, key)
    if cached is not None:
        return cached[:limit]
    urls = _search_opportunity_urls_uncached(query, limit=max(limit, MAX_SEARCH_RESULTS))
    _cache_put(_SEARCH_CACHE, key, urls)
    return urls[:limit]


def _search_queries(name: str, notes: str, original_url: str) -> list[str]:
    clean_name = str(name or "").strip()
    note_hint = re.sub(r"\s+", " ", str(notes or "").strip())[:220]
    host = _host(original_url)
    queries = []
    if clean_name:
        queries.extend(
            [
                f'"{clean_name}" official scholarship',
                f'"{clean_name}" eligibility deadline',
                f'"{clean_name}" application guidelines PDF',
            ]
        )
        if host and not any(host == item or host.endswith(f".{item}") for item in _KNOWN_AGGREGATORS):
            queries.insert(0, f'site:{host} "{clean_name}" eligibility application')
    elif note_hint:
        queries.append(f"{note_hint} scholarship official eligibility deadline")
    return queries[:4]


def _dedupe_documents(documents: Iterable[SourceDocument]) -> list[SourceDocument]:
    result = []
    seen = set()
    for document in documents:
        key = (document.final_url or document.url).lower().rstrip("/")
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(document)
    return result


def _fetch_many(urls: Iterable[str], fetcher: Callable[[str], SourceDocument]) -> list[SourceDocument]:
    unique = list(dict.fromkeys(urls))[:MAX_SUPPORTING_SOURCES]
    if not unique:
        return []
    results: list[SourceDocument] = []
    with ThreadPoolExecutor(max_workers=min(4, len(unique))) as executor:
        futures = {executor.submit(fetcher, url): url for url in unique}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as exc:
                results.append(SourceDocument(url=futures[future], fetched=False, error=str(exc)[:500]))
    order = {url: index for index, url in enumerate(unique)}
    results.sort(key=lambda document: order.get(document.url, len(order)))
    return results


def _relevant_excerpt(text: str, limit: int = MAX_SOURCE_CHARS) -> str:
    clean = re.sub(r"[ \t]+", " ", str(text or "")).strip()
    if len(clean) <= limit:
        return clean
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n|(?<=[.!?])\s+(?=[A-Z])", clean) if part.strip()]
    keywords = tuple(_RELEVANT_LINK_TERMS) + (
        "citizen",
        "resident",
        "gpa",
        "major",
        "degree",
        "amount",
        "stipend",
        "transcript",
        "recommendation",
    )
    ranked = []
    for index, paragraph in enumerate(paragraphs):
        lowered = paragraph.lower()
        score = sum(1 for keyword in keywords if keyword in lowered)
        if index < 8:
            score += 1
        ranked.append((score, index, paragraph))
    selected = sorted(sorted(ranked, key=lambda row: (-row[0], row[1]))[:80], key=lambda row: row[1])
    excerpt = "\n\n".join(row[2] for row in selected)
    return excerpt[:limit]


def _compose_source_text(documents: list[SourceDocument], notes: str, name: str, original_url: str) -> str:
    chunks: list[str] = []
    used = 0
    for document in documents:
        if not document.fetched or not document.text.strip():
            continue
        excerpt = _relevant_excerpt(document.text)
        remaining = MAX_TOTAL_SOURCE_CHARS - used
        if remaining <= 0:
            break
        excerpt = excerpt[:remaining]
        used += len(excerpt)
        chunks.append(
            "\n".join(
                [
                    f"SOURCE URL: {document.final_url or document.url}",
                    f"SOURCE AUTHORITY: {document.authority}",
                    f"SOURCE TITLE: {document.title or 'Not available'}",
                    excerpt,
                ]
            )
        )
    if notes.strip():
        chunks.append(f"USER-PROVIDED NOTES (clues only; not authoritative):\n{notes.strip()}")
    if name.strip():
        chunks.append(f"USER-PROVIDED SCHOLARSHIP NAME (identity clue):\n{name.strip()}")
    if original_url.strip():
        chunks.append(f"USER-PROVIDED URL:\n{original_url.strip()}")
    return "\n\n---\n\n".join(chunks).strip()


def resolve_opportunity_sources(
    scholarship_name: str,
    scholarship_url: str,
    additional_notes: str,
    *,
    fetcher: Callable[[str], SourceDocument] = fetch_source,
    searcher: Callable[[str, int], list[str]] = search_opportunity_urls,
) -> SourceResolution:
    warnings: list[str] = []
    documents: list[SourceDocument] = []
    identity_name = scholarship_name
    url_clue = scholarship_url
    if not scholarship_url.strip() and is_fetchable_url(scholarship_name):
        url_clue = scholarship_name
        identity_name = ""
    primary_url = normalize_url(url_clue) if url_clue.strip() and is_fetchable_url(url_clue) else ""

    if scholarship_url.strip() and not primary_url:
        warnings.append("The pasted URL was incomplete or malformed, so it was used only as a search clue.")

    primary = fetcher(primary_url) if primary_url else None
    if primary:
        primary.authority = "aggregator" if _is_aggregator_url(primary.final_url or primary.url) else "primary"
        documents.append(primary)
        if not primary.fetched:
            warnings.append(f"The pasted page could not be read: {primary.error or 'unknown fetch error'}")
        elif _is_sparse(primary):
            warnings.append("The pasted page contained too little readable scholarship information, so fallback search was used.")
        elif _looks_mismatched(primary, identity_name):
            warnings.append("The pasted page did not clearly match the supplied scholarship name, so fallback search was used.")
        elif primary.authority == "aggregator":
            warnings.append("The pasted page is a scholarship aggregator, so Scholar-E searched for a more authoritative sponsor source.")

    needs_fallback = (
        primary is None
        or _is_sparse(primary)
        or _looks_mismatched(primary, identity_name)
        or primary.authority == "aggregator"
    )
    primary_links = select_supporting_links(primary) if primary and primary.fetched else []
    needs_enrichment = bool(
        primary
        and primary.fetched
        and not needs_fallback
        and _important_coverage(primary) < 3
        and not primary_links
    )
    search_urls: list[str] = []
    if needs_fallback or needs_enrichment:
        if needs_enrichment:
            warnings.append("The pasted page lacked several important requirement sections, so a bounded enrichment search was used.")
        for query in _search_queries(identity_name, additional_notes, url_clue):
            for url in searcher(query, MAX_SEARCH_RESULTS):
                if url not in search_urls and url != primary_url:
                    search_urls.append(url)
                if len(search_urls) >= MAX_SEARCH_RESULTS:
                    break
            if len(search_urls) >= MAX_SEARCH_RESULTS:
                break
        searched = _fetch_many(search_urls, fetcher)
        for document in searched:
            document.authority = _authority(document.final_url or document.url, primary_url, from_search=True)
        documents.extend(searched)

    viable = [document for document in documents if document.fetched and document.text.strip()]
    if viable:
        best_primary = viable[0]
        if primary is None or not primary.fetched or _is_sparse(primary) or _looks_mismatched(primary, identity_name):
            matching = [
                document
                for document in viable
                if not _is_sparse(document) and not _looks_mismatched(document, identity_name)
            ]
            if matching:
                authority_order = {"primary": 0, "official_supporting": 1, "institutional": 2, "supporting": 3, "search_result": 4, "aggregator": 5}
                matching.sort(
                    key=lambda document: (
                        authority_order.get(document.authority, 6),
                        -_important_coverage(document),
                        -len(document.text),
                    )
                )
                best_primary = matching[0]
                primary_url = best_primary.final_url or best_primary.url
                best_primary.authority = _authority(primary_url, primary_url)
        supporting_urls = select_supporting_links(best_primary)
        supporting = _fetch_many(
            [url for url in supporting_urls if all((doc.final_url or doc.url).lower().rstrip("/") != url.lower().rstrip("/") for doc in documents)],
            fetcher,
        )
        for document in supporting:
            document.authority = _authority(document.final_url or document.url, primary_url)
        documents.extend(supporting)

    documents = _dedupe_documents(documents)
    for document in documents:
        if not document.fetched and document.error:
            warnings.append(f"Could not read {document.url}: {document.error}")

    fetched = [document for document in documents if document.fetched and document.text.strip()]
    source_urls = [document.final_url or document.url for document in fetched]
    source_text = _compose_source_text(fetched, additional_notes, identity_name, url_clue)
    if not fetched:
        resolution_status = "unresolved"
        warnings.append("No readable authoritative source was found; unsupported fields were left blank.")
    elif needs_fallback:
        resolution_status = "resolved_with_fallback"
    elif needs_enrichment:
        resolution_status = "resolved_with_search_enrichment"
    elif len(fetched) > 1:
        resolution_status = "resolved_with_supporting_sources"
    else:
        resolution_status = "resolved_from_pasted_url"

    return SourceResolution(
        source_text=source_text,
        source_urls=source_urls,
        source_metadata=[document.metadata() for document in documents],
        warnings=list(dict.fromkeys(warnings)),
        resolution_status=resolution_status,
        primary_url=primary_url,
    )
