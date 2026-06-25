# api/routes.py
"""API layer for ScholarlE Engen, exposing the coaching pipeline."""

from typing import Dict, Optional

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field
from fastapi import HTTPException

from config import settings
from rag.store import ChromaStore
from graph.builder import build_application_graph


class AnalyzeRequest(BaseModel):
    cv_text: str = Field(..., min_length=1)
    essay_text: str = Field(..., min_length=1)
    scholarship_name: str = Field(..., min_length=1)
    scholarship_type: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    previous_readiness: Optional[Dict[str, int]] = None
    draft_number: int = Field(default=1, ge=1)


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


def run_application_pipeline(
    opportunity_text: str,
    student_draft: str,
    profile_text: str,
    previous_readiness: Optional[Dict[str, int]] = None,
    draft_number: int = 1,
) -> dict:
    profile_docs = _text_to_chunks(profile_text, "uploaded_cv")
    profile_store = ChromaStore(documents=profile_docs, ephemeral=True)

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

    result = run_application_pipeline(
        opportunity_text=opportunity_text,
        student_draft=request.essay_text,
        profile_text=request.cv_text,
        previous_readiness=request.previous_readiness,
        draft_number=request.draft_number,
    )

    return {
        "coaching_brief": result.get("coaching_brief", {}),
        "readiness_index": result.get("readiness_index", {}),
        "growth_report": result.get("growth_report", {}),
        "reviewer_comments": result.get("reviewer_comments", []),
        "coaching_reports": result.get("coaching_reports", {}),
        "feedback": result.get("feedback", ""),
        "section_coaching": result.get("section_coaching", {}),
        "opportunity_analysis": result.get("opportunity_analysis", {}),
        "final_application_package": result.get("final_application_package", ""),
        "revision_priorities": result.get("revision_priorities", []),
        "draft_number": result.get("draft_number", request.draft_number),
    }
