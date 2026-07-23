# server.py
"""
FastAPI server for Scholar-E MVP.
Exposes Scholar-E API routes for frontend-react.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from api.routes import (
    CoachingSessionRequest,
    EditorCheckRequest,
    FitAnalyzeRequest,
    OpportunityExtractRequest,
    OutlineGenerateRequest,
    OutlineCoverageRequest,
    RevisionCoachRequest,
    RewriteRequest,
    WikiDiscoverRequest,
    WikiBootstrapRequest,
    analyze_scholarship_fit,
    autofill_profile_from_resume,
    discover_scholarship_wiki,
    extract_scholarship_pdf_text,
    get_scholarship_discovery_bootstrap,
    extract_scholarship_opportunity,
    generate_personalized_outline,
    run_contextual_grammar_check,
    run_editor_check,
    run_outline_coverage_check,
    run_revision_coach,
    rewrite_selection,
    run_workspace_coaching_session,
)
from persistence.database import initialize_database
from education_catalog import get_education_catalog
from essay_editor_service import close_language_tool, start_language_tool_warmup


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    # Do not hold the entire API behind Java's one-time warm-up. The editor's
    # browser checks and every unrelated endpoint remain available immediately.
    start_language_tool_warmup()
    try:
        yield
    finally:
        close_language_tool()


app = FastAPI(title="Scholar-E", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/education/schools")
def search_education_schools(
    q: str = Query(min_length=2, max_length=120),
    kind: str = Query(pattern="^(high_school|postsecondary)$"),
    limit: int = Query(default=10, ge=1, le=10),
):
    try:
        return {"results": get_education_catalog().search_institutions(q, kind, limit)}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/education/majors")
def search_education_majors(
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=10, ge=1, le=10),
):
    try:
        return {"results": get_education_catalog().search_majors(q, limit)}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/profile/autofill-resume")
async def autofill_resume(file: UploadFile = File(...), user_id: str = Form(default="")):
    try:
        return await autofill_profile_from_resume(file, user_id=user_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/opportunity/extract")
def extract_opportunity(request: OpportunityExtractRequest):
    try:
        return extract_scholarship_opportunity(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/opportunity/pdf-text")
async def extract_opportunity_pdf(file: UploadFile = File(...)):
    try:
        return await extract_scholarship_pdf_text(file)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="We couldn’t upload this PDF. Try again.",
        ) from exc


@app.get("/api/opportunity/pdf-upload-config")
def opportunity_pdf_upload_config():
    return {"max_size_bytes": max(1, settings.scholarship_pdf_max_bytes)}


@app.post("/api/fit/analyze")
def analyze_fit(request: FitAnalyzeRequest):
    try:
        return analyze_scholarship_fit(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/wiki/discover")
def discover_wiki(request: WikiDiscoverRequest):
    try:
        return discover_scholarship_wiki(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/wiki/bootstrap")
def discovery_bootstrap(request: WikiBootstrapRequest):
    try:
        return get_scholarship_discovery_bootstrap(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/apply/generate-outline")
def generate_outline(request: OutlineGenerateRequest):
    try:
        return generate_personalized_outline(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/apply/editor-check")
def editor_check(request: EditorCheckRequest):
    try:
        return run_editor_check(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/apply/editor-warmup")
def editor_warmup():
    return start_language_tool_warmup()


@app.post("/api/apply/contextual-grammar")
def contextual_grammar_check(request: EditorCheckRequest):
    try:
        return run_contextual_grammar_check(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/apply/outline-coverage")
def outline_coverage_check(request: OutlineCoverageRequest):
    try:
        return run_outline_coverage_check(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/apply/coaching-session")
def coaching_session(request: CoachingSessionRequest):
    try:
        return run_workspace_coaching_session(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/apply/rewrite-selection")
def rewrite_selection_endpoint(request: RewriteRequest):
    try:
        return rewrite_selection(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/apply/revision-coach")
def revision_coach_endpoint(request: RevisionCoachRequest):
    try:
        return run_revision_coach(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
