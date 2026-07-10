from langgraph.graph import END, StateGraph

from nodes.profile_extraction import clean_profile_fields, extract_profile_fields
from state.profile_state import ProfileExtractionState


def build_profile_extraction_graph():
    builder = StateGraph(ProfileExtractionState)
    builder.add_node("profile_extraction_agent", extract_profile_fields)
    builder.add_node("profile_cleanup", clean_profile_fields)

    builder.set_entry_point("profile_extraction_agent")
    builder.add_edge("profile_extraction_agent", "profile_cleanup")
    builder.add_edge("profile_cleanup", END)

    return builder.compile()
