def init_compliance(state):
    matrix = []

    for req in state.get("requirements", []):
        matrix.append({
            "id": req.get("id"),
            "text": req.get("text"),
            "addressed": False
        })

    return {"compliance_matrix": matrix}