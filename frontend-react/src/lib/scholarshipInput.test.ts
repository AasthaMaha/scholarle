import { describe, expect, it } from "vitest";

import {
  formatUploadSize,
  isMeaningfulScholarshipText,
  isValidScholarshipUrl,
  scholarshipSourceIsReady,
} from "./scholarshipInput";

describe("scholarship input validation", () => {
  it("accepts HTTP scholarship URLs and rejects invalid or unsafe schemes", () => {
    expect(isValidScholarshipUrl("https://example.org/scholarship")).toBe(true);
    expect(isValidScholarshipUrl("http://example.org/award")).toBe(true);
    expect(isValidScholarshipUrl("example.org/scholarship")).toBe(false);
    expect(isValidScholarshipUrl("javascript:alert(1)")).toBe(false);
  });

  it("requires meaningful copied scholarship text", () => {
    expect(isMeaningfulScholarshipText("short note")).toBe(false);
    expect(isMeaningfulScholarshipText("Applicants must be enrolled full time.")).toBe(true);
  });

  it("enables analysis only for the active ready source", () => {
    const options = {
      url: "https://example.org/scholarship",
      pdfReady: true,
      copiedText: "Applicants must submit a complete application.",
    };
    expect(scholarshipSourceIsReady(null, options)).toBe(false);
    expect(scholarshipSourceIsReady("url", options)).toBe(true);
    expect(scholarshipSourceIsReady("pdf", options)).toBe(true);
    expect(scholarshipSourceIsReady("text", options)).toBe(true);
    expect(scholarshipSourceIsReady("url", { ...options, url: "invalid" })).toBe(false);
    expect(scholarshipSourceIsReady("pdf", { ...options, pdfReady: false })).toBe(false);
  });

  it("formats uploaded file sizes compactly", () => {
    expect(formatUploadSize(2048)).toBe("2 KB");
    expect(formatUploadSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
