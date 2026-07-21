import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Bold,
  Copy,
  Expand,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Palette,
  Scissors,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { applySuggestion, CATEGORY_META, isInlineSuggestion, type Suggestion } from "@/lib/suggestions";

export type EssayEditorHandle = {
  accept: (s: Suggestion) => void;
  reveal: (s: Suggestion) => void;
};

export type RewriteAction = "rewrite" | "shorten" | "expand" | "improve_tone";

const REWRITE_LABEL: Record<RewriteAction, string> = {
  rewrite: "Rewrite",
  shorten: "Shorten",
  expand: "Expand",
  improve_tone: "Improve tone",
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  richValue?: string;
  onRichChange?: (value: string) => void;
  suggestions: Suggestion[];
  onDismiss: (s: Suggestion) => void;
  onAutoCheck?: () => void;
  onRequestRewrite?: (action: RewriteAction, text: string, surrounding: string) => Promise<{ rewritten_text: string; note: string }>;
  className?: string;
};

// Shared box metrics — the textarea and its backdrop MUST match exactly so the
// underline marks line up under the visible glyphs.
const EDITOR_BOX = "px-[45px] py-4 tracking-normal [overflow-wrap:break-word]";

type EditorAlignment = "left" | "center" | "right" | "justify";
type EditorFontFamily = "serif" | "sans";

type EditorTypography = {
  fontSize: number;
  fontFamily: EditorFontFamily;
};

const DEFAULT_EDITOR_TYPOGRAPHY: EditorTypography = {
  fontSize: 18,
  fontFamily: "serif",
};

const EDITOR_TYPOGRAPHY_STORAGE_KEY = "scholar-e:essay-editor-typography";
const EDITOR_FONT_SIZES = [14, 16, 18, 20, 22, 24] as const;

function validEditorTypography(value: unknown): EditorTypography {
  if (!value || typeof value !== "object") return DEFAULT_EDITOR_TYPOGRAPHY;
  const candidate = value as Partial<EditorTypography>;
  const fontSize = EDITOR_FONT_SIZES.includes(candidate.fontSize as (typeof EDITOR_FONT_SIZES)[number])
    ? candidate.fontSize!
    : DEFAULT_EDITOR_TYPOGRAPHY.fontSize;
  const fontFamily = candidate.fontFamily === "sans" || candidate.fontFamily === "serif"
    ? candidate.fontFamily
    : DEFAULT_EDITOR_TYPOGRAPHY.fontFamily;
  return { fontSize, fontFamily };
}

type Segment = { text: string; sugg?: Suggestion };

function buildSegments(value: string, suggestions: Suggestion[]): Segment[] {
  const sorted = [...suggestions].sort((a, b) => a.start - b.start);
  const segs: Segment[] = [];
  let idx = 0;
  for (const s of sorted) {
    if (s.start < idx) continue;
    if (s.start > idx) segs.push({ text: value.slice(idx, s.start) });
    segs.push({ text: value.slice(s.start, s.end), sugg: s });
    idx = s.end;
  }
  if (idx < value.length) segs.push({ text: value.slice(idx) });
  // A trailing newline needs a filler char or the backdrop drops its last line.
  segs.push({ text: "​" });
  return segs;
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  return nodes;
}

type VisibleTextPoint = { node: Text; offset: number };

function visibleTextMap(root: Node) {
  const points: VisibleTextPoint[] = [];
  let text = "";
  for (const node of collectTextNodes(root)) {
    const content = node.data;
    for (let offset = 0; offset < content.length; offset += 1) {
      const character = content[offset];
      if (character === "\n" || character === "\r") continue;
      points.push({ node, offset });
      text += character === "\u00a0" ? " " : character;
    }
  }
  return { points, text };
}

function visibleOffset(text: string, offset: number) {
  let result = 0;
  for (let index = 0; index < Math.min(offset, text.length); index += 1) {
    if (text[index] !== "\n" && text[index] !== "\r") result += 1;
  }
  return result;
}

function valueOffsetFromVisibleOffset(value: string, target: number) {
  let visible = 0;
  let index = 0;
  while (index < value.length) {
    if (value[index] === "\n" || value[index] === "\r") {
      index += 1;
      continue;
    }
    if (visible === target) return index;
    visible += 1;
    index += 1;
    if (visible === target) {
      while (index < value.length && (value[index] === "\n" || value[index] === "\r")) index += 1;
      return index;
    }
  }
  return value.length;
}

