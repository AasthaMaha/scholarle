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

    # Separate vector DBs
    rfp_vector_db_path: str = "./chroma_db_rfp"
    kb_vector_db_path: str = "./chroma_db_kb"

    # Document locations
    rfp_docs_path: str = "./documents/rfp_docs"
    knowledge_base_path: str = "./documents/knowledge_base"

settings = Settings()