from pydantic import BaseModel, Field
from typing import List, Dict, Any


class SectionTemplate(BaseModel):
    name: str
    purpose: str

    inputs: List[str] = Field(default_factory=list)
    subsections: List[str] = Field(default_factory=list)

    instructions: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)

    tone: str = "Professional"
    length_guidance: str = "Medium"

    evaluation_criteria: List[str] = Field(default_factory=list)


#def build_prompt(template: SectionTemplate, data: Dict[str, Any]) -> str:
#    input_text = "\n\n".join(
#        f"{k}:\n{data.get(k, '')}" for k in template.inputs
#    )

def build_prompt(template: SectionTemplate, data: Dict[str, Any]) -> str:

    # --- Separate context from other inputs ---
    context = data.get("context_chunks", [])
    context_text = "\n\n".join(context)

    # All other inputs EXCLUDING context
    input_text = "\n\n".join(
        f"{k}:\n{data.get(k, '')}"
        for k in template.inputs
        if k != "context_chunks"
    )

    subsections = "\n".join(f"- {s}" for s in template.subsections)

    instructions = "\n".join(f"- {i}" for i in template.instructions)
    constraints = "\n".join(f"- {c}" for c in template.constraints)
    eval_criteria = "\n".join(f"- {e}" for e in template.evaluation_criteria)

    return f"""
You are writing a high-quality proposal section.

SECTION: {template.name}

PURPOSE:
{template.purpose}

CONTEXT (AUTHORITATIVE SOURCE - USE THIS FOR ALL FACTUAL CLAIMS):
{context_text}

INPUTS:
{input_text}

SUBSECTIONS:
{subsections}

INSTRUCTIONS:
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
- Only use information from the CONTEXT section for factual claims
- Do NOT invent projects, clients, or metrics
- If information is not in the context, explicitly state that it is not available

Write the section clearly and professionally.
"""