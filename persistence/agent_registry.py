from __future__ import annotations

from config import settings


CURRENT_AGENT_DEFINITIONS = [
    {
        "agent_name": "resume_profile_extraction",
        "display_name": "Resume Profile Extraction Agent",
        "description": "Extracts editable student profile fields from uploaded resume text.",
        "agent_type": "profile",
        "uses_rag": False,
        "rag_sources": [],
    },
    {
        "agent_name": "scholarship_discovery_wiki",
        "display_name": "Scholarship Discovery Wiki Agents",
        "description": "Recommends curated platforms and specific scholarship sources from the saved profile.",
        "agent_type": "discovery",
        "uses_rag": True,
        "rag_sources": ["scholarship_sources", "global_wiki_memory"],
    },
    {
        "agent_name": "scholarship_requirements_extraction",
        "display_name": "Scholarship Requirements Extraction Agent",
        "description": "Extracts scholarship facts and requirements from user-provided source text or links.",
        "agent_type": "extraction",
        "uses_rag": False,
        "rag_sources": [],
    },
    {
        "agent_name": "scholarship_information_cleaner",
        "display_name": "Scholarship Information Cleaner Agent",
        "description": "Normalizes extracted scholarship information for editable UI display.",
        "agent_type": "cleaning",
        "uses_rag": False,
        "rag_sources": [],
    },
    {
        "agent_name": "scholarship_fit_analysis",
        "display_name": "Scholarship Fit Analysis Agent",
        "description": "Compares the current profile against the cleaned scholarship record.",
        "agent_type": "analysis",
        "uses_rag": True,
        "rag_sources": ["user_profile_memory", "user_opportunity_memory"],
    },
    {
        "agent_name": "essay_application_coaching",
        "display_name": "Essay/Application Coaching Agents",
        "description": "Runs strategy, eligibility, discovery, narrative, reviewer, critic, and package agents.",
        "agent_type": "coaching",
        "uses_rag": True,
        "rag_sources": [
            "user_profile_memory",
            "user_opportunity_memory",
            "user_application_memory",
            "user_feedback_memory",
        ],
    },
    {
        "agent_name": "essay_alignment_matrix",
        "display_name": "Essay Alignment Matrix Agent",
        "description": "Checks whether the current essay draft answers the prompt, stated themes, criteria, and length guidance.",
        "agent_type": "analysis",
        "uses_rag": True,
        "rag_sources": [
            "user_profile_memory",
            "user_opportunity_memory",
            "user_application_memory",
            "user_feedback_memory",
        ],
    },
]


def agent_definition_by_name(agent_name: str) -> dict:
    for definition in CURRENT_AGENT_DEFINITIONS:
        if definition["agent_name"] == agent_name:
            return {
                **definition,
                "model_provider": settings.llm_provider,
                "model_name": settings.model,
                "prompt_version": "v1",
                "input_schema": {},
                "output_schema": {},
                "is_active": True,
            }
    return {
        "agent_name": agent_name,
        "display_name": agent_name.replace("_", " ").title(),
        "description": "Registered dynamically by the agent persistence wrapper.",
        "agent_type": "future",
        "uses_rag": False,
        "rag_sources": [],
        "model_provider": settings.llm_provider,
        "model_name": settings.model,
        "prompt_version": "v1",
        "input_schema": {},
        "output_schema": {},
        "is_active": True,
    }
