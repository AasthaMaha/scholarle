from __future__ import annotations

import hashlib
import uuid
from typing import Any

from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import settings
from persistence.database import is_database_enabled, session_scope


PRIVATE_COLLECTIONS = {
    "user_profile_memory",
    "user_opportunity_memory",
    "user_application_memory",
    "user_feedback_memory",
}
GLOBAL_COLLECTIONS = {"global_wiki_memory"}


class VectorService:
    """Shared RAG access layer for user-scoped memory."""

    def __init__(self, persist_directory: str | None = None):
        self.persist_directory = persist_directory or settings.chroma_persist_directory
        self.embeddings = OpenAIEmbeddings()
        self.splitter = RecursiveCharacterTextSplitter(chunk_size=900, chunk_overlap=120)

    def _collection(self, collection_name: str) -> Chroma:
        return Chroma(
            collection_name=collection_name,
            persist_directory=self.persist_directory,
            embedding_function=self.embeddings,
        )

    @staticmethod
    def _hash(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    @staticmethod
    def _metadata(metadata: dict[str, Any]) -> dict[str, str | int | float | bool]:
        clean: dict[str, str | int | float | bool] = {}
        for key, value in metadata.items():
            if value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                clean[key] = value
            else:
                clean[key] = str(value)
        return clean

    def _delete_from_chroma(self, collection_name: str, where: dict[str, str]) -> None:
        db = self._collection(collection_name)
        try:
            db._collection.delete(where=where)
        except Exception:
            pass

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

        source_id = str(source_id or uuid.uuid4())
        knowledge_item_id = f"{source_type}:{source_id}"
        if is_database_enabled():
            from persistence.models import KnowledgeChunk, KnowledgeItem

            with session_scope() as session:
                item = (
                    session.query(KnowledgeItem)
                    .filter_by(user_id=user_id, source_type=source_type, source_id=source_id)
                    .first()
                )
                if item is None:
                    item = KnowledgeItem(
                        user_id=user_id,
                        source_type=source_type,
                        source_id=source_id,
                        title=title,
                        canonical_text=canonical_text,
                        structured_json=structured_json or {},
                        visibility="private" if collection_name in PRIVATE_COLLECTIONS else "system",
                        is_active=True,
                    )
                    session.add(item)
                    session.flush()
                else:
                    item.title = title
                    item.canonical_text = canonical_text
                    item.structured_json = structured_json or {}
                    item.is_active = True

                knowledge_item_id = item.id
                old_chunks = (
                    session.query(KnowledgeChunk)
                    .filter_by(
                        user_id=user_id,
                        source_type=source_type,
                        source_id=source_id,
                        chroma_collection=collection_name,
                    )
                    .all()
                )
                for chunk in old_chunks:
                    session.delete(chunk)

        self._delete_from_chroma(collection_name, {"user_id": user_id, "source_type": source_type, "source_id": source_id})

        db_rows: list[dict[str, Any]] = []
        texts: list[str] = []
        ids: list[str] = []
        metadatas: list[dict[str, str | int | float | bool]] = []
        for index, chunk_text in enumerate(self.splitter.split_text(canonical_text)):
            chunk_hash = self._hash(chunk_text)
            chroma_id = f"{collection_name}:{user_id}:{source_type}:{source_id}:{index}:{chunk_hash[:12]}"
            metadata = self._metadata(
                {
                    "user_id": user_id,
                    "source_type": source_type,
                    "source_id": source_id,
                    "knowledge_item_id": knowledge_item_id,
                    "chroma_id": chroma_id,
                    "chunk_hash": chunk_hash,
                    "chunk_index": index,
                    "title": title,
                    "embedding_model": "text-embedding-3-small",
                }
            )
            texts.append(chunk_text)
            ids.append(chroma_id)
            metadatas.append(metadata)
            db_rows.append(
                {
                    "user_id": user_id,
                    "knowledge_item_id": knowledge_item_id,
                    "source_type": source_type,
                    "source_id": source_id,
                    "chunk_index": index,
                    "chunk_text": chunk_text,
                    "chunk_hash": chunk_hash,
                    "chroma_collection": collection_name,
                    "chroma_id": chroma_id,
                    "embedding_model": "text-embedding-3-small",
                    "token_count": len(chunk_text.split()),
                    "metadata_json": metadata,
                }
            )

        if texts:
            self._collection(collection_name).add_texts(texts=texts, metadatas=metadatas, ids=ids)

        if is_database_enabled() and db_rows:
            from persistence.models import KnowledgeChunk

            with session_scope() as session:
                for row in db_rows:
                    session.add(KnowledgeChunk(**row))

        return [
            {
                "text": row["chunk_text"],
                "source_type": row["source_type"],
                "source_id": row["source_id"],
                "knowledge_item_id": row["knowledge_item_id"],
                "chroma_id": row["chroma_id"],
                "metadata": row["metadata_json"],
            }
            for row in db_rows
        ]

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

        results: list[dict[str, Any]] = []
        for collection_name in allowed_collections:
            filter_meta = {"user_id": user_id} if collection_name in PRIVATE_COLLECTIONS else None
            try:
                docs = self._collection(collection_name).similarity_search_with_score(query, k=k, filter=filter_meta)
            except Exception:
                docs = []
            for doc, score in docs:
                metadata = dict(doc.metadata or {})
                if source_types and metadata.get("source_type") not in source_types:
                    continue
                if min_score is not None and float(score) > min_score:
                    continue
                results.append(
                    {
                        "text": doc.page_content,
                        "source_type": metadata.get("source_type", ""),
                        "source_id": metadata.get("source_id", ""),
                        "knowledge_item_id": metadata.get("knowledge_item_id", ""),
                        "chroma_id": metadata.get("chroma_id", ""),
                        "relevance_score": float(score),
                        "metadata": metadata,
                        "collection": collection_name,
                    }
                )

        seen = set()
        deduped = []
        for item in sorted(results, key=lambda value: value.get("relevance_score", 9999)):
            key = (item.get("collection"), item.get("metadata", {}).get("chunk_hash"), item.get("text"))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped[:k]

    def delete_source_vectors(self, user_id: str, source_type: str, source_id: str):
        if not user_id:
            raise ValueError("user_id is required when deleting private vectors.")
        for collection_name in PRIVATE_COLLECTIONS:
            self._delete_from_chroma(collection_name, {"user_id": user_id, "source_type": source_type, "source_id": source_id})
        if is_database_enabled():
            from persistence.models import KnowledgeChunk, KnowledgeItem

            with session_scope() as session:
                session.query(KnowledgeChunk).filter_by(user_id=user_id, source_type=source_type, source_id=source_id).delete()
                item = session.query(KnowledgeItem).filter_by(user_id=user_id, source_type=source_type, source_id=source_id).first()
                if item:
                    item.is_active = False

    def reembed_knowledge_item(self, user_id: str, knowledge_item_id: str):
        if not user_id:
            raise ValueError("user_id is required when re-embedding private memory.")
        if not is_database_enabled():
            raise RuntimeError("SQLite persistence is required to re-embed a stored knowledge item.")
        from persistence.models import KnowledgeItem

        with session_scope() as session:
            item = session.get(KnowledgeItem, knowledge_item_id)
            if not item or item.user_id != user_id:
                raise ValueError("Knowledge item not found for this user.")
            source_type = item.source_type
            source_id = item.source_id
            title = item.title
            canonical_text = item.canonical_text
            structured_json = item.structured_json
        return self.upsert_user_memory(
            user_id=user_id,
            source_type=source_type,
            source_id=source_id,
            title=title,
            canonical_text=canonical_text,
            structured_json=structured_json,
            collection_name=_collection_for_source_type(source_type),
        )


def _collection_for_source_type(source_type: str) -> str:
    if source_type in {"scholarship", "clean_scholarship", "opportunity"}:
        return "user_opportunity_memory"
    if source_type in {"essay", "essay_draft"}:
        return "user_application_memory"
    if source_type in {"fit_analysis", "coaching_feedback"}:
        return "user_feedback_memory"
    return "user_profile_memory"
