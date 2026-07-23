# api/routes.py
"""API layer for ScholarlE Engen, exposing the coaching pipeline."""

import hashlib
import io
import json
import re
import time
from pathlib import Path
from typing import Optional

import pypdf
from pydantic import BaseModel, Field
from fastapi import HTTPException, UploadFile

from config import settings
from essay_context import canonicalize_essay_text
from essay_editor_service import run_contextual_grammar_check as run_contextual_grammar_check_service
from essay_editor_service import run_editor_check as run_editor_check_service
from essay_editor_service import run_outline_coverage_check as run_outline_coverage_check_service
from essay_editor_service import run_selection_rewrite
from prompt_adaptation import format_brief_for_prompt, resolve_writing_brief
from revision_coach_service import run_revision_coach as run_revision_coach_service
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
from unified_coaching_service import run_unified_coaching_session
from utils.opportunity_sources import resolve_opportunity_sources


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


OPPORTUNITY_ADDITIONAL_NOTES_MAX_LENGTH = 12_000


class OpportunityExtractRequest(BaseModel):
    user_id: str = Field(default="", max_length=100)
    scholarship_name: str = Field(default="", max_length=500)
    scholarship_url: str = Field(default="", max_length=2000)
    additional_notes: str = Field(default="", max_length=OPPORTUNITY_ADDITIONAL_NOTES_MAX_LENGTH)


class EssayPromptResponse(BaseModel):
    id: str = ""
    promptNumber: int = Field(default=1, ge=1)
    promptText: str = ""
    minimumWords: Optional[int] = Field(default=None, ge=0)
    maximumWords: Optional[int] = Field(default=None, ge=0)
    minimumWordsReviewed: bool = False
    maximumWordsReviewed: bool = False


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
    essayPromptEntries: list[EssayPromptResponse] = Field(default_factory=list)
    selectedEssayPromptIds: list[str] = Field(default_factory=list)
    noEssayPromptSelected: bool = False
    noEssayPromptConflictConfirmed: bool = False
    eligibilityRequirements: list[str] = Field(default_factory=list)
    requiredApplicationMaterials: list[str] = Field(default_factory=list)
    benefits: list[str] = Field(default_factory=list)
    selectionCriteria: list[str] = Field(default_factory=list)
    applicationProcess: list[str] = Field(default_factory=list)
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


class EditorCheckRequest(BaseModel):
    essay_draft: str = Field(default="", max_length=20000)
    user_notes: str = Field(default="", max_length=5000)
    protected_terms: list[str] = Field(default_factory=list, max_length=500)
    draft_revision: str = Field(default="", max_length=100)


class OutlineCoverageRequest(BaseModel):
    clean_scholarship_record: dict = Field(default_factory=dict)
    essay_draft: str = Field(default="", max_length=20000)
    outline_points: list[dict] = Field(default_factory=list)


class CoachingSessionRequest(BaseModel):
    """One-button Page 4 session: evaluate the submitted draft without rewriting it."""

    user_id: str = Field(default="", max_length=100)
    cv_text: str = Field(default="", max_length=50000)
    essay_text: str = Field(default="", max_length=20000)
    scholarship_name: str = Field(default="", max_length=500)
    scholarship_type: str = Field(default="", max_length=200)
    prompt: str = Field(default="", max_length=10000)
    previous_manager_plan: Optional[dict] = None
    previous_review: Optional[dict] = None
    student_profile: dict = Field(default_factory=dict)
    clean_scholarship_record: dict = Field(default_factory=dict)
    essay_prompt: str = Field(default="", max_length=12000)
    word_limit: str = Field(default="", max_length=120)
    outline_points: list[dict] = Field(default_factory=list)


class RewriteRequest(BaseModel):
    action: str = Field(default="rewrite", max_length=40)
    selected_text: str = Field(..., min_length=1, max_length=6000)
    surrounding_text: str = Field(default="", max_length=20000)
    essay_prompt: str = Field(default="", max_length=12000)
    clean_scholarship_record: dict = Field(default_factory=dict)
    student_profile: dict = Field(default_factory=dict)


