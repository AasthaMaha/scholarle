// Anchored Essay Workspace Fixes.
//
// A small deterministic browser layer provides immediate, unquestionably local
// mechanics feedback. Debounced backend results add LanguageTool spelling,
// grammar, and punctuation findings followed by a contextual AI pass. Unknown
// words may intentionally have no replacement: the student can ignore them or
// add them to a personal dictionary.

export type SuggestionCategory = "correctness" | "clarity" | "engagement" | "tone";
export type EditRiskTier = "C0" | "C1" | "C2" | "C3";

export type Suggestion = {
  id: string;
  category: SuggestionCategory;
  start: number;
  end: number;
  original: string;
  title: string;
  explanation: string;
  replacement: string;
  severity?: "low" | "medium" | "high";
  source?: "auto" | "coach";
  riskTier?: EditRiskTier;
  suggestionType?: string;
  confidence?: "low" | "medium" | "high" | string;
  engineSource?: string;
  replacementAvailable?: boolean;
};

// Raw sentence suggestion returned by the background Fixes endpoint.
export type CoachSentenceSuggestion = {
  original_text: string;
  suggested_text: string;
  suggestion_type: string;
  reason: string;
  severity: "low" | "medium" | "high" | string;
  risk_tier?: string;
  source?: string;
  confidence?: string;
  replacement_available?: boolean;
  start_offset?: number | null;
  end_offset?: number | null;
};

export const CATEGORY_ORDER: SuggestionCategory[] = ["correctness", "clarity", "engagement", "tone"];

// Distinct Grammarly-style colors. Hexes are used directly (via inline style for
// underlines and Tailwind arbitrary values for borders/dots) so they stay stable
// and distinguishable regardless of the theme accent.
export const CATEGORY_META: Record<
  SuggestionCategory,
  { label: string; color: string; borderClass: string; dotClass: string; textClass: string; tintClass: string }
> = {
  correctness: { label: "Correctness", color: "#dc2626", borderClass: "border-l-[#dc2626]", dotClass: "bg-[#dc2626]", textClass: "text-[#dc2626]", tintClass: "bg-[#dc2626]/10" },
  clarity: { label: "Clarity", color: "#2563eb", borderClass: "border-l-[#2563eb]", dotClass: "bg-[#2563eb]", textClass: "text-[#2563eb]", tintClass: "bg-[#2563eb]/10" },
  engagement: { label: "Engagement", color: "#16a34a", borderClass: "border-l-[#16a34a]", dotClass: "bg-[#16a34a]", textClass: "text-[#16a34a]", tintClass: "bg-[#16a34a]/10" },
  tone: { label: "Tone", color: "#8b5cf6", borderClass: "border-l-[#8b5cf6]", dotClass: "bg-[#8b5cf6]", textClass: "text-[#8b5cf6]", tintClass: "bg-[#8b5cf6]/10" },
};

