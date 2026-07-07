// Client-side writing-suggestion engine.
//
// The backend coaching pipeline returns prose-level feedback that is NOT anchored
// to character ranges, so it cannot drive inline underlines. This module runs a
// set of deterministic heuristics over the essay text and returns anchored,
// auto-fixable suggestions (Grammarly-style) that the editor can underline and
// the sidebar can list. Every suggestion carries a concrete replacement so the
// "Accept" action always has something to apply.

export type SuggestionCategory = "correctness" | "clarity" | "engagement" | "tone";

export type Suggestion = {
  id: string;
  category: SuggestionCategory;
  start: number;
  end: number;
  original: string;
  title: string;
  explanation: string;
  replacement: string;
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
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchCase(sample: string, replacement: string): string {
  if (sample && sample[0] === sample[0].toUpperCase() && sample[0] !== sample[0].toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const MISSPELLINGS: Record<string, string> = {
  teh: "the",
  recieve: "receive",
  seperate: "separate",
  definately: "definitely",
  occured: "occurred",
  untill: "until",
  wich: "which",
  becuase: "because",
  thier: "their",
  goverment: "government",
  enviroment: "environment",
  succesful: "successful",
  begining: "beginning",
  beleive: "believe",
};

const WORDY_PHRASES: Record<string, string> = {
  "in order to": "to",
  "due to the fact that": "because",
  "in spite of the fact that": "although",
  "a large number of": "many",
  "a majority of": "most",
  "at this point in time": "now",
  "in the event that": "if",
  "for the purpose of": "to",
  "with regard to": "about",
  "with regards to": "about",
  "in a timely manner": "promptly",
  "make use of": "use",
  "has the ability to": "can",
  "a great deal of": "much",
};

const CLICHES: Record<string, string> = {
  "at the end of the day": "ultimately",
  "last but not least": "finally",
  "in today's society": "today",
  "think outside the box": "be creative",
  "when all is said and done": "ultimately",
  "each and every": "every",
  "first and foremost": "first",
};

function buildPhraseRule(
  map: Record<string, string>,
  category: SuggestionCategory,
  title: string,
  explanation: string,
): Rule {
  const alternation = Object.keys(map)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return {
    category,
    title,
    explanation,
    regex: new RegExp(`\\b(${alternation})\\b`, "gi"),
    replace: (m) => matchCase(m[0], map[m[0].toLowerCase()] ?? m[0]),
  };
}

const RULES: Rule[] = [
  // --- Correctness (red) ---
  {
    category: "correctness",
    title: "Extra spaces",
    explanation: "Remove the extra whitespace so the spacing is consistent.",
    regex: /[^\S\n]{2,}/g,
    replace: () => " ",
  },
  {
    category: "correctness",
    title: "Repeated word",
    explanation: "This word appears twice in a row.",
    regex: /\b(\w+)\s+\1\b/gi,
    replace: (m) => m[1],
  },
  {
    category: "correctness",
    title: 'Capitalize "I"',
    explanation: 'The pronoun "I" is always capitalized.',
    regex: /\bi\b/g,
    replace: () => "I",
  },
  {
    category: "correctness",
    title: "Add a space",
    explanation: "Add a space after the punctuation mark.",
    regex: /([,;])(?=[A-Za-z])/g,
    replace: (m) => `${m[1]} `,
  },
  {
    category: "correctness",
    title: "Spacing before punctuation",
    explanation: "Remove the space before the punctuation mark.",
    regex: /[^\S\n]+([,.;:!?])/g,
    replace: (m) => m[1],
  },
  buildPhraseRule(MISSPELLINGS, "correctness", "Possible misspelling", "This looks like a common misspelling."),

  // --- Clarity (blue) ---
  buildPhraseRule(WORDY_PHRASES, "clarity", "Wordy phrase", "This phrase can be tightened up."),

  // --- Engagement (green) ---
  {
    category: "engagement",
    title: "Weak intensifier",
    explanation: "Cut the filler word and let the point stand on its own.",
    regex: /\b(?:very|really|extremely|basically|actually|literally)\s+([A-Za-z]+)/gi,
    replace: (m) => m[1],
  },

  // --- Tone (purple) ---
  buildPhraseRule(CLICHES, "tone", "Cliché", "This is an overused phrase — say it more directly."),
  {
    category: "tone",
    title: "Hedging",
    explanation: "State it with confidence instead of hedging.",
    regex: /\bI (?:think|believe|feel) that\s+/gi,
    replace: () => "",
  },
];

function priority(category: SuggestionCategory): number {
  return CATEGORY_ORDER.indexOf(category);
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
      found.push({
        id: `${rule.category}:${m.index}:${original}`,
        category: rule.category,
        start: m.index,
        end: m.index + original.length,
        original,
        title: rule.title,
        explanation: rule.explanation,
        replacement,
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
