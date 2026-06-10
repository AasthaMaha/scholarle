from pydantic import BaseModel, Field
from typing import List, Dict, Any

MISSING_NOTICE = (
    "Missing from student profile. Ask the student for this information "
    "before using it."
)


class SectionTemplate(BaseModel):
    name: str
    purpose: str

    inputs: List[str] = Field(default_factory=list)
    subsections: List[str] = Field(default_factory=list)

    instructions: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)

    tone: str = "Encouraging, honest"
    length_guidance: str = "Medium"

    evaluation_criteria: List[str] = Field(default_factory=list)


def build_prompt(template: SectionTemplate, data: Dict[str, Any]) -> str:
    """
    Build a COACHING prompt for one application section.

    This guides the student to improve their OWN draft. It does not ghostwrite
    and must never invent student facts. The retrieved profile chunks are the
    only authoritative source of factual claims about the student.
    """
    # Profile evidence is the authoritative source about the student.
    context = data.get("retrieved_profile_chunks", []) or []
    context_text = "\n\n".join(context) if context else "(no profile evidence retrieved)"

    student_draft = data.get("student_draft", "") or "(no draft provided yet)"

    # Any other named inputs from the state (excluding the profile evidence).
    input_text = "\n\n".join(
        f"{k}:\n{data.get(k, '')}"
        for k in template.inputs
        if k != "retrieved_profile_chunks"
    )

    subsections = "\n".join(f"- {s}" for s in template.subsections)
    instructions = "\n".join(f"- {i}" for i in template.instructions)
    constraints = "\n".join(f"- {c}" for c in template.constraints)
    eval_criteria = "\n".join(f"- {e}" for e in template.evaluation_criteria)

    return f"""
You are an application coach helping a student strengthen one section of their
scholarship / college / internship application. Coach the student to improve
their OWN writing. Do NOT rewrite the section for them.

SECTION: {template.name}

PURPOSE:
{template.purpose}

PROFILE EVIDENCE (AUTHORITATIVE SOURCE - the only facts you may rely on):
{context_text}

STUDENT DRAFT:
{student_draft}

OTHER INPUTS:
{input_text}

SUBSECTIONS TO CONSIDER:
{subsections}

COACHING INSTRUCTIONS:
{instructions}

CONSTRAINTS:
{constraints}

EVALUATION FOCUS:
{eval_criteria}

TONE:
{template.tone}

LENGTH:
{template.length_guidance}

IMPORTANT RULES:
- Only rely on the PROFILE EVIDENCE and STUDENT DRAFT for factual claims.
- Never invent awards, grades, schools, internships, leadership roles,
  personal stories, or metrics.
- If a stronger section would need information that is not present, do not make
  it up. Tell the student to add it, using this exact phrase:
  "{MISSING_NOTICE}"

Provide specific, actionable coaching feedback for this section.
"""


def _format_section_brief(template: SectionTemplate) -> str:
    subsections = "\n".join(f"    - {s}" for s in template.subsections)
    instructions = "\n".join(f"    - {i}" for i in template.instructions)
    constraints = "\n".join(f"    - {c}" for c in template.constraints)
    eval_criteria = "\n".join(f"    - {e}" for e in template.evaluation_criteria)

    return f"""SECTION: {template.name}
  PURPOSE: {template.purpose.strip()}
  SUBSECTIONS TO CONSIDER:
{subsections}
  COACHING INSTRUCTIONS:
{instructions}
  CONSTRAINTS:
{constraints}
  EVALUATION FOCUS:
{eval_criteria}"""


def build_batch_prompt(templates: List[SectionTemplate], data: Dict[str, Any]) -> str:
    """
    Build a SINGLE coaching prompt covering multiple sections at once.

    The shared profile evidence and student draft are included once, and each
    section's guidance is listed below. The model returns one JSON object whose
    keys are the section names and whose values are the coaching feedback.
    """
    context = data.get("retrieved_profile_chunks", []) or []
    context_text = "\n\n".join(context) if context else "(no profile evidence retrieved)"

    student_draft = data.get("student_draft", "") or "(no draft provided yet)"

    section_briefs = "\n\n".join(_format_section_brief(t) for t in templates)
    section_names = [t.name for t in templates]
    json_keys = ",\n".join(f'  "{name}": "<coaching feedback>"' for name in section_names)

    return f"""
You are an application coach helping a student strengthen their scholarship /
college / internship application. Coach the student to improve their OWN
writing. Do NOT rewrite any section for them.

PROFILE EVIDENCE (AUTHORITATIVE SOURCE - the only facts you may rely on):
{context_text}

STUDENT DRAFT:
{student_draft}

Provide specific, actionable coaching feedback for EACH of the sections below.

{section_briefs}

IMPORTANT RULES:
- Only rely on the PROFILE EVIDENCE and STUDENT DRAFT for factual claims.
- Never invent awards, grades, schools, internships, leadership roles,
  personal stories, or metrics.
- If a stronger section would need information that is not present, do not make
  it up. Tell the student to add it, using this exact phrase:
  "{MISSING_NOTICE}"

Return ONLY valid JSON in exactly this shape (one key per section):
{{
{json_keys}
}}
"""
