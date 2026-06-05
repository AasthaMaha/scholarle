# rag/store.py

from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma


class VectorStore:
    def search(self, query: str, k: int = 5):
        raise NotImplementedError


class ChromaStore(VectorStore):
    def __init__(self, documents=None, persist_directory="./chroma_db"):
        self.embeddings = OpenAIEmbeddings()
        self.persist_directory = persist_directory

        if documents:
            # Build a NEW database from documents
            self.db = Chroma.from_documents(
                documents,
                embedding=self.embeddings,
                persist_directory=self.persist_directory
            )
        else:
            # Load an EXISTING database
            self.db = Chroma(
                persist_directory=self.persist_directory,
                embedding_function=self.embeddings
            )

    def search(self, query: str, k: int = 5):
        results = self.db.similarity_search(query, k=k)
        return [doc.page_content for doc in results]