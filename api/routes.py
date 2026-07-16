# api/routes.py
"""API layer for ScholarlE Engen, exposing the coaching pipeline."""

import hashlib
import io
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Optional

import pypdf
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field
from fastapi import HTTPException, UploadFile

from config import settings
from essay_coaching_service import run_essay_workspace_coach, run_selection_rewrite
from essay_mechanics import apply_deterministic_mechanics
from graph.builder import build_application_graph
from graph.fit_builder import build_fit_analysis_graph
from graph.opportunity_builder import build_opportunity_extraction_graph
from graph.profile_builder import build_profile_extraction_graph
from graph.wiki_builder import build_wiki_discovery_graph
from discovery.compatibility import assess_candidate
from discovery.evidence import candidate_evidence
from discovery.intent_service import generate_intent_options
from discovery.normalization import build_discovery_context
from discovery.ranking import score_candidate
from discovery.schemas import model_dict
from llm.client import llm
from persistence.memory_text import (
    build_feedback_memory_text,
    build_profile_memory_text,
    build_scholarship_memory_text,
)
from persistence.services import (
    ProfileService,
    ScholarshipService,
    default_user_id,
    run_agent_with_persistence,
)
from persistence.vector_service import VectorService
from utils.opportunity_sources import resolve_opportunity_sources


class AnalyzeRequest(BaseModel):
    user_id: str = Field(default="", max_length=100)
    cv_text: str = Field(..., min_length=1, max_length=50000)
    essay_text: str = Field(..., min_length=1, max_length=20000)
    scholarship_name: str = Field(..., min_length=1, max_length=500)
    scholarship_type: str = Field(..., min_length=1, max_length=200)
    prompt: str = Field(..., min_length=1, max_length=10000)
    previous_readiness: Optional[Dict[str, int]] = None
    draft_number: int = Field(default=1, ge=1, le=50)
    # Fast Evaluate default: skip section essay coaching off the critical path.
    include_section_coaching: bool = False


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
    sourceMetadata: list[dict] = Field(default_factory=list)
    fieldEvidence: list[dict] = Field(default_factory=list)
    extractionWarnings: list[str] = Field(default_factory=list)
    validationWarnings: list[str] = Field(default_factory=list)
    criticalFieldsFound: list[str] = Field(default_factory=list)
    criticalFieldsMissing: list[str] = Field(default_factory=list)
    completenessScore: int = Field(default=0, ge=0, le=100)
    resolutionStatus: str = ""
    extractedAt: str = ""


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


class DiscoveryIntentSelection(BaseModel):
    id: str = Field(default="", max_length=80)
    label: str = Field(default="", max_length=120)
    dimension: str = Field(default="", max_length=50)
    value: str = Field(default="", max_length=200)
    canonical_values: list[str] = Field(default_factory=list, max_length=10)
    derived_from: list[str] = Field(default_factory=list, max_length=10)


class WikiDiscoverRequest(BaseModel):
    user_id: str = Field(default="", max_length=100)
    student_profile: dict = Field(default_factory=dict)
    discovery_focus: str = Field(default="", max_length=1000)
    selected_intents: list[DiscoveryIntentSelection] = Field(default_factory=list, max_length=4)
    free_text_intent: str = Field(default="", max_length=1000)
    excluded_urls: list[str] = Field(default_factory=list, max_length=100)
    feedback: list[dict] = Field(default_factory=list, max_length=100)


class WikiBootstrapRequest(BaseModel):
    student_profile: dict = Field(default_factory=dict)


class WikiBootstrapResponse(BaseModel):
    intent_options: list[dict] = Field(default_factory=list)
    platform_defaults: list[dict] = Field(default_factory=list)
    profile_summary: dict = Field(default_factory=dict)


class WikiDiscoverResponse(BaseModel):
    page_title: str = "Scholarship Discovery"
    profile_summary: dict = Field(default_factory=dict)
    recommended_source_groups: list[dict] = Field(default_factory=list)
    top_free_platforms: list[dict] = Field(default_factory=list)
    specific_opportunities: list[dict] = Field(default_factory=list)
    funding_categories: list[dict] = Field(default_factory=list)
    personalized_search_queries: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    missing_profile_fields: list[str] = Field(default_factory=list)
    discovery_focus: str = ""
    selected_intents: list[dict] = Field(default_factory=list)
    free_text_intent: str = ""
    generated_at: str = ""
    result_note: str = ""


