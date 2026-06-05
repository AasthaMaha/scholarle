from llm.client import llm


def review(state):
    prompt = f"""
    Review this proposal for:

    - Missing requirements
    - Weak areas
    - Clarity issues

    Proposal:
    {state.get('exec_summary')}

    {state.get('technical_volume')}

    {state.get('past_performance')}

    Provide structured feedback.
    """

    result = llm.generate(prompt)

    return {
        "review_notes": result
    }