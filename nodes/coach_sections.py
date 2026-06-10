# nodes/coach_sections.py

from llm.client import llm
from utils.parsing import safe_json_parse
from templates.base import build_batch_prompt
from templates.personal_statement import PERSONAL_STATEMENT_TEMPLATE
from templates.leadership_impact import LEADERSHIP_IMPACT_TEMPLATE
from templates.experience_achievements import EXPERIENCE_ACHIEVEMENTS_TEMPLATE

TEMPLATES = [
    PERSONAL_STATEMENT_TEMPLATE,
    LEADERSHIP_IMPACT_TEMPLATE,
    EXPERIENCE_ACHIEVEMENTS_TEMPLATE,
]


def coach_sections(state):
    """
    Generate section-by-section coaching feedback using profile evidence
    and the student's draft. One LLM call covers all configured templates.
    """
    data = {
        "retrieved_profile_chunks": state.get("retrieved_profile_chunks", []),
        "student_draft": state.get("student_draft", ""),
        "opportunity_text": state.get("opportunity_text", ""),
        "opportunity_analysis": state.get("opportunity_analysis", {}),
    }

    prompt = build_batch_prompt(TEMPLATES, data)
    response = llm.generate(prompt)
    section_coaching = safe_json_parse(response)

    for template in TEMPLATES:
        section_coaching.setdefault(template.name, "")

    return {"section_coaching": section_coaching}