class EssayCoachRequest(BaseModel):
    user_id: str = Field(default="", max_length=100)
    student_profile: dict = Field(default_factory=dict)
    clean_scholarship_record: dict = Field(default_factory=dict)
    essay_prompt: str = Field(default="", max_length=12000)
    essay_draft: str = Field(default="", max_length=20000)
    personalized_outline: dict = Field(default_factory=dict)
    user_notes: str = Field(default="", max_length=5000)
    word_limit: str = Field(default="", max_length=120)
    outline_points: list[dict] = Field(default_factory=list)
    mode: str = Field(default="full", max_length=40)
    writing_support_level: str = Field(default="grammar_only", max_length=40)


class CoachingSessionRequest(BaseModel):
    """One-button Step 4 session: mechanics → parallel evaluate + coach."""

    user_id: str = Field(default="", max_length=100)
    cv_text: str = Field(default="", max_length=50000)
    essay_text: str = Field(..., min_length=1, max_length=20000)
    scholarship_name: str = Field(default="", max_length=500)
    scholarship_type: str = Field(default="", max_length=200)
    prompt: str = Field(..., min_length=1, max_length=10000)
    previous_readiness: Optional[Dict[str, int]] = None
    draft_number: int = Field(default=1, ge=1, le=50)
    include_section_coaching: bool = False
    student_profile: dict = Field(default_factory=dict)
    clean_scholarship_record: dict = Field(default_factory=dict)
    essay_prompt: str = Field(default="", max_length=12000)
    personalized_outline: dict = Field(default_factory=dict)
    user_notes: str = Field(default="", max_length=5000)
    word_limit: str = Field(default="", max_length=120)
    outline_points: list[dict] = Field(default_factory=list)
    writing_support_level: str = Field(default="grammar_only", max_length=40)


class RewriteRequest(BaseModel):
    action: str = Field(default="rewrite", max_length=40)
    selected_text: str = Field(..., min_length=1, max_length=6000)
    surrounding_text: str = Field(default="", max_length=20000)
    essay_prompt: str = Field(default="", max_length=12000)
    clean_scholarship_record: dict = Field(default_factory=dict)
    student_profile: dict = Field(default_factory=dict)


class OutlineGenerateRequest(BaseModel):
    opportunity_id: str = Field(default="", max_length=200)
    scholarship_name: str = Field(default="", max_length=500)
    student_profile: dict = Field(default_factory=dict)
    clean_scholarship_record: dict = Field(default_factory=dict)
    essay_prompt: str = Field(default="", max_length=12000)
    essay_type: str = Field(default="", max_length=200)
    word_limit: str = Field(default="", max_length=120)
    user_notes: str = Field(default="", max_length=5000)


class OutlineSection(BaseModel):
    section_name: str = ""
    purpose: str = ""
    suggested_content: list[str] = Field(default_factory=list)
    profile_evidence_to_use: list[str] = Field(default_factory=list)
    scholarship_requirement_addressed: list[str] = Field(default_factory=list)
    estimated_word_count: str = ""
    coaching_notes: list[str] = Field(default_factory=list)


class PersonalizedOutline(BaseModel):
    outline_title: str = ""
    thesis_or_core_message: str = ""
    sections: list[OutlineSection] = Field(default_factory=list)
    recommended_opening: str = ""
    recommended_conclusion: str = ""
    questions_for_student: list[str] = Field(default_factory=list)


class OutlineStrategy(BaseModel):
    recommended_strategy: str = ""
    central_message: str = ""
    tone_guidance: str = ""


class CoverageCheck(BaseModel):
    requirement: str = ""
    covered: bool = False
    where_covered: str = ""
    notes: str = ""


class OutlineGenerateResponse(BaseModel):
    status: str = "success"
    outline: PersonalizedOutline = Field(default_factory=PersonalizedOutline)
    strategy: OutlineStrategy = Field(default_factory=OutlineStrategy)
    coverage_check: list[CoverageCheck] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    missing_profile_info: list[str] = Field(default_factory=list)


