from langgraph.graph import END, StateGraph

from nodes.fit_analysis import analyze_fit, clean_fit_result
from state.fit_state import FitAnalysisState


def build_fit_analysis_graph():
    builder = StateGraph(FitAnalysisState)
    builder.add_node("fit_analysis_agent", analyze_fit)
    builder.add_node("fit_result_cleanup", clean_fit_result)

    builder.set_entry_point("fit_analysis_agent")
    builder.add_edge("fit_analysis_agent", "fit_result_cleanup")
    builder.add_edge("fit_result_cleanup", END)

    return builder.compile()
