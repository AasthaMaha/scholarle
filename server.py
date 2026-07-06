# server.py
"""
FastAPI server for Scholar-E MVP.
Exposes POST /api/analyze and auth routes for frontend-react.
"""

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from api.routes import (
    AnalyzeRequest,
    FitAnalyzeRequest,
    OpportunityExtractRequest,
    OutlineGenerateRequest,
    WikiDiscoverRequest,
    analyze_application,
    analyze_scholarship_fit,
    autofill_profile_from_resume,
    discover_scholarship_wiki,
    extract_scholarship_opportunity,
    generate_personalized_outline,
)

app = FastAPI(title="Scholar-E", version="0.1.0")

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


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest):
    try:
        return analyze_application(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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


@app.post("/api/apply/generate-outline")
def generate_outline(request: OutlineGenerateRequest):
    try:
        return generate_personalized_outline(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
