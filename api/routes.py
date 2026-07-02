# api/routes.py
"""API layer for ScholarlE Engen, exposing the coaching pipeline."""

import hashlib
import io
import json
import re
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, Optional
from urllib.error import URLError
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen

import pypdf
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field
from fastapi import HTTPException, UploadFile

from config import settings
from rag.store import ChromaStore
from graph.builder import build_application_graph
from graph.fit_builder import build_fit_analysis_graph
from graph.opportunity_builder import build_opportunity_extraction_graph
from graph.profile_builder import build_profile_extraction_graph
from graph.wiki_builder import build_wiki_discovery_graph
from persistence.services import default_user_id, run_agent_with_persistence


class AnalyzeRequest(BaseModel):
    user_id: str = Field(default="", max_length=100)
    cv_text: str = Field(..., min_length=1, max_length=50000)
    essay_text: str = Field(..., min_length=1, max_length=20000)
    scholarship_name: str = Field(..., min_length=1, max_length=500)
    scholarship_type: str = Field(..., min_length=1, max_length=200)
    prompt: str = Field(..., min_length=1, max_length=10000)
    previous_readiness: Optional[Dict[str, int]] = None
    draft_number: int = Field(default=1, ge=1, le=50)


class ProfileAutofillResponse(BaseModel):
    name: str = ""
    email: str = ""
    location: str = ""
    careerGoal: str = ""
    educationLevel: str = ""
    highSchool: dict = Field(default_factory=dict)
    undergrad: dict = Field(default_factory=dict)
    graduate: dict = Field(default_factory=dict)
    educationHistory: list[dict] = Field(default_factory=list)
    researchExperience: list[dict] = Field(default_factory=list)
    workExperience: list[dict] = Field(default_factory=list)
    optional: dict = Field(default_factory=dict)


class OpportunityExtractRequest(BaseModel):
    user_id: str = Field(default="", max_length=100)
    scholarship_name: str = Field(default="", max_length=500)
    scholarship_url: str = Field(default="", max_length=2000)
    additional_notes: str = Field(default="", max_length=12000)


class OpportunityExtractResponse(BaseModel):
    name: str = ""
    organization: str = ""
    type: str = ""
    country: str = ""
    officialWebsite: str = ""
    url: str = ""
    applicationOpens: str = ""
    awardAmount: str = ""
    applicationDeadline: str = ""
    notificationDate: str = ""
    programStart: str = ""
    programEnd: str = ""
    currentStatus: str = ""
    description: str = ""
    minimumGpa: str = ""
    enrollmentLevel: str = ""
    citizenshipRequirement: str = ""
    financialNeedRequirement: str = ""
    locationRequirement: str = ""
    eligibleMajors: str = ""
    otherEligibilityRules: str = ""
    requiredDocumentTypes: list[str] = Field(default_factory=list)
    otherRequiredMaterials: str = ""
    essayPrompts: str = ""
    eligibilityRequirements: list[str] = Field(default_factory=list)
    requiredApplicationMaterials: list[str] = Field(default_factory=list)
    benefits: list[str] = Field(default_factory=list)
    selectionCriteria: list[str] = Field(default_factory=list)
    applicationProcess: list[str] = Field(default_factory=list)
    missingInformation: list[str] = Field(default_factory=list)
    importantNotes: list[str] = Field(default_factory=list)
    requirements: list[dict] = Field(default_factory=list)
    requirementsPreview: str = ""
    fullText: str = ""
    sourceUrls: list[str] = Field(default_factory=list)


class FitAnalyzeRequest(BaseModel):
    user_id: str = Field(default="", max_length=100)
    scholarship_record: dict = Field(default_factory=dict)
    student_profile: dict = Field(default_factory=dict)


