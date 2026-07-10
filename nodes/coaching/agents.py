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


def run_strategy_coach(context: str) -> dict:
    """Opportunity Strategy agent — what this opportunity actually evaluates."""
    prompt = f"""
You are the Opportunity Strategy Coach for ScholarlE Engen.
Explain what this opportunity actually evaluates based on the opportunity text.

{context}
{_grounding_rules()}

Return ONLY valid JSON:
{{
  "surface_prompt": "what students usually think it asks",
  "actual_evaluation_focus": ["what reviewers really weight"],
  "strategic_insight": "2-3 sentences tied to THIS opportunity text",
  "reflection_vs_story_ratio": "e.g. challenge is 30%, reflection is 70%"
}}
"""
    return safe_json_parse(llm.generate(prompt))


def run_discovery_coach(context: str) -> dict:
    """Experience Discovery agent — strengths grounded ONLY in profile text."""
    prompt = f"""
You are the Experience Discovery Coach for ScholarlE Engen.
Identify strengths ONLY from the profile text shown. If the profile is
placeholder or empty, say so — do not invent experiences.

{context}
{_grounding_rules()}

Return ONLY valid JSON:
{{
  "hidden_strengths": ["only from profile text, or empty list"],
  "strongest_match_for_opportunity": "from profile or 'none in submitted profile'",
  "underused_experiences": ["from profile vs draft comparison"],
  "recommended_experience_to_feature": "specific or 'add profile content first'",
  "coaching_message": "actionable advice based on what was submitted"
}}
"""
    return safe_json_parse(llm.generate(prompt))


def run_eligibility_matrix(context: str) -> dict:
    """Eligibility / Requirements Matrix agent.

    Builds a row-by-row comparison of every requirement the opportunity states
    against what the student's profile + draft actually provide. This is a REAL
    LLM evaluation grounded in the submitted text — never a hardcoded mapping.

    Each row's status is one of:
      - "met"     : the submitted profile clearly satisfies the requirement
      - "not_met" : the submitted profile contradicts/violates the requirement
      - "missing" : the requirement exists but the profile lacks the info to verify
    """
    prompt = f"""
You are the Eligibility & Requirements Matrix Coach for ScholarlE Engen.
Compare EACH requirement, eligibility rule, and required material stated in the
opportunity against what the student actually provided in their profile and draft.

{context}
{_grounding_rules()}

Build one row per distinct requirement you find in the opportunity text
(eligibility rules, GPA, citizenship/residency, enrollment level, major/field,
required documents, deadlines, essay prompts, financial-need, etc.).

For each row decide a status using ONLY the submitted text:
- "met": the profile clearly satisfies it (quote the supporting profile detail).
- "not_met": the profile clearly violates it (e.g. requires 3.0 GPA, profile shows 2.4).
- "missing": the requirement exists but the profile does not contain enough
  information to verify it — the student must add this.

Do NOT assume unstated details. If you cannot find it in the profile, it is "missing".

Return ONLY valid JSON:
{{
  "rows": [
    {{
      "requirement": "the requirement, short and specific",
      "category": "Eligibility|Academic|Documents|Deadline|Essay|Financial|Other",
      "student_value": "what the profile shows, or 'Not provided'",
      "status": "met|not_met|missing",
      "explanation": "one sentence grounded in the submitted text",
      "action_needed": "what the student must add/fix, or empty string if met"
    }}
  ],
  "overall": "eligible|not_eligible|incomplete",
  "summary": "1-2 sentences on overall eligibility based on the rows"
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


def run_combiner(
    context: str,
    strategy: dict,
    discovery: dict,
    narrative: dict,
    reviewers: dict,
    critique: dict | None = None,
) -> dict:
    """Combiner agent — synthesize all specialist outputs into the readiness
    index and coaching brief. Re-runs with critique guidance when the Critic
    requests a revision."""
    critique_block = ""
    if critique:
        critique_block = f"""
CRITIC FEEDBACK (a prior pass was flagged — you MUST fix these issues):
{json.dumps(critique, indent=2)}

Re-evaluate carefully. Correct any ungrounded scores or comments the critic
identified, and make sure every score is justified by the submitted text.
"""

    prompt = f"""
You are the ScholarlE Combiner Coach. You synthesize the work of several
specialist agents into one coherent evaluation.

Assign Application Readiness Index scores (0–100) by evaluating ONLY the
submitted CV, essay, and opportunity text. Scores must match content quality:
placeholder text like "N/A" should receive very low scores with coaching that
says why.

{context}

OPPORTUNITY STRATEGY AGENT:
{json.dumps(strategy, indent=2)}

EXPERIENCE DISCOVERY AGENT:
{json.dumps(discovery, indent=2)}

NARRATIVE AGENT:
{json.dumps(narrative, indent=2)}

REVIEWER SIMULATION AGENT:
{json.dumps(reviewers, indent=2)}
{critique_block}
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


def run_critic_review(context: str, combined: dict) -> dict:
    """Critic agent — verify the combined evaluation is grounded in the
    submitted text and obeys the coaching guardrails. Flags revisions."""
    prompt = f"""
You are the ScholarlE Critic. You are a strict quality-control reviewer of the
OTHER agents' work. You do NOT coach the student. You audit the evaluation
below against the submitted text and the grounding rules.

{context}

EVALUATION TO AUDIT (produced by the combiner from specialist agents):
{json.dumps(combined, indent=2)}
{_grounding_rules()}

Check specifically:
- Is every readiness score justified by specific words in the submitted text?
- Did any agent invent experiences, awards, metrics, or facts not present?
- Is placeholder/empty content (e.g. "N/A") correctly scored low, not praised?
- Are comments specific to THIS submission rather than generic template praise?

Set "verdict" to "needs_revision" ONLY if you find a concrete grounding or
guardrail violation that materially changes the evaluation. Otherwise "approved".

Return ONLY valid JSON:
{{
  "grounding_pass": true,
  "guardrail_pass": true,
  "confidence": 0,
  "issues": ["concrete problems found, or empty list"],
  "revision_guidance": "what the combiner must fix, or empty string",
  "verdict": "approved"
}}
"""
    return safe_json_parse(llm.generate(prompt))
