from datetime import date, datetime, timezone

from api.routes import _load_wiki_source_library
from discovery.deadlines import assess_deadline, is_currently_open
from nodes import wiki_discovery


TODAY = date(2026, 7, 15)


def test_platform_library_contains_no_specific_scholarships():
    library = _load_wiki_source_library()
    assert len(library) >= 3
    assert all(item["kind"] == "platform" for item in library)


def test_award_queries_force_current_cycle_and_skip_platform_queries():
    queries = wiki_discovery._current_award_queries(
        [
            "materials science graduate fellowship",
            "scholarship database for engineering students",
        ],
        {"degree_level": "Graduate", "field_of_study": "Materials Science"},
    )
    assert len(queries) == 1
    assert str(datetime.now(timezone.utc).year) in queries[0]
    assert "applications open deadline" in queries[0]
    assert "official" in queries[0]


def test_future_current_cycle_deadline_is_open():
    result = assess_deadline(
        "Applications are open. The application deadline is October 15, 2026.",
        today=TODAY,
    )
    assert result["deadline_status"] == "open"
    assert result["deadline_verified"] is True
    assert result["application_deadline"] == "2026-10-15"


def test_past_deadline_is_closed_even_if_stale_page_says_open():
    result = assess_deadline(
        "Applications are open. The application deadline was March 1, 2026.",
        today=TODAY,
    )
    assert result["deadline_status"] == "closed"
    assert not is_currently_open(result)


def test_future_opening_date_is_upcoming_not_currently_open():
    result = assess_deadline(
        "Applications open August 1, 2026. The deadline is October 15, 2026.",
        today=TODAY,
    )
    assert result["deadline_status"] == "upcoming"
    assert result["application_opens"] == "2026-08-01"
    assert not is_currently_open(result)


def test_explicit_open_language_without_date_is_accepted():
    result = assess_deadline("We are currently accepting applications for this scholarship.", today=TODAY)
    assert result["deadline_status"] == "open"
    assert is_currently_open(result)


def test_yearless_or_generic_cycle_is_not_treated_as_current():
    result = assess_deadline("Annual application cycle. Deadline: October 15.", today=TODAY)
    assert result["deadline_status"] == "unknown"
    assert result["deadline_verified"] is False


def test_unrelated_page_dates_do_not_become_a_deadline():
    result = assess_deadline(
        "The foundation was established on October 15, 2026. Scholarship details will be announced later.",
        today=TODAY,
    )
    assert result["deadline_status"] == "unknown"


def test_search_candidate_uses_direct_official_page_for_deadline(monkeypatch):
    deadline_year = datetime.now(timezone.utc).year + 1
    monkeypatch.setattr(
        wiki_discovery,
        "search_web",
        lambda _query, _limit: [{
            "url": "https://official.example/scholarship",
            "title": "Current Scholarship",
            "snippet": "Scholarship information",
        }],
    )
    monkeypatch.setattr(
        wiki_discovery,
        "_fetch_raw",
        lambda _url, timeout=6: (
            "<html><title>Current Scholarship</title><body>Applications are open. "
            f"The application deadline is November 30, {deadline_year}.</body></html>"
        ),
    )
    candidates = wiki_discovery._search_candidates(["current scholarship"], limit_per_query=1)
    assert len(candidates) == 1
    assert candidates[0]["direct_fetch_ok"] is True
    assert candidates[0]["deadline_status"] == "open"
    assert candidates[0]["application_deadline"] == f"{deadline_year}-11-30"


def _award_hit(name: str, url: str = "https://official.example/apply") -> dict:
    return {"name": name, "url": url, "preview_ok": True}


def test_listicle_and_funding_hub_pages_are_not_specific_opportunities():
    # The two page shapes Step 2 was surfacing instead of real awards.
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("Top 80 Computer Science Scholarships (July 2026)", "https://example.org/top-80-cs")
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("Funding for Graduate Students", "https://example.edu/grad/funding")
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("10 Best Scholarships for Engineers", "https://example.org/10-best")
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("List of Scholarships", "https://example.org/list")
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("How to Find Scholarships", "https://example.org/how-to-find")
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("Financial Aid and Scholarship Options", "https://example.edu/finaid")
    )
    # A department hub that does not lead with a funding word.
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit(
            "Scholarship and Fellowship Opportunities - CS @ FSU",
            "https://www.cs.fsu.edu/financial-aid/scholarship-fellowship-opportunities",
        )
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("Graduate Fellowship Programs", "https://example.edu/grad/fellowships")
    )


