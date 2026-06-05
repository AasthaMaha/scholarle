from rag.retrieve import retrieve_context


from rag.retrieve import retrieve_context


def retrieve(state, rfp_store, kb_store):
    queries = []

    # Build queries from requirements
    for r in state.get("requirements", []):
        queries.append(r.get("text"))

    if not queries:
        queries = [state.get("rfp_text", "")]

    # --- Retrieve from BOTH sources ---
    rfp_context = retrieve_context(rfp_store, queries)
    kb_context = retrieve_context(kb_store, queries)

    return {
        "rfp_chunks": rfp_context,
        "kb_chunks": kb_context,
        "context_chunks": rfp_context + kb_context
    }