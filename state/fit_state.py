from typing import Any, Dict, List, TypedDict


class FitAnalysisState(TypedDict, total=False):
    scholarship_record: Dict[str, Any]
    student_profile: Dict[str, Any]
    fit_result: Dict[str, Any]

    scholarship_name: str
    fit_label: str
    fit_score: int
    likely_eligible: str
    summary: str
    eligibility_analysis: List[Dict[str, str]]
    strengths: List[str]
    gaps_or_risks: List[str]
    missing_student_information: List[str]
    application_materials_check: List[Dict[str, str]]
    selection_criteria_alignment: List[Dict[str, str]]
    recommended_next_steps: List[str]
    application_readiness_matrix: Dict[str, Any]
