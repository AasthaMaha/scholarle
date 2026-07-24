import { describe, expect, it } from "vitest";

import {
  draftParagraphRanges,
  ignoredSuggestionKey,
  rebaseCachedSuggestions,
  requiresFullDraftFixScan,
  type EssayFixCacheEntry,
} from "./fixCache";
import type { CoachSentenceSuggestion, Suggestion } from "./suggestions";

function rawSuggestion(draft: string, original = "problem"): CoachSentenceSuggestion {
  const start = draft.indexOf(original);
  return {
    original_text: original,
    suggested_text: "problems",
    suggestion_type: "grammar",
    reason: "Nouns must agree in number with their context.",
    severity: "medium",
    source: "contextual_grammar",
    start_offset: start,
    end_offset: start + original.length,
  };
}

function visibleSuggestion(draft: string): Suggestion {
  const start = draft.indexOf("problem");
  return {
    id: `grammar:${start}:problem`,
    category: "correctness",
    start,
    end: start + "problem".length,
    original: "problem",
    replacement: "problems",
    title: "Grammar",
    explanation: "Nouns must agree in number with their context.",
    source: "coach",
    engineSource: "contextual_grammar",
    suggestionType: "grammar",
  };
}

describe("prompt-scoped Fixes cache", () => {
  it("restores a cached contextual suggestion after navigation remounts the workspace", () => {
    const draft = "I use my knowledge to find solutions to problem.";
    const entry: EssayFixCacheEntry = {
      draft,
      suggestions: [rawSuggestion(draft)],
      checkedAt: Date.now(),
    };

    const serialized = JSON.parse(JSON.stringify(entry)) as EssayFixCacheEntry;
    expect(rebaseCachedSuggestions(serialized.draft, draft, serialized.suggestions)).toEqual(entry.suggestions);
  });

  it("keeps and shifts a cached suggestion after an unrelated earlier edit", () => {
    const draft = "Opening paragraph.\n\nI use my knowledge to find solutions to problem.";
    const nextDraft = `New context. ${draft}`;
    const [restored] = rebaseCachedSuggestions(draft, nextDraft, [rawSuggestion(draft)]);

    expect(restored.original_text).toBe("problem");
    expect(nextDraft.slice(restored.start_offset!, restored.end_offset!)).toBe("problem");
  });

  it("drops a cached suggestion when the student edits the underlined text", () => {
    const draft = "I use my knowledge to find solutions to problem.";
    const nextDraft = draft.replace("problem", "problems");
    expect(rebaseCachedSuggestions(draft, nextDraft, [rawSuggestion(draft)])).toEqual([]);
  });

  it("keeps an ignored finding ignored across unrelated edits but not sentence changes", () => {
    const draft = "I use my knowledge to find solutions to problem. A separate ending follows.";
    const ignored = ignoredSuggestionKey(visibleSuggestion(draft), draft);
    const unrelatedEdit = `${draft} Another unrelated sentence.`;
    const changedSentence = draft.replace("solutions to problem", "one difficult problem");

    expect(ignoredSuggestionKey(visibleSuggestion(unrelatedEdit), unrelatedEdit)).toBe(ignored);
    expect(ignoredSuggestionKey(visibleSuggestion(changedSentence), changedSentence)).not.toBe(ignored);
  });
});

describe("Fixes scan scope", () => {
  it("uses a full scan when a similarly sized document is replaced", () => {
    const previous = "First old paragraph.\n\nSecond old paragraph with supporting detail.";
    const current = "A newly imported intro.\n\nA different body paragraph with new evidence.";

    expect(Math.abs(previous.length - current.length)).toBeLessThan(20);
    expect(requiresFullDraftFixScan(previous, current)).toBe(true);
  });

  it("uses a full scan for a multi-paragraph paste", () => {
    const previous = "Opening paragraph.\n\nClosing paragraph.";
    const current = "Opening paragraph.\n\nInserted one.\n\nInserted two.\n\nClosing paragraph.";

    expect(requiresFullDraftFixScan(previous, current)).toBe(true);
  });

  it("keeps a one-character typing edit paragraph-scoped", () => {
    const previous = "Opening paragraph.\n\nA sentence with an eror.";
    const current = "Opening paragraph.\n\nA sentence with an error.";

    expect(requiresFullDraftFixScan(previous, current)).toBe(false);
  });

  it("returns exact prose paragraph ranges and skips title/name blocks", () => {
    const draft = [
      "Scholarship Essay",
      "Brianna Gilbert",
      "I began using my knowledge to find solutions to problem.",
      "This scholarship would support my education and strengthen my service.",
    ].join("\n\n");

    const paragraphs = draftParagraphRanges(draft).map(({ start, end }) => draft.slice(start, end));

    expect(paragraphs).toEqual([
      "I began using my knowledge to find solutions to problem.",
      "This scholarship would support my education and strengthen my service.",
    ]);
  });
});
