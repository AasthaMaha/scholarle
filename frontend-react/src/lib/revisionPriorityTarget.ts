import type {
  EssayReviewResult,
  EssayRevisionPriority,
} from "@/lib/userStore";

export type EssayTextRange = { start: number; end: number };

export function containingSentenceRange(
  draft: string,
  range: EssayTextRange,
): EssayTextRange {
  let start = Math.max(0, Math.min(range.start, draft.length));
  let end = Math.max(start, Math.min(range.end, draft.length));

  while (start > 0 && !/[.!?\n]/.test(draft[start - 1])) start -= 1;
  while (start < end && /\s/.test(draft[start])) start += 1;

  if (end === 0 || !/[.!?]/.test(draft[end - 1])) {
    while (end < draft.length && !/[.!?\n]/.test(draft[end])) end += 1;
    if (end < draft.length && /[.!?]/.test(draft[end])) end += 1;
  }
  while (end > start && /\s/.test(draft[end - 1])) end -= 1;

  return { start, end };
}

function paragraphNumberFromReference(value?: string): number | null {
  if (!value) return null;
  const passageMatch = value.match(/\bp(\d+)(?:\.s\d+)?\b/i);
  const paragraphMatch = value.match(/\bparagraph\s+(\d+)\b/i);
  const number = Number(passageMatch?.[1] ?? paragraphMatch?.[1]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function essayParagraphRanges(draft: string): EssayTextRange[] {
  const ranges: EssayTextRange[] = [];
  const separator = /\n\s*\n/g;
  let blockStart = 0;

  function addRange(rawStart: number, rawEnd: number) {
    const raw = draft.slice(rawStart, rawEnd);
    const leadingWhitespace = raw.search(/\S/);
    if (leadingWhitespace < 0) return;
    const trailingWhitespace = raw.length - raw.trimEnd().length;
    ranges.push({
      start: rawStart + leadingWhitespace,
      end: rawEnd - trailingWhitespace,
    });
  }

  for (const match of draft.matchAll(separator)) {
    const matchStart = match.index ?? blockStart;
    addRange(blockStart, matchStart);
    blockStart = matchStart + match[0].length;
  }
  addRange(blockStart, draft.length);
  return ranges;
}

function quoteRangeInDraft(draft: string, quote?: string): EssayTextRange | null {
  const target = quote?.trim();
  if (!target) return null;
  const exactStart = draft.indexOf(target);
  if (exactStart >= 0) return { start: exactStart, end: exactStart + target.length };

  const tokens = target.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const flexiblePattern = tokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const match = new RegExp(flexiblePattern, "i").exec(draft);
  return match?.index == null
    ? null
    : { start: match.index, end: match.index + match[0].length };
}

export function revisionPriorityRange(
  priority: EssayRevisionPriority,
  review: EssayReviewResult,
  draft: string,
): EssayTextRange | null {
  const locationParagraph = paragraphNumberFromReference(priority.location);
  const criterionKeys = Array.from(new Set([
    ...(priority.source_gap_criteria ?? []),
    priority.primary_criterion,
  ].filter(Boolean)));
  const evidence = criterionKeys.flatMap((key) => (
    review.criteria?.[key as keyof typeof review.criteria]?.criterion_specific_gap?.evidence ?? []
  ));
  const orderedEvidence = [...evidence].sort((left, right) => {
    if (!locationParagraph) return 0;
    const leftMatches = paragraphNumberFromReference(left.paragraph_id) === locationParagraph;
    const rightMatches = paragraphNumberFromReference(right.paragraph_id) === locationParagraph;
    return Number(rightMatches) - Number(leftMatches);
  });

  for (const item of orderedEvidence) {
    const range = quoteRangeInDraft(draft, item.quote);
    if (range) return range;
  }

  if (!locationParagraph) return null;
  return essayParagraphRanges(draft)[locationParagraph - 1] ?? null;
}
