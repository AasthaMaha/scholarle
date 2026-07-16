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
    sticky_rubric: dict | None = None,
) -> dict:
    """Manager + Evaluator stage of the scholarship-essay evaluation.

    The Manager first tailors a seven-criterion rubric to the opportunity and
    prompt. The Evaluator then scores the draft against that rubric. When QA
    requests a revision, its notes are supplied to the Evaluator on the next
    bounded graph pass. On revise loops, reuse sticky_rubric instead of
    regenerating a moving-target rubric.
    """
    critique_block = ""
    if critique:
        critique_block = f"""
CRITIC FEEDBACK (a prior pass was flagged — you MUST fix these issues):
{json.dumps(critique, indent=2)}

Re-evaluate carefully. Correct any ungrounded scores or comments the critic
identified, and make sure every score is justified by the submitted text.
"""

    rubric = sticky_rubric if isinstance(sticky_rubric, dict) and sticky_rubric else {}
    if not rubric:
        manager_prompt = f"""
You are the Manager Agent for a scholarship essay evaluation system.
Create a tailored rubric for the exact scholarship and essay prompt below.
Keep all seven required criteria, but tailor each criterion's observable
standards to the scholarship's values, priorities, and every part of its prompt.

{context}
{_grounding_rules()}

REQUIRED CRITERIA:
CONTENT
1. alignment — direct prompt coverage, scholarship values/priorities, and specific fit.
2. evidence_strength — profile grounding, concrete specificity, measurable impact,
   unsupported/invented claims, and missed stronger evidence.
3. insight — meaning, reflection, learning, change, responsibility, and why it mattered.
STRUCTURE
4. coherence_continuity — logical consistency across ideas, timeline, motivations,
   people, events, and claims; no contradictions or unexplained jumps.
5. flow_narrative_arc — effective paragraph order, transitions, setup, action,
   reflection, and takeaway.
VOICE
6. tone_authenticity — sincere, thoughtful, confident, respectful, student-written
   voice; flag generic, corporate, formulaic, performative, or AI-like phrasing.
7. clarity_concision — direct, understandable sentences without filler, repetition,
   wordiness, unclear phrasing, or tangled construction.

Return ONLY valid JSON:
{{
  "rubric": {{
    "alignment": {{"description": "tailored standard", "excellent": "...", "developing": "...", "weak": "..."}},
    "evidence_strength": {{"description": "...", "excellent": "...", "developing": "...", "weak": "..."}},
    "insight": {{"description": "...", "excellent": "...", "developing": "...", "weak": "..."}},
    "coherence_continuity": {{"description": "...", "excellent": "...", "developing": "...", "weak": "..."}},
    "flow_narrative_arc": {{"description": "...", "excellent": "...", "developing": "...", "weak": "..."}},
    "tone_authenticity": {{"description": "...", "excellent": "...", "developing": "...", "weak": "..."}},
    "clarity_concision": {{"description": "...", "excellent": "...", "developing": "...", "weak": "..."}}
  }}
}}
"""
        rubric = safe_json_parse(llm.generate(manager_prompt)).get("rubric", {})

    prompt = f"""
You are the Evaluator Agent. Evaluate the scholarship essay independently
against every criterion in the Manager Agent's tailored rubric. Use only the
submitted essay, profile, scholarship information, and prompt. Provide a score,
a hidden scoring justification, and one structured detailed feedback item for
every criterion. Scores must
be integers from 0 through 97; 97 is the absolute
maximum so the system never implies perfect certainty.

{context}

MANAGER'S TAILORED RUBRIC:
{json.dumps(rubric, indent=2)}

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

SCORING RULES:
- Score all seven criteria. Never omit or merge one.
- Cite or tightly paraphrase concrete draft/profile evidence in each justification.
- Penalize unsupported or invented claims under evidence_strength.
- Do not score eligibility facts as essay quality unless the prompt explicitly asks for them.
- Apply the rubric consistently; do not inflate scores because the topic is admirable.

STRUCTURED DETAILED FEEDBACK REQUIREMENTS:
- For every criterion, generate exactly 1 detailed feedback item. Do not assign
  an item to a different criterion merely because it is important overall.
- Select the single best revision opportunity for that criterion. "Best" means
  the most specific, actionable, well-grounded change that would materially
  improve the essay—not the broadest observation or most dramatic label.
- Preserve the specificity and usefulness of the former Revision Priority
  Combiner: short ranked titles, a clear explanation of value, and actionable
  location-aware coaching rather than broad evaluator advice.
  Every action must include:
  - "priority": a concise, action-oriented title.
  - "why_it_matters": 1-2 essay-specific sentences explaining the criterion-level
    benefit and naming the relevant prompt, scholarship value, passage, example,
    or omission.
  - "how_to_fix": a concrete instruction that says what to change and where.
    Name a paragraph, passage, transition, example, or section whenever the
    submitted text makes that possible.
  - "impact": exactly "High", "Medium", or "Low".
  - "estimated_effort": exactly "Quick", "Moderate", or "Deep".
- Order actions by impact. Avoid duplicates within a criterion and across the
  seven criteria.
- Identify an exact passage, named example, paragraph, transition, claim, or
  clearly described omission whenever possible.
- The "how_to_fix" instruction must identify both the location and the content
  of the change. Avoid vague directions such as "improve transitions,"
  "clarify themes," or "add examples" unless you name the exact transition,
  theme, or supported example and explain what the student should add or change.
- For alignment, identify the affected prompt part or scholarship value. For
  evidence strength, distinguish verified profile evidence from vague or
  unsupported evidence. For insight, name the missing reflection or meaning.
  For structure, name the affected paragraph, transition, or narrative stage.
  For voice, identify representative wording while preserving authenticity.
- Never use generic advice such as "add more detail" without naming the exact
  detail needed and where it belongs.

Return ONLY valid JSON:
{{
  "readiness_index": {{
    "alignment": {{"score": 0, "justification": "...", "revision_actions": [{{"priority": "...", "why_it_matters": "...", "how_to_fix": "...", "impact": "High", "estimated_effort": "Moderate"}}]}},
    "evidence_strength": {{"score": 0, "justification": "...", "revision_actions": []}},
    "insight": {{"score": 0, "justification": "...", "revision_actions": []}},
    "coherence_continuity": {{"score": 0, "justification": "...", "revision_actions": []}},
    "flow_narrative_arc": {{"score": 0, "justification": "...", "revision_actions": []}},
    "tone_authenticity": {{"score": 0, "justification": "...", "revision_actions": []}},
    "clarity_concision": {{"score": 0, "justification": "...", "revision_actions": []}}
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
    result = safe_json_parse(llm.generate(prompt))
    result["evaluation_rubric"] = rubric
    return result


def run_critic_review(context: str, combined: dict) -> dict:
    """QA Agent — audit fairness, consistency, completeness, and clarity."""
    prompt = f"""
