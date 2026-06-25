from typing import Any, Dict, List, TypedDict


class ApplicationState(TypedDict, total=False):
    # Input
    opportunity_text: str
    previous_readiness: Dict[str, int]
    draft_number: int

    # Opportunity analysis
    opportunity_analysis: Dict[str, Any]

    # Input documents + retrieval (Retriever agent)
    student_profile_docs: List[Any]
    retrieved_profile_chunks: List[str]

    # Student-provided draft
    student_draft: str

    # Shared grounding context (prepared once, read by every generation agent)
    shared_context: str
    profile_text: str
    submitted_summary: str

    # Raw outputs from the specialized generation agents (distinct keys so they
    # can run in parallel without clobbering each other)
    section_coaching: Dict[str, str]
    strategy_report: Dict[str, Any]
    eligibility_report: Dict[str, Any]
    discovery_report: Dict[str, Any]
    narrative_report: Dict[str, Any]
    reviewer_report: Dict[str, Any]

    # Eligibility / requirements comparison matrix (consumer-facing)
    eligibility_matrix: Dict[str, Any]

    # Combiner agent output (consumer-facing)
    coaching_brief: Dict[str, Any]
    readiness_index: Dict[str, Any]
    growth_report: Dict[str, Any]
    reviewer_comments: List[Dict[str, str]]
    coaching_reports: Dict[str, Any]
    feedback: str
    revision_priorities: List[str]
    scores: Dict[str, Any]

    # Critic agent output + bounded revision loop control
    critique: Dict[str, Any]
    critic_attempts: int
    needs_revision: bool

    # Final package
    final_application_package: str
