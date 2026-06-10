# rag/store.py

import chromadb
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma


class VectorStore:
    def search(self, query: str, k: int = 5):
        raise NotImplementedError


class ChromaStore(VectorStore):
    def __init__(
        self,
        documents=None,
        persist_directory="./chroma_db",
        ephemeral: bool = False,
    ):
        self.embeddings = OpenAIEmbeddings()
        self.persist_directory = persist_directory
        self._client = None
        self.db = None

        if documents:
            if ephemeral:
                # In-memory store — avoids Windows file locks on chroma_db_profile.
                self._client = chromadb.EphemeralClient()
                self.db = Chroma.from_documents(
                    documents,
                    self.embeddings,
                    client=self._client,
                    collection_name="profile_session",
                )
            else:
                self.db = Chroma.from_documents(
                    documents,
                    embedding=self.embeddings,
                    persist_directory=self.persist_directory,
                )
        else:
            self.db = Chroma(
                persist_directory=self.persist_directory,
                embedding_function=self.embeddings,
            )

    def search(self, query: str, k: int = 5):
        results = self.db.similarity_search(query, k=k)
        return [doc.page_content for doc in results]

    def close(self) -> None:
        """Release Chroma resources (especially ephemeral clients)."""
        self.db = None
        self._client = None
