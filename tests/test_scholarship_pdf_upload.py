import asyncio
import io
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from api.routes import extract_scholarship_pdf_text, validate_scholarship_pdf_upload
from config import settings


class ScholarshipPdfUploadTests(unittest.TestCase):
    def setUp(self):
        self.original_limit = settings.scholarship_pdf_max_bytes
        settings.scholarship_pdf_max_bytes = 1024

    def tearDown(self):
        settings.scholarship_pdf_max_bytes = self.original_limit

    def test_validates_extension_mime_signature_and_sanitizes_name(self):
        safe_name = validate_scholarship_pdf_upload(
            filename="../My Scholarship <>.pdf",
            content_type="application/pdf",
            file_bytes=b"%PDF-valid",
        )
        self.assertEqual(safe_name, "My Scholarship _.pdf")

    def test_rejects_non_pdf_extension_or_mime(self):
        for filename, content_type in [
            ("scholarship.txt", "application/pdf"),
            ("scholarship.pdf", "text/plain"),
        ]:
            with self.subTest(filename=filename, content_type=content_type):
                with self.assertRaises(HTTPException) as context:
                    validate_scholarship_pdf_upload(
                        filename=filename,
                        content_type=content_type,
                        file_bytes=b"%PDF-valid",
                    )
                self.assertEqual(context.exception.detail, "Upload a PDF file.")

    def test_rejects_spoofed_pdf_content(self):
        with self.assertRaises(HTTPException) as context:
            validate_scholarship_pdf_upload(
                filename="scholarship.pdf",
                content_type="application/pdf",
                file_bytes=b"not a pdf",
            )
        self.assertEqual(context.exception.detail, "Upload a PDF file.")

    def test_oversized_error_uses_configured_limit(self):
        settings.scholarship_pdf_max_bytes = 1024 * 1024
        with self.assertRaises(HTTPException) as context:
            validate_scholarship_pdf_upload(
                filename="scholarship.pdf",
                content_type="application/pdf",
                file_bytes=b"%PDF-" + (b"x" * (1024 * 1024)),
            )
        self.assertEqual(context.exception.status_code, 413)
        self.assertIn("1 MB", context.exception.detail)

    def test_extracts_readable_text_without_retaining_the_file(self):
        upload = UploadFile(
            filename="Scholarship.pdf",
            file=io.BytesIO(b"%PDF-valid"),
            headers=Headers({"content-type": "application/pdf"}),
        )
        with patch("api.routes.extract_text_from_pdf", return_value="A" * 100):
            result = asyncio.run(extract_scholarship_pdf_text(upload))

        self.assertEqual(result["filename"], "Scholarship.pdf")
        self.assertEqual(result["size_bytes"], len(b"%PDF-valid"))
        self.assertEqual(result["text"], "A" * 100)
        self.assertTrue(upload.file.closed)

    def test_unreadable_pdf_returns_actionable_fallback(self):
        upload = UploadFile(
            filename="Scanned.pdf",
            file=io.BytesIO(b"%PDF-valid"),
            headers=Headers({"content-type": "application/pdf"}),
        )
        with patch("api.routes.extract_text_from_pdf", return_value=""):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(extract_scholarship_pdf_text(upload))

        self.assertEqual(context.exception.status_code, 422)
        self.assertIn("couldn’t read enough text", context.exception.detail)

    def test_parser_failure_returns_safe_upload_error(self):
        upload = UploadFile(
            filename="Broken.pdf",
            file=io.BytesIO(b"%PDF-valid"),
            headers=Headers({"content-type": "application/pdf"}),
        )
        with patch(
            "api.routes.extract_text_from_pdf",
            side_effect=HTTPException(status_code=422, detail="internal parser detail"),
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(extract_scholarship_pdf_text(upload))

        self.assertEqual(context.exception.detail, "We couldn’t upload this PDF. Try again.")


if __name__ == "__main__":
    unittest.main()