def _text_to_chunks(text: str, source: str) -> list:
    doc = Document(page_content=text.strip(), metadata={"source": source})
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    return splitter.split_documents([doc])


def _stable_source_id(prefix: str, value: object) -> str:
    raw = json.dumps(value, sort_keys=True, default=str) if not isinstance(value, str) else value
    digest = hashlib.sha256(raw.strip().encode("utf-8")).hexdigest()[:24]
    return f"{prefix[:10]}-{digest}"


def _safe_vector_service() -> VectorService:
    return VectorService()


def _upsert_memory(
    vector_service: VectorService,
    *,
    user_id: str,
    source_type: str,
    source_id: str,
    title: str,
    canonical_text: str,
    structured_json: dict,
    collection_name: str,
) -> None:
    try:
        vector_service.upsert_user_memory(
            user_id=user_id,
            source_type=source_type,
            source_id=source_id,
            title=title,
            canonical_text=canonical_text,
            structured_json=structured_json,
            collection_name=collection_name,
        )
    except Exception:
        pass


def _persist_domain_record(save_fn, *args, **kwargs):
    try:
        return save_fn(*args, **kwargs)
    except Exception:
        return None


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


def _gather_opportunity_source_text(request: OpportunityExtractRequest):
    """Resolve the pasted page, recover through search, and collect supporting official pages."""
    return resolve_opportunity_sources(
        scholarship_name=request.scholarship_name,
        scholarship_url=request.scholarship_url,
        additional_notes=request.additional_notes,
    )


def run_application_pipeline(
    user_id: str,
    opportunity_text: str,
    student_draft: str,
    profile_text: str,
    previous_readiness: Optional[Dict[str, int]] = None,
    draft_number: int = 1,
    include_section_coaching: bool = False,
) -> dict:
    vector_service = _safe_vector_service()
    profile_docs = _text_to_chunks(profile_text, "uploaded_cv")

    _upsert_memory(
        vector_service,
        user_id=user_id,
        source_type="profile_summary",
        source_id="current-profile",
        title="Current student profile",
        canonical_text=profile_text,
        structured_json={"profile_text": profile_text},
        collection_name="user_profile_memory",
    )
    _upsert_memory(
        vector_service,
        user_id=user_id,
        source_type="opportunity",
        source_id=_stable_source_id("opportunity", opportunity_text),
        title="Current scholarship opportunity",
        canonical_text=opportunity_text,
        structured_json={"opportunity_text": opportunity_text},
        collection_name="user_opportunity_memory",
    )
    if student_draft.strip():
        _upsert_memory(
            vector_service,
            user_id=user_id,
            source_type="essay_draft",
            source_id=_stable_source_id(f"essay-draft-{draft_number}", student_draft),
            title=f"Essay draft {draft_number}",
            canonical_text=student_draft,
            structured_json={"draft_number": draft_number, "essay_text": student_draft},
            collection_name="user_application_memory",
        )

    graph = build_application_graph(vector_service, user_id)
    result = graph.invoke(
        {
            "opportunity_text": opportunity_text,
            "student_profile_docs": profile_docs,
            "student_draft": student_draft,
            "previous_readiness": previous_readiness or {},
            "draft_number": draft_number,
            "include_section_coaching": include_section_coaching,
        }
    )
    feedback_text = build_feedback_memory_text(
        {
            "summary": result.get("feedback", ""),
            "strengths": result.get("revision_priorities", []),
            "recommended_next_steps": result.get("essay_alignment_matrix", {}).get("recommended_revision_tasks", []),
        }
    )
    _upsert_memory(
        vector_service,
        user_id=user_id,
        source_type="coaching_feedback",
        source_id=_stable_source_id(f"coaching-{draft_number}", result.get("feedback", "")),
        title=f"Coaching feedback draft {draft_number}",
        canonical_text=feedback_text,
        structured_json=result,
        collection_name="user_feedback_memory",
    )
    return result