def test_news_and_blog_urls_are_not_specific_opportunities():
    # An announcement about an award is not the page a student applies on.
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit(
            "NSF announces 2026 Graduate Research Fellowship Program award offers",
            "https://www.nsf.gov/news/nsf-announces-2026-graduate-research-fellowship-program",
        )
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("Marshall Scholarship", "https://example.org/blog/marshall-scholarship")
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("Marshall Scholarship", "https://example.org/articles/marshall-scholarship")
    )


def test_social_writeups_about_an_award_are_not_specific_opportunities():
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit(
            "Gates Cambridge Scholarship 2026-27 (Full Funding)",
            "https://www.linkedin.com/pulse/gates-cambridge-scholarship-202627-zo0ce",
        )
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit(
            "Gates Cambridge Scholarship 2026-27 - Scholarship GOAT",
            "https://www.facebook.com/scholarshipgoat/posts/gates-cambridge-scholarship",
        )
    )
    assert not wiki_discovery._looks_like_specific_award(
        _award_hit("Rhodes Scholarship explained", "https://medium.com/@someone/rhodes-scholarship")
    )


def test_named_single_awards_remain_specific_opportunities():
    assert wiki_discovery._looks_like_specific_award(_award_hit("Gates Cambridge Scholarship"))
    assert wiki_discovery._looks_like_specific_award(_award_hit("NSF Graduate Research Fellowship Program"))
    assert wiki_discovery._looks_like_specific_award(_award_hit("Amelia Earhart Fellowship — Zonta International"))
    assert wiki_discovery._looks_like_specific_award(
        _award_hit(
            "Study with a scholarship at HPI",
            "https://hpi.de/en/studies/your-studies-at-hpi/study-with-a-scholarship",
        )
    )
    assert wiki_discovery._looks_like_specific_award(
        _award_hit(
            "Call for Applications: 2026 Tech Policy Press Fellowship Program",
            "https://techpolicy.press/call-for-applications-2026-fellowship",
        )
    )


def test_real_award_pages_titling_only_a_section_are_kept():
    # Live titles that a name-only check wrongly rejected: an award's own site
    # often titles the section, leaving the award name to the host path.
    assert wiki_discovery._looks_like_specific_award(
        _award_hit(
            "How to Apply for a Cambridge Scholarship | Gates Cambridge",
            "https://www.gatescambridge.org/apply/how-to-apply",
        )
    )
    assert wiki_discovery._looks_like_specific_award(
        _award_hit(
            "Admission | Knight-Hennessy Scholars at Stanford University",
            "https://knight-hennessy.stanford.edu/admission",
        )
    )
    assert wiki_discovery._looks_like_specific_award(
        _award_hit("Eligibility", "https://example.org/rhodes-scholarship/eligibility")
    )


def test_unpreviewed_hit_is_not_a_specific_opportunity():
    assert not wiki_discovery._looks_like_specific_award(
        {"name": "Some Scholarship", "url": "https://official.example/x", "preview_ok": False}
    )


def test_award_search_drops_listicles_and_hubs_but_keeps_named_awards(monkeypatch):
    monkeypatch.setattr(
        wiki_discovery,
        "_search_candidates",
        lambda _queries: [
            _award_hit("Top 80 Computer Science Scholarships (July 2026)", "https://example.org/top-80"),
            _award_hit("Funding for Graduate Students", "https://example.edu/grad/funding"),
            _award_hit("Gates Cambridge Scholarship", "https://example.org/gates"),
        ],
    )
    kept = wiki_discovery._search_award_candidates(["2026 scholarship applications open"])
    assert [item["name"] for item in kept] == ["Gates Cambridge Scholarship"]


