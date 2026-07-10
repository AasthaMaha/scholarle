from langgraph.graph import END, StateGraph

from nodes.wiki_discovery import (
    build_candidate_pool,
    critique_wiki_output,
    finalize_wiki_output,
    interpret_profile,
    normalize_wiki_fields,
    rank_and_verify_sources,
)
from state.wiki_state import WikiDiscoveryState


def build_wiki_discovery_graph():
    """
    4 LLM agents + code gates for Scholarship Discovery Wiki:
      1) interpret_profile
      2) build_candidate_pool (code: library + online search)
      3) rank_and_verify_sources
      4) normalize_wiki_fields
      5) critique_wiki_output (always on)
      6) finalize_wiki_output (code)
    """
    builder = StateGraph(WikiDiscoveryState)
    builder.add_node("profile_interpreter_agent", interpret_profile)
    builder.add_node("candidate_pool_builder", build_candidate_pool)
    builder.add_node("source_ranker_verifier_agent", rank_and_verify_sources)
    builder.add_node("wiki_field_normalizer_agent", normalize_wiki_fields)
    builder.add_node("grounding_critic_agent", critique_wiki_output)
    builder.add_node("wiki_output_finalizer", finalize_wiki_output)

    builder.set_entry_point("profile_interpreter_agent")
    builder.add_edge("profile_interpreter_agent", "candidate_pool_builder")
    builder.add_edge("candidate_pool_builder", "source_ranker_verifier_agent")
    builder.add_edge("source_ranker_verifier_agent", "wiki_field_normalizer_agent")
    builder.add_edge("wiki_field_normalizer_agent", "grounding_critic_agent")
    builder.add_edge("grounding_critic_agent", "wiki_output_finalizer")
    builder.add_edge("wiki_output_finalizer", END)

    return builder.compile()
