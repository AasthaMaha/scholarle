from api.routes import WikiDiscoverRequest, WikiDiscoverResponse
from nodes import wiki_discovery


def _source(**overrides):
    source = {
        "name": "Example source",
        "url": "https://example.org/opportunity",
        "kind": "specific_source",
        "category": "Scholarship program",
        "degree_levels": ["Undergraduate"],
        "student_types": ["Domestic", "International"],
        "fields": ["General"],
        "best_for": [],
        "status": "active",
    }
    source.update(overrides)
    return source


def test_field_mismatch_stays_in_pool_for_llm_judging():
    # Field relevance is judged semantically by the LLM ranker; the code gate
    # keeps only true eligibility constraints (degree level, student type).
    brief = {
        "degree_level": "Undergraduate",
        "field_of_study": "Political Science",
        "student_type": "Domestic student",
    }
    smart = _source(
        name="SMART Scholarship-for-Service Program",
        category="STEM service scholarship",
        fields=["STEM", "Computer Science", "Engineering"],
        best_for=["STEM undergraduates"],
    )
    assert wiki_discovery._candidate_matches_brief(smart, brief, "public service scholarships")
    graduate_only = _source(degree_levels=["Graduate", "PhD"])
    assert not wiki_discovery._candidate_matches_brief(graduate_only, brief, "public service scholarships")


def test_general_platform_passes_but_hard_degree_mismatch_does_not():
    brief = {"degree_level": "Graduate", "field_of_study": "Political Science"}
    broad_platform = _source(
        kind="platform",
        category="General scholarship platform",
        degree_levels=["Undergraduate", "Graduate"],
    )
    high_school_only = _source(
        kind="platform",
        category="General scholarship platform",
        degree_levels=["High school"],
    )
    assert wiki_discovery._candidate_matches_brief(broad_platform, brief, "policy")
    assert not wiki_discovery._candidate_matches_brief(high_school_only, brief, "policy")


def test_candidate_pool_honors_dismissed_urls(monkeypatch):
    dismissed = _source(url="https://example.org/dismissed", kind="platform", category="Scholarship platform")
    useful = _source(url="https://example.org/useful", kind="platform", category="Scholarship platform")
    monkeypatch.setattr(wiki_discovery, "_library_candidates", lambda _: [dismissed, useful])
    monkeypatch.setattr(wiki_discovery, "_search_candidates", lambda _: [])
    monkeypatch.setattr(wiki_discovery, "_search_platform_candidates", lambda _brief, _focus: [])

    result = wiki_discovery.build_candidate_pool(
        {
            "source_library": [],
            "discovery_brief": {"degree_level": "Undergraduate", "field_of_study": "Political Science"},
            "discovery_focus": "public service",
            "excluded_urls": [dismissed["url"]],
            "search_queries": ["political science scholarship"],
        }
    )

    assert [item["url"] for item in result["candidate_pool"]] == [useful["url"]]


def test_live_platform_search_requires_page_evidence_and_marks_grounding(monkeypatch):
    monkeypatch.setattr(
        wiki_discovery,
        "_search_candidates",
        lambda _queries, **_kwargs: [
            {
                "candidate_id": "https://example.org/database",
                "name": "Policy Funding Database",
                "url": "https://example.org/database",
                "snippet": "Search scholarships and browse funding opportunities for policy students.",
                "search_query": "policy fellowship database",
                "preview_ok": True,
            },
            {
                "candidate_id": "https://example.org/award",
                "name": "One Policy Award",
                "url": "https://example.org/award",
                "snippet": "Apply for this annual award.",
                "search_query": "policy fellowship database",
                "preview_ok": True,
            },
            {
                "candidate_id": "https://example.org/unreachable",
                "name": "Scholarship Database",
                "url": "https://example.org/unreachable",
                "snippet": "Search hit for query: scholarship database",
                "search_query": "scholarship database",
                "preview_ok": False,
            },
        ],
    )

    results = wiki_discovery._search_platform_candidates(
        {
            "degree_level": "Graduate",
            "field_of_study": "Political Science",
            "student_type": "International student",
            "opportunity_types": ["Fellowship"],
        },
        "public policy fellowships",
    )

    assert [item["url"] for item in results] == ["https://example.org/database"]
    assert results[0]["kind"] == "platform"
    assert results[0]["origin"] == "web_platform_search"
    assert results[0]["fields"] == []
    assert results[0]["search_query"] == "policy fellowship database"


def test_candidate_pool_merges_curated_and_live_platforms(monkeypatch):
    curated = _source(
        name="Curated Finder",
        url="https://example.org/curated",
        kind="platform",
        category="General scholarship platform",
    )
    live = _source(
        name="Live Policy Database",
        url="https://example.org/live",
        kind="platform",
        category="Online scholarship search platform",
        origin="web_platform_search",
        search_query="policy fellowship database",
        snippet="Search fellowships for policy students.",
    )
    monkeypatch.setattr(wiki_discovery, "_library_candidates", lambda _: [curated])
    monkeypatch.setattr(wiki_discovery, "_search_candidates", lambda _queries: [])
    monkeypatch.setattr(wiki_discovery, "_search_platform_candidates", lambda _brief, _focus: [live])

    result = wiki_discovery.build_candidate_pool(
        {
            "source_library": [],
            "discovery_brief": {"degree_level": "Undergraduate", "field_of_study": "Political Science"},
            "discovery_focus": "public service fellowships",
            "search_queries": ["political science scholarships"],
        }
    )

    assert [item["url"] for item in result["candidate_pool"]] == [curated["url"], live["url"]]


