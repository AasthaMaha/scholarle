# nodes/coaching/agents.py

import json

from llm.client import llm
from utils.parsing import safe_json_parse


def _word_count(text: str) -> int:
    text = (text or "").strip()
    return len(text.split()) if text else 0


def build_context(
    opportunity_text: str,
    profile_text: str,
    student_draft: str,
    opportunity_analysis: dict,
    submitted_summary: str = "",
) -> str:
    analysis_json = json.dumps(opportunity_analysis or {}, indent=2)
    summary_block = ""
    if submitted_summary:
        summary_block = f"""
VERBATIM SUBMITTED INPUT (the ONLY source for scores — read every character):
{submitted_summary}
"""
    return f"""
OPPORTUNITY TEXT:
{opportunity_text}

OPPORTUNITY ANALYSIS:
{analysis_json}
{summary_block}
STUDENT PROFILE EVIDENCE:
{profile_text}

STUDENT DRAFT ({_word_count(student_draft)} words):
{student_draft}
"""


def _grounding_rules() -> str:
    return """
CRITICAL GROUNDING RULES:
- Read the VERBATIM SUBMITTED INPUT and STUDENT DRAFT exactly as written.
- Every score and comment must be justified by specific words in those texts.
- If the student wrote "N/A" or similar placeholder, score that dimension very low
  and explain that there is no substantive content to evaluate — do NOT invent
  experiences, achievements, or strengths that are not in the text.
- Do NOT use generic template feedback. Quote or paraphrase what was actually submitted.
- Do NOT assume unstated profile details, even if the opportunity would normally
  require them.
"""


def run_strategy_and_discovery_coach(context: str) -> dict:
    prompt = f"""
You are two coaches working together for ScholarlE Engen.

COACH 1 — Opportunity Strategy Coach:
Explain what this opportunity actually evaluates based on the opportunity text.

COACH 2 — Experience Discovery Coach:
Identify strengths ONLY from the profile text shown. If profile is placeholder
or empty, say so — do not invent experiences.

{context}
{_grounding_rules()}

Return ONLY valid JSON:
{{
  "strategy": {{
    "surface_prompt": "what students usually think it asks",
    "actual_evaluation_focus": ["what reviewers really weight"],
    "strategic_insight": "2-3 sentences tied to THIS opportunity text",
    "reflection_vs_story_ratio": "e.g. challenge is 30%, reflection is 70%"
  }},
  "discovery": {{
    "hidden_strengths": ["only from profile text, or empty list"],
    "strongest_match_for_opportunity": "from profile or 'none in submitted profile'",
    "underused_experiences": ["from profile vs draft comparison"],
    "recommended_experience_to_feature": "specific or 'add profile content first'",
    "coaching_message": "actionable advice based on what was submitted"
  }}
}}
"""
    return safe_json_parse(llm.generate(prompt))


def run_narrative_coach(context: str) -> dict:
    prompt = f"""
You are the Narrative Coach for ScholarlE Engen.

Evaluate story construction in the STUDENT DRAFT only.

{context}
{_grounding_rules()}

Return ONLY valid JSON:
{{
  "beginning": {{"strength": "strong|adequate|weak", "coaching": "..."}},
  "middle": {{"strength": "strong|adequate|weak", "coaching": "..."}},
  "end": {{"strength": "strong|adequate|weak", "coaching": "..."}},
  "reflection": {{"strength": "strong|adequate|weak", "coaching": "..."}},
  "overall_narrative_coaching": "2-3 sentences about THIS draft",
  "biggest_narrative_gap": "single fix based on what is missing in the draft"
}}
"""
    return safe_json_parse(llm.generate(prompt))


def run_reviewer_simulation_coach(context: str, strategy: dict) -> dict:
    prompt = f"""
You are the Reviewer Simulation Coach. Four personas comment on the submitted draft.

{context}

STRATEGY CONTEXT:
{json.dumps(strategy, indent=2)}
{_grounding_rules()}

Return ONLY valid JSON:
{{
  "scholarship_reviewer": {{"comment": "2-3 sentences on submitted draft only"}},
  "admissions_officer": {{"comment": "2-3 sentences on submitted draft only"}},
  "recruiter": {{"comment": "2-3 sentences on submitted draft only"}},
  "skeptical_reviewer": {{"comment": "2-3 sentences on submitted draft only"}}
}}
"""
    return safe_json_parse(llm.generate(prompt))


def run_readiness_and_brief_coach(
    context: str,
    strategy_discovery: dict,
    narrative: dict,
    reviewers: dict,
) -> dict:
    prompt = f"""
You are the ScholarlE Readiness Coach.

Assign Application Readiness Index scores (0–100) by evaluating ONLY the
submitted CV, essay, and opportunity text. Scores must match content quality:
placeholder text like "N/A" should receive very low scores with coaching that
says why.

{context}

STRATEGY & DISCOVERY:
{json.dumps(strategy_discovery, indent=2)}

NARRATIVE COACH:
{json.dumps(narrative, indent=2)}

REVIEWER SIMULATIONS:
{json.dumps(reviewers, indent=2)}
{_grounding_rules()}

Return ONLY valid JSON:
{{
  "readiness_index": {{
    "opportunity_fit": {{"score": 0, "coaching": "one sentence citing submitted text"}},
    "evidence_strength": {{"score": 0, "coaching": "one sentence citing profile/draft"}},
    "narrative_quality": {{"score": 0, "coaching": "one sentence citing draft"}},
    "authenticity": {{"score": 0, "coaching": "one sentence citing draft"}},
    "competitiveness": {{"score": 0, "coaching": "one sentence citing draft vs opportunity"}}
  }},
  "coaching_brief": {{
    "current_strength_level": "Strong|Developing|Emerging|Needs Work",
    "biggest_opportunity": "clearest gap in THIS submission",
    "recommended_action": "concrete next step based on what is missing",
    "expected_improvement": "High|Medium|Low",
    "coach_message": "2-4 sentences — specific to submitted text, no generic praise"
  }}
}}
"""
    return safe_json_parse(llm.generate(prompt))
