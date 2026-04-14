from rag.ingest import ingest_documents
from rag.store import ChromaStore
from graph.builder import build_graph
from config import settings
from outputs.writer import save
import shutil
import os


def reset_vector_db(path):
    if os.path.exists(path):
        shutil.rmtree(path)


def main():
    print("Loading RFP documents...")
    rfp_docs = ingest_documents(settings.rfp_docs_path)

    print("Loading knowledge base...")
    kb_docs = ingest_documents(settings.knowledge_base_path)

    # STEP 3A — Reset DBs
    print("Resetting vector databases...")
    reset_vector_db(settings.rfp_vector_db_path)
    reset_vector_db(settings.kb_vector_db_path)

    # STEP 3B — Build separate stores
    print("Building vector stores...")
    rfp_store = ChromaStore(
        documents=rfp_docs,
        persist_directory=settings.rfp_vector_db_path
    )

    kb_store = ChromaStore(
        documents=kb_docs,
        persist_directory=settings.kb_vector_db_path
    )

    print("Building graph...")
    graph = build_graph(rfp_store, kb_store)

    # Combine RFP text for analysis
    rfp_text = "\n\n".join([doc.page_content for doc in rfp_docs])

    print("Running pipeline...\n")
    result = graph.invoke({
        "rfp_text": rfp_text,
        "rfp_docs": rfp_docs
    })

    print("\n===== FINAL PROPOSAL =====\n")
    print(result["final_proposal"][:2000])

    
    print("\n===== SCORE BREAKDOWN =====")
    print(f"Completeness: {result.get('completeness')}")
    print(f"Clarity: {result.get('clarity')}")
    print(f"Strength: {result.get('strength')}")
    print(f"Hallucination Penalty: {result.get('hallucination_penalty')}")
    print(f"Final Score: {result.get('score')}")

   # Save to file
    save_text = f"""
    # Proposal

    {result["final_proposal"]}

    ---
        
    # Score Breakdown

    Completeness: {result.get('completeness')}
    Clarity: {result.get('clarity')}
    Strength: {result.get('strength')}
    Hallucination Penalty: {result.get('hallucination_penalty')}
    Final Score: {result.get('score')}
    """

    save(save_text, filename="outputs/final_proposal.md")

if __name__ == "__main__":
    main()