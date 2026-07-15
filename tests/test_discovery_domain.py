import pytest

from api.routes import WikiBootstrapRequest, get_scholarship_discovery_bootstrap
from discovery.compatibility import assess_candidate, compatible_levels
from discovery.evidence import candidate_evidence
from discovery.eligibility import candidate_eligibility_constraints
from discovery.intent_service import generate_intent_options
from discovery.normalization import apply_field_intelligence, build_discovery_context, normalize_profile
from discovery.ranking import score_candidate
from discovery.schemas import EducationLevel


def profile(field="Materials Science", level="Master's Degree", citizenship="B-International Student or Other Visa Status"):
    return {
        "educationLevel": "grad",
        "educationHistory": [
            {
                "educationLevel": level,
                "majorField": field,
                "institution": "Example University",
            }
        ],
        "citizenshipStatus": citizenship,
        "careerGoal": "Develop sustainable battery materials",
    }


def source(**overrides):
    item = {
        "name": "Example award",
        "url": "https://example.org/award",
        "origin": "library",
        "kind": "specific_source",
        "degree_levels": ["Graduate"],
        "student_types": ["Domestic", "International"],
        "fields": ["General"],
        "opportunity_types": ["Scholarship"],
    }
    item.update(overrides)
    return item


def test_degree_compatibility_is_exact_not_substring_based():
    assert not compatible_levels(EducationLevel.MASTERS, {EducationLevel.BACHELORS})
    assert compatible_levels(EducationLevel.MASTERS, {EducationLevel.GRADUATE})
    assert not compatible_levels(EducationLevel.BACHELORS, {EducationLevel.GRADUATE})
    assert not compatible_levels(EducationLevel.DOCTORAL, {EducationLevel.POSTDOCTORAL})


def test_field_mismatch_is_advisory_not_a_hard_rejection():
    context = build_discovery_context(profile())
    computing = source(fields=["Computer Science", "Data Science"])
    result = assess_candidate(computing, context)
    assert result.compatible
    assert result.field_match == "unrelated"
    assert result.field_score == 0.0
    assert "field" not in result.hard_contradictions


def test_broad_stem_source_can_support_materials_science():
    context = build_discovery_context(profile())
    stem = source(fields=["STEM"])
    result = assess_candidate(stem, context)
    assert result.compatible
    assert result.field_match == "broad_family"


@pytest.mark.parametrize(
    "field",
    [
        "Materials Science",
        "Nursing",
        "Art History",
        "Architecture",
        "Welding Technology",
        "Quantum Materials Informatics",
        "Agricultural Economics",
    ],
)
def test_arbitrary_fields_are_preserved_exactly(field):
    context = build_discovery_context(profile(field=field))
    assert context.profile.field.raw_label == field
    assert context.profile.field.canonical_id
    assert context.profile.field.canonical_label == field


def test_field_intelligence_expands_matching_for_any_field():
    context = build_discovery_context(profile(field="Ethnomusicology"))
    apply_field_intelligence(context, {
        "canonical_label": "Ethnomusicology",
        "synonyms": ["music anthropology"],
        "parent_disciplines": ["Music", "Cultural Studies"],
        "umbrella_terms": ["Humanities", "Arts"],
        "funder_vocabulary": ["arts and humanities fellowships"],
    })
    field = context.profile.field
    assert "music anthropology" in field.expanded_terms
    assert "Humanities" in field.expanded_terms
    assert field.confidence >= 0.85
    humanities_source = source(fields=["Humanities", "Arts"])
    result = assess_candidate(humanities_source, context)
    assert result.compatible
    assert result.field_match in {"exact", "related_terms"}
    assert result.field_score >= 0.6


def test_more_specific_education_history_wins_over_generic_grad_flag():
    normalized = normalize_profile(profile(level="Doctoral Degree"))
    assert normalized.education.current_level == EducationLevel.DOCTORAL


def test_intent_options_are_backend_owned_profile_grounded_and_capped():
    options = generate_intent_options(profile())
    assert 1 <= len(options) <= 4
    assert any(item["id"] == "field-funding" and item["canonical_values"] == ["materials_science"] for item in options)
    assert any(item["id"] == "international-funding" for item in options)
    assert all(item["derived_from"] for item in options)


def test_free_text_is_preserved_and_exclusions_are_structured():
    context = build_discovery_context(
        profile(),
        [{
            "id": "field-funding",
            "label": "Materials Science funding",
            "dimension": "field",
            "value": "Materials Science",
            "canonical_values": ["materials_science"],
            "derived_from": ["educationHistory.majorField"],
        }],
        "Battery research without a government service requirement",
    )
    assert context.preference_text.startswith("Battery research")
    assert context.exclusions == ["a government service requirement"]
    assert context.selected_intents[0].canonical_values == ["materials_science"]


def test_online_retrieval_evidence_does_not_claim_profile_attributes():
    evidence = candidate_evidence({
        "origin": "web_search",
        "search_query": "materials science graduate fellowship",
        "snippet": "Search result preview",
        "preview_ok": True,
        "fields": [],
        "degree_levels": [],
        "student_types": [],
    })
    assert evidence["retrieval_query"] == "materials science graduate fellowship"
    assert evidence["asserted_fields"] == []
    assert evidence["attribute_provenance"]["fields"] == "unknown_from_page"


def test_hard_contradiction_forces_zero_rank_score():
    context = build_discovery_context(profile())
    candidate = source(degree_levels=["Undergraduate"], fields=["Computer Science"])
    score, components = score_candidate(candidate, context)
    assert score == 0
    assert components == {"compatibility": 0.0}