type Rule = {
  category: SuggestionCategory;
  regex: RegExp;
  title: string;
  explanation: string;
  replace: (m: RegExpMatchArray) => string;
  riskTier?: EditRiskTier;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RULES: Rule[] = [
  // --- Correctness (red) / C0 mechanics ---
  {
    category: "correctness",
    title: "Extra spaces",
    explanation: "Remove the extra whitespace so the spacing is consistent.",
    riskTier: "C0",
    regex: /[^\S\n]{2,}/g,
    replace: () => " ",
  },
  {
    category: "correctness",
    title: "Repeated word",
    explanation: "This word appears twice in a row.",
    riskTier: "C0",
    regex: /\b(\w+)\s+\1\b/gi,
    replace: (m) => m[1],
  },
  {
    category: "correctness",
    title: "Punctuation",
    explanation: "Remove the accidental repeated or conflicting punctuation mark.",
    riskTier: "C0",
    // Consolidate unquestionably accidental punctuation while preserving
    // conventional ellipses, ?!, !?, and intentional double hyphens.
    regex: /(?<!\.)\.{2}(?!\.)|([!?;,:])\1+|\.[!?]|[!?]\./g,
    replace: (m) => {
      const marks = m[0];
      if (marks.includes(".") && /[!?]/.test(marks)) {
        return marks.replaceAll(".", "");
      }
      return marks[0];
    },
  },
  {
    category: "correctness",
    title: "Add a space",
    explanation: "Add a space after the punctuation mark.",
    riskTier: "C0",
    regex: /([,;])(?=[A-Za-z])/g,
    replace: (m) => `${m[1]} `,
  },
  {
    category: "correctness",
    title: "Spacing before punctuation",
    explanation: "Remove the space before the punctuation mark.",
    riskTier: "C0",
    regex: /[^\S\n]+([,.;:!?])/g,
    replace: (m) => m[1],
  },
  {
    category: "correctness",
    title: "Hyphen spacing",
    explanation: "Review whether this compound should use a closed hyphen without surrounding spaces.",
    riskTier: "C0",
    regex: /\b([A-Za-z]+)\s+-\s+([A-Za-z]+)\b/g,
    replace: (m) => `${m[1]}-${m[2]}`,
  },
];

function priority(category: SuggestionCategory): number {
  return CATEGORY_ORDER.indexOf(category);
}

function expandShortLocalEdit(text: string, start: number, end: number, replacement: string) {
  if (end - start > 2) {
    return { start, end, original: text.slice(start, end), replacement };
  }
  let expandedStart = start;
  let expandedEnd = end;
  while (expandedStart > 0 && !/\s/.test(text[expandedStart - 1])) expandedStart -= 1;
  while (expandedEnd < text.length && !/\s/.test(text[expandedEnd])) expandedEnd += 1;
  const leftContext = text.slice(expandedStart, start);
  const rightContext = text.slice(end, expandedEnd);
  return {
    start: expandedStart,
    end: expandedEnd,
    original: text.slice(expandedStart, expandedEnd),
    replacement: leftContext + replacement + rightContext,
  };
}

/** Run every heuristic over the text and return non-overlapping, anchored suggestions. */
export function analyzeText(text: string): Suggestion[] {
  if (!text.trim()) return [];
  const found: Suggestion[] = [];

  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.regex.exec(text)) !== null) {
      const original = m[0];
      if (original.length === 0) {
        rule.regex.lastIndex += 1;
        continue;
      }
      const replacement = rule.replace(m);
      if (replacement === original) continue;
      const edit = expandShortLocalEdit(text, m.index, m.index + original.length, replacement);
      found.push({
        id: `${rule.category}:${edit.start}:${edit.original}`,
        category: rule.category,
        start: edit.start,
        end: edit.end,
        original: edit.original,
        title: rule.title,
        explanation: rule.explanation,
        replacement: edit.replacement,
        source: "auto",
        riskTier: rule.riskTier ?? (rule.category === "correctness" ? "C0" : "C1"),
        suggestionType: rule.title.toLowerCase(),
      });
    }
  }

  // Resolve overlaps: earliest first, then by category priority; keep the first,
  // drop anything that overlaps an already-kept span.
  found.sort((a, b) => a.start - b.start || priority(a.category) - priority(b.category) || b.original.length - a.original.length);
  const result: Suggestion[] = [];
  let lastEnd = -1;
  for (const s of found) {
    if (s.start >= lastEnd) {
      result.push(s);
      lastEnd = s.end;
    }
  }
  return result;
}

/** Apply a suggestion's replacement, tidying the seam if the replacement is empty. */
export function applySuggestion(text: string, s: Suggestion): string {
  const left = text.slice(0, s.start);
  let right = text.slice(s.end);
  const rep = s.replacement;
  if (rep === "" && /\s$/.test(left) && /^\s/.test(right)) {
    right = right.replace(/^\s+/, "");
  }
  const merged = left + rep + right;
  // Capitalize a new sentence start if a leading hedge was removed.
  if (rep === "" && (left === "" || /[.!?]\s$/.test(left))) {
    const idx = left.length;
    return merged.slice(0, idx) + merged.charAt(idx).toUpperCase() + merged.slice(idx + 1);
  }
  return merged;
}

export function countByCategory(suggestions: Suggestion[]): Record<SuggestionCategory, number> {
  const counts: Record<SuggestionCategory, number> = { correctness: 0, clarity: 0, engagement: 0, tone: 0 };
  for (const s of suggestions) counts[s.category] += 1;
  return counts;
}

