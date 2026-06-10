# graph/builder.py

from langgraph.graph import StateGraph, END

from state.proposal_state import ProposalState

# Nodes
<<<<<<< Updated upstream
from nodes.analyze import analyze
from nodes.compliance import init_compliance
from nodes.retrieve import retrieve
from nodes.generate import generate
from nodes.review import review
from nodes.score import score
from nodes.assemble import assemble
=======
from nodes.analyze_opportunity import analyze_opportunity
from nodes.retrieve_profile import retrieve_profile
<<<<<<< Updated upstream
from nodes.score_application import score_application
=======
from nodes.coach_sections import coach_sections
from nodes.coach_application import coach_application
>>>>>>> Stashed changes
from nodes.assemble_package import assemble_package
>>>>>>> Stashed changes


def build_graph(rfp_store, kb_store):
    builder = StateGraph(ProposalState)

    builder.add_node("analyze", analyze)
    builder.add_node("compliance", init_compliance)

    builder.add_node(
        "retrieve",
        lambda s: retrieve(s, rfp_store, kb_store)
    )

<<<<<<< Updated upstream
    builder.add_node("generate", generate)
    builder.add_node("review", review)
    builder.add_node("score", score)
    builder.add_node("assemble", assemble)
=======
<<<<<<< Updated upstream
    builder.add_node("score_application", score_application)
=======
    builder.add_node("coach_sections", coach_sections)
    builder.add_node("coach_application", coach_application)
>>>>>>> Stashed changes
    builder.add_node("assemble_package", assemble_package)
>>>>>>> Stashed changes

    builder.set_entry_point("analyze")

<<<<<<< Updated upstream
    builder.add_edge("analyze", "compliance")
    builder.add_edge("compliance", "retrieve")
    builder.add_edge("retrieve", "generate")
    builder.add_edge("generate", "review")
    builder.add_edge("review", "score")
    builder.add_edge("score", "assemble")
    builder.add_edge("assemble", END)
=======
    builder.add_edge("analyze_opportunity", "retrieve_profile")
<<<<<<< Updated upstream
    builder.add_edge("retrieve_profile", "score_application")
    builder.add_edge("score_application", "assemble_package")
=======
    builder.add_edge("retrieve_profile", "coach_sections")
    builder.add_edge("coach_sections", "coach_application")
    builder.add_edge("coach_application", "assemble_package")
>>>>>>> Stashed changes
    builder.add_edge("assemble_package", END)
>>>>>>> Stashed changes

    return builder.compile()