def test_candidate_pool_keeps_fetched_discovery_fallbacks_but_excludes_closed_results(monkeypatch):
    platform = {
        "name": "Trusted Finder",
        "url": "https://example.org/finder",
        "kind": "platform",
        "category": "Scholarship platform",
        "degree_levels": ["Undergraduate"],
        "student_types": ["Domestic", "International"],
        "fields": ["General"],
    }
    stale_library_award = {
        **platform,
        "name": "Old Curated Award",
        "url": "https://example.org/old",
        "kind": "specific_source",
    }
    open_award = {
        **platform,
        "name": "Open Live Award",
        "url": "https://official.example/open",
        "kind": "specific_source",
        "origin": "web_search",
        "direct_fetch_ok": True,
        "deadline_verified": True,
        "deadline_status": "open",
        "application_deadline": "2026-11-30",
        "preview_ok": True,
        "snippet": "Applications are open until November 30, 2026.",
    }
    closed_award = {
        **open_award,
        "name": "Closed Live Award",
        "url": "https://official.example/closed",
        "deadline_status": "closed",
    }
    unknown_award = {
        **open_award,
        "name": "Unknown Live Award",
        "url": "https://official.example/unknown",
        "deadline_status": "unknown",
        "deadline_verified": False,
    }
    monkeypatch.setattr(wiki_discovery, "_library_candidates", lambda _: [platform, stale_library_award])
    monkeypatch.setattr(wiki_discovery, "_search_candidates", lambda _queries: [open_award, closed_award, unknown_award])
    monkeypatch.setattr(wiki_discovery, "_search_platform_candidates", lambda _brief, _focus: [])

    result = wiki_discovery.build_candidate_pool({
        "source_library": [],
        "student_profile": {"educationLevel": "undergrad"},
        "discovery_brief": {"degree_level": "Undergraduate", "field_of_study": "General"},
        "search_queries": ["open scholarships"],
    })

    urls = [item["url"] for item in result["candidate_pool"]]
    assert platform["url"] in urls
    assert open_award["url"] in urls
    assert stale_library_award["url"] not in urls
    assert closed_award["url"] not in urls
    assert unknown_award["url"] in urls


def test_deterministic_verifier_keeps_fetched_unverified_specific_opportunity():
    candidate = {
        "name": "Unknown Award",
        "url": "https://official.example/unknown",
        "kind": "specific_source",
        "origin": "web_search",
        "direct_fetch_ok": True,
        "deadline_verified": False,
        "deadline_status": "unknown",
        "degree_levels": [],
        "student_types": [],
        "fields": ["General"],
    }
    result = wiki_discovery.verify_ranked_sources({"ranked_sources": [candidate], "student_profile": {}})
    assert [item["url"] for item in result["ranked_sources"]] == [candidate["url"]]
    assert result["verification_report"]["rejected"] == []


def test_deterministic_specific_fallback_prefers_open_then_upcoming_then_unknown():
    base = {
        "kind": "specific_source",
        "origin": "web_search",
        "direct_fetch_ok": True,
        "semantic_score": 0.8,
    }
    candidates = [
        {**base, "name": "Unknown Award", "url": "https://example.org/unknown", "deadline_status": "unknown"},
        {**base, "name": "Upcoming Award", "url": "https://example.org/upcoming", "deadline_status": "upcoming"},
        {**base, "name": "Open Award", "url": "https://example.org/open", "deadline_status": "open"},
        {**base, "name": "Closed Award", "url": "https://example.org/closed", "deadline_status": "closed"},
        {**base, "name": "Unfetched Award", "url": "https://example.org/unfetched", "deadline_status": "open", "direct_fetch_ok": False},
    ]

    selected = wiki_discovery._select_discoverable_specifics(candidates)

    assert [item["name"] for item in selected] == ["Open Award", "Upcoming Award", "Unknown Award"]


def test_search_snippet_is_used_when_official_page_fetch_is_blocked():
    candidate = {
        "name": "Provider-grounded Award",
        "url": "https://example.org/provider-grounded",
        "kind": "specific_source",
        "origin": "web_search",
        "direct_fetch_ok": False,
        "preview_ok": True,
        "snippet": "Graduate scholarship for computing students.",
        "deadline_status": "unknown",
    }

    selected = wiki_discovery._select_discoverable_specifics([candidate])
    verified = wiki_discovery.verify_ranked_sources({"ranked_sources": selected, "student_profile": {}})

    assert [item["url"] for item in verified["ranked_sources"]] == [candidate["url"]]


def test_generated_wording_cannot_override_verified_deadline():
    base = [{
        "name": "Verified Award",
        "url": "https://official.example/award",
        "deadline_window": "2026-11-30",
        "deadline_status": "open",
        "deadline_verified": True,
        "status_note": "Official page checked; application deadline 2026-11-30.",
    }]
    wording = [{
        "url": "https://official.example/award",
        "why_recommended": "Relevant to this student.",
        "deadline_window": "Fall cycle; verify dates",
        "deadline_status": "unknown",
        "status_note": "Verify the deadline.",
    }]
    merged = wiki_discovery._overlay_wording(base, wording)
    assert merged[0]["why_recommended"] == "Relevant to this student."
    assert merged[0]["deadline_window"] == "2026-11-30"
    assert merged[0]["deadline_status"] == "open"
    assert merged[0]["status_note"].startswith("Official page checked")