function visibleOffsetAtDomBoundary(root: HTMLElement, container: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }
  return visibleTextMap(range.cloneContents()).text.length;
}

function editorRangeForValueOffsets(root: HTMLElement, value: string, start: number, end: number) {
  const { points, text } = visibleTextMap(root);
  const visibleValue = value.replace(/[\r\n]/g, "").replace(/\u00a0/g, " ");
  if (!points.length || text !== visibleValue) return null;

  const visibleStart = visibleOffset(value, start);
  const visibleEnd = visibleOffset(value, end);
  if (visibleEnd < visibleStart || visibleStart > points.length) return null;

  const boundary = (offset: number) => {
    if (offset <= 0) return points[0];
    if (offset >= points.length) {
      const last = points[points.length - 1];
      return { node: last.node, offset: last.offset + 1 };
    }
    return points[offset];
  };
  const first = boundary(visibleStart);
  const last = boundary(visibleEnd);

  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  return range;
}

type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

const ESSAY_HIGHLIGHT_NAMES = [
  "essay-fix-correctness",
  "essay-fix-clarity",
  "essay-fix-engagement",
  "essay-fix-tone",
  "essay-fix-selected",
] as const;

const ESSAY_HIGHLIGHT_STYLES = `
::highlight(essay-fix-correctness) { text-decoration: underline wavy #dc2626bf 1.5px; text-decoration-skip-ink: none; text-underline-offset: 3px; }
::highlight(essay-fix-clarity) { text-decoration: underline wavy #2563ebbf 1.5px; text-decoration-skip-ink: none; text-underline-offset: 3px; }
::highlight(essay-fix-engagement) { text-decoration: underline wavy #16a34abf 1.5px; text-decoration-skip-ink: none; text-underline-offset: 3px; }
::highlight(essay-fix-tone) { text-decoration: underline wavy #8b5cf6bf 1.5px; text-decoration-skip-ink: none; text-underline-offset: 3px; }
::highlight(essay-fix-selected) { text-decoration: underline wavy #6d5df6 2px; text-decoration-skip-ink: none; text-underline-offset: 3px; }
`;

function locate(nodes: Text[], offset: number): { node: Text; pos: number } | null {
  let acc = 0;
  for (const node of nodes) {
    const len = node.textContent?.length ?? 0;
    if (offset <= acc + len) return { node, pos: offset - acc };
    acc += len;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, pos: last.textContent?.length ?? 0 } : null;
}

function rangeRect(backdrop: HTMLElement | null, start: number, end: number): DOMRect | null {
  if (!backdrop) return null;
  const nodes = collectTextNodes(backdrop);
  const a = locate(nodes, start);
  const b = locate(nodes, end);
  if (!a || !b) return null;
  const range = document.createRange();
  try {
    range.setStart(a.node, a.pos);
    range.setEnd(b.node, b.pos);
  } catch {
    return null;
  }
  const rects = range.getClientRects();
  return rects.length ? rects[0] : range.getBoundingClientRect();
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainTextToHtml(text: string) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function normalizeEditorText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\n$/, "");
}

function sanitizeRichHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["B", "STRONG", "I", "EM", "H2", "UL", "OL", "LI", "A", "DIV", "P", "BR"]);
  const allowedAttrs = new Set(["href", "target", "rel"]);
  template.content.querySelectorAll("*").forEach((el) => {
    if (!allowedTags.has(el.tagName)) {
      el.replaceWith(...Array.from(el.childNodes));
      return;
    }
    const requestedAlignment = (
      el.getAttribute("align")
      || (el instanceof HTMLElement ? el.style.textAlign : "")
    ).toLowerCase();
    Array.from(el.attributes).forEach((attr) => {
      if (!allowedAttrs.has(attr.name)) el.removeAttribute(attr.name);
    });
    if (["left", "center", "right", "justify"].includes(requestedAlignment)) {
      el.setAttribute("style", `text-align: ${requestedAlignment};`);
    }
    if (el.tagName === "A") {
      const href = el.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) el.removeAttribute("href");
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noreferrer");
    }
  });
  return template.innerHTML;
}

let flashSeq = 0;

