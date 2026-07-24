export function canRunEssayEvaluation(
  canonicalDraft: string,
  coachLoading: boolean,
  isEvaluating: boolean,
) {
  return Boolean(canonicalDraft) && !coachLoading && !isEvaluating;
}

export function shouldAutoLoadRevisionCoaching(
  hasReview: boolean,
  reviewInputChanged: boolean,
  priorityCount: number,
) {
  return hasReview && !reviewInputChanged && priorityCount > 0;
}

export function runRevisionCoachingInParallel<T>(
  priorities: readonly T[],
  worker: (priority: T) => Promise<void>,
) {
  return Promise.allSettled(priorities.map((priority) => worker(priority)));
}
