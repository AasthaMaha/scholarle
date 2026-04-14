# rag/retrieve.py

def retrieve_context(store, queries, k=5):
    results = []

    for q in queries:
        docs = store.search(q, k=k)
        results.extend(docs)

    # deduplicate + limit
    unique = list(set(results))
    return unique[:20]