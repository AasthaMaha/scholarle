from __future__ import annotations

from typing import Any

from .schemas import CandidateEvidence, model_dict


def candidate_evidence(candidate: dict[str, Any]) -> dict[str, Any]:
    origin = str(candidate.get("origin") or "")
    curated = origin == "library"
    fetched = bool(candidate.get("preview_ok")) or curated
    evidence = CandidateEvidence(
        origin=origin,
        retrieval_query=str(candidate.get("search_query") or ""),
        page_snippet=str(candidate.get("snippet") or "")[:500],
        fetched=fetched,
        asserted_fields=[str(value) for value in candidate.get("fields") or []],
        asserted_levels=[str(value) for value in candidate.get("degree_levels") or []],
        asserted_student_types=[str(value) for value in candidate.get("student_types") or []],
        asserted_opportunity_types=[str(value) for value in candidate.get("opportunity_types") or []],
        evidence_quality=1.0 if curated else 0.65 if fetched else 0.2,
        attribute_provenance={
            "fields": "curated_metadata" if curated else "unknown_from_page",
            "education_levels": "curated_metadata" if curated else "unknown_from_page",
            "student_types": "curated_metadata" if curated else "unknown_from_page",
            "retrieval_relevance": "search_query" if not curated else "curated_metadata",
        },
    )
    return model_dict(evidence)
