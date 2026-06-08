# rag/ingest.py

from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter


def load_documents(path: str):
    loader = DirectoryLoader(
        path,
        glob="**/*.txt",
        loader_cls=TextLoader
    )
    return loader.load()


def split_documents(documents):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100
    )
    return splitter.split_documents(documents)


def ingest_documents(path: str):
    docs = load_documents(path)
    chunks = split_documents(docs)
    return chunks