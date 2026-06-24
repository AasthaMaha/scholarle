# config.py
from dataclasses import dataclass
from dotenv import load_dotenv
import os

load_dotenv()

@dataclass
class Settings:
    model: str = "gpt-4o-mini"
    temperature: float = 0.2

    # API Keys
    openai_api_key: str = os.getenv("OPENAI_API_KEY")
    jwt_secret_key: str = os.getenv(
        "JWT_SECRET_KEY",
        "dev-only-change-me-use-a-real-32-byte-secret",
    )

    # Auth + OAuth
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./scholar_e.db")
    frontend_url: str = os.getenv("FRONTEND_URL", "http://127.0.0.1:8080")
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    google_redirect_uri: str = os.getenv(
        "GOOGLE_REDIRECT_URI",
        "http://127.0.0.1:8000/auth/google/callback",
    )

    # Separate vector DBs
    rfp_vector_db_path: str = "./chroma_db_rfp"
    kb_vector_db_path: str = "./chroma_db_kb"
    profile_vector_db_path: str = "./chroma_db_profile"

    # Document locations
    rfp_docs_path: str = "./documents/rfp_docs"
    knowledge_base_path: str = "./documents/knowledge_base"

settings = Settings()
