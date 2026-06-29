# server.py
"""
FastAPI server for Scholar-E MVP.
Exposes POST /api/analyze and auth routes for frontend-react.
"""

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from api.routes import (
    AnalyzeRequest,
    OpportunityExtractRequest,
    analyze_application,
    autofill_profile_from_resume,
    extract_scholarship_opportunity,
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
async def autofill_resume(file: UploadFile = File(...)):
    try:
        return await autofill_profile_from_resume(file)
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
