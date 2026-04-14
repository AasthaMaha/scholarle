from llm.client import llm
from templates.base import build_prompt

from templates.executive_summary import EXECUTIVE_SUMMARY_TEMPLATE
from templates.technical import TECHNICAL_TEMPLATE
from templates.past_performance import PAST_PERFORMANCE_TEMPLATE


def generate(state):
    # Executive Summary
    exec_prompt = build_prompt(
        EXECUTIVE_SUMMARY_TEMPLATE,
        state
    )
    exec_summary = llm.generate(exec_prompt)

    # Technical
    tech_prompt = build_prompt(
        TECHNICAL_TEMPLATE,
        state
    )
    technical = llm.generate(tech_prompt)

    # Past Performance
    past_prompt = build_prompt(
        PAST_PERFORMANCE_TEMPLATE,
        state
    )
    past_perf = llm.generate(past_prompt)

    return {
        "exec_summary": exec_summary,
        "technical_volume": technical,
        "past_performance": past_perf
    }