class FitAnalyzeResponse(BaseModel):
    scholarship_name: str = ""
    fit_label: str = ""
    fit_score: int = 0
    likely_eligible: str = ""
    summary: str = ""
    eligibility_analysis: list[dict] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    gaps_or_risks: list[str] = Field(default_factory=list)
    missing_student_information: list[str] = Field(default_factory=list)
    application_materials_check: list[dict] = Field(default_factory=list)
    selection_criteria_alignment: list[dict] = Field(default_factory=list)
    recommended_next_steps: list[str] = Field(default_factory=list)
    application_readiness_matrix: dict = Field(default_factory=dict)


class WikiDiscoverRequest(BaseModel):
    user_id: str = Field(default="", max_length=100)
    student_profile: dict = Field(default_factory=dict)


class WikiDiscoverResponse(BaseModel):
    page_title: str = "Scholarship Discovery Wiki"
    profile_summary: dict = Field(default_factory=dict)
    recommended_source_groups: list[dict] = Field(default_factory=list)
    top_free_platforms: list[dict] = Field(default_factory=list)
    specific_opportunities: list[dict] = Field(default_factory=list)
    funding_categories: list[dict] = Field(default_factory=list)
    personalized_search_queries: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    missing_profile_fields: list[str] = Field(default_factory=list)


def _text_to_chunks(text: str, source: str) -> list:
    doc = Document(page_content=text.strip(), metadata={"source": source})
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    return splitter.split_documents([doc])


def _build_opportunity_text(
    scholarship_name: str,
    scholarship_type: str,
    prompt: str,
) -> str:
    return (
        f"Scholarship: {scholarship_name}\n"
        f"Type: {scholarship_type}\n\n"
        f"{prompt.strip()}"
    )


def _profile_store_path(profile_text: str) -> Path:
    profile_hash = hashlib.sha256(profile_text.strip().encode("utf-8")).hexdigest()[:16]
    return Path(settings.profile_vector_db_path) / profile_hash


def _has_existing_chroma_store(path: Path) -> bool:
    return (path / "chroma.sqlite3").exists()


def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        page_text = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                page_text.append(text)
        return "\n".join(page_text).strip()
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to parse PDF text: {str(exc)}",
        ) from exc


class _ReadableTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag in {"p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if tag in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip_depth:
            text = data.strip()
            if text:
                self.parts.append(text)

    def text(self) -> str:
        raw = " ".join(self.parts)
        raw = re.sub(r"[ \t]+", " ", raw)
        raw = re.sub(r"\n\s*\n+", "\n\n", raw)
        return unescape(raw).strip()


def _looks_like_url(value: str) -> bool:
    text = value.strip()
    return text.startswith(("http://", "https://")) or "." in text and " " not in text


def _normalize_url(value: str) -> str:
    text = value.strip()
    if text and not text.startswith(("http://", "https://")):
        return f"https://{text}"
    return text


def _fetch_page_text(url: str, timeout: int = 12) -> str:
    request = Request(
        _normalize_url(url),
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Scholar-E/0.1"
            )
        },
    )
    with urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("content-type", "")
        body = response.read(1_500_000)
    if "pdf" in content_type.lower() or url.lower().endswith(".pdf"):
        return extract_text_from_pdf(body)
    html = body.decode("utf-8", errors="ignore")
    parser = _ReadableTextParser()
    parser.feed(html)
    return parser.text()


def _search_opportunity_urls(query: str, limit: int = 3) -> list[str]:
    if not query.strip():
        return []
    search_url = f"https://duckduckgo.com/html/?q={quote_plus(query + ' scholarship requirements deadline')}"
    try:
        html = _fetch_raw(search_url)
    except Exception:
        return []
    urls = []
    for match in re.finditer(r'href="([^"]+)"[^>]*class="result__a"', html):
        href = unescape(match.group(1))
        parsed = urlparse(href)
        if parsed.netloc.endswith("duckduckgo.com"):
            target = parse_qs(parsed.query).get("uddg", [""])[0]
            href = unquote(target) if target else href
        if href.startswith("http") and href not in urls:
            urls.append(href)
        if len(urls) >= limit:
            break
    return urls


def _fetch_raw(url: str, timeout: int = 12) -> str:
    request = Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 Scholar-E/0.1"},
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read(1_500_000).decode("utf-8", errors="ignore")


