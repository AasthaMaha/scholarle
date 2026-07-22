import { describe, expect, it } from "vitest";

import { analyzeText, applySuggestion } from "./suggestions";

describe("immediate mechanics suggestions", () => {
  it.each([
    ["I had already experienced.. Advanced courses followed.", "I had already experienced. Advanced courses followed."],
    ["This matters!!", "This matters!"],
    ["Why??", "Why?"],
    ["First,, second", "First, second"],
    ["First;; second", "First; second"],
    ["Label:: value", "Label: value"],
    ["Really.?", "Really?"],
    ["Stop!.", "Stop!"],
  ])("normalizes an unquestionably accidental punctuation sequence in %s", (draft, corrected) => {
    const [suggestion] = analyzeText(draft).filter((item) => item.title === "Punctuation");

    expect(suggestion).toBeDefined();
    expect(applySuggestion(draft, suggestion)).toBe(corrected);
  });

  it.each([
    "I paused... then continued.",
    "Really?!",
    "Really!?",
    "The well-known result -- while surprising -- was valid.",
  ])("preserves intentional punctuation in %s", (draft) => {
    expect(analyzeText(draft).filter((item) => item.title === "Punctuation")).toEqual([]);
  });
});