def _outline_fallback(request: OutlineGenerateRequest, message: str = "") -> dict:
    scholarship = request.clean_scholarship_record or {}
    prompt = request.essay_prompt.strip() or scholarship.get("essayPrompts") or scholarship.get("requirementsPreview") or ""
    warnings = []
    if message:
        warnings.append(message)
    if not request.student_profile:
        warnings.append("Add your student profile to make this outline more personalized.")
    if not request.clean_scholarship_record:
        warnings.append("Scholarship requirements are limited, so this outline is based mainly on the essay prompt and profile.")
    if not prompt:
        warnings.append("Add an essay prompt or scholarship writing requirement to generate a more personalized outline.")

    name = request.scholarship_name or scholarship.get("name") or "this scholarship"
    return {
        "status": "success",
        "outline": {
            "outline_title": f"Essay plan for {name}",
            "thesis_or_core_message": "Connect your strongest real profile evidence to the scholarship prompt and stated selection priorities.",
            "sections": [
                {
                    "section_name": "Opening motivation tied to the prompt",
                    "purpose": "Introduce the specific motivation or problem that makes this opportunity relevant.",
                    "suggested_content": ["Use one concrete real experience from your profile.", "Name the academic, service, or career direction the essay will explain."],
                    "profile_evidence_to_use": ["Use a real profile detail you have already provided."],
                    "scholarship_requirement_addressed": ["Essay prompt or writing requirement"],
                    "estimated_word_count": request.word_limit or "Adjust to the final word limit.",
                    "coaching_notes": ["Do not invent a dramatic story. Avoid generic openings."],
                },
                {
                    "section_name": "Evidence of preparation and fit",
                    "purpose": "Show the experiences, skills, coursework, research, work, or leadership that support your claim.",
                    "suggested_content": ["Choose two or three strongest facts from your profile.", "Explain what each fact proves about readiness or alignment."],
                    "profile_evidence_to_use": ["Academic background", "Skills", "Leadership, research, work, or projects if provided"],
                    "scholarship_requirement_addressed": ["Selection criteria", "Eligibility or application themes"],
                    "estimated_word_count": "Middle section",
                    "coaching_notes": ["Use evidence, not a list of achievements."],
                },
                {
                    "section_name": "Future goals and scholarship alignment",
                    "purpose": "Explain how the scholarship connects to your next step and the impact you want to make.",
                    "suggested_content": ["Tie goals to the scholarship mission or benefits.", "End with a contribution-focused statement."],
                    "profile_evidence_to_use": ["Career goal or academic goal if provided"],
                    "scholarship_requirement_addressed": ["Career goals", "Community impact", "Scholarship purpose"],
                    "estimated_word_count": "Closing section",
                    "coaching_notes": ["Keep the ending specific to the scholarship."],
                },
            ],
            "recommended_opening": "Begin with a specific real moment, project, question, or responsibility that connects to the prompt.",
            "recommended_conclusion": "Close by reinforcing what the scholarship would help you do next and why that matters.",
            "questions_for_student": ["What real experience best proves your fit for this scholarship?", "What detail from your profile should the essay definitely include?"],
        },
        "strategy": {
            "recommended_strategy": "Use a profile-grounded, scholarship-specific argument rather than a broad personal statement.",
            "central_message": "Your preparation and goals match the opportunity's purpose.",
            "tone_guidance": "Specific, reflective, confident, and evidence-based.",
        },
        "coverage_check": [],
        "warnings": warnings,
        "missing_profile_info": [],
    }


