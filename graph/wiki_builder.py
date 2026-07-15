from langgraph.graph import END, StateGraph

from nodes.wiki_discovery import (
    build_candidate_pool,
    finalize_wiki_output,
    interpret_profile,
    rank_and_verify_sources,
    verify_ranked_sources,
)
from state.wiki_state import WikiDiscoveryState


def build_wiki_discovery_graph():
    """
    2 focused LLM stages plus deterministic gates for Scholarship Discovery:
      1) interpret_profile
      2) build_candidate_pool (code: library + online search)
      3) rank_and_verify_sources
      4) verify_ranked_sources (code: hard constraints + evidence)
      5) finalize_wiki_output (code: schema, grounding, and UX metadata)
    """
    builder = StateGraph(WikiDiscoveryState)
    builder.add_node("profile_interpreter_agent", interpret_profile)
    builder.add_node("candidate_pool_builder", build_candidate_pool)
    builder.add_node("source_ranker_verifier_agent", rank_and_verify_sources)
    builder.add_node("deterministic_grounding_verifier", verify_ranked_sources)
    builder.add_node("wiki_output_finalizer", finalize_wiki_output)

    builder.set_entry_point("profile_interpreter_agent")
    builder.add_edge("profile_interpreter_agent", "candidate_pool_builder")
    builder.add_edge("candidate_pool_builder", "source_ranker_verifier_agent")
    builder.add_edge("source_ranker_verifier_agent", "deterministic_grounding_verifier")
    builder.add_edge("deterministic_grounding_verifier", "wiki_output_finalizer")
    builder.add_edge("wiki_output_finalizer", END)

    return builder.compile()