def test_platforms_are_selected_semantically_and_capped_at_three():
    brief = {
        "degree_level": "Graduate",
        "field_of_study": "Political Science",
        "student_type": "International student",
        "opportunity_types": ["Fellowship", "Scholarship"],
    }
    platforms = [
        _source(
            name="Policy Fellowships",
            url="https://example.org/policy",
            kind="platform",
            category="Fellowship database",
            degree_levels=["Graduate"],
            student_types=["International"],
            fields=["Policy", "Political Science"],
            opportunity_types=["Fellowship"],
            best_for=["Policy students"],
        ),
        _source(
            name="International Funding",
            url="https://example.org/international",
            kind="platform",
            category="International student database",
            degree_levels=["Graduate"],
            student_types=["International"],
            fields=["General"],
            opportunity_types=["Scholarship"],
        ),
        _source(
            name="Global Opportunities",
            url="https://example.org/global",
            kind="platform",
            category="Global opportunity platform",
            degree_levels=["Graduate"],
            student_types=["International"],
            fields=["Policy", "Leadership"],
            opportunity_types=["Fellowship"],
        ),
        _source(
            name="Broad Search",
            url="https://example.org/broad",
            kind="platform",
            category="General scholarship platform",
            degree_levels=["Graduate"],
            student_types=["International"],
            fields=["General"],
            opportunity_types=["Scholarship"],
        ),
    ]

    selected = wiki_discovery._select_semantic_platforms(
        platforms,
        brief,
        "public policy and public service fellowships",
    )

    assert len(selected) == 3
    assert selected[0]["name"] == "Policy Fellowships"
    assert all(item["why_recommended"].startswith("Selected") for item in selected)


def test_selected_intents_are_sanitized_capped_and_combined_with_free_text():
    state = {
        "free_text_intent": "public-service funding without a service commitment",
        "selected_intents": [
            {
                "id": "policy",
                "label": "Policy funding",
                "dimension": "field",
                "value": "political science and public policy",
                "derived_from": ["undergrad.major"],
            },
            {
                "id": "fellowship",
                "label": "Fellowships",
                "dimension": "opportunity_type",
                "value": "graduate fellowship",
                "derived_from": ["educationLevel"],
            },
            {
                "id": "duplicate",
                "label": "Fellowships again",
                "dimension": "opportunity_type",
                "value": "graduate fellowship",
            },
            {"id": "invalid", "dimension": "unsupported", "value": "ignore me"},
        ],
    }

    selected = wiki_discovery._selected_intents(state)
    combined = wiki_discovery._combined_intent_text(state)

    assert [item["id"] for item in selected] == ["policy", "fellowship"]
    assert combined.startswith("public-service funding without a service commitment")
    assert "political science and public policy" in combined
    assert "graduate fellowship" in combined


def test_finalizer_does_not_backfill_and_respects_critic_drop():
    kept = _source(name="Policy Scholarship", url="https://example.org/policy")
    dropped = _source(name="STEM Scholarship", url="https://example.org/stem")
    for item in (kept, dropped):
        item.update({"candidate_id": item["url"], "priority": "High", "status_estimate": "active"})

    result = wiki_discovery.finalize_wiki_output(
        {
            "ranked_sources": [kept, dropped],
            "wiki_draft": {
                "specific_opportunities": [
                    wiki_discovery._as_specific_item(kept),
                    wiki_discovery._as_specific_item(dropped),
                ]
            },
            "critic_result": {
                "actions": [{"action": "drop", "name": dropped["name"], "url": dropped["url"]}]
            },
            "discovery_focus": "Political science and public service",
        }
    )

    assert [item["url"] for item in result["specific_opportunities"]] == [kept["url"]]
    assert result["discovery_focus"] == "Political science and public service"
    assert result["generated_at"]


def test_finalizer_guarantees_platforms_from_curated_library():
    platforms = [
        _source(
            name=f"Platform {index}",
            url=f"https://example.org/platform-{index}",
            kind="platform",
            category="General scholarship platform",
            degree_levels=["Graduate"],
            fields=["General"],
        )
        for index in range(1, 5)
    ]

    result = wiki_discovery.finalize_wiki_output(
        {
            "source_library": platforms,
            "ranked_sources": [],
            "discovery_brief": {
                "degree_level": "Graduate",
                "field_of_study": "Computer Science",
            },
            "discovery_focus": "graduate computing fellowships",
        }
    )

    assert len(result["top_free_platforms"]) == 3
    assert all(item["url"].startswith("https://example.org/platform-") for item in result["top_free_platforms"])


def test_discovery_api_contract_accepts_focus_feedback_and_status_metadata():
    request = WikiDiscoverRequest(
        discovery_focus="political science",
        free_text_intent="public-service funding",
        selected_intents=[
            {
                "id": "policy",
                "label": "Policy funding",
                "dimension": "field",
                "value": "political science",
                "derived_from": ["undergrad.major"],
            }
        ],
        excluded_urls=["https://example.org/no"],
        feedback=[{"url": "https://example.org/no", "reason": "Wrong field"}],
    )
    response = WikiDiscoverResponse(result_note="No close scholarship yet.", discovery_focus=request.discovery_focus)

    assert request.excluded_urls == ["https://example.org/no"]
    assert request.selected_intents[0].value == "political science"
    assert request.free_text_intent == "public-service funding"
    assert response.discovery_focus == "political science"
    assert response.page_title == "Scholarship Discovery"


def test_html_preview_preserves_eligibility_text_beyond_page_intro():
    html = (
        "<html><head><title>Example Scholarship</title></head><body>"
        + "Program overview and background. " * 30
        + "Eligibility: This award is open to international women graduate students."
        + "</body></html>"
    )
    snippet = wiki_discovery._snippet_from_html(html)
    assert "Eligibility context" in snippet
    assert "international women graduate students" in snippet
