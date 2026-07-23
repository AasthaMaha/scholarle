import { describe, expect, it } from "vitest";
import type { EssayReviewResult, EssayRevisionPriority } from "@/lib/userStore";
import {
  containingSentenceRange,
  revisionPriorityRange,
} from "./revisionPriorityTarget";

function reviewWithEvidence(paragraphId: string, quote: string): EssayReviewResult {
  return {
    schema_version: 5,
    status: "success",
    manager_plan: {},
    quality_review: {},
    criteria: {
      alignment: {
        criterion: "alignment",
        criterion_specific_gap: {
          evidence: [{ paragraph_id: paragraphId, quote }],
        },
      },
    },
  };
}

const priority: EssayRevisionPriority = {
  id: "priority_1",
  primary_criterion: "alignment",
  source_gap_criteria: ["alignment"],
  location: "paragraph 2",
};

describe("revisionPriorityRange", () => {
  it("targets the exact cited evidence instead of the whole paragraph", () => {
    const draft = "Opening context.\n\nA concrete example belongs here. It changed the outcome.";
    const quote = "It changed the outcome.";

    expect(revisionPriorityRange(priority, reviewWithEvidence("p2.s2", quote), draft)).toEqual({
      start: draft.indexOf(quote),
      end: draft.indexOf(quote) + quote.length,
    });
  });

  it("matches evidence when line wrapping changes its whitespace", () => {
    const draft = "Opening context.\n\nA concrete example\nbelongs here.";
    const quote = "A concrete example belongs here.";
    const range = revisionPriorityRange(priority, reviewWithEvidence("p2.s1", quote), draft);

    expect(range && draft.slice(range.start, range.end)).toBe("A concrete example\nbelongs here.");
  });

  it("falls back to the internal paragraph location when no quote is available", () => {
    const draft = "First paragraph.\n\nSecond paragraph to revise.\n\nThird paragraph.";
    const review = reviewWithEvidence("", "");
    const range = revisionPriorityRange(priority, review, draft);

    expect(range && draft.slice(range.start, range.end)).toBe("Second paragraph to revise.");
  });
});

describe("containingSentenceRange", () => {
  it("expands a cited phrase to its complete sentence for safe replacement", () => {
    const draft = "Opening. I helped students and learned from them. Closing.";
    const phraseStart = draft.indexOf("helped students");
    const range = containingSentenceRange(draft, {
      start: phraseStart,
      end: phraseStart + "helped students".length,
    });

    expect(draft.slice(range.start, range.end)).toBe(
      "I helped students and learned from them.",
    );
  });

  it("leaves an already complete sentence unchanged", () => {
    const draft = "Opening. Complete sentence. Closing.";
    const start = draft.indexOf("Complete sentence.");
    const original = { start, end: start + "Complete sentence.".length };

    expect(containingSentenceRange(draft, original)).toEqual(original);
  });
});