export const EssayEditor = forwardRef<EssayEditorHandle, Props>(function EssayEditor(
  { value, onChange, richValue, onRichChange, suggestions, onDismiss, onAutoCheck, onRequestRewrite, className = "" },
  ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [card, setCard] = useState<{ sugg: Suggestion; left: number; top: number } | null>(null);
  const [selBar, setSelBar] = useState<{ top: number; left: number; start: number; end: number; below: boolean } | null>(null);
  const [flashes, setFlashes] = useState<Array<{ id: number; top: number; left: number; width: number; height: number; pulse: boolean }>>([]);
  const [gutter, setGutter] = useState<{ top: number } | null>(null);
  const [rewrite, setRewrite] = useState<{
    action: RewriteAction;
    start: number;
    end: number;
    original: string;
    status: "loading" | "ready" | "stale";
    result: string;
    note: string;
    top: number;
    left: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [nativeHighlightsSupported, setNativeHighlightsSupported] = useState(false);
  const [nativeHighlightsReady, setNativeHighlightsReady] = useState(false);
  const [typography, setTypography] = useState<EditorTypography>(DEFAULT_EDITOR_TYPOGRAPHY);
  const [activeAlignment, setActiveAlignment] = useState<EditorAlignment>("left");
  const [typographyLoaded, setTypographyLoaded] = useState(false);
  const pendingFlash = useRef<{ start: number; len: number; pulse: boolean } | null>(null);
  const lastSyncedHtml = useRef("");

  // Overlays use position:fixed with viewport coords; an ancestor `transform`
  // (the full-bleed wrapper) would otherwise become their containing block, so
  // render them through a portal on <body>.
  useEffect(() => {
    setMounted(true);
    const highlightRegistry = (CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights;
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    setNativeHighlightsSupported(!!highlightRegistry && !!HighlightConstructor);
    try {
      const saved = window.localStorage.getItem(EDITOR_TYPOGRAPHY_STORAGE_KEY);
      if (saved) setTypography(validEditorTypography(JSON.parse(saved)));
    } catch {
      // Keep the defaults when browser storage is unavailable or malformed.
    } finally {
      setTypographyLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!nativeHighlightsSupported) return;
    const style = document.createElement("style");
    style.dataset.essayFixHighlights = "true";
    style.textContent = ESSAY_HIGHLIGHT_STYLES;
    document.head.appendChild(style);
    return () => style.remove();
  }, [nativeHighlightsSupported]);

  useEffect(() => {
    if (!typographyLoaded) return;
    try {
      window.localStorage.setItem(EDITOR_TYPOGRAPHY_STORAGE_KEY, JSON.stringify(typography));
    } catch {
      // The controls still work for this session when storage is unavailable.
    }
  }, [typography, typographyLoaded]);

  const typographyStyle = useMemo(
    () => ({
      fontFamily:
        typography.fontFamily === "serif"
          ? '"Source Serif 4", "Iowan Old Style", Georgia, serif'
          : 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: `${typography.fontSize}px`,
      lineHeight: 1.75,
    }),
    [typography],
  );

  const inlineSuggestions = useMemo(() => suggestions.filter(isInlineSuggestion), [suggestions]);
  const segments = useMemo(() => buildSegments(value, inlineSuggestions), [value, inlineSuggestions]);

  const syncScroll = useCallback(() => {
    if (backdropRef.current && editorRef.current) {
      backdropRef.current.scrollTop = editorRef.current.scrollTop;
      backdropRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
  }, []);

  useEffect(syncScroll, [value, syncScroll]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentText = normalizeEditorText(editor.innerText ?? "");
    if (currentText === value && editor.innerHTML === lastSyncedHtml.current) return;
    if (currentText === value && editor.innerHTML) return;
    const html = richValue && normalizeEditorText(editor.innerText ?? "") === value
      ? sanitizeRichHtml(richValue)
      : sanitizeRichHtml(richValue && normalizeEditorText(new DOMParser().parseFromString(richValue, "text/html").body.innerText) === value ? richValue : plainTextToHtml(value));
    editor.innerHTML = html || "<br>";
    lastSyncedHtml.current = editor.innerHTML;
  }, [richValue, value]);

  useLayoutEffect(() => {
    if (!nativeHighlightsSupported) return;
    const editor = editorRef.current;
    const registry = (CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights;
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!editor || !registry || !HighlightConstructor) return;

    ESSAY_HIGHLIGHT_NAMES.forEach((name) => registry.delete(name));
    const grouped = new Map<string, Range[]>();
    let mappedSuggestionCount = 0;
    inlineSuggestions.forEach((suggestion) => {
      const range = editorRangeForValueOffsets(editor, value, suggestion.start, suggestion.end);
      if (!range) return;
      mappedSuggestionCount += 1;
      const name = card?.sugg.id === suggestion.id
        ? "essay-fix-selected"
        : `essay-fix-${suggestion.category}`;
      const ranges = grouped.get(name) ?? [];
      ranges.push(range);
      grouped.set(name, ranges);
    });
    if (mappedSuggestionCount !== inlineSuggestions.length) {
      setNativeHighlightsReady(false);
      return;
    }
    grouped.forEach((ranges, name) => registry.set(name, new HighlightConstructor(...ranges)));
    setNativeHighlightsReady(true);

    return () => {
      ESSAY_HIGHLIGHT_NAMES.forEach((name) => registry.delete(name));
    };
  }, [card?.sugg.id, inlineSuggestions, nativeHighlightsSupported, richValue, value]);

  function syncFromEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    const html = sanitizeRichHtml(editor.innerHTML);
    const text = normalizeEditorText(editor.innerText ?? "");
    lastSyncedHtml.current = html;
    if (editor.innerHTML !== html) editor.innerHTML = html || "<br>";
    onRichChange?.(html);
    onChange(text);
    syncScroll();
  }

  function addFlash(start: number, len: number, pulse: boolean) {
    const rect = valueRangeRect(start, start + len);
    if (!rect) return;
    const id = ++flashSeq;
    setFlashes((prev) => [...prev, { id, top: rect.top, left: rect.left, width: rect.width, height: rect.height, pulse }]);
    window.setTimeout(() => setFlashes((prev) => prev.filter((f) => f.id !== id)), 700);
  }

  // After an accepted edit re-renders, measure the new range and flash it.
  useLayoutEffect(() => {
    if (!pendingFlash.current) return;
    const { start, len, pulse } = pendingFlash.current;
    pendingFlash.current = null;
    requestAnimationFrame(() => addFlash(start, len, pulse));
  }, [value]);

  function scrollOffsetIntoView(start: number, end: number) {
    const editor = editorRef.current;
    if (!editor) return;
    const rect = valueRangeRect(start, end);
    if (!rect) return;
    const editorRect = editor.getBoundingClientRect();
    const contentTop = rect.top - editorRect.top + editor.scrollTop;
    editor.scrollTop = Math.max(0, contentTop - editor.clientHeight / 2);
    syncScroll();
  }

  function valueRangeRect(start: number, end: number) {
    const editor = editorRef.current;
    if (editor) {
      const editorRange = editorRangeForValueOffsets(editor, value, start, end);
      if (editorRange) {
        const rects = editorRange.getClientRects();
        if (rects.length) return rects[0];
        const rect = editorRange.getBoundingClientRect();
        if (rect.width || rect.height) return rect;
      }
    }
    return rangeRect(backdropRef.current, start, end);
  }

  function getSelectionOffsets() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;

    const mappedEditorText = visibleTextMap(editor).text;
    const mappedValue = value.replace(/[\r\n]/g, "").replace(/\u00a0/g, " ");
    const visibleStart = mappedEditorText === mappedValue
      ? visibleOffsetAtDomBoundary(editor, range.startContainer, range.startOffset)
      : null;
    const visibleEnd = mappedEditorText === mappedValue
      ? visibleOffsetAtDomBoundary(editor, range.endContainer, range.endOffset)
      : null;
    if (visibleStart !== null && visibleEnd !== null) {
      const start = valueOffsetFromVisibleOffset(value, visibleStart);
      const end = valueOffsetFromVisibleOffset(value, visibleEnd);
      return { start: Math.min(start, end), end: Math.max(start, end) };
    }

    const startRange = document.createRange();
    startRange.selectNodeContents(editor);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = document.createRange();
    endRange.selectNodeContents(editor);
    endRange.setEnd(range.endContainer, range.endOffset);
    const start = normalizeEditorText(startRange.toString()).length;
    const end = normalizeEditorText(endRange.toString()).length;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function setSelectionByOffsets(start: number, end: number) {
    const editor = editorRef.current;
    if (!editor) return false;
    const formattedRange = editorRangeForValueOffsets(editor, value, start, end);
    if (formattedRange) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(formattedRange);
      return true;
    }
    if (!editor.textContent) editor.appendChild(document.createTextNode(""));
    const nodes = collectTextNodes(editor);
    const a = locate(nodes, start);
    const b = locate(nodes, end);
    if (!a || !b) return false;
    const range = document.createRange();
    range.setStart(a.node, a.pos);
    range.setEnd(b.node, b.pos);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }

  useImperativeHandle(ref, () => ({
    accept(s: Suggestion) {
      const next = applySuggestion(value, s);
      pendingFlash.current = { start: s.start, len: s.replacement.length, pulse: false };
      onChange(next);
      setCard(null);
    },
    reveal(s: Suggestion) {
      scrollOffsetIntoView(s.start, s.end);
      requestAnimationFrame(() => addFlash(s.start, s.end - s.start, true));
      editorRef.current?.focus();
      setSelectionByOffsets(s.start, s.end);
    },
  }));

  function suggestionAt(offset: number): Suggestion | null {
    return inlineSuggestions.find((s) => offset >= s.start && offset < s.end) ?? null;
  }

  function openCardFor(s: Suggestion) {
    const rect = valueRangeRect(s.start, s.end);
    if (!rect) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(rect.left, vw - 296));
    const estimatedHeight = 260;
    // Open below the underline when there's room; otherwise flip above; and if
    // neither fits, clamp into the viewport. Combined with max-h + scroll, the
    // card (and its Accept/Ignore buttons) always stay reachable on screen.
    let top: number;
    if (rect.bottom + estimatedHeight + 12 <= vh) {
      top = rect.bottom + 6;
    } else if (rect.top - estimatedHeight - 6 >= 8) {
      top = rect.top - estimatedHeight - 6;
    } else {
      top = Math.max(8, vh - estimatedHeight - 8);
    }
    setCard({ sugg: s, left, top });
    setSelBar(null);
  }

  function handleClick() {
    const selection = getSelectionOffsets();
    if (!selection) return;
    if (selection.start !== selection.end) return;
    const s = suggestionAt(selection.start);
    if (s) openCardFor(s);
    else setCard(null);
  }

  function refreshSelectionUi() {
    const nextAlignment = ([
      ["justifyCenter", "center"],
      ["justifyRight", "right"],
      ["justifyFull", "justify"],
      ["justifyLeft", "left"],
    ] as const).find(([command]) => document.queryCommandState(command))?.[1] ?? "left";
    setActiveAlignment(nextAlignment);
    const selection = getSelectionOffsets();
    if (!selection) return;
    updateGutter();
    if (selection.start === selection.end) {
      setSelBar(null);
      return;
    }
    const rect = valueRangeRect(selection.start, selection.end);
    if (!rect) return;
    // Flip below the selection when it's too close to the viewport top.
    const below = rect.top < 96;
    setSelBar({
      top: below ? rect.bottom + 8 : rect.top - 8,
      left: rect.left + rect.width / 2,
      start: selection.start,
      end: selection.end,
      below,
    });
    setCard(null);
  }

  function updateGutter() {
    const selection = getSelectionOffsets();
    if (!selection) return;
    const rect = rangeRect(backdropRef.current, selection.start, selection.start);
    if (!rect) {
      setGutter(null);
      return;
    }
    setGutter({ top: rect.top });
  }

  function replaceRange(start: number, end: number, text: string, pulse = false) {
    pendingFlash.current = { start, len: text.length, pulse };
    if (setSelectionByOffsets(start, end)) {
      document.execCommand("insertText", false, text);
      syncFromEditor();
      requestAnimationFrame(() => setSelectionByOffsets(start, start + text.length));
      return;
    }
    onChange(value.slice(0, start) + text + value.slice(end));
  }

  function runEditorCommand(command: string, valueArg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, valueArg);
    syncFromEditor();
    refreshSelectionUi();
  }

  // Local, offline fallback transforms (used only if the AI rewrite call fails).
  // These never fabricate content.
  function localRewrite(action: RewriteAction, sel: string): string {
    if (action === "shorten") {
      return sel
        .replace(/\b(very|really|extremely|basically|actually|literally|just|simply|in order to)\b\s*/gi, (m) => (m.trim().toLowerCase() === "in order to" ? "to " : ""))
        .replace(/[^\S\n]{2,}/g, " ")
        .trim();
    }
    if (action === "improve_tone") {
      const out = sel.replace(/\bI (?:think|believe|feel)(?: that)?\b\s*/gi, "").replace(/[^\S\n]{2,}/g, " ").trimStart();
      return out.charAt(0).toUpperCase() + out.slice(1);
    }
    if (action === "expand") {
      return `${sel.trimEnd()} [add a specific example or detail]`;
    }
    const out = sel.replace(/[^\S\n]{2,}/g, " ").replace(/[^\S\n]+([,.;:!?])/g, "$1").trim();
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  // Ask the AI rewrite agent for a version of the selection, shown as a preview
  // the student accepts or rejects (never applied automatically).
  async function requestRewrite(action: RewriteAction) {
    const selection = getSelectionOffsets();
    if (!selection) return;
    const { start, end } = selection;
    const original = value.slice(start, end);
    if (!original.trim()) return;
    const rect = valueRangeRect(start, end);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const previewWidth = vw >= 640 ? Math.min(608, vw - 16) : vw - 16;
    const left = rect ? Math.max(8, Math.min(rect.left, vw - previewWidth - 8)) : 8;
    const top = rect ? (rect.bottom + 360 <= vh ? rect.bottom + 8 : Math.max(8, rect.top - 360)) : 80;
    setSelBar(null);
    setCard(null);
    setRewrite({ action, start, end, original, status: "loading", result: "", note: "", top, left });
    try {
      if (!onRequestRewrite) throw new Error("no handler");
      const res = await onRequestRewrite(action, original, value);
      const rewritten = (res.rewritten_text || "").trim();
      setRewrite((prev) => (prev ? { ...prev, status: "ready", result: rewritten || original, note: res.note || "" } : null));
    } catch {
      setRewrite((prev) => (prev ? { ...prev, status: "ready", result: localRewrite(action, original), note: "Offline suggestion — the AI coach was unavailable." } : null));
    }
  }

  function acceptRewrite() {
    if (!rewrite || rewrite.status !== "ready") return;
    const { start, end, original, result } = rewrite;
    // Range guard: only apply if the underlying text is still exactly what we rewrote.
    if (value.slice(start, end) !== original) {
      setRewrite((prev) => (prev ? { ...prev, status: "stale" } : null));
      return;
    }
    if (result && result !== original) replaceRange(start, end, result, true);
    setRewrite(null);
  }

  function improveParagraph() {
    const selection = getSelectionOffsets();
    if (!selection) return;
    const caret = selection.start;
    const before = value.lastIndexOf("\n\n", caret - 1);
    const start = before === -1 ? 0 : before + 2;
    const after = value.indexOf("\n\n", caret);
    const end = after === -1 ? value.length : after;
    editorRef.current?.focus();
    setSelectionByOffsets(start, end);
    void requestRewrite("rewrite");
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // Clicks inside a floating overlay (card / mini-toolbar / rewrite preview)
      // must not dismiss it — those are portaled to <body>, outside the container.
      if (target?.closest?.("[data-editor-overlay]")) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setCard(null);
        setSelBar(null);
        setRewrite(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const formattingTools = [
    { label: "Bold", icon: Bold, run: () => runEditorCommand("bold") },
    { label: "Italic", icon: Italic, run: () => runEditorCommand("italic") },
    { label: "Bullet list", icon: List, run: () => runEditorCommand("insertUnorderedList") },
    { label: "Numbered list", icon: ListOrdered, run: () => runEditorCommand("insertOrderedList") },
    {
      label: "Link",
      icon: LinkIcon,
      run: () => {
        const url = window.prompt("Paste a link");
        if (url) runEditorCommand("createLink", url);
      },
    },
  ];

  const aiTools: Array<{ label: string; icon: typeof Wand2; run: () => void }> = [
    { label: "Rewrite", icon: Wand2, run: () => void requestRewrite("rewrite") },
    { label: "Shorten", icon: Scissors, run: () => void requestRewrite("shorten") },
    { label: "Expand", icon: Expand, run: () => void requestRewrite("expand") },
    { label: "Improve tone", icon: Palette, run: () => void requestRewrite("improve_tone") },
  ];

  return (
    <div ref={containerRef} className={`relative flex min-h-0 flex-col ${className}`}>
      <div className="relative min-h-0 flex-1">
        {/* Underline backdrop (mirrors the textarea exactly) */}
        <div
          ref={backdropRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words text-transparent ${EDITOR_BOX}`}
          style={typographyStyle}
        >
          {segments.map((seg, i) =>
            seg.sugg && !nativeHighlightsReady ? (
              <mark
                key={i}
                data-sugg-id={seg.sugg.id}
                className="bg-transparent text-transparent"
                style={{
                  textDecoration: "underline",
                  textDecorationStyle: "wavy",
                  textDecorationColor:
                    card?.sugg.id === seg.sugg.id
                      ? CATEGORY_META[seg.sugg.category].color
                      : `${CATEGORY_META[seg.sugg.category].color}bf`,
                  textDecorationThickness: card?.sugg.id === seg.sugg.id ? "2px" : "1.5px",
                  textDecorationSkipInk: "none",
                  textUnderlineOffset: "3px",
                }}
              >
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </div>

        {!value.trim() && (
          <div
            className={`pointer-events-none absolute inset-0 text-muted-foreground/60 ${EDITOR_BOX}`}
            style={typographyStyle}
          >
            Type or paste your essay draft here, or upload a PDF to get started.
          </div>
        )}

        <div
          ref={editorRef}
          contentEditable
          spellCheck={false}
          suppressContentEditableWarning
          onInput={syncFromEditor}
          onPaste={() => onAutoCheck?.()}
          onScroll={syncScroll}
          onClick={handleClick}
          onKeyUp={refreshSelectionUi}
          onMouseUp={refreshSelectionUi}
          onFocus={updateGutter}
          aria-label="Essay draft editor"
          className={`absolute inset-0 block h-full w-full overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent text-foreground caret-foreground outline-none empty:before:content-[''] [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:leading-9 [&_h2]:text-foreground ${EDITOR_BOX}`}
          style={typographyStyle}
        />

        {/* Paragraph gutter affordance */}
        {gutter && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              improveParagraph();
            }}
            title="Improve this paragraph"
            className="group absolute left-0.5 z-10 grid size-6 -translate-y-0.5 place-items-center rounded-md text-muted-foreground/50 transition-colors duration-150 hover:bg-info/10 hover:text-info md:left-1.5"
            style={{ top: gutter.top - (containerRef.current?.getBoundingClientRect().top ?? 0) }}
          >
            <Sparkles className="size-3.5" />
          </button>
        )}

      </div>

      {/* Bottom formatting toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-t border-border px-2 py-1.5">
        {formattingTools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.label}
              type="button"
              title={tool.label}
              onMouseDown={(e) => {
                e.preventDefault();
                tool.run();
              }}
              className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            >
              <Icon className="size-4" />
            </button>
          );
        })}
        <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <label className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-[12px] text-muted-foreground">
          <span className="sr-only">Font size</span>
          <select
            aria-label="Font size"
            value={typography.fontSize}
            onChange={(event) =>
              setTypography((current) => ({ ...current, fontSize: Number(event.target.value) }))
            }
            className="cursor-pointer bg-transparent font-medium text-foreground outline-none"
          >
            {EDITOR_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex h-8 items-center rounded-md border border-border bg-background px-2 text-[12px] text-muted-foreground">
          <span className="sr-only">Font family</span>
          <select
            aria-label="Font family"
            value={typography.fontFamily}
            onChange={(event) =>
              setTypography((current) => ({ ...current, fontFamily: event.target.value as EditorFontFamily }))
            }
            className="cursor-pointer bg-transparent font-medium text-foreground outline-none"
          >
            <option value="serif">Serif</option>
            <option value="sans">Sans serif</option>
          </select>
        </label>

        <div className="ml-0.5 inline-flex items-center overflow-hidden rounded-md border border-border bg-background" aria-label="Text alignment">
          {([
            { value: "left", label: "Align left", icon: AlignLeft, command: "justifyLeft" },
            { value: "center", label: "Align center", icon: AlignCenter, command: "justifyCenter" },
            { value: "right", label: "Align right", icon: AlignRight, command: "justifyRight" },
            { value: "justify", label: "Justify", icon: AlignJustify, command: "justifyFull" },
          ] as const).map((option) => {
            const Icon = option.icon;
            const selected = activeAlignment === option.value;
            return (
              <button
                key={option.value}
                type="button"
                title={option.label}
                aria-label={option.label}
                aria-pressed={selected}
                onMouseDown={(event) => {
                  event.preventDefault();
                  runEditorCommand(option.command);
                  setActiveAlignment(option.value);
                }}
                className={`grid size-8 place-items-center border-l border-border first:border-l-0 transition-colors ${
                  selected ? "bg-info/10 text-info" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Floating selection mini-toolbar */}
      {mounted &&
        selBar &&
        createPortal(
        <div
          data-editor-overlay
          className={`fixed z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-xl animate-in fade-in zoom-in-95 duration-150 ${selBar.below ? "" : "-translate-y-full"}`}
          style={{ top: selBar.top, left: selBar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" title="Bold" onClick={() => runEditorCommand("bold")} className="grid size-8 place-items-center rounded-md text-foreground transition-colors hover:bg-accent">
            <Bold className="size-4" />
          </button>
          <button type="button" title="Italic" onClick={() => runEditorCommand("italic")} className="grid size-8 place-items-center rounded-md text-foreground transition-colors hover:bg-accent">
            <Italic className="size-4" />
          </button>
          <div className="mx-0.5 h-5 w-px bg-border" />
          {aiTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.label}
                type="button"
                title={tool.label}
                onClick={tool.run}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-info/10 hover:text-info"
              >
                <Icon className="size-3.5" />
                {tool.label}
              </button>
            );
          })}
        </div>,
          document.body,
        )}

      {/* Floating suggestion card */}
      {mounted &&
        card &&
        createPortal(
        <div
          data-editor-overlay
          className="fixed z-40 flex max-h-[70vh] w-72 flex-col overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in duration-150"
          style={{ top: card.top, left: card.left }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: CATEGORY_META[card.sugg.category].color }} />
              <span className="text-[13px] font-semibold">{card.sugg.title}</span>
            </div>
            <button type="button" onClick={() => setCard(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{card.sugg.explanation}</p>
          <div className="mt-2 rounded-lg border border-border bg-background p-2 text-[13px]">
            <span className="text-muted-foreground line-through decoration-muted-foreground/50">{card.sugg.original.trim() || "␠"}</span>
            <span className="mx-1.5 text-muted-foreground">→</span>
            <span className="font-medium text-foreground">{card.sugg.replacement.trim() || "(removed)"}</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = applySuggestion(value, card.sugg);
                pendingFlash.current = { start: card.sugg.start, len: card.sugg.replacement.length, pulse: false };
                onChange(next);
                setCard(null);
              }}
              className="flex-1 rounded-lg bg-info px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => {
                onDismiss(card.sugg);
                setCard(null);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Ignore
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(card.sugg.replacement)}
              title="Copy suggested text"
              aria-label="Copy suggested text"
              className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
        </div>,
          document.body,
        )}

      {/* AI rewrite preview (Accept / Reject) */}
      {mounted &&
        rewrite &&
        createPortal(
          <div
            data-editor-overlay
            className="fixed z-40 flex max-h-[70vh] w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-2xl animate-in fade-in duration-150 sm:w-[38rem] sm:max-w-[calc(100vw-1rem)]"
            style={{ top: rewrite.top, left: rewrite.left }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Wand2 className="size-3.5 text-info" />
                {REWRITE_LABEL[rewrite.action]}
              </span>
              <button type="button" onClick={() => setRewrite(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="size-3.5" />
              </button>
            </div>
            {rewrite.status === "loading" ? (
              <div className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="size-3 animate-spin rounded-full border-2 border-info/30 border-t-info" />
                Rewriting…
              </div>
            ) : (
              <>
                <div className="mt-1.5 grid grid-cols-1 items-stretch gap-1.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2">
                  <section className="flex min-w-0 flex-col" aria-label="Original text">
                    <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Original</div>
                    <div className="min-h-[4.75rem] max-h-40 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-4 text-muted-foreground line-through decoration-muted-foreground/40">
                      {rewrite.original}
                    </div>
                  </section>
                  <div className="flex items-center justify-center text-muted-foreground/70" aria-hidden="true">
                    <ArrowRight className="size-4 rotate-90 sm:rotate-0" />
                  </div>
                  <section className="flex min-w-0 flex-col" aria-label="Suggested revision">
                    <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Suggested</div>
                    <div className="min-h-[4.75rem] max-h-40 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-info/20 bg-background p-4 font-medium text-foreground">
                      {rewrite.result}
                    </div>
                  </section>
                </div>
                {rewrite.note && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{rewrite.note}</p>}
                {rewrite.status === "stale" && <p className="mt-1 text-[12px] leading-snug text-warning">Your text changed — select it again to rewrite.</p>}
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={acceptRewrite}
                    disabled={rewrite.status === "stale" || rewrite.result === rewrite.original}
                    className="h-11 flex-1 rounded-lg bg-info px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => setRewrite(null)}
                    className="h-11 rounded-lg border border-border px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}

      {/* Accept / reveal flash overlays */}
      {mounted &&
        flashes.length > 0 &&
        createPortal(
          <>
            {flashes.map((f) => (
              <div
                key={f.id}
                className={`pointer-events-none fixed z-30 rounded ${f.pulse ? "essay-flash-pulse" : "essay-flash-accept"}`}
                style={{ top: f.top - 2, left: f.left - 2, width: f.width + 4, height: f.height + 4 }}
              />
            ))}
          </>,
          document.body,
        )}
    </div>
  );
});
