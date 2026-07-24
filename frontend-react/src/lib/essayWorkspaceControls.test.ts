import { describe, expect, it } from "vitest";

import {
  canRunEssayEvaluation,
  runRevisionCoachingInParallel,
  shouldAutoLoadRevisionCoaching,
} from "./essayWorkspaceControls";

describe("essay workspace controls", () => {
  it("allows a saved user to evaluate an unchanged non-empty essay again", () => {
    expect(canRunEssayEvaluation("Saved essay text", false, false)).toBe(true);
  });

  it("disables evaluation only for an empty draft or active evaluation", () => {
    expect(canRunEssayEvaluation("", false, false)).toBe(false);
    expect(canRunEssayEvaluation("Essay", true, false)).toBe(false);
    expect(canRunEssayEvaluation("Essay", false, true)).toBe(false);
  });

  it("automatically loads coaching for current review priorities", () => {
    expect(shouldAutoLoadRevisionCoaching(true, false, 3)).toBe(true);
    expect(shouldAutoLoadRevisionCoaching(true, true, 3)).toBe(false);
    expect(shouldAutoLoadRevisionCoaching(false, false, 3)).toBe(false);
    expect(shouldAutoLoadRevisionCoaching(true, false, 0)).toBe(false);
  });

  it("starts all revision-priority agents in parallel", async () => {
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const run = runRevisionCoachingInParallel([1, 2, 3], async (priority) => {
      started.push(priority);
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    expect(started).toEqual([1, 2, 3]);
    releases.forEach((release) => release());
    await run;
  });
});
