import { describe, expect, it } from "vitest";

import {
  buildRevisionCoachEdit,
  normalizeRevisionCoachEditAction,
  resolveRevisionCoachTarget,
} from "./revisionCoachEdit";

describe("buildRevisionCoachEdit", () => {
  const draft = "Opening paragraph.\n\nAnchor paragraph.\n\nClosing paragraph.";
  const anchorStart = draft.indexOf("Anchor paragraph.");
  const target = {
    start: anchorStart,
    end: anchorStart + "Anchor paragraph.".length,
  };

  it("replaces the selected passage", () => {
    const edit = buildRevisionCoachEdit(
      draft,
      target,
      "replace",
      "Developed anchor paragraph.",
    );

    expect(edit.originalText).toBe("Anchor paragraph.");
    expect(edit.proposedDraft).toContain("Developed anchor paragraph.");
    expect(edit.proposedDraft).not.toContain("Anchor paragraph.\n\nClosing");
  });

  it("inserts a new paragraph before the anchor without deleting it", () => {
    const edit = buildRevisionCoachEdit(
      draft,
      target,
      "insert_before",
      "New evidence paragraph.",
    );

    expect(edit.start).toBe(target.start);
    expect(edit.end).toBe(target.start);
    expect(edit.originalText).toBe("");
    expect(edit.proposedDraft).toContain(
      "New evidence paragraph.\n\nAnchor paragraph.",
    );
  });

  it("inserts a new paragraph after the anchor without deleting it", () => {
    const edit = buildRevisionCoachEdit(
      draft,
      target,
      "insert_after",
      "New reflection paragraph.",
    );

    expect(edit.start).toBe(target.end);
    expect(edit.end).toBe(target.end);
    expect(edit.proposedDraft).toContain(
      "Anchor paragraph.\n\nNew reflection paragraph.",
    );
  });

  it("treats unknown actions as replacement", () => {
    expect(normalizeRevisionCoachEditAction("unknown")).toBe("replace");
  });

  it("rebases a parallel suggestion after an earlier edit shifts its anchor", () => {
    const shiftedDraft = `New introduction.\n\n${draft}`;

    expect(resolveRevisionCoachTarget(
      shiftedDraft,
      target,
      "Anchor paragraph.",
    )).toEqual({
      start: shiftedDraft.indexOf("Anchor paragraph."),
      end: shiftedDraft.indexOf("Anchor paragraph.") + "Anchor paragraph.".length,
    });
  });

  it("refuses to rebase when the anchor is no longer unique", () => {
    const ambiguousDraft = `${draft}\n\nAnchor paragraph.`;

    expect(resolveRevisionCoachTarget(
      ambiguousDraft,
      { start: 0, end: 4 },
      "Anchor paragraph.",
    )).toBeNull();
  });
});
