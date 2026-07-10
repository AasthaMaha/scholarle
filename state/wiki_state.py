from typing import Any, Dict, List, TypedDict


class WikiDiscoveryState(TypedDict, total=False):
    student_profile: Dict[str, Any]
    source_library: List[Dict[str, Any]]
    platform_sources: List[Dict[str, Any]]
    specific_sources: List[Dict[str, Any]]
    page_title: str
    profile_summary: Dict[str, Any]
    recommended_source_groups: List[Dict[str, Any]]
    top_free_platforms: List[Dict[str, Any]]
    specific_opportunities: List[Dict[str, Any]]
    funding_categories: List[Dict[str, Any]]
    personalized_search_queries: List[str]
    next_steps: List[str]
    missing_profile_fields: List[str]
