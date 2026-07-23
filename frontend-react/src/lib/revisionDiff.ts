export type RevisionDiffSegment = {
  type: "equal" | "remove" | "add";
  text: string;
};

function tokens(value: string): string[] {
  return value.match(/\s+|[\p{L}\p{N}’'-]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

function append(
  segments: RevisionDiffSegment[],
  type: RevisionDiffSegment["type"],
  text: string,
) {
  if (!text) return;
  const previous = segments[segments.length - 1];
  if (previous?.type === type) {
    previous.text += text;
  } else {
    segments.push({ type, text });
  }
}

/** Small word-level LCS diff for localized Revision Coach suggestions. */
export function revisionDiff(
  original: string,
  suggested: string,
): RevisionDiffSegment[] {
  const before = tokens(original);
  const after = tokens(suggested);
  const lengths = Array.from(
    { length: before.length + 1 },
    () => new Uint16Array(after.length + 1),
  );

  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lengths[left][right] = before[left] === after[right]
        ? lengths[left + 1][right + 1] + 1
        : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
    }
  }

  const segments: RevisionDiffSegment[] = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      append(segments, "equal", before[left]);
      left += 1;
      right += 1;
    } else if (lengths[left + 1][right] >= lengths[left][right + 1]) {
      append(segments, "remove", before[left]);
      left += 1;
    } else {
      append(segments, "add", after[right]);
      right += 1;
    }
  }
  while (left < before.length) {
    append(segments, "remove", before[left]);
    left += 1;
  }
  while (right < after.length) {
    append(segments, "add", after[right]);
    right += 1;
  }
  return segments;
}
