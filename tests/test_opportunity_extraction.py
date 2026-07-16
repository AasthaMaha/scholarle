import unittest

from nodes.opportunity_extraction import clean_scholarship_output


class OpportunityExtractionFinalizerTests(unittest.TestCase):
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
