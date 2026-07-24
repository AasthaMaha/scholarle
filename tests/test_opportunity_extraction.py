import unittest

from nodes.opportunity_extraction import (
    clean_scholarship_output,
    extract_prompt_word_limits,
    normalize_essay_prompt_entries,
)


class OpportunityExtractionFinalizerTests(unittest.TestCase):
    def test_word_limit_phrases_map_only_explicit_bounds(self):
        self.assertEqual(extract_prompt_word_limits("Respond in 350 words or less."), (None, 350))
        self.assertEqual(extract_prompt_word_limits("Respond in 500 words or less."), (None, 500))
        self.assertEqual(extract_prompt_word_limits("Write between 250 and 500 words."), (250, 500))
        self.assertEqual(extract_prompt_word_limits("Your response must be at least 500 words."), (500, None))
        self.assertEqual(extract_prompt_word_limits("Write exactly 500 words."), (500, 500))
        self.assertEqual(extract_prompt_word_limits("Describe your goals."), (None, None))

    def test_words_or_less_corrects_conflicting_model_bounds(self):
        entry = normalize_essay_prompt_entries(
            [{"promptText": "Respond in 500 words or less.", "minimumWords": 500, "maximumWords": 500}]
        )[0]

        self.assertIsNone(entry["minimumWords"])
        self.assertFalse(entry["minimumWordsReviewed"])
        self.assertEqual(entry["maximumWords"], 500)
        self.assertTrue(entry["maximumWordsReviewed"])

    def test_confirmed_na_is_distinct_from_unresolved_null(self):
        unresolved = normalize_essay_prompt_entries([{"promptText": "Describe your goals."}])[0]
        confirmed = normalize_essay_prompt_entries(
            [{
                "promptText": "Describe your goals.",
                "minimumWords": None,
                "maximumWords": None,
                "minimumWordsReviewed": True,
                "maximumWordsReviewed": True,
            }]
        )[0]

        self.assertFalse(unresolved["minimumWordsReviewed"])
        self.assertFalse(unresolved["maximumWordsReviewed"])
        self.assertTrue(confirmed["minimumWordsReviewed"])
        self.assertTrue(confirmed["maximumWordsReviewed"])

    def test_structured_prompts_keep_independent_word_limits(self):
        entries = normalize_essay_prompt_entries(
            [
                {"promptText": "Describe your ideal job in 350 words or less."},
                {"promptText": "Describe an aerospace project.", "maximumWords": 350},
                {"promptText": "Explain how this award helps your career.", "minimumWords": 250, "maximumWords": 500},
            ]
        )

        self.assertEqual(len(entries), 3)
        self.assertEqual(entries[0]["maximumWords"], 350)
        self.assertIsNone(entries[0]["minimumWords"])
        self.assertEqual(entries[1]["maximumWords"], 350)
        self.assertEqual(entries[2]["minimumWords"], 250)
        self.assertEqual(entries[2]["maximumWords"], 500)
        self.assertNotEqual(entries[0]["promptText"], entries[1]["promptText"])

    def test_legacy_prompt_string_migrates_without_concatenating_prompts(self):
        entries = normalize_essay_prompt_entries(
            legacy_prompt=(
                "Prompt 1: Describe your ideal job. Maximum 350 words.\n\n"
                "Prompt 2: Explain how this scholarship will help. At least 500 words."
            )
        )

        self.assertEqual(len(entries), 2)
        self.assertTrue(entries[0]["promptText"].startswith("Describe your ideal job"))
        self.assertTrue(entries[1]["promptText"].startswith("Explain how this scholarship"))
        self.assertEqual(entries[0]["maximumWords"], 350)
        self.assertEqual(entries[1]["minimumWords"], 500)

    def test_finalizer_preserves_structured_and_legacy_prompt_shapes(self):
        state = {
            "name": "Three Essay Scholarship",
            "essayPrompts": "",
            "essayPromptEntries": [
                {"id": "one", "promptNumber": 1, "promptText": "First prompt", "maximumWords": 350},
                {"id": "two", "promptNumber": 2, "promptText": "Second prompt", "maximumWords": 500},
            ],
            "fullText": "",
            "sourceUrls": [],
            "sourceMetadata": [],
        }

        result = clean_scholarship_output(state)

        self.assertEqual(len(result["essayPromptEntries"]), 2)
        self.assertIn("Prompt 1: First prompt", result["essayPrompts"])
        self.assertIn("Prompt 2: Second prompt", result["essayPrompts"])

    def test_finalizer_removes_stale_prompt_selection_and_honors_no_essay(self):
        result = clean_scholarship_output(
            {
                "essayPromptEntries": [
                    {"id": "one", "promptText": "First prompt", "minimumWords": 100, "maximumWords": 300},
                ],
                "selectedEssayPromptIds": ["one", "deleted"],
                "noEssayPromptSelected": True,
                "noEssayPromptConflictConfirmed": True,
            }
        )

        self.assertEqual(result["selectedEssayPromptIds"], [])
        self.assertTrue(result["noEssayPromptSelected"])
        self.assertTrue(result["noEssayPromptConflictConfirmed"])

    def test_finalizer_keeps_only_one_selected_essay_prompt(self):
        result = clean_scholarship_output(
            {
                "essayPromptEntries": [
                    {"id": "one", "promptText": "First prompt", "minimumWords": 100, "maximumWords": 300},
                    {"id": "two", "promptText": "Second prompt", "minimumWords": 200, "maximumWords": 400},
                ],
                "selectedEssayPromptIds": ["two", "one"],
                "noEssayPromptSelected": False,
            }
        )

        self.assertEqual(result["selectedEssayPromptIds"], ["two"])

    def test_finalizer_scores_critical_fields_and_keeps_valid_evidence(self):
        url = "https://official.edu/political-award"
        source_text = (
            f"SOURCE URL: {url}\n"
            "SOURCE AUTHORITY: primary\n"
            "SOURCE TITLE: Political Science Public Service Scholarship\n"
            "The Political Science Public Service Scholarship is sponsored by Example University. "
            "The award is $10,000. Applications close November 15, 2026. Applicants must be graduate "
            "students studying political science and must submit a transcript and two recommendations."
        )
        state = {
            "name": "Political Science Public Service Scholarship",
            "organization": "Example University",
            "type": "Scholarship",
            "officialWebsite": url,
            "url": url,
            "awardAmount": "$10,000",
            "applicationDeadline": "November 15, 2026",
            "currentStatus": "Upcoming",
            "enrollmentLevel": "Graduate students",
            "eligibleMajors": "Political science",
            "requiredApplicationMaterials": ["Transcript", "Two recommendations"],
            "requiredDocumentTypes": ["Transcript", "Recommendations"],
            "eligibilityRequirements": ["Applicants must be graduate students studying political science."],
            "applicationProcess": ["Submit the application with required materials."],
            "fullText": source_text,
            "source_text": source_text,
            "sourceUrls": [url],
            "sourceMetadata": [{"url": url, "authority": "primary", "fetched": True}],
            "fieldEvidence": [
                {
                    "field": "applicationDeadline",
                    "value": "November 15, 2026",
                    "source_url": url,
                    "evidence": "Applications close November 15, 2026.",
                    "confidence": 0.98,
                }
            ],
            "extractionWarnings": [],
            "resolutionStatus": "resolved_from_pasted_url",
        }

        result = clean_scholarship_output(state)

        self.assertGreaterEqual(result["completenessScore"], 60)
        self.assertIn("Application deadline", result["criticalFieldsFound"])
        evidence = next(item for item in result["fieldEvidence"] if item["field"] == "applicationDeadline")
        self.assertEqual(evidence["authority"], "primary")
        self.assertEqual(evidence["sourceUrl"], url)
        self.assertNotIn("Application deadline", result["criticalFieldsMissing"])

    def test_unverified_or_tentative_values_are_removed(self):
        state = {
            "name": "Example Scholarship",
            "applicationDeadline": "Verify current deadline window",
            "eligibleMajors": "Confirm discipline",
            "requiredApplicationMaterials": ["Verify current materials"],
            "fullText": "USER-PROVIDED NOTES (clues only; not authoritative): verify current terms",
            "sourceUrls": [],
            "sourceMetadata": [],
            "fieldEvidence": [],
            "resolutionStatus": "unresolved",
        }

        result = clean_scholarship_output(state)

        self.assertEqual(result["applicationDeadline"], "")
        self.assertEqual(result["eligibleMajors"], "")
        self.assertEqual(result["requiredApplicationMaterials"], [])
        self.assertIn("Application deadline", result["criticalFieldsMissing"])
        self.assertTrue(any("No readable web source" in warning for warning in result["validationWarnings"]))


if __name__ == "__main__":
    unittest.main()
