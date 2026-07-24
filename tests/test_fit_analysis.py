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
