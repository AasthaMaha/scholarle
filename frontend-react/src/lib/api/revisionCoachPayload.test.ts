import { describe, expect, it } from "vitest";
import type { EssayRevisionPriority, UserProfile } from "@/lib/userStore";
import {
  buildRevisionCoachPayload,
  revisionCoachResultIssue,
  REVISION_COACH_VERSION,
} from "./scholarE";

const priority: EssayRevisionPriority = {
  id: "priority-1",
  title: "Ground the claim",
  primary_criterion: "evidence_strength",
};

describe("buildRevisionCoachPayload", () => {
  it("sends the complete profile evidence while excluding essay and workflow state", () => {
    const user = {
      name: "Student",
      careerGoal: "Teacher",
      optional: {
        communityService: "Tutored 15 students every Saturday.",
        financial: { pellEligible: true },
      },
      essayDraft: "This should not enter the profile evidence inventory.",
      essayReviewResult: { status: "success" },
      activeScholarship: {
        name: "Community Scholarship",
        essayPrompts: "Describe your community impact.",
      },
    } as unknown as UserProfile;

    const payload = buildRevisionCoachPayload(
      user,
      priority,
      "I helped students.",
      { start: 2, end: 8 },
      "draft-hash",
      "Describe your community impact.",
      500,
    );

    expect(payload.student_profile).toMatchObject({
      name: "Student",
      careerGoal: "Teacher",
      optional: {
        communityService: "Tutored 15 students every Saturday.",
        financial: { pellEligible: true },
      },
    });
    expect(payload.student_profile).not.toHaveProperty("essayDraft");
    expect(payload.student_profile).not.toHaveProperty("essayReviewResult");
    expect(payload.student_profile).not.toHaveProperty("activeScholarship");
    expect(payload).not.toHaveProperty("student_answer");
    expect(payload.current_word_count).toBe(3);
    expect(payload.word_limit).toBe(500);
  });
});

describe("revisionCoachResultIssue", () => {
  const completeResult = {
    status: "success" as const,
    version: REVISION_COACH_VERSION,
    can_apply: true,
    suggested_text: "This scholarship will let me expand the tutoring work I began in my community.",
    target: { start: 0, end: 18 },
  };

  it("accepts complete essay-ready edits", () => {
    expect(revisionCoachResultIssue(completeResult)).toBeNull();
  });

  it("rejects legacy scaffold results", () => {
    expect(revisionCoachResultIssue({
      ...completeResult,
      version: "revision-coach-v1.2-substantive",
      suggested_text: "[Add a focused passage here.]",
    })).toContain("out of date");
  });

  it("rejects instructions even when the response claims to be current", () => {
    expect(revisionCoachResultIssue({
      ...completeResult,
      suggested_text: "Add a sentence explaining how the scholarship supports your goals.",
    })).toContain("prepared again");
  });

  it("accepts actionable advice when a complete edit needs a missing personal detail", () => {
    expect(revisionCoachResultIssue({
      status: "success",
      version: REVISION_COACH_VERSION,
      assistance_type: "advice",
      can_apply: false,
      advice: "Add one verified outcome after the highlighted passage.",
      target: { start: 0, end: 18 },
    })).toBeNull();
  });
});
