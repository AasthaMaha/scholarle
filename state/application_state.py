<<<<<<< Updated upstream
from typing import TypedDict, List, Dict, Any


class ApplicationState(TypedDict, total=False):
    # Input
    opportunity_text: str

    # analyze_opportunity node
    opportunity_analysis: Dict[str, Any]

    # Input documents + retrieval
    student_profile_docs: List[Any]
    retrieved_profile_chunks: List[str]

    # Student-provided draft (essay / personal statement / answer)
    student_draft: str

    # score_application node
    feedback: str
    scores: Dict[str, Any]

    # assemble_package node
    final_application_package: str
=======
from typing import TypedDict, List, Dict, Any, Optional


class ApplicationState(TypedDict, total=False):
    # Input
    opportunity_text: str
    previous_readiness: Dict[str, int]
    draft_number: int

    # analyze_opportunity node
    opportunity_analysis: Dict[str, Any]

    # Input documents + retrieval
    student_profile_docs: List[Any]
    retrieved_profile_chunks: List[str]

    # Student-provided draft (essay / personal statement / answer)
    student_draft: str

    # coach_sections node (per-section coaching from templates)
    section_coaching: Dict[str, str]

    # coach_application node
    coaching_brief: Dict[str, Any]
    readiness_index: Dict[str, Any]
    growth_report: Dict[str, Any]
    reviewer_comments: List[Dict[str, str]]
    coaching_reports: Dict[str, Any]
    feedback: str
    revision_priorities: List[str]
    scores: Dict[str, Any]

    # assemble_package node
    final_application_package: str
>>>>>>> Stashed changes
