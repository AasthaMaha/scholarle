import { describe, expect, it } from "vitest";
import type { EssayRevisionPriority, UserProfile } from "@/lib/userStore";
import { buildRevisionCoachPayload } from "./scholarE";

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
  });
});
