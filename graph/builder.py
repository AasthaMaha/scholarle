# graph/builder.py

from langgraph.graph import StateGraph, END

from state.proposal_state import ProposalState

# Nodes
from nodes.analyze import analyze
from nodes.compliance import init_compliance
from nodes.retrieve import retrieve
from nodes.generate import generate
from nodes.review import review
from nodes.score import score
from nodes.assemble import assemble


def build_graph(rfp_store, kb_store):
    builder = StateGraph(ProposalState)

    builder.add_node("analyze", analyze)
    builder.add_node("compliance", init_compliance)

    builder.add_node(
        "retrieve",
        lambda s: retrieve(s, rfp_store, kb_store)
    )

    builder.add_node("generate", generate)
    builder.add_node("review", review)
    builder.add_node("score", score)
    builder.add_node("assemble", assemble)

    builder.set_entry_point("analyze")

    builder.add_edge("analyze", "compliance")
    builder.add_edge("compliance", "retrieve")
    builder.add_edge("retrieve", "generate")
    builder.add_edge("generate", "review")
    builder.add_edge("review", "score")
    builder.add_edge("score", "assemble")
    builder.add_edge("assemble", END)

    return builder.compile()