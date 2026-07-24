export type RevisionCoachEditAction =
  | "replace"
  | "insert_before"
  | "insert_after";

export function normalizeRevisionCoachEditAction(
  action?: string,
): RevisionCoachEditAction {
  return action === "insert_before" || action === "insert_after"
    ? action
    : "replace";
}

export function resolveRevisionCoachTarget(
  draft: string,
  target: { start: number; end: number },
  originalText: string,
): { start: number; end: number } | null {
  if (draft.slice(target.start, target.end) === originalText) return target;
  if (!originalText) return null;

  const matches: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= draft.length - originalText.length) {
    const index = draft.indexOf(originalText, fromIndex);
    if (index < 0) break;
    matches.push(index);
    if (matches.length > 1) return null;
    fromIndex = index + Math.max(1, originalText.length);
  }
  return matches.length === 1
    ? { start: matches[0], end: matches[0] + originalText.length }
    : null;
}

export function buildRevisionCoachEdit(
  draft: string,
  target: { start: number; end: number },
  action: RevisionCoachEditAction,
  replacement: string,
) {
  const passage = replacement.trim();
  const start = action === "insert_before"
    ? target.start
    : action === "insert_after"
      ? target.end
      : target.start;
  const end = action === "replace" ? target.end : start;
  const appliedText = action === "insert_before"
    ? `${passage}\n\n`
    : action === "insert_after"
      ? `\n\n${passage}`
      : passage;

  return {
    start,
    end,
    appliedText,
    originalText: draft.slice(start, end),
    proposedDraft: `${draft.slice(0, start)}${appliedText}${draft.slice(end)}`,
  };
}
