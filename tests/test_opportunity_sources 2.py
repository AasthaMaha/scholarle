import unittest
from unittest.mock import patch

from utils.opportunity_sources import (
    SourceDocument,
    _FETCH_CACHE,
    _is_safe_ip,
    assert_safe_public_url,
    fetch_source,
    resolve_opportunity_sources,
    select_supporting_links,
)


class OpportunitySourceResolverTests(unittest.TestCase):
    def test_private_and_local_addresses_are_rejected(self):
        self.assertFalse(_is_safe_ip("127.0.0.1"))
        self.assertFalse(_is_safe_ip("10.1.2.3"))
        self.assertFalse(_is_safe_ip("169.254.169.254"))
        self.assertTrue(_is_safe_ip("8.8.8.8"))

        with patch("utils.opportunity_sources.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaisesRegex(ValueError, "private"):
                assert_safe_public_url("https://attacker.example/path")

    def test_supporting_links_stay_on_host_and_prioritize_requirements(self):
        page = SourceDocument(
            url="https://example.org/political-science-award",
            final_url="https://example.org/political-science-award",
            text="A" * 900,
            links=[
                ("https://example.org/privacy", "Privacy"),
                ("https://outside.example/apply", "Apply"),
                ("https://example.org/eligibility", "Eligibility requirements"),
                ("https://example.org/guidelines.pdf", "Program guidelines"),
                ("https://example.org/about", "About us"),
            ],
        )
        links = select_supporting_links(page)
        self.assertEqual(links[0], "https://example.org/eligibility")
        self.assertIn("https://example.org/guidelines.pdf", links)
        self.assertNotIn("https://example.org/privacy", links)
        self.assertNotIn("https://outside.example/apply", links)

    def test_fetch_cache_returns_defensive_copies(self):
        url = "https://official.edu/cached-award"
        document = SourceDocument(url=url, final_url=url, text="Authoritative scholarship text", authority="supporting")
        _FETCH_CACHE.clear()
        with patch("utils.opportunity_sources._fetch_source_uncached", return_value=document) as uncached:
            first = fetch_source(url)
            first.authority = "primary"
            second = fetch_source(url)

        self.assertEqual(uncached.call_count, 1)
        self.assertEqual(second.authority, "supporting")

    def test_sparse_pasted_page_uses_search_and_supporting_pages(self):
        documents = {
            "https://listing.example/political-award": SourceDocument(
                url="https://listing.example/political-award",
                final_url="https://listing.example/political-award",
                title="Political Science Award",
                text="Political Science Award listing.",
            ),
            "https://official.edu/political-award": SourceDocument(
                url="https://official.edu/political-award",
                final_url="https://official.edu/political-award",
                title="Political Science Public Service Scholarship",
                text=("Political Science Public Service Scholarship supports graduate students. " * 30),
                links=[
                    ("https://official.edu/political-award/eligibility", "Eligibility and deadline"),
                ],
            ),
            "https://official.edu/political-award/eligibility": SourceDocument(
                url="https://official.edu/political-award/eligibility",
                final_url="https://official.edu/political-award/eligibility",
                title="Eligibility",
                text=("Applicants must study political science. The deadline is November 15, 2026. " * 20),
            ),
        }

        def fetcher(url):
            return documents[url]

        def searcher(query, limit):
            self.assertIn("Political Science Public Service", query)
            return ["https://official.edu/political-award"][:limit]

        result = resolve_opportunity_sources(
            "Political Science Public Service Scholarship",
            "https://listing.example/political-award",
            "Graduate public policy applicant",
            fetcher=fetcher,
            searcher=searcher,
        )

        self.assertEqual(result.resolution_status, "resolved_with_fallback")
        self.assertEqual(result.primary_url, "https://official.edu/political-award")
        self.assertIn("https://official.edu/political-award/eligibility", result.source_urls)
        self.assertIn("SOURCE AUTHORITY: primary", result.source_text)
        self.assertIn("USER-PROVIDED NOTES (clues only; not authoritative)", result.source_text)
        self.assertTrue(any("too little readable" in warning for warning in result.warnings))

    def test_url_in_name_field_is_fetched_as_the_primary_source(self):
        url = "https://official.edu/scholarship"

        def fetcher(requested_url):
            self.assertEqual(requested_url, url)
            return SourceDocument(
                url=url,
                final_url=url,
                title="Public Leadership Scholarship",
                text=(
                    "Eligibility requirements, application deadline, award amount, required materials, "
                    "and application process are published here. " * 20
                ),
            )

        result = resolve_opportunity_sources(
            url,
            "",
            "",
            fetcher=fetcher,
            searcher=lambda query, limit: [],
        )

        self.assertEqual(result.primary_url, url)
        self.assertEqual(result.resolution_status, "resolved_from_pasted_url")
        self.assertEqual(result.source_urls, [url])


if __name__ == "__main__":
    unittest.main()