def generate_personalized_outline(request: OutlineGenerateRequest) -> dict:
    if not settings.openai_api_key:
        return _outline_fallback(request, "AI outline generation is unavailable because OPENAI_API_KEY is missing.")

    scholarship = request.clean_scholarship_record or {}
    essay_prompt = (
        request.essay_prompt.strip()
        or str(scholarship.get("essayPrompts") or "").strip()
        or str(scholarship.get("otherRequiredMaterials") or "").strip()
        or str(scholarship.get("requirementsPreview") or "").strip()
    )
    if not essay_prompt and not scholarship:
        return _outline_fallback(request)

    model = llm._get_client().with_structured_output(OutlineGenerateResponse)
    try:
        result = model.invoke(
            [
                (
                    "system",
                    "You are an AI scholarship essay planning team coaching a student. Create a personalized, "
                    "read-only essay outline for a student applying to a specific scholarship. Use only the provided "
                    "student profile, cleaned scholarship requirements, essay prompt, selection criteria, and word limit. "
                    "Do not invent student experiences or scholarship requirements. Do not write the full essay. Do not "
                    "make the outline generic. "
                    "VOICE: Address the student directly in the second person ('you', 'your'). Never write in the first "
                    "person from the student's point of view — do not use 'I', 'me', 'my', or 'we'. For example, write "
                    "'Open with your experience tutoring…' or 'Use your research on…', never 'Open with my experience' or "
                    "'my research'. This is coaching guidance TO the student, not the essay itself. "
                    "Return structured data only.",
                ),
                (
                    "human",
                    "Generate the final personalized outline through these internal steps: identify relevant profile evidence, "
                    "analyze essay requirements, choose an essay strategy, draft a structured outline, then review coverage. "
                    "Keep confirmed requirements separate from suggestions. Use meaningful section names, not generic paragraph labels. "
                    "Write ALL guidance addressed to the student in the second person ('you', 'your') — never first person ('I', 'my', 'me', 'we').\n\n"
                    f"Scholarship name:\n{request.scholarship_name or scholarship.get('name', '')}\n\n"
                    f"Clean scholarship record:\n{json.dumps(scholarship, indent=2, default=str)}\n\n"
                    f"Essay prompt or writing requirement:\n{essay_prompt}\n\n"
                    f"Essay type:\n{request.essay_type}\n\n"
                    f"Word limit:\n{request.word_limit or 'Not stated'}\n\n"
                    f"Student profile:\n{json.dumps(request.student_profile or {}, indent=2, default=str)}\n\n"
                    f"User notes:\n{request.user_notes}",
                ),
            ]
        )
        data = result.model_dump() if hasattr(result, "model_dump") else result.dict()
    except Exception as exc:
        fallback = _outline_fallback(request, f"Outline generation failed, so Scholar-E created a basic guide instead: {exc}")
        fallback["status"] = "error"
        fallback["message"] = str(exc)
        fallback["fallback_outline"] = fallback.get("outline")
        return fallback

    data["status"] = data.get("status") or "success"
    outline = data.get("outline") or {}
    if not outline.get("sections"):
        return _outline_fallback(request, "The generated outline was incomplete, so Scholar-E created a safe fallback guide.")

    warnings = list(data.get("warnings") or [])
    if not request.word_limit:
        warnings.append("No word limit was found. Adjust section lengths after confirming the official limit.")
    if not request.student_profile:
        warnings.append("Add your student profile to make this outline more personalized.")
    if not request.clean_scholarship_record:
        warnings.append("Scholarship requirements are limited, so this outline is based mainly on the essay prompt and profile.")
    data["warnings"] = list(dict.fromkeys(warnings))
    return data


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
            user_id=default_user_id(request.user_id),
            opportunity_text=opportunity_text,
            student_draft=request.essay_text,
            profile_text=request.cv_text,
            previous_readiness=request.previous_readiness,
            draft_number=request.draft_number,
            include_section_coaching=bool(request.include_section_coaching),
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
        "ranked_revision_actions": result.get("ranked_revision_actions", []),
        "draft_number": result.get("draft_number", request.draft_number),
    }


def run_essay_coach(request: EssayCoachRequest) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    return run_essay_workspace_coach(
        student_profile=request.student_profile,
        clean_scholarship_record=request.clean_scholarship_record,
        essay_prompt=request.essay_prompt,
        essay_draft=request.essay_draft,
        personalized_outline=request.personalized_outline,
        user_notes=request.user_notes,
        word_limit=request.word_limit,
        outline_points=request.outline_points,
        mode=request.mode or "full",
        writing_support_level=request.writing_support_level or "grammar_only",
    )


