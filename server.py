# server.py
"""
FastAPI server for ScholarlE Engen MVP prototype.
Serves ScholarlE Engen.html and exposes POST /api/analyze.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from api.routes import AnalyzeRequest, analyze_application
from backend_auth.database import init_db
from backend_auth.routes import router as auth_router

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
HTML_FILE = FRONTEND / "ScholarlE Engen.html"

app = FastAPI(title="ScholarlE Engen", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/")
def index():
    return FileResponse(HTML_FILE)


@app.get("/styles.css")
def styles():
    return FileResponse(FRONTEND / "styles.css", media_type="text/css")


@app.get("/app.js")
def app_js():
    return FileResponse(FRONTEND / "app.js", media_type="application/javascript")


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest):
    try:
        return analyze_application(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
