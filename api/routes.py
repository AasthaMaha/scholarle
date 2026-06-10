# api/routes.py
"""
<<<<<<< Updated upstream
Basic API route placeholder for ScholarlE Engen.

This is a thin, framework-agnostic placeholder that exposes the existing
LangGraph pipeline as a single callable entry point. It can later be wired to
FastAPI / Flask / etc. without changing the backend structure.
"""

from rag.ingest import ingest_documents
=======
API layer for ScholarlE Engen — exposes the LangGraph coaching pipeline.
"""

from typing import Any, Dict, Optional

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field

>>>>>>> Stashed changes
from rag.store import ChromaStore
from graph.builder import build_graph
from config import settings


<<<<<<< Updated upstream
def run_application_pipeline(opportunity_text: str, student_draft: str = "") -> dict:
    """
    Run the coaching pipeline for a single request.

    Args:
        opportunity_text: the opportunity prompt text.
        student_draft: the student's draft to be coached / scored.

    Returns:
        The final pipeline state (including scores, feedback, and the
        assembled application package).
    """
    profile_docs = ingest_documents(settings.student_profile_path)
    profile_store = ChromaStore(
        documents=profile_docs,
        persist_directory=settings.profile_vector_db_path,
    )

    graph = build_graph(profile_store)

    result = graph.invoke({
        "opportunity_text": opportunity_text,
        "student_profile_docs": profile_docs,
        "student_draft": student_draft,
    })

    return result


# TODO: wire this placeholder to a web framework, e.g.:
#
#   from fastapi import FastAPI
#   app = FastAPI()
#
#   @app.post("/coach")
#   def coach(opportunity_text: str, student_draft: str = ""):
#       return run_application_pipeline(opportunity_text, student_draft)
=======
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
    profile_text: Optional[str] = None,
    previous_readiness: Optional[Dict[str, int]] = None,
    draft_number: int = 1,
) -> dict:
    if profile_text and profile_text.strip():
        profile_docs = _text_to_chunks(profile_text, "uploaded_cv")
    else:
        from rag.ingest import ingest_documents

        profile_docs = ingest_documents(settings.student_profile_path)

    profile_store = ChromaStore(documents=profile_docs, ephemeral=True)

    try:
        graph = build_graph(profile_store)
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
>>>>>>> Stashed changes