class RevisionCoachRequest(BaseModel):
    priority: dict = Field(default_factory=dict)
    essay_text: str = Field(..., min_length=1, max_length=20000)
    target_start: int = Field(..., ge=0)
    target_end: int = Field(..., ge=1)
    draft_revision: str = Field(default="", max_length=100)
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
    section_name: str = Field(
        default="",
        description=(
            "A short descriptive noun phrase for the section, never a question, prompt directive, or copy of the "
            "question in scholarship_requirement_addressed. Do not add 'Introduction:' or 'Conclusion:' prefixes; "
            "the interface adds those structural labels."
        ),
    )
    purpose: str = ""
    suggested_content: list[str] = Field(default_factory=list)
    profile_evidence_to_use: list[str] = Field(default_factory=list)
    scholarship_requirement_addressed: list[str] = Field(
        default_factory=list,
        description=(
            "Concise, standalone questions from the essay prompt or scholarship focus that this section answers. "
            "Every item must be phrased as a direct question ending in a question mark, without category headings."
        ),
    )
    estimated_word_count: str = ""
    coaching_notes: list[str] = Field(default_factory=list)


class PersonalizedOutline(BaseModel):
    sections: list[OutlineSection] = Field(default_factory=list)


class OutlineStrategy(BaseModel):
    tone_guidance: str = Field(
        default="",
        description=(
            "Exactly one concise sentence recommending a tone tailored to the student, essay prompt, and scholarship. "
            "Do not include a label such as 'Tone' or 'Recommended tip'."
        ),
    )


class OutlineGenerateResponse(BaseModel):
    status: str = "success"
    outline: PersonalizedOutline = Field(default_factory=PersonalizedOutline)
    strategy: OutlineStrategy = Field(default_factory=OutlineStrategy)
    warnings: list[str] = Field(default_factory=list)
    missing_profile_info: list[str] = Field(default_factory=list)


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


def _safe_upload_filename(filename: str) -> str:
    basename = Path(filename or "scholarship.pdf").name
    sanitized = re.sub(r"[^A-Za-z0-9._ -]+", "_", basename).strip(" ._")
    return sanitized or "scholarship.pdf"


def validate_scholarship_pdf_upload(
    *,
    filename: str,
    content_type: str,
    file_bytes: bytes,
) -> str:
    """Validate an in-memory scholarship PDF and return its safe display name."""
    safe_filename = _safe_upload_filename(filename)
    if Path(safe_filename).suffix.lower() != ".pdf" or content_type.lower() != "application/pdf":
        raise HTTPException(status_code=400, detail="Upload a PDF file.")
    max_bytes = max(1, settings.scholarship_pdf_max_bytes)
    if len(file_bytes) > max_bytes:
        max_megabytes = max_bytes / (1024 * 1024)
        display_limit = f"{max_megabytes:g} MB"
        raise HTTPException(
            status_code=413,
            detail=f"This PDF exceeds the {display_limit} file limit.",
        )
    if not file_bytes.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Upload a PDF file.")
    return safe_filename


async def extract_scholarship_pdf_text(file: UploadFile) -> dict:
    """Read scholarship PDF text in memory without retaining the uploaded file."""
    max_bytes = max(1, settings.scholarship_pdf_max_bytes)
    try:
        file_bytes = await file.read(max_bytes + 1)
        safe_filename = validate_scholarship_pdf_upload(
            filename=file.filename or "scholarship.pdf",
            content_type=file.content_type or "",
            file_bytes=file_bytes,
        )
        try:
            text = extract_text_from_pdf(file_bytes)
        except HTTPException as exc:
            raise HTTPException(
                status_code=422,
                detail="We couldn’t upload this PDF. Try again.",
            ) from exc
    finally:
        await file.close()
    if len(text) < 80:
        raise HTTPException(
            status_code=422,
            detail=(
                "We couldn’t read enough text from this PDF. "
                "Try a webpage link or paste the scholarship text instead."
            ),
        )
    # The existing extraction request accepts 12,000 characters of user-provided
    # source text. Preserve that contract while keeping the most relevant lead text.
    text_limit = OPPORTUNITY_ADDITIONAL_NOTES_MAX_LENGTH
    extracted_text = text[:text_limit]
    return {
        "filename": safe_filename,
        "size_bytes": len(file_bytes),
        "text": extracted_text,
        "truncated": len(text) > len(extracted_text),
        "max_size_bytes": max_bytes,
    }