// Map the backend's richer suggestion_type onto underline categories + risk tiers.
// word_choice is NOT correctness — Accept-all must never bulk-apply diction changes.
const COACH_TYPE_MAP: Record<string, { category: SuggestionCategory; title: string; riskTier: EditRiskTier }> = {
  grammar: { category: "correctness", title: "Grammar", riskTier: "C0" },
  spelling: { category: "correctness", title: "Possible misspelling", riskTier: "C0" },
  spelling_name: { category: "correctness", title: "Possible name or misspelling", riskTier: "C1" },
  spelling_spacing: { category: "correctness", title: "Possible split word", riskTier: "C0" },
  spelling_unknown: { category: "correctness", title: "Possible misspelling", riskTier: "C1" },
  word_choice: { category: "clarity", title: "Word choice", riskTier: "C2" },
  clarity: { category: "clarity", title: "Clarity", riskTier: "C1" },
  flow: { category: "clarity", title: "Flow", riskTier: "C1" },
  transition: { category: "clarity", title: "Transition", riskTier: "C1" },
  concision: { category: "clarity", title: "Concision", riskTier: "C1" },
  specificity: { category: "engagement", title: "Specificity", riskTier: "C3" },
  tone: { category: "tone", title: "Tone", riskTier: "C2" },
  ai_like_language: { category: "tone", title: "AI-like language", riskTier: "C2" },
};

function coachType(type: string): { category: SuggestionCategory; title: string; riskTier: EditRiskTier } {
  return COACH_TYPE_MAP[type] ?? { category: "clarity", title: "Suggestion", riskTier: "C1" };
}

function normalizeRiskTier(value: string | undefined, fallback: EditRiskTier): EditRiskTier {
  if (value === "C0" || value === "C1" || value === "C2" || value === "C3") return value;
  return fallback;
}

