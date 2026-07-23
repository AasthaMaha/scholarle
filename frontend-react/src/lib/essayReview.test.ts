import { describe, expect, it } from "vitest";

import { incompleteReviewMessage, isCompleteEssayReview } from "@/lib/essayReview";
import type { EssayReviewResult } from "@/lib/userStore";

const criteria = [
  "alignment",
  "evidence_strength",
  "insight",
  "narrative_structure_flow_coherence",
  "tone_authenticity",
  "clarity_concision",
];

function completeReview(): EssayReviewResult {
  return {
    schema_version: 5,
    status: "success",
    overall_score: 73,
    overall_level: "Effective",
    criteria: Object.fromEntries(
      criteria.map((criterion) => [
        criterion,
        {
          criterion,
          available: true,
          score: 73,
          level: "Effective",
        },
      ]),
    ),
    manager_plan: {},
    quality_review: {
      approved: true,
      scoring_approved: true,
      coaching_approved: true,
    },
  };
}

describe("complete essay review validation", () => {
  it("accepts only a verified result with all six criterion scores", () => {
    expect(isCompleteEssayReview(completeReview())).toBe(true);
  });

  it("rejects a partial result even when it contains a numeric overall score", () => {
    const review = completeReview();
    review.status = "partial";
    expect(isCompleteEssayReview(review)).toBe(false);
  });

  it("rejects a result when one criterion score is unavailable", () => {
    const review = completeReview();
    review.criteria.clarity_concision.score = null;
    review.criteria.clarity_concision.available = false;
    expect(isCompleteEssayReview(review)).toBe(false);
  });

  it("accepts verified scores when coaching priorities are unavailable", () => {
    const review = completeReview();
    review.status = "scoring_success_coaching_partial";
    review.quality_review.approved = false;
    review.quality_review.scoring_approved = true;
    review.quality_review.coaching_approved = false;
    review.revision_priorities = [];
    expect(isCompleteEssayReview(review)).toBe(true);
  });

  it("explains that an existing complete review remains visible", () => {
    const message = incompleteReviewMessage(
      {
        ...completeReview(),
        status: "partial",
        status_message: "The new evaluation could not be verified.",
      },
      true,
    );
    expect(message).toContain("previous complete review remains displayed");
  });
});
