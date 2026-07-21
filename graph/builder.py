# graph/builder.py

from concurrent.futures import ThreadPoolExecutor

from langgraph.graph import END, StateGraph

from state.application_state import ApplicationState
from llm.client import llm
from utils.parsing import safe_json_parse
from nodes.prepare import prepare_context
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


def retrieve_profile(state, vector_service, user_id: str):
    analysis = state.get("opportunity_analysis", {}) or {}
    queries = []
    queries.extend(analysis.get("requirements") or [])
    queries.extend(analysis.get("evaluation_themes") or [])
    if state.get("student_draft"):
        queries.append(state["student_draft"])
    if not queries:
        queries = [state.get("opportunity_text", "")]

    context_chunks = []
    seen = set()
    selected_queries = queries[:8]

    def _retrieve(query: str):
        return vector_service.retrieve_context(
            user_id=user_id,
            query=query,
            allowed_collections=[
                "user_profile_memory",
                "user_opportunity_memory",
                "user_application_memory",
                "user_feedback_memory",
            ],
            k=4,
        )

    # Parallel retrieval — formerly serial over up to 8 queries.
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(selected_queries)))) as pool:
        for items in pool.map(_retrieve, selected_queries):
            for item in items:
                key = (item.get("collection"), item.get("chroma_id"), item.get("text"))
                if key in seen:
                    continue
                seen.add(key)
                context_chunks.append(item)

    profile_chunks = []
    for item in context_chunks[:10]:
        source_label = item.get("source_type") or item.get("collection") or "memory"
        profile_chunks.append(f"[{source_label}]\n{item.get('text', '')}")
    return {
        "retrieved_profile_chunks": profile_chunks,
        "retrieved_context_chunks": context_chunks[:10],
    }


def _route_after_critic(state):
    """Loop back to the combiner once if the critic flags an issue, else finish."""
    if state.get("needs_revision") and int(state.get("critic_attempts") or 0) < MAX_CRITIC_ATTEMPTS:
        return "revise"
    return "done"


def build_application_graph(vector_service, user_id: str):
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
    builder.add_node("retrieve_profile", lambda s: retrieve_profile(s, vector_service, user_id))
    builder.add_node("prepare_context", prepare_context)

    # Specialized generation agents (selected subset runs in parallel)
    builder.add_node("strategy_agent", strategy_node)
    builder.add_node("eligibility_agent", eligibility_node)
    builder.add_node("discovery_agent", discovery_node)
    builder.add_node("narrative_agent", narrative_node)
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
        },
    )

    # Join the (variable) set of generation agents
    builder.add_edge("strategy_agent", "post_generation")
    builder.add_edge("eligibility_agent", "post_generation")
    builder.add_edge("discovery_agent", "post_generation")
    builder.add_edge("narrative_agent", "post_generation")

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
