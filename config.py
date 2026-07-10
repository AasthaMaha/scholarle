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
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "")
    llm_provider: str = os.getenv("LLM_PROVIDER", "openai")
    secret_key: str = os.getenv("SECRET_KEY", "")
    environment: str = os.getenv("ENVIRONMENT", "development")

    profile_vector_db_path: str = "./chroma_db_profile"
    chroma_persist_directory: str = os.getenv("CHROMA_PERSIST_DIRECTORY", "./chroma_db")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///scholar_e.db")
    default_user_id: str = os.getenv("DEFAULT_USER_ID", "demo-user")

settings = Settings()
