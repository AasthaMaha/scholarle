"""Adaptive writing-brief resolution for outline + essay coaching agents.

Specialists should not treat every scholarship the same. This module turns the
selected essay prompt (or, when missing, scholarship mission/criteria) into a
shared writing brief that outline and coaching agents must follow.
"""

from __future__ import annotations

import re
from typing import Any


def _clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "; ".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def _split_prompt_asks(essay_prompt: str) -> list[str]:
    """Best-effort decomposition of a prompt into discrete asks/clauses."""
    text = (essay_prompt or "").strip()
    if not text:
        return []

    numbered = re.split(r"(?:^|\n)\s*(?:\d+[.)]|[A-D][.)]|[-*•])\s+", text)
    parts = [part.strip(" \n\t-•") for part in numbered if part and part.strip()]
    if len(parts) > 1:
        return parts[:8]

    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
    asks = [s.strip() for s in sentences if len(s.strip()) > 24]
    if len(asks) > 1:
        return asks[:8]
    return [text]


def resolve_writing_brief(
    *,
    essay_prompt: str = "",
    clean_scholarship_record: dict | None = None,
    allow_scholarship_fallback: bool = True,
) -> dict[str, Any]:
    """Return an adaptive brief for outline + coaching agents.

    Modes:
      - prompt_driven: student selected/entered an essay prompt
      - scholarship_guided: no formal prompt; use mission/criteria/materials
      - empty: nothing usable yet
    """
    scholarship = clean_scholarship_record or {}
    prompt = (essay_prompt or "").strip()
    if prompt:
        asks = _split_prompt_asks(prompt)
        return {
            "mode": "prompt_driven",
            "has_formal_prompt": True,
            "writing_brief": prompt,
            "prompt_asks": asks,
            "adaptation_instructions": (
                "Adapt every section, strategy note, and coaching suggestion to the SELECTED "
                "essay prompt. Quote or paraphrase the specific prompt ask you are addressing. "
                "Do not give generic scholarship-essay advice that ignores these asks:\n- "
                + "\n- ".join(asks)
            ),
        }

    if not allow_scholarship_fallback:
        return {
            "mode": "empty",
            "has_formal_prompt": False,
            "writing_brief": "",
            "prompt_asks": [],
            "adaptation_instructions": (
                "No essay prompt was provided. Ask the student to add a prompt or confirm "
                "scholarship-guided writing before giving structure or alignment advice."
            ),
        }

    mission_bits = [
        _clean(scholarship.get("description")),
        _clean(scholarship.get("selectionCriteria")),
        _clean(scholarship.get("requirementsPreview")),
        _clean(scholarship.get("otherRequiredMaterials")),
        _clean(scholarship.get("benefits")),
    ]
    mission_bits = [bit for bit in mission_bits if bit]
    name = _clean(scholarship.get("name")) or "this scholarship"
    if not mission_bits:
        return {
            "mode": "empty",
            "has_formal_prompt": False,
            "writing_brief": "",
            "prompt_asks": [],
            "adaptation_instructions": (
                f"No essay prompt and little scholarship detail were provided for {name}. "
                "Coach conservatively: help the student draft a grounded personal statement "
                "and flag that an official prompt should still be confirmed."
            ),
        }

    brief = (
        f"This scholarship ({name}) does not provide a formal essay prompt. "
        "Write a scholarship-guided personal statement that clearly fits the opportunity.\n\n"
        "Scholarship writing focus:\n- " + "\n- ".join(mission_bits[:6])
    )
    asks = _split_prompt_asks("\n".join(mission_bits[:4])) or mission_bits[:4]
    return {
        "mode": "scholarship_guided",
        "has_formal_prompt": False,
        "writing_brief": brief,
        "prompt_asks": asks,
        "adaptation_instructions": (
            "There is NO formal essay prompt. Adapt the outline and coaching to the scholarship "
            "mission, selection criteria, and required materials below. Make sections answer "
            "those opportunity demands — do not invent a fake prompt.\n- "
            + "\n- ".join(asks)
        ),
    }


def format_brief_for_prompt(brief: dict[str, Any]) -> str:
    """Compact block injected into LLM system/human prompts."""
    mode = brief.get("mode") or "empty"
    writing_brief = brief.get("writing_brief") or "(none)"
    instructions = brief.get("adaptation_instructions") or ""
    asks = brief.get("prompt_asks") or []
    asks_block = "\n".join(f"- {ask}" for ask in asks) if asks else "- (none extracted)"
    return (
        f"WRITING MODE: {mode}\n"
        f"HAS FORMAL ESSAY PROMPT: {bool(brief.get('has_formal_prompt'))}\n\n"
        f"WRITING BRIEF:\n{writing_brief}\n\n"
        f"PROMPT / FOCUS ASKS:\n{asks_block}\n\n"
        f"ADAPTATION RULES:\n{instructions}"
    )
