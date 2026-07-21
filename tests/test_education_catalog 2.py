import tempfile
import unittest
from pathlib import Path

from education_catalog.repository import DEFAULT_SOURCE_DIR, EducationCatalogRepository


class EducationCatalogRepositoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary_directory = tempfile.TemporaryDirectory()
        cls.catalog = EducationCatalogRepository(
            database_path=Path(cls.temporary_directory.name) / "education.sqlite3",
            source_dir=DEFAULT_SOURCE_DIR,
        )

    @classmethod
    def tearDownClass(cls):
        cls.temporary_directory.cleanup()

    def test_school_search_keeps_education_types_separate(self):
        high_schools = self.catalog.search_institutions("Lincoln High", "high_school", 10)
        colleges = self.catalog.search_institutions("Harvard", "postsecondary", 10)

        self.assertTrue(high_schools)
        self.assertTrue(all(item["institutionType"] == "high_school" for item in high_schools))
        self.assertTrue(all(item["id"] and item["location"] for item in high_schools))
        self.assertEqual(colleges[0]["name"], "Harvard University")
        self.assertEqual(colleges[0]["institutionType"], "postsecondary")

    def test_major_search_returns_cip_code_and_readable_name(self):
        majors = self.catalog.search_majors("Computer Science", 10)

        self.assertTrue(majors)
        self.assertEqual(majors[0], {"cipCode": "11.0701", "name": "Computer Science"})
        self.assertLessEqual(len(majors), 10)


if __name__ == "__main__":
    unittest.main()