def _gather_opportunity_source_text(request: OpportunityExtractRequest):
    """Resolve the pasted page, recover through search, and collect supporting official pages."""
    return resolve_opportunity_sources(
        scholarship_name=request.scholarship_name,
        scholarship_url=request.scholarship_url,
        additional_notes=request.additional_notes,
    )


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

    return {
        "status": "success",
        "outline": {
            "sections": [
                {
                    "section_name": "Opening motivation tied to the prompt",
                    "purpose": "Open with a specific real moment, project, question, or responsibility that introduces the motivation or problem connecting you to this opportunity. This would place the reader in a concrete context and help them quickly understand why the opportunity matters to you.",
                    "suggested_content": ["Use one concrete real experience from your profile.", "Name the academic, service, or career direction the essay will explain."],
                    "profile_evidence_to_use": ["Use a real profile detail you have already provided."],
                    "scholarship_requirement_addressed": [
                        "What experience or motivation connects you to this opportunity?"
                    ],
                    "estimated_word_count": request.word_limit or "Adjust to the final word limit.",
                    "coaching_notes": ["Do not invent a dramatic story. Avoid generic openings."],
                },
                {
                    "section_name": "Evidence of preparation and fit",
                    "purpose": "Use two or three strong experiences, skills, courses, research projects, work responsibilities, or leadership examples from your profile, then explain what each one demonstrates. This would give the reader concrete reasons to trust your preparation and recognize your fit with the scholarship.",
                    "suggested_content": ["Choose two or three strongest facts from your profile.", "Explain what each fact proves about readiness or alignment."],
                    "profile_evidence_to_use": ["Academic background", "Skills", "Leadership, research, work, or projects if provided"],
                    "scholarship_requirement_addressed": [
                        "What evidence demonstrates your preparation and fit?"
                    ],
                    "estimated_word_count": "Middle section",
                    "coaching_notes": ["Use evidence, not a list of achievements."],
                },
                {
                    "section_name": "Future goals and scholarship alignment",
                    "purpose": "Connect the scholarship to your next step, reflect on the impact you want to make, and close by explaining why that direction matters. This would leave the reader with a clear understanding of your future purpose and how the scholarship would help you pursue it.",
                    "suggested_content": ["Tie goals to the scholarship mission or benefits.", "End with a contribution-focused statement."],
                    "profile_evidence_to_use": ["Career goal or academic goal if provided"],
                    "scholarship_requirement_addressed": [
                        "How would this scholarship support your future goals and intended impact?"
                    ],
                    "estimated_word_count": "Closing section",
                    "coaching_notes": ["Keep the ending specific to the scholarship."],
                },
            ],
        },
        "strategy": {
            "tone_guidance": "Maintain a reflective and sincere tone, emphasizing your personal growth and commitment to community engagement.",
        },
        "warnings": warnings,
        "missing_profile_info": [],
    }


_DIRECT_QUESTION_START = re.compile(
    r"^(?:what|when|where|why|how|which|who|whose|is|are|was|were|do|does|did|can|could|will|would|"
    r"has|have|had|to what extent|in what ways)\b",
    flags=re.IGNORECASE,
)
_IMPERATIVE_PROMPT_START = re.compile(
    r"^(?:describe|explain|discuss|share|identify|tell|write|provide|outline|reflect)\b",
    flags=re.IGNORECASE,
)


def _is_direct_question(value: object) -> bool:
    text = " ".join(str(value or "").split())
    return bool(
        text.endswith("?")
        and _DIRECT_QUESTION_START.match(text)
        and not _IMPERATIVE_PROMPT_START.match(text)
    )


def _coerce_direct_question(value: object) -> str:
    """Last-resort grammatical repair after the model's correction pass."""
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return "What does this section need to address?"
    if ":" in text:
        heading, remainder = text.split(":", 1)
        if len(heading.split()) <= 10 and _IMPERATIVE_PROMPT_START.match(remainder.strip()):
            text = remainder.strip()
    clean = text.rstrip(".?!").strip()
    if _DIRECT_QUESTION_START.match(clean) and not _IMPERATIVE_PROMPT_START.match(clean):
        return f"{clean}?"
    experience_match = re.match(
        r"describe\s+(?:a|an)\s+(?:time|occasion|instance)\s+when\s+you\s+(.+)",
        clean,
        re.IGNORECASE,
    )
    if experience_match:
        return f"What experience shows how you {experience_match.group(1).strip()}?"
    directive_match = re.match(
        r"(?:describe|explain|discuss|share|identify|provide|outline|reflect on)\s+(.+)",
        clean,
        re.IGNORECASE,
    )
    if directive_match:
        return f"What would you explain about {directive_match.group(1).strip()}?"
    return f"What does this section need to address about {clean[0].lower()}{clean[1:]}?"