def test_bootstrap_always_returns_profile_intents_and_three_platforms():
    result = get_scholarship_discovery_bootstrap(WikiBootstrapRequest(student_profile=profile()))
    assert 1 <= len(result["intent_options"]) <= 4
    assert len(result["platform_defaults"]) == 3
    assert result["profile_summary"]["field_of_study"] == "Materials Science"
    assert result["profile_summary"]["education_level"] == "masters"


def test_male_profile_rejects_women_only_scholarship():
    student = profile()
    student["gender"] = "Male"
    context = build_discovery_context(student)
    peo = source(
        name="P.E.O. International Peace Scholarship",
        eligible_genders=["Female"],
        best_for=["International women graduate students"],
    )
    result = assess_candidate(peo, context)
    assert not result.compatible
    assert result.gender_match == "incompatible"
    assert "gender" in result.hard_contradictions


def test_female_profile_keeps_women_only_scholarship():
    student = profile()
    student["gender"] = "Female"
    result = assess_candidate(source(eligible_genders=["Female"]), build_discovery_context(student))
    assert result.compatible
    assert result.gender_match == "compatible"


def test_unknown_gender_flags_confirmation_instead_of_rejecting():
    result = assess_candidate(source(eligible_genders=["Female"]), build_discovery_context(profile()))
    assert result.compatible
    assert result.gender_match == "unknown"
    assert "gender" in result.unknowns


def test_page_evidence_detects_explicit_women_only_audience():
    constraints = candidate_eligibility_constraints(source(
        origin="web_search",
        best_for=[],
        snippet="This scholarship is aimed at international women graduate students studying in the U.S.",
    ))
    assert constraints["eligible_genders"] == ["female"]


def test_womens_studies_subject_is_not_misread_as_gender_restriction():
    constraints = candidate_eligibility_constraints(source(
        origin="web_search",
        name="Women's Studies Research Award",
        best_for=[],
        snippet="Funding for graduate students researching women's studies and gender history.",
    ))
    assert constraints["eligible_genders"] == []


def test_known_race_ethnicity_mismatch_is_a_hard_contradiction():
    student = profile()
    student["raceEthnicity"] = "White (Not Hispanic or Latino)"
    result = assess_candidate(
        source(race_ethnicity_requirements=["Hispanic / Latino"]),
        build_discovery_context(student),
    )
    assert not result.compatible
    assert result.race_ethnicity_match == "incompatible"
    assert "race_ethnicity" in result.hard_contradictions


def test_multiracial_profile_does_not_get_false_identity_rejection():
    student = profile()
    student["raceEthnicity"] = "Two or More Races"
    result = assess_candidate(
        source(race_ethnicity_requirements=["Black or African American"]),
        build_discovery_context(student),
    )
    assert result.compatible
    assert result.race_ethnicity_match == "unknown"


def test_positive_context_fields_are_preserved_and_used():
    student = profile()
    student.update({"firstGen": True, "pellEligible": True})
    student["extendedContext"] = {
        "Full-time student": True,
        "Student with disability": True,
        "Veteran": False,
    }
    context = build_discovery_context(student)
    assert context.profile.first_generation
    assert context.profile.financial_need
    assert "disability" in context.profile.identity_context
    assert "full_time" in context.profile.enrollment_statuses
    result = assess_candidate(
        source(
            identity_requirements=["Student with disability"],
            financial_need_required=True,
            first_generation_required=True,
            enrollment_statuses=["Full-time student"],
        ),
        context,
    )
    assert result.compatible
    assert result.identity_match == "compatible"
    assert result.financial_need_match == "compatible"
    assert result.enrollment_status_match == "compatible"


def test_unchecked_context_is_unknown_not_a_false_rejection():
    result = assess_candidate(
        source(identity_requirements=["Veteran"], financial_need_required=True),
        build_discovery_context(profile()),
    )
    assert result.compatible
    assert "identity:veteran" in result.unknowns
    assert "financial_need" in result.unknowns


def test_confirmed_enrollment_status_mismatch_is_rejected():
    student = profile()
    student["extendedContext"] = {"Part-time student": True}
    result = assess_candidate(
        source(enrollment_statuses=["Full-time student"]),
        build_discovery_context(student),
    )
    assert not result.compatible
    assert "enrollment_status" in result.hard_contradictions


def test_candidate_evidence_carries_eligibility_constraints():
    evidence = candidate_evidence(source(eligible_genders=["Female"], financial_need_required=True))
    constraints = evidence["asserted_eligibility_constraints"]
    assert constraints["eligible_genders"] == ["female"]
    assert constraints["financial_need_required"] is True


def test_known_gpa_below_explicit_minimum_is_rejected():
    student = profile()
    student["educationHistory"][0]["gpa"] = "3.20"
    result = assess_candidate(source(minimum_gpa=3.5), build_discovery_context(student))
    assert not result.compatible
    assert result.gpa_match == "incompatible"
    assert "minimum_gpa" in result.hard_contradictions


def test_gpa_requirement_from_page_text_is_enforced():
    student = profile()
    student["educationHistory"][0]["gpa"] = "3.8 / 4.0"
    candidate = source(
        origin="web_search",
        snippet="Applicants must have a minimum cumulative GPA of 3.5 to apply.",
    )
    result = assess_candidate(candidate, build_discovery_context(student))
    assert result.compatible
    assert result.gpa_match == "compatible"


def test_missing_or_nonstandard_gpa_is_confirmation_not_rejection():
    student = profile()
    student["educationHistory"][0]["gpa"] = "92 percent"
    result = assess_candidate(source(minimum_gpa=3.5), build_discovery_context(student))
    assert result.compatible
    assert result.gpa_match == "unknown"
    assert "gpa" in result.unknowns
