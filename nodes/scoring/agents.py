# nodes/scoring/agents.py

import json

from llm.client import llm
from utils.parsing import safe_json_parse


def _word_count(text: str) -> int:
    text = (text or "").strip()
    return len(text.split()) if text else 0


def _shared_context(
    opportunity_text: str,
    profile_text: str,
    student_draft: str,
    opportunity_analysis: dict,
) -> str:
    analysis_json = json.dumps(opportunity_analysis or {}, indent=2)
    return f"""
OPPORTUNITY TEXT:
{opportunity_text}

OPPORTUNITY ANALYSIS (structured):
{analysis_json}

RETRIEVED PROFILE EVIDENCE (authoritative — do not invent facts beyond this):
{profile_text}

STUDENT DRAFT ({_word_count(student_draft)} words):
{student_draft}
"""


def run_coverage_agent(context: str) -> dict:
    """Evidence Coverage + Requirement Coverage (combined)."""
    prompt = f"""
You are two evaluators working together: the Evidence Coverage Agent and the
Requirement Coverage Agent.

{context}

TASK A — Evidence Coverage:
Identify the strongest relevant student experiences for this opportunity from
the profile evidence. Check which appear in the draft.

TASK B — Requirement Coverage:
Break the opportunity prompt into distinct requirements. For each, rate coverage
0–100 and status: covered / partial / not_covered.

Return ONLY valid JSON:
{{
  "relevant_profile_evidence": ["..."],
  "evidence_used_in_draft": ["..."],
  "evidence_missing_from_draft": ["..."],
  "evidence_coverage_score": 0,
  "evidence_recommendation": "specific evidence to add from profile",
  "requirement_map": [
    {{
      "requirement": "...",
      "coverage": 0,
      "status": "covered|partial|not_covered",
      "revision_needed": "exact fix if weak"
    }}
  ],
  "weakest_requirement": "...",
  "strongest_requirement": "...",
  "overall_requirement_coverage_score": 0
}}

Rules:
- Scores are integers 0–100.
- Do not invent student facts.
- If evidence is missing from the profile, say it is missing.
- Be specific to this draft — no generic coaching templates.
"""
    return safe_json_parse(llm.generate(prompt))


def run_authenticity_writing_agent(context: str, draft_word_count: int) -> dict:
    """Authenticity Consistency + tone, grammar, length (combined)."""
    prompt = f"""
You are the Authenticity Consistency Agent and Writing Quality Agent combined.

{context}

Evaluate the draft for:
1. Claims supported by profile evidence
2. Specific vs generic details
3. Personal reflection depth
4. Generic / AI-style phrasing (list exact phrases from the draft)
5. Tone — appropriate, personal, and aligned with a scholarship essay
6. Grammar — correctness, sentence variety, clarity of expression
7. Length fit — whether word count ({draft_word_count} words) fits stated limits
   and whether the essay is underdeveloped or padded

Return ONLY valid JSON:
{{
  "unsupported_claims": ["..."],
  "generic_phrases": ["exact phrase from draft", "..."],
  "specific_details_present": ["..."],
  "evidence_support_score": 0,
  "reflection_depth_score": 0,
  "specific_detail_score": 0,
  "generic_phrase_penalty": 0,
  "revision_advice": "constructive, specific advice",
  "tone_score": 0,
  "tone_feedback": "...",
  "tone_suggestion": "...",
  "grammar_score": 0,
  "grammar_feedback": "...",
  "grammar_suggestion": "...",
  "length_score": 0,
  "length_feedback": "...",
  "length_suggestion": "...",
  "stated_word_limit": "e.g. 500-650 or unknown",
  "draft_word_count": {draft_word_count}
}}

Rules:
- Sub-scores are integers 0–100 (higher is better except generic_phrase_penalty).
- generic_phrase_penalty: 0 = none, 100 = heavily generic/AI-like.
- Do not accuse the student. Be constructive and cite the draft.
"""
    return safe_json_parse(llm.generate(prompt))


def run_competitiveness_agent(context: str, coverage_report: dict) -> dict:
    prompt = f"""
You are the Competitiveness Agent. Act like a strict scholarship reviewer.

{context}

PRIOR COVERAGE FINDINGS (use these, do not contradict):
{json.dumps(coverage_report, indent=2)}

Evaluate differentiation, impact, specificity, fit, reflection maturity, and
evidence strength.

Return ONLY valid JSON:
{{
  "competitiveness_score": 0,
  "estimated_tier": "weak|average|strong|exceptional",
  "reason": "specific reason tied to this draft",
  "top_changes": [
    "concrete change 1",
    "concrete change 2",
    "concrete change 3"
  ]
}}

Rules:
- competitiveness_score is 0–100.
- top_changes must be specific to this student and opportunity.
"""
    return safe_json_parse(llm.generate(prompt))


def run_revision_agent(
    coverage_report: dict,
    authenticity_report: dict,
    competitiveness_report: dict,
) -> dict:
    prompt = f"""
You are the Revision Impact Forecast Agent.

Given the specialist agent reports below, rank targeted revisions by expected
score improvement. Do not suggest rewriting the whole essay unless necessary.

COVERAGE AGENT:
{json.dumps(coverage_report, indent=2)}

AUTHENTICITY & WRITING AGENT:
{json.dumps(authenticity_report, indent=2)}

COMPETITIVENESS AGENT:
{json.dumps(competitiveness_report, indent=2)}

Return ONLY valid JSON:
{{
  "ranked_revision_actions": [
    {{
      "action": "...",
      "expected_score_gain": 0,
      "difficulty": "easy|medium|hard",
      "reason": "which scores this improves"
    }}
  ],
  "recommended_next_step": "single highest-impact next action"
}}
"""
    return safe_json_parse(llm.generate(prompt))


def run_final_judge(
    coverage_report: dict,
    authenticity_report: dict,
    competitiveness_report: dict,
    revision_report: dict,
    computed_scores: dict,
) -> dict:
    prompt = f"""
You are the Final ScholarlE Judge.

Specialist reports:
COVERAGE: {json.dumps(coverage_report, indent=2)}
AUTHENTICITY & WRITING: {json.dumps(authenticity_report, indent=2)}
COMPETITIVENESS: {json.dumps(competitiveness_report, indent=2)}
REVISION FORECAST: {json.dumps(revision_report, indent=2)}

Computed score breakdown (0–100, use these numbers):
{json.dumps(computed_scores, indent=2)}

Final score formula used:
20% requirement coverage + 20% evidence coverage + 20% authenticity +
20% competitiveness + 20% writing readiness (avg of tone, grammar, length)

Return ONLY valid JSON:
{{
  "final_score": 0,
  "score_breakdown": {{
    "requirement_coverage": 0,
    "evidence_coverage": 0,
    "authenticity": 0,
    "competitiveness": 0,
    "writing_readiness": 0
  }},
  "strongest_area": "human-readable area name",
  "weakest_area": "human-readable area name",
  "top_revision_priorities": ["...", "...", "..."],
  "final_coaching_message": "2-4 sentences, strict and specific, no generic praise"
}}

Rules:
- final_score should align with the computed breakdown (within ±3 points).
- Do not give vague praise. Name concrete strengths and gaps.
"""
    return safe_json_parse(llm.generate(prompt))