def _outline_contract_violations(data: dict, writing_brief: dict) -> list[str]:
    sections = ((data or {}).get("outline") or {}).get("sections") or []
    violations: list[str] = []
    prompt_driven = writing_brief.get("mode") == "prompt_driven"
    expected_asks = writing_brief.get("prompt_asks") or []
    if prompt_driven and len(sections) != len(expected_asks):
        violations.append(f"Expected {len(expected_asks)} ordered sections but received {len(sections)}.")
    for index, section in enumerate(sections):
        title = " ".join(str(section.get("section_name") or "").split())
        questions = section.get("scholarship_requirement_addressed") or []
        if title.endswith("?"):
            violations.append(f"Section {index + 1} title is a question instead of a descriptive phrase.")
        if prompt_driven and len(questions) != 1:
            violations.append(f"Section {index + 1} must contain exactly one prompt question.")
        for question in questions:
            if not _is_direct_question(question):
                violations.append(f"Section {index + 1} contains a malformed prompt question: {question!r}.")
            if title.rstrip("?").casefold() == str(question).strip().rstrip("?").casefold():
                violations.append(f"Section {index + 1} title duplicates its prompt question.")
    return violations


def _normalize_outline_requirement_questions(data: dict) -> dict:
    sections = ((data or {}).get("outline") or {}).get("sections") or []
    for section in sections:
        questions = section.get("scholarship_requirement_addressed") or []
        section["scholarship_requirement_addressed"] = [_coerce_direct_question(question) for question in questions]
    return data


