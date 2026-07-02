from __future__ import annotations

from typing import Any


PRIVATE_COLLECTIONS = {
    "user_profile_memory",
    "user_opportunity_memory",
    "user_application_memory",
    "user_feedback_memory",
}
GLOBAL_COLLECTIONS = {"global_wiki_memory"}


class VectorService:
    """Shared RAG contract for future agent memory.

    The current app still uses its existing Chroma store for the essay coaching
    flow. New durable memory should go through this service so retrieval always
    carries user_id and explicit collection filters.
    """

    def upsert_user_memory(
        self,
        user_id: str,
        source_type: str,
        source_id: str,
        title: str,
        canonical_text: str,
        structured_json: dict[str, Any],
        collection_name: str,
    ):
        if collection_name in PRIVATE_COLLECTIONS and not user_id:
            raise ValueError("user_id is required for private memory upserts.")
        if not canonical_text.strip():
            return []
        raise NotImplementedError("Durable Chroma upsert wiring belongs in the next persistence milestone.")

    def retrieve_context(
        self,
        user_id: str,
        query: str,
        allowed_collections: list[str],
        source_types: list[str] | None = None,
        k: int = 6,
        min_score: float | None = None,
    ):
        if not allowed_collections:
            raise ValueError("allowed_collections must be explicit.")
        if any(collection in PRIVATE_COLLECTIONS for collection in allowed_collections) and not user_id:
            raise ValueError("user_id is required for private retrieval.")
        if not query.strip():
            return []
        raise NotImplementedError("Durable Chroma retrieval wiring belongs in the next persistence milestone.")

    def delete_source_vectors(self, user_id: str, source_type: str, source_id: str):
        if not user_id:
            raise ValueError("user_id is required when deleting private vectors.")
        raise NotImplementedError("Durable Chroma deletion wiring belongs in the next persistence milestone.")

    def reembed_knowledge_item(self, user_id: str, knowledge_item_id: str):
        if not user_id:
            raise ValueError("user_id is required when re-embedding private memory.")
        raise NotImplementedError("Durable Chroma re-embedding belongs in the next persistence milestone.")

