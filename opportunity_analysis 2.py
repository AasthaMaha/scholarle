"""Small opportunity-analysis helper for the unified Essay Review."""

from __future__ import annotations

from llm.client import llm
from utils.parsing import safe_json_parse


def analyze_opportunity_text(opportunity_text: str) -> dict:
    prompt = f"""
You are a JSON extractor for scholarship, college application, and internship
opportunities.

Given the opportunity text below, return ONLY valid JSON with these keys:
- opportunity_type: string
- requirements: list of strings
- deadlines: list of strings
- evaluation_themes: list of strings

OPPORTUNITY TEXT:
{opportunity_text or ''}
"""
    return safe_json_parse(llm.generate(prompt))
