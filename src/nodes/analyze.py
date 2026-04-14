# nodes/analyze.py

from llm.client import llm
from utils.parsing import safe_json_parse

def analyze(state):
    """
    Process multiple RFP documents individually, extract requirements,
    evaluation criteria, and key themes.
    """
    all_requirements = []
    all_criteria = []
    all_themes = []

    rfp_docs = state.get("rfp_docs", [])  # List of Doc objects

    for doc in rfp_docs:
        prompt = f"""
        You are a JSON extractor for proposals.

        Given the RFP text below, return only valid JSON:

        Keys:
        - requirements: list of {{id, text}}
        - evaluation_criteria: list of strings
        - themes: list of strings

        RFP Text:
        {doc.page_content}
        """

        response = llm.generate(prompt)
        data = safe_json_parse(response)

        all_requirements.extend(data.get("requirements", []))
        all_criteria.extend(data.get("evaluation_criteria", []))
        all_themes.extend(data.get("themes", []))

    # Return combined results
    return {
        "requirements": all_requirements,
        "evaluation_criteria": all_criteria,
        "themes": all_themes
    }