def run_workspace_coaching_session(request: CoachingSessionRequest) -> dict:
    """Mechanics first, then parallel essay-quality evaluate + workspace coach."""
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    mechanics = apply_deterministic_mechanics(request.essay_text)
    cleaned_draft = mechanics["draft"]
    essay_prompt = (request.essay_prompt or request.prompt or "").strip()

    analyze_request = AnalyzeRequest(
        user_id=request.user_id,
        cv_text=request.cv_text or "No student profile evidence was provided.",
        essay_text=cleaned_draft,
        scholarship_name=request.scholarship_name or "Scholarship opportunity",
        scholarship_type=request.scholarship_type or "Scholarship",
        prompt=request.prompt,
        previous_readiness=request.previous_readiness,
        draft_number=request.draft_number,
        include_section_coaching=bool(request.include_section_coaching),
    )

    warnings: list[str] = []
    evaluation: dict | None = None
    coach_pack: dict | None = None

    def _evaluate() -> dict:
        return analyze_application(analyze_request)

    def _coach() -> dict:
        return run_essay_workspace_coach(
            student_profile=request.student_profile,
            clean_scholarship_record=request.clean_scholarship_record,
            essay_prompt=essay_prompt,
            essay_draft=cleaned_draft,
            personalized_outline=request.personalized_outline,
            user_notes=request.user_notes,
            word_limit=request.word_limit,
            outline_points=request.outline_points,
            mode="workspace_refresh",
            writing_support_level=request.writing_support_level or "grammar_only",
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        evaluate_future = pool.submit(_evaluate)
        coach_future = pool.submit(_coach)
        try:
            evaluation = evaluate_future.result()
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"evaluation failed: {exc}")
        try:
            coach_pack = coach_future.result()
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"coach pack failed: {exc}")

    status = "success"
    if evaluation is None and coach_pack is None:
        status = "error"
    elif evaluation is None or coach_pack is None:
        status = "partial"

    return {
        "status": status,
        "mechanics": mechanics,
        "cleaned_draft": cleaned_draft,
        "evaluation": evaluation,
        "coach_pack": coach_pack,
        "warnings": warnings,
    }


def rewrite_selection(request: RewriteRequest) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    return run_selection_rewrite(
        action=request.action,
        selected_text=request.selected_text,
        surrounding_text=request.surrounding_text,
        essay_prompt=request.essay_prompt,
        clean_scholarship_record=request.clean_scholarship_record,
        student_profile=request.student_profile,
    )


