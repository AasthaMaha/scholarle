"""Deterministic spelling/mechanics fixes applied before LLM coaching.

These rules mirror the frontend C0 correctness heuristics so both paths stay
aligned. Only meaning-preserving mechanics are auto-applied — never style,
tone, or word-choice polish.
"""

from __future__ import annotations

import re
from typing import Any


MISSPELLINGS: dict[str, str] = {
    "teh": "the",
    "recieve": "receive",
    "seperate": "separate",
    "definately": "definitely",
    "occured": "occurred",
    "untill": "until",
    "wich": "which",
    "becuase": "because",
    "thier": "their",
    "goverment": "government",
    "enviroment": "environment",
    "succesful": "successful",
    "begining": "beginning",
    "beleive": "believe",
}


def _match_case(sample: str, replacement: str) -> str:
    if sample and sample[0].isupper() and sample[0].isalpha():
        return replacement[0].upper() + replacement[1:]
    return replacement


def apply_deterministic_mechanics(draft: str) -> dict[str, Any]:
    """Apply safe C0 mechanics left-to-right and return the cleaned draft.

    Returns:
      {
        "draft": str,
        "applied_count": int,
        "applied_fixes": [{"original", "suggested", "title"}, ...],
      }
    """
    text = draft or ""
    applied: list[dict[str, str]] = []

    def _record(original: str, suggested: str, title: str) -> str:
        if original == suggested:
            return original
        applied.append({"original": original, "suggested": suggested, "title": title})
        return suggested

    # Extra spaces (not newlines)
    text = re.sub(
        r"[^\S\n]{2,}",
        lambda m: _record(m.group(0), " ", "Extra spaces"),
        text,
    )

    # Spacing before punctuation
    text = re.sub(
        r"[^\S\n]+([,.;:!?])",
        lambda m: _record(m.group(0), m.group(1), "Spacing before punctuation"),
        text,
    )

    # Space after comma/semicolon when missing
    text = re.sub(
        r"([,;])(?=[A-Za-z])",
        lambda m: _record(m.group(0), f"{m.group(1)} ", "Add a space"),
        text,
    )

    # Repeated word
    text = re.sub(
        r"\b(\w+)\s+\1\b",
        lambda m: _record(m.group(0), m.group(1), "Repeated word"),
        text,
        flags=re.IGNORECASE,
    )

    # Capitalize pronoun "I"
    text = re.sub(
        r"\bi\b",
        lambda m: _record(m.group(0), "I", 'Capitalize "I"'),
        text,
    )

    # Common misspellings
    if MISSPELLINGS:
        alternation = "|".join(sorted((re.escape(k) for k in MISSPELLINGS), key=len, reverse=True))
        pattern = re.compile(rf"\b({alternation})\b", re.IGNORECASE)

        def _spell_sub(match: re.Match[str]) -> str:
            original = match.group(0)
            suggested = _match_case(original, MISSPELLINGS[original.lower()])
            return _record(original, suggested, "Possible misspelling")

        text = pattern.sub(_spell_sub, text)

    return {
        "draft": text,
        "applied_count": len(applied),
        "applied_fixes": applied[:80],
    }