function minimizeSuggestionEdit(
  original: string,
  replacement: string,
  absoluteStart: number,
): { start: number; end: number; original: string; replacement: string } {
  let prefix = 0;
  const sharedLength = Math.min(original.length, replacement.length);
  while (prefix < sharedLength && original[prefix] === replacement[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < replacement.length - prefix &&
    original[original.length - 1 - suffix] === replacement[replacement.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  // Pure insertions have no original glyph to underline. Include one adjacent
  // unchanged character so the insertion still has a small, clickable anchor.
  if (prefix === original.length - suffix) {
    if (prefix > 0) prefix -= 1;
    else if (suffix > 0) suffix -= 1;
  }

  let originalStart = prefix;
  let originalEnd = original.length - suffix;
  let replacementStart = prefix;
  let replacementEnd = replacement.length - suffix;

  // A punctuation mark or single changed letter is too small to make a useful
  // inline target. Include its surrounding token as unchanged context; Accept
  // still produces exactly the same corrected sentence.
  if (originalEnd - originalStart <= 2) {
    const initialStart = originalStart;
    const initialEnd = originalEnd;
    while (originalStart > 0 && !/\s/.test(original[originalStart - 1])) originalStart -= 1;
    while (originalEnd < original.length && !/\s/.test(original[originalEnd])) originalEnd += 1;
    replacementStart = Math.max(0, replacementStart - (initialStart - originalStart));
    replacementEnd = Math.min(replacement.length, replacementEnd + (originalEnd - initialEnd));
  }

  return {
    start: absoluteStart + originalStart,
    end: absoluteStart + originalEnd,
    original: original.slice(originalStart, originalEnd),
    replacement: replacement.slice(replacementStart, replacementEnd),
  };
}

/** Broad sentence/paragraph feedback stays in Fixes instead of marking a large block. */
export function isInlineSuggestion(suggestion: Suggestion): boolean {
  const original = suggestion.original.trim();
  if (!original || suggestion.end <= suggestion.start || original.includes("\n\n")) return false;
  const wordCount = original.split(/\s+/).filter(Boolean).length;
  return original.length <= 96 && wordCount <= 14;
}

/**
 * Anchor backend sentence suggestions to the current draft by locating each
 * `original_text` verbatim (LLM char offsets are unreliable). Suggestions whose
 * anchor no longer exists — because the student edited that text — are dropped,
 * so accepted/edited sentences naturally stop showing.
 */
// Locate `original` in `text`, tolerating the drift LLMs introduce (casing and
// collapsed/normalized whitespace). Returns the REAL [start, end] span in the
// draft, skipping ranges already claimed by another suggestion.
function findRealSpan(
  text: string,
  textLower: string,
  original: string,
  used: Array<[number, number]>,
): [number, number] | null {
  const overlaps = (a: number, b: number) => used.some(([x, y]) => a < y && b > x);

  // 1. Exact match.
  for (let from = 0; (from = text.indexOf(original, from)) !== -1; from += 1) {
    const end = from + original.length;
    if (!overlaps(from, end)) return [from, end];
  }

  // 2. Case-insensitive match (same length, so real indices line up).
  const lower = original.toLowerCase();
  for (let from = 0; (from = textLower.indexOf(lower, from)) !== -1; from += 1) {
    const end = from + original.length;
    if (!overlaps(from, end)) return [from, end];
  }

  // 3. Whitespace-tolerant, case-insensitive regex (runs of whitespace flex).
  const pattern = escapeRegExp(original).replace(/\s+/g, "\\s+");
  try {
    const re = new RegExp(pattern, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (!overlaps(start, end)) return [start, end];
    }
  } catch {
    /* invalid regex — give up on this suggestion */
  }
  return null;
}

export function anchorCoachSuggestions(raw: CoachSentenceSuggestion[], text: string): Suggestion[] {
  const used: Array<[number, number]> = [];
  const results: Suggestion[] = [];
  const textLower = text.toLowerCase();
  for (const item of raw) {
    const original = (item.original_text ?? "").trim();
    const replacement = (item.suggested_text ?? "").trim();
    const replacementAvailable = item.replacement_available !== false;
    if (!original || (replacementAvailable && !replacement)) continue;

    const hintedStart = typeof item.start_offset === "number" ? item.start_offset : -1;
    const hintedEnd = typeof item.end_offset === "number" ? item.end_offset : -1;
    const hintedSpan = hintedStart >= 0
      && hintedEnd > hintedStart
      && text.slice(hintedStart, hintedEnd).toLowerCase() === original.toLowerCase()
      ? [hintedStart, hintedEnd] as [number, number]
      : null;
    const span = hintedSpan ?? findRealSpan(text, textLower, original, used);
    if (!span) continue;
    const [matchedStart, matchedEnd] = span;
    // Use the ACTUAL draft substring so the card shows — and Accept replaces —
    // exactly what is in the essay, even when matched case-/whitespace-insensitively.
    const realOriginal = text.slice(matchedStart, matchedEnd);
    if (replacementAvailable && realOriginal === replacement) continue;
    // Spelling cards must show and replace the complete token. Minimizing
    // "Morogoro → Morocco" into "gor → cc" is technically correct as a diff,
    // but misleading to a student reviewing a possible proper noun.
    const preserveCompleteSpelling = item.suggestion_type?.startsWith("spelling");
    const edit = replacementAvailable && !preserveCompleteSpelling
      ? minimizeSuggestionEdit(realOriginal, replacement, matchedStart)
      : {
          start: matchedStart,
          end: matchedEnd,
          original: realOriginal,
          replacement: replacementAvailable ? replacement : "",
        };
    if (!edit.original || edit.original === edit.replacement) continue;
    used.push([edit.start, edit.end]);

    const meta = coachType(item.suggestion_type);
    const severity = (["low", "medium", "high"] as const).includes(item.severity as "low")
      ? (item.severity as "low" | "medium" | "high")
      : "medium";
    results.push({
      id: `coach:${edit.start}:${edit.original.slice(0, 40)}`,
      category: meta.category,
      start: edit.start,
      end: edit.end,
      original: edit.original,
      title: meta.title,
      explanation: item.reason ?? "",
      replacement: edit.replacement,
      severity,
      source: "coach",
      riskTier: normalizeRiskTier(item.risk_tier, meta.riskTier),
      suggestionType: item.suggestion_type,
      confidence: item.confidence,
      engineSource: item.source,
      replacementAvailable,
    });
  }
  return results;
}

/**
 * Merge coach suggestions (authoritative) with the instant heuristic ones,
 * dropping any heuristic suggestion that overlaps a coach suggestion.
 */
export function mergeSuggestions(coach: Suggestion[], auto: Suggestion[]): Suggestion[] {
  const kept: Suggestion[] = [...coach].sort((a, b) => a.start - b.start);
  const spans: Array<[number, number]> = kept.map((s) => [s.start, s.end]);
  for (const s of auto) {
    if (spans.some(([a, b]) => s.start < b && s.end > a)) continue;
    kept.push(s);
    spans.push([s.start, s.end]);
  }
  return kept.sort((a, b) => a.start - b.start);
}
