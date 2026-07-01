from langgraph.graph import END, StateGraph

from nodes.wiki_discovery import (
    clean_wiki_discovery_output,
    extract_platform_recommendations,
    extract_specific_opportunity_sources,
)
from state.wiki_state import WikiDiscoveryState


def build_wiki_discovery_graph():
    builder = StateGraph(WikiDiscoveryState)
    builder.add_node("platform_source_agent", extract_platform_recommendations)
    builder.add_node("specific_open_source_agent", extract_specific_opportunity_sources)
    builder.add_node("wiki_output_cleaner_agent", clean_wiki_discovery_output)

    builder.set_entry_point("platform_source_agent")
    builder.add_edge("platform_source_agent", "specific_open_source_agent")
    builder.add_edge("specific_open_source_agent", "wiki_output_cleaner_agent")
    builder.add_edge("wiki_output_cleaner_agent", END)

    return builder.compile()
