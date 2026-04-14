# nodes/score.py

from llm.client import llm
from utils.parsing import safe_json_parse


def score(state):
    prompt = f"""
You are a strict government proposal evaluator.

Evaluate the proposal using the rubric below and return structured JSON.

SCORING RUBRIC:

9–10: Exceptional
- Fully complete
- Strong, specific, evidence-based
- No unsupported claims

7–8: Good
- Mostly complete
- Minor gaps
- Some weak or generic areas

5–6: Average
- Noticeable gaps
- Some unsupported or vague claims

3–4: Poor
- Missing key requirements
- Weak or unclear solution

1–2: Very Poor
- Incomplete
- Largely unsupported or irrelevant

EVALUATION CRITERIA:

1. Completeness (1–10)
2. Clarity (1–10)
3. Strength (1–10)
4. Hallucination Penalty (0–5)

CRITICAL RULES:
- Be strict and conservative
- Penalize missing info
- Penalize ANY hallucinations heavily

---

PROPOSAL:
{state.get('exec_summary')}
{state.get('technical_volume')}
{state.get('past_performance')}

---

Return ONLY valid JSON:

{{
  "completeness": <number>,
  "clarity": <number>,
  "strength": <number>,
  "hallucination_penalty": <number>,
  "final_score": <number>
}}
"""

    result = llm.generate(prompt)

    print("\n=== RAW SCORE RESPONSE ===")
    print(result)

    data = safe_json_parse(result)

    return {
        "completeness": data.get("completeness", 0),
        "clarity": data.get("clarity", 0),
        "strength": data.get("strength", 0),
        "hallucination_penalty": data.get("hallucination_penalty", 0),
        "score": data.get("final_score", 0)
    }