def generate_personalized_outline(request: OutlineGenerateRequest) -> dict:
    if not settings.openai_api_key:
        return _outline_fallback(request, "AI outline generation is unavailable because OPENAI_API_KEY is missing.")

    scholarship = request.clean_scholarship_record or {}
    # Prefer the explicitly selected/edited prompt; do not silently swap in
    # materials text unless the student left the prompt empty on purpose.
    essay_prompt = (request.essay_prompt or "").strip()
    writing_brief = resolve_writing_brief(
        essay_prompt=essay_prompt,
        clean_scholarship_record=scholarship,
        allow_scholarship_fallback=True,
    )
    if writing_brief.get("mode") == "empty" and not scholarship:
        return _outline_fallback(request)

    model = llm._get_client().with_structured_output(OutlineGenerateResponse)
    messages = [
                (
                    "system",
                    "You are an AI scholarship essay planning team coaching a student. Create a personalized, "
                    "read-only essay outline that is ADAPTIVE to the writing brief for this specific opportunity. "
                    "Use only the provided student profile, cleaned scholarship requirements, essay prompt / writing "
                    "brief, selection criteria, and word limit. "
                    "Do not invent student experiences or scholarship requirements. Do not write the full essay. Do not "
                    "make the outline generic. "
                    "If WRITING MODE is prompt_driven: every section must map to one distinct ask in the selected essay prompt. "
                    "Create exactly one section for each distinct item in PROMPT / FOCUS ASKS, preserve their order, and "
                    "never merge two asks into one section. Each section must contain exactly one corresponding "
                    "scholarship_requirement_addressed question. "
                    "If WRITING MODE is scholarship_guided: there is no formal prompt — structure the outline around the "
                    "scholarship mission, selection criteria, and materials, and say so in coaching notes. "
                    "Write each section_name as a short descriptive noun phrase, such as 'Outcome and Impact' or "
                    "'Reflection and Growth'. A section name must never be a question, end in '?', or repeat its purple "
                    "scholarship_requirement_addressed question. Do not prefix a section name with 'Introduction:' or "
                    "'Conclusion:' because the interface adds those labels. "
                    "For each section, write purpose as one cohesive guidance paragraph. Begin with a direct coaching action "
                    "that explains what the student could include and how to present it, then explain the intended effect on "
                    "the reader or scholarship reviewer using 'would'. Never use the word 'should' in a section purpose. "
                    "Incorporate opening guidance directly into the first section's purpose and closing guidance directly "
                    "into the final section's purpose. "
                    "Return tone_guidance as exactly one concise sentence tailored to the student, prompt, and scholarship. "
                    "Do not prefix it with 'Tone:' or 'Recommended tip:'. "
                    "For scholarship_requirement_addressed, rewrite every mapped prompt ask or scholarship focus as a "
                    "concise, standalone direct question ending in '?'. Remove category names, numbered-option labels, and "
                    "instructional prefixes such as 'Describe' or 'Explain'. For example, convert 'Leadership: Describe a "
                    "time you led a team' to 'When did you lead a team?'. Use the same question format in every section. "
                    "VOICE: Address the student directly in the second person ('you', 'your'). Never write in the first "
                    "person from the student's point of view — do not use 'I', 'me', 'my', or 'we'. For example, write "
                    "'Open with your experience tutoring…' or 'Use your research on…', never 'Open with my experience' or "
                    "'my research'. This is coaching guidance TO the student, not the essay itself. "
                    "Return structured data only.",
                ),
                (
                    "human",
                    "Generate the final personalized outline through these internal steps: identify relevant profile evidence, "
                    "analyze the writing brief / prompt asks, choose an essay strategy adapted to those asks, draft a structured "
                    "outline, and ensure every prompt ask is assigned to at least one specific section. "
                    "In prompt-driven mode, return one section per distinct prompt ask in the supplied order; do not combine "
                    "asks even when the source prompt places them in the same sentence. "
                    "Keep confirmed requirements separate from suggestions. Use meaningful section names tied to the brief. "
                    "Make every section purpose a single, specific coaching paragraph that combines the writing action with "
                    "what it would help the reader understand, feel, or conclude. Do not return separate opening or closing tips. "
                    "Phrase every scholarship_requirement_addressed item as a short question, never as a heading, label, "
                    "statement, or copied directive. "
                    "Write ALL guidance addressed to the student in the second person ('you', 'your') — never first person ('I', 'my', 'me', 'we').\n\n"
                    f"{format_brief_for_prompt(writing_brief)}\n\n"
                    f"Scholarship name:\n{request.scholarship_name or scholarship.get('name', '')}\n\n"
                    f"Clean scholarship record:\n{json.dumps(scholarship, indent=2, default=str)}\n\n"
                    f"Selected essay prompt text (may be empty if scholarship-guided):\n{essay_prompt or '(none provided)'}\n\n"
                    f"Essay type:\n{request.essay_type}\n\n"
                    f"Word limit:\n{request.word_limit or 'Not stated'}\n\n"
                    f"Student profile:\n{json.dumps(request.student_profile or {}, indent=2, default=str)}\n\n"
                    f"User notes:\n{request.user_notes}",
                ),
            ]
    try:
        result = model.invoke(messages)
        data = result.model_dump() if hasattr(result, "model_dump") else result.dict()
        violations = _outline_contract_violations(data, writing_brief)
        if violations:
            violation_list = "\n- ".join(violations)
            repair_result = model.invoke(
                [
                    *messages,
                    (
                        "human",
                        "Correct the candidate outline below and return the complete structured outline again. "
                        "Resolve every listed contract violation without changing supported student facts or scholarship "
                        "requirements. A direct question must use interrogative grammar; never turn an instruction such as "
                        "'Describe a time...' into 'Describe a time...?'.\n\n"
                        f"CONTRACT VIOLATIONS:\n- {violation_list}\n\n"
                        f"CANDIDATE OUTLINE:\n{json.dumps(data, indent=2, default=str)}",
                    ),
                ]
            )
            data = repair_result.model_dump() if hasattr(repair_result, "model_dump") else repair_result.dict()
        data = _normalize_outline_requirement_questions(data)
    except Exception as exc:
        fallback = _outline_fallback(request, f"Outline generation failed, so Scholar-E created a basic guide instead: {exc}")
        fallback["status"] = "error"
        fallback["message"] = str(exc)
        fallback["fallback_outline"] = fallback.get("outline")
        fallback["writing_brief"] = {
            "mode": writing_brief.get("mode"),
            "has_formal_prompt": writing_brief.get("has_formal_prompt"),
            "prompt_asks": writing_brief.get("prompt_asks") or [],
        }
        return fallback

    data["status"] = data.get("status") or "success"
    outline = data.get("outline") or {}
    if not outline.get("sections"):
        return _outline_fallback(request, "The generated outline was incomplete, so Scholar-E created a safe fallback guide.")

    warnings = list(data.get("warnings") or [])
    if writing_brief.get("mode") == "scholarship_guided":
        warnings.append(
            "No formal essay prompt was provided, so this outline adapts to the scholarship mission and selection criteria. "
            "Add an official prompt anytime to regenerate a prompt-specific outline."
        )
    elif writing_brief.get("mode") == "empty":
        warnings.append("Add an essay prompt or more scholarship details to personalize this outline further.")
    if not request.word_limit:
        warnings.append("No word limit was found. Adjust section lengths after confirming the official limit.")
    if not request.student_profile:
        warnings.append("Add your student profile to make this outline more personalized.")
    if not request.clean_scholarship_record:
        warnings.append("Scholarship requirements are limited, so this outline is based mainly on the writing brief and profile.")
    data["warnings"] = list(dict.fromkeys(warnings))
    data["writing_brief"] = {
        "mode": writing_brief.get("mode"),
        "has_formal_prompt": writing_brief.get("has_formal_prompt"),
        "prompt_asks": writing_brief.get("prompt_asks") or [],
    }
    return data


