import pytest
from fastapi import HTTPException

from api.routes import build_public_fit_analysis_response
from nodes.fit_analysis import compute_fit_score


def eligibility(status: str) -> dict:
    return {"requirement": "Example requirement", "status": status}


def criterion(alignment: str) -> dict:
    return {"criterion": "Example criterion", "alignment": alignment}


def test_fit_score_is_capped_at_95_for_perfect_alignment():
    score, label, likely_eligible = compute_fit_score(
        [eligibility("Met")],
        [criterion("Strong")],
    )

    assert score == 95
    assert label == "Strong Fit"
    assert likely_eligible == "Yes"


def test_fit_score_is_floored_at_15_for_multiple_hard_failures():
    score, label, likely_eligible = compute_fit_score(
        [eligibility("Not met"), eligibility("Not met"), eligibility("Not met")],
        [],
    )

    assert score == 15
    assert label == "Not Eligible"
    assert likely_eligible == "No"


def test_single_hard_failure_keeps_existing_score_of_24():
    score, label, likely_eligible = compute_fit_score(
        [eligibility("Not met")],
        [],
    )

    assert score == 24
    assert label == "Not Eligible"
    assert likely_eligible == "No"


def test_no_fit_information_keeps_existing_score_of_20():
    score, label, likely_eligible = compute_fit_score([], [])

    assert score == 20
    assert label == "Insufficient Information"
    assert likely_eligible == "Unclear"


def test_public_fit_response_excludes_internal_fields_and_scoring_language():
    response = build_public_fit_analysis_response(
        {
            "scholarship_name": "Community Scholarship",
            "fit_label": "Not Eligible",
            "fit_score": 24,
            "likely_eligible": "No",
            "summary": (
                "Your profile does not currently meet one eligibility requirement. "
                "Downstream code computes fit_score from the internal scoring formula."
            ),
            "eligibility_analysis": [
                {
                    "requirement": "This hard requirement asks for graduate enrollment.",
                    "status": "Not met",
                    "student_evidence": "The profile lists undergraduate enrollment.",
                    "explanation": "The score stays below 40 because this is a hard failure.",
                }
            ],
            "strengths": ["Community leadership"],
            "gaps_or_risks": ["Graduate enrollment is not shown."],
            "missing_student_information": [],
            "selection_criteria_alignment": [],
            "recommended_next_steps": ["Confirm the required academic level."],
            "application_materials_check": [{"material": "Transcript"}],
            "application_readiness_matrix": {"internal": True},
            "diagnostics": {"prompt": "private"},
        }
    )
    data = response.model_dump() if hasattr(response, "model_dump") else response.dict()
    rendered_text = " ".join(
        [
            data["summary"],
            *data["strengths"],
            *data["gaps_or_risks"],
            *data["missing_student_information"],
            *data["recommended_next_steps"],
            *[
                " ".join(str(value) for value in row.values())
                for row in data["eligibility_analysis"]
            ],
            *[
                " ".join(str(value) for value in row.values())
                for row in data["selection_criteria_alignment"]
            ],
        ]
    ).lower()

    assert data["fit_score"] == 24
    assert "application_materials_check" not in data
    assert "application_readiness_matrix" not in data
    assert "diagnostics" not in data
    assert "downstream code" not in rendered_text
    assert "fit_score" not in rendered_text
    assert "scoring formula" not in rendered_text
    assert "score stays below" not in rendered_text
    assert "hard requirement" not in rendered_text
    assert "eligibility requirement" in rendered_text


def test_fit_route_masks_internal_exception_details(monkeypatch):
    import server
    from api.routes import FitAnalyzeRequest

    def fail_fit_analysis(_request):
        raise RuntimeError("private scoring implementation detail")

    monkeypatch.setattr(server, "analyze_scholarship_fit", fail_fit_analysis)
    request = FitAnalyzeRequest(
        scholarship_record={"name": "Community Scholarship"},
        student_profile={"name": "Student"},
    )

    with pytest.raises(HTTPException) as raised:
        server.analyze_fit(request)

    assert raised.value.status_code == 500
    assert raised.value.detail == (
        "Scholarship fit analysis could not be completed. Please try again."
    )