def _gather_opportunity_source_text(request: OpportunityExtractRequest) -> tuple[str, list[str]]:
    source_urls = []
    chunks = []

    if request.scholarship_url.strip():
        source_urls.append(_normalize_url(request.scholarship_url))
    elif _looks_like_url(request.scholarship_name):
        source_urls.append(_normalize_url(request.scholarship_name))
    else:
        source_urls.extend(_search_opportunity_urls(request.scholarship_name))

    for url in source_urls[:4]:
        try:
            text = _fetch_page_text(url)
        except (HTTPException, URLError, TimeoutError, ValueError):
            continue
        if text:
            chunks.append(f"SOURCE URL: {url}\n{text[:12000]}")

    if request.additional_notes.strip():
        chunks.append(f"USER NOTES:\n{request.additional_notes.strip()}")
    if request.scholarship_name.strip():
        chunks.append(f"USER SCHOLARSHIP NAME/QUERY:\n{request.scholarship_name.strip()}")
    if request.scholarship_url.strip():
        chunks.append(f"USER SCHOLARSHIP URL/SOURCE:\n{request.scholarship_url.strip()}")

    return "\n\n---\n\n".join(chunks).strip(), source_urls


def run_application_pipeline(
    opportunity_text: str,
    student_draft: str,
    profile_text: str,
    previous_readiness: Optional[Dict[str, int]] = None,
    draft_number: int = 1,
) -> dict:
    profile_docs = _text_to_chunks(profile_text, "uploaded_cv")
    profile_store_path = _profile_store_path(profile_text)
    profile_store_path.parent.mkdir(parents=True, exist_ok=True)
    has_existing = _has_existing_chroma_store(profile_store_path)
    profile_store = ChromaStore(
        documents=None if has_existing else profile_docs,
        persist_directory=str(profile_store_path),
        ephemeral=not has_existing,
    )

    try:
        graph = build_application_graph(profile_store)
        return graph.invoke({
            "opportunity_text": opportunity_text,
            "student_profile_docs": profile_docs,
            "student_draft": student_draft,
            "previous_readiness": previous_readiness or {},
            "draft_number": draft_number,
        })
    finally:
        profile_store.close()


def analyze_application(request: AnalyzeRequest) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    opportunity_text = _build_opportunity_text(
        request.scholarship_name,
        request.scholarship_type,
        request.prompt,
    )

    result, _ = run_agent_with_persistence(
        user_id=request.user_id,
        agent_name="essay_application_coaching",
        input_json={
            "cv_text_chars": len(request.cv_text),
            "essay_text_chars": len(request.essay_text),
            "scholarship_name": request.scholarship_name,
            "scholarship_type": request.scholarship_type,
            "prompt_chars": len(request.prompt),
            "draft_number": request.draft_number,
        },
        run_fn=lambda _: run_application_pipeline(
            opportunity_text=opportunity_text,
            student_draft=request.essay_text,
            profile_text=request.cv_text,
            previous_readiness=request.previous_readiness,
            draft_number=request.draft_number,
        ),
    )

    return {
        "coaching_brief": result.get("coaching_brief", {}),
        "readiness_index": result.get("readiness_index", {}),
        "growth_report": result.get("growth_report", {}),
        "reviewer_comments": result.get("reviewer_comments", []),
        "coaching_reports": result.get("coaching_reports", {}),
        "eligibility_matrix": result.get("eligibility_matrix", {}),
        "essay_alignment_matrix": result.get("essay_alignment_matrix", {}),
        "feedback": result.get("feedback", ""),
        "section_coaching": result.get("section_coaching", {}),
        "opportunity_analysis": result.get("opportunity_analysis", {}),
        "critique": result.get("critique", {}),
        "final_application_package": result.get("final_application_package", ""),
        "revision_priorities": result.get("revision_priorities", []),
        "draft_number": result.get("draft_number", request.draft_number),
    }


