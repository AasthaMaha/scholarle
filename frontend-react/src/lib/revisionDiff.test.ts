import { describe, expect, it } from "vitest";
import { revisionDiff } from "./revisionDiff";

describe("revisionDiff", () => {
  it("marks removed and added wording while preserving shared text", () => {
    const result = revisionDiff(
      "I helped students.",
      "I supported 15 students.",
    );

    expect(result.some((segment) => (
      segment.type === "remove" && segment.text.includes("helped")
    ))).toBe(true);
    expect(result.some((segment) => (
      segment.type === "add" && segment.text.includes("supported")
    ))).toBe(true);
    expect(result.some((segment) => (
      segment.type === "equal" && segment.text.includes("students")
    ))).toBe(true);
  });

  it("preserves the exact suggested text across equal and added segments", () => {
    const suggested = "When I listened, the group felt heard.";
    const result = revisionDiff("The group felt heard.", suggested);

    expect(
      result
        .filter((segment) => segment.type !== "remove")
        .map((segment) => segment.text)
        .join(""),
    ).toBe(suggested);
  });
});
