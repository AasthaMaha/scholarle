from __future__ import annotations

from typing import Any

from .schemas import CandidateEvidence, model_dict
from .eligibility import candidate_eligibility_constraints


def candidate_evidence(candidate: dict[str, Any]) -> dict[str, Any]:
    origin = str(candidate.get("origin") or "")
    curated = origin == "library"
    fetched = bool(candidate.get("direct_fetch_ok")) or curated
    constraints = candidate_eligibility_constraints(candidate)
    evidence = CandidateEvidence(
        origin=origin,
        retrieval_query=str(candidate.get("search_query") or ""),
        page_snippet=str(candidate.get("snippet") or "")[:500],
        fetched=fetched,
        asserted_fields=[str(value) for value in candidate.get("fields") or []],
        asserted_levels=[str(value) for value in candidate.get("degree_levels") or []],
        asserted_student_types=[str(value) for value in candidate.get("student_types") or []],
        asserted_opportunity_types=[str(value) for value in candidate.get("opportunity_types") or []],
        asserted_eligibility_constraints=constraints,
        deadline_status=str(candidate.get("deadline_status") or "unknown"),
        deadline_verified=bool(candidate.get("deadline_verified")),
        application_deadline=str(candidate.get("application_deadline") or ""),
        deadline_source_url=str(candidate.get("deadline_source_url") or ""),
        deadline_checked_at=str(candidate.get("deadline_checked_at") or ""),
        evidence_quality=1.0 if curated else 0.65 if fetched else 0.2,
        attribute_provenance={
            "fields": "curated_metadata" if curated else "unknown_from_page",
            "education_levels": "curated_metadata" if curated else "unknown_from_page",
            "student_types": "curated_metadata" if curated else "unknown_from_page",
            "eligibility_constraints": "curated_metadata_or_page_text" if curated else "page_text",
            "deadline": "official_page" if candidate.get("deadline_verified") else "unverified",
            "retrieval_relevance": "search_query" if not curated else "curated_metadata",
        },
    )
    return model_dict(evidence)
