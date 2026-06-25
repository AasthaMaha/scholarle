# graph/builder.py

from langgraph.graph import END, StateGraph

from state.application_state import ApplicationState
from llm.client import llm
from utils.parsing import safe_json_parse
from rag.retrieve import retrieve_context
from nodes.prepare import prepare_context
from nodes.coach_sections import coach_sections
from nodes.generation import (
    discovery_node,
    eligibility_node,
    narrative_node,
    reviewer_node,
    strategy_node,
)
from nodes.combine import combine_coaching
from nodes.critic import MAX_CRITIC_ATTEMPTS, critic_review
from nodes.assemble_package import assemble_package
from nodes.insufficient import insufficient_input
from nodes.routing import (
    post_generation,
    route_after_generation,
    route_entry,
    route_generators,
)


def analyze_opportunity(state):
    prompt = f"""
You are a JSON extractor for scholarship, college application, and internship
opportunities.

Given the opportunity text below, return ONLY valid JSON with these keys:
- opportunity_type: string
- requirements: list of strings
- deadlines: list of strings
- evaluation_themes: list of strings

OPPORTUNITY TEXT:
{state.get('opportunity_text', '')}
"""
    data = safe_json_parse(llm.generate(prompt))
    return {"opportunity_analysis": data}


def retrieve_profile(state, profile_store):
    analysis = state.get("opportunity_analysis", {}) or {}
    queries = []
    queries.extend(analysis.get("requirements") or [])
    queries.extend(analysis.get("evaluation_themes") or [])
    if state.get("student_draft"):
        queries.append(state["student_draft"])
    if not queries:
        queries = [state.get("opportunity_text", "")]

    return {"retrieved_profile_chunks": retrieve_context(profile_store, queries, k=4)}


def _route_after_critic(state):
    """Loop back to the combiner once if the critic flags an issue, else finish."""
    if state.get("needs_revision") and int(state.get("critic_attempts") or 0) < MAX_CRITIC_ATTEMPTS:
        return "revise"
    return "done"


def build_application_graph(profile_store):
    """
    Branched multi-agent coaching graph (non-linear — agents run only when they
    can add value):

      START --(empty submission?)--> insufficient_input -> assemble -> END
            \--(otherwise)--------> analyze_opportunity (Analyzer)
                                      -> retrieve_profile (Retriever)
                                        -> prepare_context
                                          --(conditional fan-out)-->
                                             strategy        (always)
                                             eligibility     (always)
                                             discovery       (only if profile)
                                             narrative       (only if draft)
                                             coach_sections  (only if draft)
                                          -> post_generation (join)
                                            --(draft?)--> reviewer -> combine
                                            \--(no draft)--------->  combine
                                              -> critic
                                                 --revise--> combine (bounded)
                                                 --done----> assemble -> END
    """
    builder = StateGraph(ApplicationState)

    builder.add_node("insufficient_input", insufficient_input)
    builder.add_node("analyze_opportunity", analyze_opportunity)
    builder.add_node("retrieve_profile", lambda s: retrieve_profile(s, profile_store))
    builder.add_node("prepare_context", prepare_context)

    # Specialized generation agents (selected subset runs in parallel)
    builder.add_node("strategy_agent", strategy_node)
    builder.add_node("eligibility_agent", eligibility_node)
    builder.add_node("discovery_agent", discovery_node)
    builder.add_node("narrative_agent", narrative_node)
    builder.add_node("coach_sections", coach_sections)
    builder.add_node("post_generation", post_generation)
    builder.add_node("reviewer_agent", reviewer_node)

    builder.add_node("combine_coaching", combine_coaching)
    builder.add_node("critic_review", critic_review)
    builder.add_node("assemble_package", assemble_package)

    # Branch 1: short-circuit empty submissions before any LLM call
    builder.set_conditional_entry_point(
        route_entry,
        {
            "insufficient_input": "insufficient_input",
            "analyze_opportunity": "analyze_opportunity",
        },
    )
    builder.add_edge("insufficient_input", "assemble_package")

    builder.add_edge("analyze_opportunity", "retrieve_profile")
    builder.add_edge("retrieve_profile", "prepare_context")

    # Branch 2: conditional fan-out — only spin up agents that have inputs
    builder.add_conditional_edges(
        "prepare_context",
        route_generators,
        {
            "strategy_agent": "strategy_agent",
            "eligibility_agent": "eligibility_agent",
            "discovery_agent": "discovery_agent",
            "narrative_agent": "narrative_agent",
            "coach_sections": "coach_sections",
        },
    )

    # Join the (variable) set of generation agents
    builder.add_edge("strategy_agent", "post_generation")
    builder.add_edge("eligibility_agent", "post_generation")
    builder.add_edge("discovery_agent", "post_generation")
    builder.add_edge("narrative_agent", "post_generation")
    builder.add_edge("coach_sections", "post_generation")

    # Branch 3: reviewer simulation only when there is a draft to review
    builder.add_conditional_edges(
        "post_generation",
        route_after_generation,
        {
            "reviewer_agent": "reviewer_agent",
            "combine_coaching": "combine_coaching",
        },
    )
    builder.add_edge("reviewer_agent", "combine_coaching")

    builder.add_edge("combine_coaching", "critic_review")

    # Branch 4: bounded critic-driven revision loop
    builder.add_conditional_edges(
        "critic_review",
        _route_after_critic,
        {"revise": "combine_coaching", "done": "assemble_package"},
    )
    builder.add_edge("assemble_package", END)

    return builder.compile()
