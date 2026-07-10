from langgraph.graph import END, StateGraph

from nodes.opportunity_extraction import (
    clean_opportunity_fields,
    clean_scholarship_output,
    extract_opportunity_fields,
)
from state.opportunity_state import OpportunityExtractionState


def build_opportunity_extraction_graph():
    builder = StateGraph(OpportunityExtractionState)
    builder.add_node("opportunity_extraction_agent", extract_opportunity_fields)
    builder.add_node("opportunity_cleanup", clean_opportunity_fields)
    builder.add_node("information_cleaner_agent", clean_scholarship_output)

    builder.set_entry_point("opportunity_extraction_agent")
    builder.add_edge("opportunity_extraction_agent", "opportunity_cleanup")
    builder.add_edge("opportunity_cleanup", "information_cleaner_agent")
    builder.add_edge("information_cleaner_agent", END)

    return builder.compile()