def run_editor_check(request: EditorCheckRequest) -> dict:
    return run_editor_check_service(
        essay_draft=request.essay_draft,
        user_notes=request.user_notes,
        protected_terms=request.protected_terms,
        draft_revision=request.draft_revision,
    )


def run_contextual_grammar_check(request: EditorCheckRequest) -> dict:
    return run_contextual_grammar_check_service(
        essay_draft=request.essay_draft,
        user_notes=request.user_notes,
        protected_terms=request.protected_terms,
        draft_revision=request.draft_revision,
    )


def run_outline_coverage_check(request: OutlineCoverageRequest) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )
    return run_outline_coverage_check_service(
        essay_draft=request.essay_draft,
        clean_scholarship_record=request.clean_scholarship_record,
        outline_points=request.outline_points,
    )


def run_workspace_coaching_session(request: CoachingSessionRequest) -> dict:
    """Run one Manager-led criterion review graph on the submitted draft."""
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    started_at = time.perf_counter()
    essay_draft = request.essay_text
    canonical_draft = canonicalize_essay_text(essay_draft)
    draft_hash = hashlib.sha256(canonical_draft.encode("utf-8")).hexdigest()
    session_seed = f"{request.user_id}:{time.time_ns()}:{draft_hash}"
    session_id = f"coach_{hashlib.sha256(session_seed.encode('utf-8')).hexdigest()[:16]}"
    essay_prompt = (request.essay_prompt or request.prompt or "").strip()

    merged = run_unified_coaching_session(
        student_profile=request.student_profile,
        clean_scholarship_record=request.clean_scholarship_record,
        essay_prompt=essay_prompt,
        essay_draft=essay_draft,
        word_limit=request.word_limit,
        outline_points=request.outline_points,
        profile_text=request.cv_text,
        scholarship_name=request.scholarship_name,
        scholarship_type=request.scholarship_type,
        opportunity_prompt=request.prompt,
        previous_manager_plan=request.previous_manager_plan,
        previous_review=request.previous_review,
    )
    review = merged.get("review")
    warnings = list(merged.get("warnings") or [])
    status = str((review or {}).get("status") or "error").lower()
    if status not in {
        "success",
        "scoring_success_coaching_partial",
        "partial",
        "error",
        "insufficient_to_assess",
        "evaluation_unavailable",
    }:
        status = "partial"

    return {
        "session_id": session_id,
        "draft_hash": draft_hash,
        "status": status,
        "review": review,
        "outline_coverage": merged.get("outline_coverage") or {},
        "agents": merged.get("agent_status", {}),
        "warnings": list(dict.fromkeys(warnings)),
        "duration_ms": round((time.perf_counter() - started_at) * 1000),
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


def run_revision_coach(request: RevisionCoachRequest) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing OPENAI_API_KEY. Add a .env file in the project root "
                "with OPENAI_API_KEY=your_key, then restart the server."
            ),
        )

    return run_revision_coach_service(
        priority=request.priority,
        essay_text=request.essay_text,
        target_start=request.target_start,
        target_end=request.target_end,
        draft_revision=request.draft_revision,
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
