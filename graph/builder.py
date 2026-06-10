# graph/builder.py

from langgraph.graph import END, StateGraph

from state.application_state import ApplicationState
from state.proposal_state import ProposalState
from llm.client import llm
from utils.parsing import safe_json_parse
from rag.retrieve import retrieve_context
from nodes.coach_application import coach_application
from nodes.coach_sections import coach_sections
from nodes.assemble_package import assemble_package


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


def build_application_graph(profile_store):
    builder = StateGraph(ApplicationState)

    builder.add_node("analyze_opportunity", analyze_opportunity)
    builder.add_node("retrieve_profile", lambda s: retrieve_profile(s, profile_store))
    builder.add_node("coach_sections", coach_sections)
    builder.add_node("coach_application", coach_application)
    builder.add_node("assemble_package", assemble_package)

    builder.set_entry_point("analyze_opportunity")
    builder.add_edge("analyze_opportunity", "retrieve_profile")
    builder.add_edge("retrieve_profile", "coach_sections")
    builder.add_edge("coach_sections", "coach_application")
    builder.add_edge("coach_application", "assemble_package")
    builder.add_edge("assemble_package", END)

    return builder.compile()


def build_graph(rfp_store, kb_store):
    from nodes.analyze import analyze
    from nodes.assemble import assemble
    from nodes.compliance import init_compliance
    from nodes.generate import generate
    from nodes.retrieve import retrieve
    from nodes.review import review
    from nodes.score import score

    builder = StateGraph(ProposalState)

    builder.add_node("analyze", analyze)
    builder.add_node("compliance", init_compliance)
    builder.add_node("retrieve", lambda s: retrieve(s, rfp_store, kb_store))
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
