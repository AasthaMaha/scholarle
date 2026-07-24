import { describe, expect, it } from "vitest";
import type { ActiveScholarship, EssayPromptEntry, UserProfile } from "@/lib/userStore";
import {
  buildOutlinePayload,
  normalizeSelectedEssayPromptEntries,
} from "./scholarE";

const promptEntries: EssayPromptEntry[] = [
  {
    id: "prompt-one",
    promptNumber: 1,
    promptText: "Describe your community impact.",
    minimumWords: null,
    maximumWords: 350,
    minimumWordsReviewed: true,
    maximumWordsReviewed: true,
  },
  {
    id: "prompt-two",
    promptNumber: 2,
    promptText: "Explain your academic goals.",
    minimumWords: null,
    maximumWords: 500,
    minimumWordsReviewed: true,
    maximumWordsReviewed: true,
  },
];

function userWithScholarship(activeScholarship: ActiveScholarship): UserProfile {
  return {
    name: "Student",
    email: "student@example.com",
    careerGoal: "Improve access to education",
    activeScholarship,
  } as unknown as UserProfile;
}

describe("essay prompt workflow", () => {
  it("normalizes legacy multiple selections to one prompt in scholarship order", () => {
    const selected = normalizeSelectedEssayPromptEntries({
      essayPromptEntries: promptEntries,
      selectedEssayPromptIds: ["prompt-two", "prompt-one"],
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("prompt-one");
  });

  it("builds a prompt-driven outline payload from the one selected prompt", () => {
    const payload = buildOutlinePayload(userWithScholarship({
      name: "Community Scholarship",
      essayPromptEntries: promptEntries,
      selectedEssayPromptIds: ["prompt-two"],
      noEssayPromptSelected: false,
    }));

    expect(payload.essay_prompt).toBe("Explain your academic goals.");
    expect(payload.word_limit).toBe("Maximum 500 words");
    expect(payload.clean_scholarship_record.essayPromptEntries).toHaveLength(1);
  });

  it("builds a scholarship-guided outline payload when no formal prompt is selected", () => {
    const payload = buildOutlinePayload(userWithScholarship({
      name: "Community Scholarship",
      description: "Supports students improving their communities.",
      selectionCriteria: ["Service", "Academic promise"],
      requirementsPreview: "Applicants demonstrate sustained community involvement.",
      essayPromptEntries: promptEntries,
      selectedEssayPromptIds: [],
      noEssayPromptSelected: true,
    }));

    expect(payload.essay_prompt).toBe("");
    expect(payload.word_limit).toBe("Maximum 500 words");
    expect(payload.clean_scholarship_record.essayPromptEntries).toEqual([]);
    expect(payload.clean_scholarship_record.description).toContain("improving their communities");
    expect(payload.clean_scholarship_record.selectionCriteria).toEqual(["Service", "Academic promise"]);
  });

  it("uses a published scholarship-wide limit instead of the scholarship-guided default", () => {
    const payload = buildOutlinePayload(userWithScholarship({
      name: "Community Scholarship",
      requirementsPreview: "Submit a personal statement. Maximum 300 words.",
      selectedEssayPromptIds: [],
      noEssayPromptSelected: true,
    }));

    expect(payload.essay_prompt).toBe("");
    expect(payload.word_limit).toBe("Maximum 300 words");
  });
});
