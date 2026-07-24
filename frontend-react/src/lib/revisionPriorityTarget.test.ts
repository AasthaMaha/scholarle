import { describe, expect, it } from "vitest";
import type { EssayReviewResult, EssayRevisionPriority } from "@/lib/userStore";
import {
  containingParagraphRange,
  containingSentenceRange,
  fallbackRevisionCoachingRange,
  revisionCoachingRange,
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

describe("revisionCoachingRange", () => {
  it("expands evidence-development priorities to the complete paragraph", () => {
    const draft = (
      "Opening context.\n\n"
      + "I helped students. The experience shaped my goals.\n\n"
      + "Closing reflection."
    );
    const phraseStart = draft.indexOf("helped students");
    const citedRange = {
      start: phraseStart,
      end: phraseStart + "helped students".length,
    };
    const range = revisionCoachingRange(
      {
        title: "Add a concrete example",
        action: "Develop this evidence and show the result.",
      },
      draft,
      citedRange,
    );

    expect(draft.slice(range.start, range.end)).toBe(
      "I helped students. The experience shaped my goals.",
    );
  });

  it("can retain sentence scope for a focused non-development priority", () => {
    const draft = "Opening. I led the weekly program. Closing.";
    const phraseStart = draft.indexOf("led the weekly program");
    const range = revisionCoachingRange(
      { title: "Clarify the timeline", action: "State when this occurred." },
      draft,
      {
        start: phraseStart,
        end: phraseStart + "led the weekly program".length,
      },
    );

    expect(draft.slice(range.start, range.end)).toBe(
      "I led the weekly program.",
    );
  });

  it("finds the paragraph containing a cited sentence", () => {
    const draft = "First paragraph.\n\nSecond sentence. More context.";
    const start = draft.indexOf("Second sentence.");
    expect(
      containingParagraphRange(draft, {
        start,
        end: start + "Second sentence.".length,
      }),
    ).toEqual({
      start,
      end: draft.length,
    });
  });

  it("chooses the most relevant paragraph when review citations are unavailable", () => {
    const draft = (
      "I am interested in education.\n\n"
      + "During weekly tutoring, I supported students with difficult math problems and tracked their progress.\n\n"
      + "This scholarship would support my degree."
    );
    const range = fallbackRevisionCoachingRange(
      {
        title: "Develop the tutoring evidence",
        action: "Add a specific tutoring example and result.",
      },
      draft,
    );

    expect(range && draft.slice(range.start, range.end)).toContain(
      "During weekly tutoring",
    );
  });
});
