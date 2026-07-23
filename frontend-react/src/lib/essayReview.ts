import type { EssayReviewResult } from "@/lib/userStore";

const REQUIRED_CRITERIA = [
  "alignment",
  "evidence_strength",
  "insight",
  "narrative_structure_flow_coherence",
  "tone_authenticity",
  "clarity_concision",
] as const;

const CRITERION_LABELS: Record<string, string> = {
  alignment: "Alignment",
  evidence_strength: "Evidence Strength",
  insight: "Insight",
  narrative_structure_flow_coherence: "Flow & Coherence",
  tone_authenticity: "Tone & Authenticity",
  clarity_concision: "Clarity & Concision",
};

export type CompleteEssayReview = EssayReviewResult & {
  status: "success" | "scoring_success_coaching_partial";
  overall_score: number;
  quality_review: EssayReviewResult["quality_review"] & { scoring_approved: true };
};

/** Only a fully verified six-criterion result may replace a saved scorecard. */
export function isCompleteEssayReview(
  review: EssayReviewResult | null | undefined,
): review is CompleteEssayReview {
  return !!(
    review
    && review.schema_version === 5
    && (review.status === "success" || review.status === "scoring_success_coaching_partial")
    && (
      review.quality_review?.scoring_approved === true
      || (review.status === "success" && review.quality_review?.approved === true)
    )
    && typeof review.overall_score === "number"
    && REQUIRED_CRITERIA.every((criterion) => {
      const result = review.criteria?.[criterion];
      return result?.available !== false && typeof result?.score === "number";
    })
  );
}

export function incompleteReviewMessage(
  review: EssayReviewResult | null | undefined,
  hasPreviousCompleteReview: boolean,
) {
  const diagnostics = review?.diagnostics;
  const failedCriteria = (diagnostics?.failed_components ?? [])
    .filter((component) => !!CRITERION_LABELS[component])
    .map((component) => CRITERION_LABELS[component]);
  const reason = diagnostics?.failure_stage === "criterion_validation" && failedCriteria.length
    ? `${failedCriteria.join(", ")} could not verify required rubric evidence after retry. No new score was saved.`
    : diagnostics?.failure_stage === "scoring_qa"
      ? "The scoring quality check could not verify the evaluation after retry. No new score was saved."
      : review?.status_message?.trim()
        || "The evaluation could not verify all six criteria.";
  return hasPreviousCompleteReview
    ? `${reason} Your previous complete review remains displayed.`
    : `${reason} Please evaluate again; no score was saved.`;
}
