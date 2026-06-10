from typing import Any, Dict, List, TypedDict


class ApplicationState(TypedDict, total=False):
    # Input
    opportunity_text: str
    previous_readiness: Dict[str, int]
    draft_number: int

    # Opportunity analysis
    opportunity_analysis: Dict[str, Any]

    # Input documents + retrieval
    student_profile_docs: List[Any]
    retrieved_profile_chunks: List[str]

    # Student-provided draft
    student_draft: str

    # Coaching nodes
    section_coaching: Dict[str, str]
    coaching_brief: Dict[str, Any]
    readiness_index: Dict[str, Any]
    growth_report: Dict[str, Any]
    reviewer_comments: List[Dict[str, str]]
    coaching_reports: Dict[str, Any]
    feedback: str
    revision_priorities: List[str]
    scores: Dict[str, Any]

    # Final package
    final_application_package: str
