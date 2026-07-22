import type { CoachSentenceSuggestion, Suggestion } from "@/lib/suggestions";

export type FixEngine = "language_tool" | "contextual_grammar";

export type CachedFixEngineResult = {
  suggestions: CoachSentenceSuggestion[];
  checkedAt: number;
  pipelineVersion?: string;
  replacesLanguageTool?: boolean;
};

export type EssayFixParagraphCache = {
  text: string;
  language_tool?: CachedFixEngineResult;
  contextual_grammar?: CachedFixEngineResult;
};

export type EssayFixCacheEntry = {
  draft: string;
  suggestions: CoachSentenceSuggestion[];
  checkedAt: number;
  pipelineVersion?: string;
  paragraphs?: Record<string, EssayFixParagraphCache>;
};

export function draftFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

export function draftEditWindow(previousDraft: string, currentDraft: string) {
  let prefix = 0;
  const sharedLength = Math.min(previousDraft.length, currentDraft.length);
  while (prefix < sharedLength && previousDraft[prefix] === currentDraft[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < previousDraft.length - prefix
    && suffix < currentDraft.length - prefix
    && previousDraft[previousDraft.length - 1 - suffix] === currentDraft[currentDraft.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const previousEnd = previousDraft.length - suffix;
  const currentEnd = currentDraft.length - suffix;
  return { prefix, previousEnd, currentEnd, delta: currentEnd - previousEnd };
}

/**
 * Decide whether an edit is too broad to check as a single paragraph.
 * PDF imports and document replacements can have almost the same character
 * count as the previous draft, so length delta alone is not enough.
 */
export function requiresFullDraftFixScan(previousDraft: string, currentDraft: string): boolean {
  if (!previousDraft) return true;
  if (previousDraft === currentDraft) return false;

  const change = draftEditWindow(previousDraft, currentDraft);
  const removed = previousDraft.slice(change.prefix, change.previousEnd);
  const inserted = currentDraft.slice(change.prefix, change.currentEnd);
  const largestChangedSpan = Math.max(removed.length, inserted.length);
  const referenceLength = Math.max(1, previousDraft.length, currentDraft.length);

  return largestChangedSpan > 300
    || largestChangedSpan / referenceLength > 0.35
    || /\n\s*\n/.test(removed)
    || /\n\s*\n/.test(inserted);
}

/** Return meaningful paragraph spans while preserving exact document offsets. */
export function draftParagraphRanges(draft: string): Array<{ start: number; end: number }> {
  if (!draft.trim()) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  const separator = /\n\s*\n/g;
  let blockStart = 0;

  function addBlock(rawStart: number, rawEnd: number) {
    const raw = draft.slice(rawStart, rawEnd);
    const leading = raw.search(/\S/);
    if (leading < 0) return;
    const trailing = raw.length - raw.trimEnd().length;
    const start = rawStart + leading;
    const end = rawEnd - trailing;
    const words = draft.slice(start, end).match(/[A-Za-z0-9'’]+/g)?.length ?? 0;
    // Skip standalone document titles and author-name lines. LanguageTool still
    // checks the complete draft, while contextual AI focuses on prose blocks.
    if (words >= 4) ranges.push({ start, end });
  }

  for (const match of draft.matchAll(separator)) {
    addBlock(blockStart, match.index ?? blockStart);
    blockStart = (match.index ?? blockStart) + match[0].length;
  }
  addBlock(blockStart, draft.length);

  return ranges.length > 1 ? ranges : [{ start: 0, end: draft.length }];
}

/**
 * Re-anchor cached findings after an edit. Findings outside the edited range
 * survive; findings touched by the edit are discarded. Exact source-text
 * validation prevents a cached underline from ever appearing on the wrong text.
 */
export function rebaseCachedSuggestions(
  previousDraft: string,
  currentDraft: string,
  suggestions: CoachSentenceSuggestion[],
): CoachSentenceSuggestion[] {
  if (!previousDraft || !currentDraft) return [];
  const change = draftEditWindow(previousDraft, currentDraft);

  return suggestions.flatMap((suggestion) => {
    const start = suggestion.start_offset;
    const end = suggestion.end_offset;
    if (typeof start !== "number" || typeof end !== "number" || end <= start) return [];

    let nextStart = start;
    let nextEnd = end;
    if (previousDraft !== currentDraft) {
      if (end < change.prefix) {
        // The finding is entirely before the edited range.
      } else if (start >= change.previousEnd) {
        nextStart += change.delta;
        nextEnd += change.delta;
      } else {
        return [];
      }
    }

    const anchoredText = currentDraft.slice(nextStart, nextEnd);
    if (anchoredText.toLocaleLowerCase() !== suggestion.original_text.toLocaleLowerCase()) return [];
    return [{ ...suggestion, start_offset: nextStart, end_offset: nextEnd }];
  });
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/** A stable, context-aware key used to keep an ignored finding ignored. */
export function ignoredSuggestionKey(suggestion: Suggestion, draft: string): string {
  const before = draft.slice(0, suggestion.start);
  const sentenceStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("\n"),
  ) + 1;
  const after = draft.slice(suggestion.end);
  const nextBoundary = after.search(/[.!?](?=\s|$)|\n/);
  const sentenceEnd = nextBoundary === -1
    ? draft.length
    : suggestion.end + nextBoundary + (after[nextBoundary] === "\n" ? 0 : 1);
  const signature = [
    suggestion.engineSource || suggestion.source || "unknown",
    suggestion.suggestionType || suggestion.title,
    compactWhitespace(suggestion.original),
    compactWhitespace(suggestion.replacement),
    compactWhitespace(draft.slice(sentenceStart, sentenceEnd)),
  ].join("\u241f");
  return draftFingerprint(signature);
}