async def autofill_profile_from_resume(file: UploadFile, user_id: str = "") -> dict:
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
    result, agent_run_id = run_agent_with_persistence(
        user_id=default_user_id(user_id),
        agent_name="resume_profile_extraction",
        input_json={
            "filename": file.filename or "",
            "content_type": file.content_type or "",
            "resume_text_chars": len(raw_resume_text),
        },
        run_fn=lambda _: graph.invoke({"resume_text": raw_resume_text}),
    )
    response = ProfileAutofillResponse(**result)
    user_id = default_user_id(user_id)
    vector_service = _safe_vector_service()
    profile_data = response.model_dump() if hasattr(response, "model_dump") else response.dict()
    _upsert_memory(
        vector_service,
        user_id=user_id,
        source_type="resume",
        source_id=_stable_source_id("resume", raw_resume_text),
        title=file.filename or "Uploaded resume",
        canonical_text=raw_resume_text,
        structured_json={"filename": file.filename or ""},
        collection_name="user_profile_memory",
    )
    _persist_domain_record(ProfileService.save_current_profile, user_id, profile_data, raw_resume_text, agent_run_id)
    _upsert_memory(
        vector_service,
        user_id=user_id,
        source_type="profile_summary",
        source_id="current-profile",
        title="Current student profile",
        canonical_text=build_profile_memory_text(profile_data),
        structured_json=profile_data,
        collection_name="user_profile_memory",
    )
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

    resolution_started = time.perf_counter()
    resolution = _gather_opportunity_source_text(request)
    source_text = resolution.source_text
    source_urls = resolution.source_urls
    resolution_ms = int((time.perf_counter() - resolution_started) * 1000)
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
        "source_metadata": resolution.source_metadata,
        "extraction_warnings": resolution.warnings,
        "resolution_status": resolution.resolution_status,
        "primary_url": resolution.primary_url,
    }
    result, agent_run_id = run_agent_with_persistence(
        user_id=request.user_id,
        agent_name="scholarship_requirements_extraction",
        input_json={
            "scholarship_name": request.scholarship_name,
            "scholarship_url": request.scholarship_url,
            "additional_notes_chars": len(request.additional_notes),
            "source_text_chars": len(source_text),
            "source_url_count": len(source_urls),
            "source_resolution_ms": resolution_ms,
            "resolution_status": resolution.resolution_status,
        },
        run_fn=lambda _: graph.invoke(payload),
    )
    response = OpportunityExtractResponse(**result)
    clean_data = response.model_dump() if hasattr(response, "model_dump") else response.dict()
    _persist_domain_record(
        ScholarshipService.save_clean_record,
        default_user_id(request.user_id),
        clean_data,
        source_text,
        agent_run_id,
    )
    _upsert_memory(
        _safe_vector_service(),
        user_id=default_user_id(request.user_id),
        source_type="clean_scholarship",
        source_id=_stable_source_id("scholarship", clean_data.get("name") or clean_data),
        title=clean_data.get("name") or request.scholarship_name or "Scholarship opportunity",
        canonical_text=build_scholarship_memory_text(clean_data),
        structured_json=clean_data,
        collection_name="user_opportunity_memory",
    )
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

    vector_service = _safe_vector_service()
    user_id = default_user_id(request.user_id)
    profile_text = build_profile_memory_text(request.student_profile)
    scholarship_text = build_scholarship_memory_text(request.scholarship_record)
    profile_id = _persist_domain_record(ProfileService.save_current_profile, user_id, request.student_profile, profile_text, None)
    clean_ids = _persist_domain_record(ScholarshipService.save_clean_record, user_id, request.scholarship_record, scholarship_text, None)
    clean_record_id = clean_ids[1] if isinstance(clean_ids, tuple) else None
    _upsert_memory(
        vector_service,
        user_id=user_id,
        source_type="profile_summary",
        source_id="current-profile",
        title="Current student profile",
        canonical_text=profile_text,
        structured_json=request.student_profile,
        collection_name="user_profile_memory",
    )
    _upsert_memory(
        vector_service,
        user_id=user_id,
        source_type="clean_scholarship",
        source_id=_stable_source_id("scholarship", request.scholarship_record.get("name") or request.scholarship_record),
        title=request.scholarship_record.get("name") or "Scholarship opportunity",
        canonical_text=scholarship_text,
        structured_json=request.scholarship_record,
        collection_name="user_opportunity_memory",
    )
    try:
        rag_context = vector_service.retrieve_context(
            user_id=user_id,
            query="\n".join([request.scholarship_record.get("name", ""), scholarship_text, profile_text])[:4000],
            allowed_collections=["user_profile_memory", "user_opportunity_memory"],
            k=8,
        )
    except Exception:
        rag_context = []

    graph = build_fit_analysis_graph()
    payload = {
            "scholarship_record": request.scholarship_record,
            "student_profile": request.student_profile,
            "rag_context": rag_context,
    }
    result, agent_run_id = run_agent_with_persistence(
        user_id=request.user_id,
        agent_name="scholarship_fit_analysis",
        input_json={
            "scholarship_name": request.scholarship_record.get("name") or request.scholarship_record.get("scholarship_name", ""),
            "profile_keys": sorted(request.student_profile.keys()),
        },
        run_fn=lambda _: graph.invoke(payload),
    )
    response = FitAnalyzeResponse(**result)
    fit_data = response.model_dump() if hasattr(response, "model_dump") else response.dict()
    _persist_domain_record(
        ScholarshipService.save_fit_analysis,
        user_id,
        request.scholarship_record.get("name") or fit_data.get("scholarship_name") or "",
        fit_data,
        profile_id,
        clean_record_id,
        agent_run_id,
    )
    _upsert_memory(
        vector_service,
        user_id=user_id,
        source_type="fit_analysis",
        source_id=_stable_source_id("fit", fit_data),
        title=f"Fit analysis: {fit_data.get('scholarship_name') or request.scholarship_record.get('name') or 'Scholarship'}",
        canonical_text=build_feedback_memory_text(fit_data),
        structured_json=fit_data,
        collection_name="user_feedback_memory",
    )
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response.dict()


