from typing import Any, Dict, List, TypedDict


class WikiDiscoveryState(TypedDict, total=False):
    student_profile: Dict[str, Any]
    source_library: List[Dict[str, Any]]
    discovery_focus: str
    selected_intents: List[Dict[str, Any]]
    free_text_intent: str
    excluded_urls: List[str]
    discovery_feedback: List[Dict[str, Any]]
    discovery_brief: Dict[str, Any]
    canonical_profile: Dict[str, Any]
    discovery_context: Dict[str, Any]
    search_queries: List[str]
    discovery_llm_failed: bool
    presentation: Dict[str, Any]
    candidate_pool: List[Dict[str, Any]]
    ranked_sources: List[Dict[str, Any]]
    rejected_sources: List[Dict[str, Any]]
    verification_report: Dict[str, Any]
    wiki_draft: Dict[str, Any]
    critic_result: Dict[str, Any]
    page_title: str
    profile_summary: Dict[str, Any]
    recommended_source_groups: List[Dict[str, Any]]
    top_free_platforms: List[Dict[str, Any]]
    specific_opportunities: List[Dict[str, Any]]
    funding_categories: List[Dict[str, Any]]
    personalized_search_queries: List[str]
    next_steps: List[str]
    missing_profile_fields: List[str]
    generated_at: str
    result_note: str