async def autofill_profile_from_resume(file: UploadFile) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Please upload a PDF.",
        )

    file_bytes = await file.read()
    raw_resume_text = extract_text_from_pdf(file_bytes)
    if not raw_resume_text:
        raise HTTPException(
            status_code=422,
            detail="The uploaded PDF appears to be empty or unreadable.",
        )

    graph = build_profile_extraction_graph()
    result, _ = run_agent_with_persistence(
        user_id=default_user_id(),
        agent_name="resume_profile_extraction",
        input_json={
            "filename": file.filename or "",
            "content_type": file.content_type or "",
            "resume_text_chars": len(raw_resume_text),
        },
        run_fn=lambda _: graph.invoke({"resume_text": raw_resume_text}),
    )
    response = ProfileAutofillResponse(**result)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response.dict()


def extract_scholarship_opportunity(request: OpportunityExtractRequest) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    if not (
        request.scholarship_name.strip()
        or request.scholarship_url.strip()
        or request.additional_notes.strip()
    ):
        raise HTTPException(
            status_code=400,
            detail="Enter a scholarship name, link, source, or notes before extracting requirements.",
        )

    source_text, source_urls = _gather_opportunity_source_text(request)
    if not source_text:
        source_text = "\n\n".join(
            [
                request.scholarship_name.strip(),
                request.scholarship_url.strip(),
                request.additional_notes.strip(),
            ]
        ).strip()

    graph = build_opportunity_extraction_graph()
    payload = {
            "scholarship_name": request.scholarship_name,
            "scholarship_url": request.scholarship_url,
            "additional_notes": request.additional_notes,
            "source_text": source_text,
            "source_urls": source_urls,
    }
    result, _ = run_agent_with_persistence(
        user_id=request.user_id,
        agent_name="scholarship_requirements_extraction",
        input_json={
            "scholarship_name": request.scholarship_name,
            "scholarship_url": request.scholarship_url,
            "additional_notes_chars": len(request.additional_notes),
            "source_text_chars": len(source_text),
            "source_url_count": len(source_urls),
        },
        run_fn=lambda _: graph.invoke(payload),
    )
    response = OpportunityExtractResponse(**result)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response.dict()


def analyze_scholarship_fit(request: FitAnalyzeRequest) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    if not request.scholarship_record:
        raise HTTPException(
            status_code=400,
            detail="Extract and review scholarship requirements before analyzing fit.",
        )
    if not request.student_profile:
        raise HTTPException(
            status_code=400,
            detail="Create a student profile before analyzing fit.",
        )

    graph = build_fit_analysis_graph()
    payload = {
            "scholarship_record": request.scholarship_record,
            "student_profile": request.student_profile,
    }
    result, _ = run_agent_with_persistence(
        user_id=request.user_id,
        agent_name="scholarship_fit_analysis",
        input_json={
            "scholarship_name": request.scholarship_record.get("name") or request.scholarship_record.get("scholarship_name", ""),
            "profile_keys": sorted(request.student_profile.keys()),
        },
        run_fn=lambda _: graph.invoke(payload),
    )
    response = FitAnalyzeResponse(**result)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response.dict()


def _load_wiki_source_library() -> list[dict]:
    library_path = Path(__file__).resolve().parent.parent / "data" / "scholarship_source_library.json"
    try:
        return json.loads(library_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Scholarship source library could not be loaded.") from exc


def discover_scholarship_wiki(request: WikiDiscoverRequest) -> dict:
    graph = build_wiki_discovery_graph()
    payload = {
            "student_profile": request.student_profile,
            "source_library": _load_wiki_source_library(),
    }
    result, _ = run_agent_with_persistence(
        user_id=request.user_id,
        agent_name="scholarship_discovery_wiki",
        input_json={
            "profile_keys": sorted(request.student_profile.keys()),
            "education_level": request.student_profile.get("educationLevel", ""),
            "has_opportunity_preferences": bool(request.student_profile.get("opportunityPreferences")),
        },
        run_fn=lambda _: graph.invoke(payload),
    )
    response = WikiDiscoverResponse(**result)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response.dict()