def _load_wiki_source_library() -> list[dict]:
    library_path = Path(__file__).resolve().parent.parent / "data" / "discovery_platform_library.json"
    try:
        items = json.loads(library_path.read_text(encoding="utf-8"))
        return [item for item in items if str(item.get("kind") or "").lower() == "platform"]
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Discovery platform library could not be loaded.") from exc


def get_scholarship_discovery_bootstrap(request: WikiBootstrapRequest) -> dict:
    context = build_discovery_context(request.student_profile)
    platforms = []
    for index, raw in enumerate(_load_wiki_source_library()):
        if str(raw.get("kind") or "").lower() != "platform":
            continue
        item = {**raw, "origin": "library", "candidate_id": str(raw.get("url") or raw.get("name") or index).lower()}
        assessment = assess_candidate(item, context)
        if not assessment.compatible:
            continue
        item["source_evidence"] = candidate_evidence(item)
        score, components = score_candidate(item, context)
        field = context.profile.field.canonical_label
        student_type = context.profile.student_type.value
        reason = (
            f"Selected for {field} and related opportunities."
            if field
            else f"Selected for {student_type} scholarship discovery."
            if student_type != "unknown"
            else "Selected as a trusted place to continue scholarship discovery."
        )
        platforms.append((score, index, {
            "name": item.get("name", ""),
            "url": item.get("url", ""),
            "category": item.get("category", ""),
            "best_for": item.get("best_for") or [],
            "search_tips": item.get("search_tips") or [],
            "why_recommended": reason,
            "source_authority": "Curated discovery platform",
            "score_components": components,
        }))
    platforms.sort(key=lambda value: (-value[0], value[1]))
    profile = context.profile
    response = WikiBootstrapResponse(
        intent_options=generate_intent_options(request.student_profile, limit=4),
        platform_defaults=[item for _, _, item in platforms[:3]],
        profile_summary={
            "education_level": profile.education.current_level.value,
            "field_of_study": profile.field.canonical_label,
            "student_type": profile.student_type.value,
        },
    )
    return response.model_dump() if hasattr(response, "model_dump") else response.dict()


def discover_scholarship_wiki(request: WikiDiscoverRequest) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    user_id = default_user_id(request.user_id)
    profile_text = build_profile_memory_text(request.student_profile)
    _persist_domain_record(ProfileService.save_current_profile, user_id, request.student_profile, profile_text, None)
    _upsert_memory(
        _safe_vector_service(),
        user_id=user_id,
        source_type="profile_summary",
        source_id="current-profile",
        title="Current student profile",
        canonical_text=profile_text,
        structured_json=request.student_profile,
        collection_name="user_profile_memory",
    )
    graph = build_wiki_discovery_graph()
    payload = {
        "student_profile": request.student_profile,
        "source_library": _load_wiki_source_library(),
        "discovery_focus": request.discovery_focus,
        "selected_intents": [
            intent.model_dump() if hasattr(intent, "model_dump") else intent.dict()
            for intent in request.selected_intents
        ],
        "free_text_intent": request.free_text_intent or request.discovery_focus,
        "excluded_urls": request.excluded_urls,
        "discovery_feedback": request.feedback,
    }
    result, _ = run_agent_with_persistence(
        user_id=request.user_id,
        agent_name="scholarship_discovery_wiki",
        input_json={
            "profile_keys": sorted(request.student_profile.keys()),
            "education_level": request.student_profile.get("educationLevel", ""),
            "has_opportunity_preferences": bool(request.student_profile.get("opportunityPreferences")),
            "has_discovery_focus": bool(request.discovery_focus.strip()),
            "selected_intent_count": len(request.selected_intents),
            "has_free_text_intent": bool((request.free_text_intent or request.discovery_focus).strip()),
            "excluded_url_count": len(request.excluded_urls),
        },
        run_fn=lambda _: graph.invoke(payload),
    )
    response = WikiDiscoverResponse(**result)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response.dict()
