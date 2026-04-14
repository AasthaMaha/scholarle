from typing import TypedDict, List, Dict, Any


class ProposalState(TypedDict, total=False):
    # Input
    rfp_text: str
    

    # Analyze node
    requirements: List[Dict[str, Any]]  # [{id, text}]
    evaluation_criteria: List[str]
    themes: List[str]

    # Compliance node
    compliance_matrix: List[Dict[str, Any]]

    # Retrieval node
    context_chunks: List[str]
    rfp_chunks: List[str]
    kb_chunks: List[str]

    # Generated sections
    exec_summary: str
    technical_volume: str
    past_performance: str

    # Review node
    review_notes: str

    # Score node
    completeness: float = 0.0
    clarity: float = 0.0
    strength: float = 0.0
    hallucination_penalty: float = 0.0
    score: float = 0.0

    # Final
    final_proposal: str