You are the Quality Assurance (QA) Agent. Critically audit the Evaluator
Agent's proposed scores and feedback. You do not rescore the essay yourself.

{context}

EVALUATION TO AUDIT (produced by the combiner from specialist agents):
{json.dumps(combined, indent=2)}
{_grounding_rules()}

Check specifically:
- FAIRNESS: are scores evidence-based, unbiased, and neither inflated nor punitive?
- RUBRIC CONSISTENCY: does each score match its tailored criterion description?
- COMPLETENESS: are all seven criteria covered with score, justification, and
  exactly 1 structured detailed feedback item?
- ACTION CONSISTENCY: does every structured item belong to its own criterion,
  without a cross-criterion mismatch?
- ACTION QUALITY: does every action contain a specific priority,
  why_it_matters, how_to_fix, impact, and estimated_effort in the required
  format? Is it concrete enough to execute, grounded in the submitted essay,
  and non-duplicative across criteria? Is it demonstrably the criterion's most
  specific and actionable revision opportunity rather than generic advice?
- GROUNDING: did the evaluator invent any fact or overlook unsupported claims?
- SCORE CAP: is every score an integer from 0 through 97?

Set "verdict" to "needs_revision" if you find a material grounding, rubric,
completeness, feedback-quality, action-quality, or cross-criterion consistency
violation. Otherwise set it to "approved".

Return ONLY valid JSON:
{{
  "grounding_pass": true,
  "guardrail_pass": true,
  "fairness_pass": true,
  "rubric_consistency_pass": true,
  "completeness_pass": true,
  "clarity_pass": true,
  "confidence": 0,
  "issues": ["concrete problems found, or empty list"],
  "revision_guidance": "what the combiner must fix, or empty string",
  "verdict": "approved"
}}
"""
    return safe_json_parse(llm.generate(prompt))
