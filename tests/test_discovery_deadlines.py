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


def test_candidate_pool_excludes_library_specifics_and_non_open_live_results(monkeypatch):
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
    assert unknown_award["url"] not in urls


def test_deterministic_verifier_rejects_unverified_specific_opportunity():
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
    assert result["ranked_sources"] == []
    assert result["verification_report"]["rejected"][0]["reason"] == "deadline_unknown"


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
