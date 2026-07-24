import { describe, expect, it } from "vitest";

import type { ActiveScholarship } from "@/lib/userStore";
import { normalizeSelectedEssayPromptEntries } from "./scholarE";

const scholarshipWithPrompts = {
  essayPromptEntries: [
    {
      id: "prompt-1",
      promptNumber: 1,
      promptText: "Describe your community impact.",
      minimumWords: null,
      maximumWords: 500,
      minimumWordsReviewed: true,
      maximumWordsReviewed: true,
    },
    {
      id: "prompt-2",
      promptNumber: 2,
      promptText: "Explain your academic goals.",
      minimumWords: null,
      maximumWords: 300,
      minimumWordsReviewed: true,
      maximumWordsReviewed: true,
    },
  ],
} satisfies ActiveScholarship;

describe("essay prompt selection", () => {
  it("uses only one prompt when older saved data contains multiple selections", () => {
    const selected = normalizeSelectedEssayPromptEntries({
      ...scholarshipWithPrompts,
      selectedEssayPromptIds: ["prompt-1", "prompt-2"],
    });

    expect(selected.map((prompt) => prompt.id)).toEqual(["prompt-1"]);
  });

  it("uses no prompt when the student explicitly chooses no essay prompt", () => {
    const selected = normalizeSelectedEssayPromptEntries({
      ...scholarshipWithPrompts,
      selectedEssayPromptIds: ["prompt-1"],
      noEssayPromptSelected: true,
    });

    expect(selected).toEqual([]);
  });
});
