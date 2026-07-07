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
  Bold,
  Expand,
  Heading2,
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
import { applySuggestion, CATEGORY_META, type Suggestion } from "@/lib/suggestions";

export type EssayEditorHandle = {
  accept: (s: Suggestion) => void;
  reveal: (s: Suggestion) => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  suggestions: Suggestion[];
  onDismiss: (s: Suggestion) => void;
  onOpenHighlights: () => void;
  className?: string;
};

// Shared box metrics — the textarea and its backdrop MUST match exactly so the
// underline marks line up under the visible glyphs.
const EDITOR_BOX = "px-5 py-4 md:px-8 font-display text-[18px] leading-8 tracking-normal [overflow-wrap:break-word]";

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

let flashSeq = 0;

export const EssayEditor = forwardRef<EssayEditorHandle, Props>(function EssayEditor(
  { value, onChange, suggestions, onDismiss, onOpenHighlights, className = "" },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [card, setCard] = useState<{ sugg: Suggestion; top: number; left: number } | null>(null);
  const [selBar, setSelBar] = useState<{ top: number; left: number; start: number; end: number } | null>(null);
  const [flashes, setFlashes] = useState<Array<{ id: number; top: number; left: number; width: number; height: number; pulse: boolean }>>([]);
  const [gutter, setGutter] = useState<{ top: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const pendingFlash = useRef<{ start: number; len: number; pulse: boolean } | null>(null);

  // Overlays use position:fixed with viewport coords; an ancestor `transform`
  // (the full-bleed wrapper) would otherwise become their containing block, so
  // render them through a portal on <body>.
  useEffect(() => setMounted(true), []);

  const segments = useMemo(() => buildSegments(value, suggestions), [value, suggestions]);

  const syncScroll = useCallback(() => {
    if (backdropRef.current && taRef.current) {
      backdropRef.current.scrollTop = taRef.current.scrollTop;
      backdropRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }, []);

  useEffect(syncScroll, [value, syncScroll]);

  function addFlash(start: number, len: number, pulse: boolean) {
    const rect = rangeRect(backdropRef.current, start, start + len);
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
    const ta = taRef.current;
    const backdrop = backdropRef.current;
    if (!ta || !backdrop) return;
    const rect = rangeRect(backdrop, start, end);
    if (!rect) return;
    const backdropRect = backdrop.getBoundingClientRect();
    const contentTop = rect.top - backdropRect.top + backdrop.scrollTop;
    ta.scrollTop = Math.max(0, contentTop - ta.clientHeight / 2);
    syncScroll();
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
      taRef.current?.focus();
      taRef.current?.setSelectionRange(s.start, s.end);
    },
  }));

  function suggestionAt(offset: number): Suggestion | null {
    return suggestions.find((s) => offset >= s.start && offset < s.end) ?? null;
  }

  function openCardFor(s: Suggestion) {
    const rect = rangeRect(backdropRef.current, s.start, s.end);
    if (!rect) return;
    setCard({ sugg: s, top: rect.bottom + 6, left: rect.left });
    setSelBar(null);
  }

  function handleClick() {
    const ta = taRef.current;
    if (!ta) return;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const s = suggestionAt(ta.selectionStart);
    if (s) openCardFor(s);
    else setCard(null);
  }

  function refreshSelectionUi() {
    const ta = taRef.current;
    if (!ta) return;
    updateGutter();
    if (ta.selectionStart === ta.selectionEnd) {
      setSelBar(null);
      return;
    }
    const rect = rangeRect(backdropRef.current, ta.selectionStart, ta.selectionEnd);
    if (!rect) return;
    setSelBar({ top: rect.top - 8, left: rect.left + rect.width / 2, start: ta.selectionStart, end: ta.selectionEnd });
    setCard(null);
  }

  function updateGutter() {
    const ta = taRef.current;
    if (!ta) return;
    const rect = rangeRect(backdropRef.current, ta.selectionStart, ta.selectionStart);
    if (!rect) {
      setGutter(null);
      return;
    }
    setGutter({ top: rect.top });
  }

  function replaceRange(start: number, end: number, text: string, pulse = false) {
    const next = value.slice(0, start) + text + value.slice(end);
    pendingFlash.current = { start, len: text.length, pulse };
    onChange(next);
    const ta = taRef.current;
    if (ta) requestAnimationFrame(() => ta.setSelectionRange(start, start + text.length));
  }

  function wrapSelection(before: string, after: string) {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    replaceRange(s, e, `${before}${value.slice(s, e)}${after}`);
  }

  function prefixLines(prefix: string) {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const block = value.slice(lineStart, e);
    const prefixed = block
      .split("\n")
      .map((line) => (line.length ? `${prefix}${line}` : line))
      .join("\n");
    replaceRange(lineStart, e, prefixed);
  }

  // Selection transforms for the AI mini-toolbar (safe, no fabricated content).
  function transformSelection(kind: "rewrite" | "shorten" | "expand" | "tone") {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = value.slice(s, e);
    if (!sel.trim()) return;
    let out = sel;
    if (kind === "shorten") {
      out = sel.replace(/\b(very|really|extremely|basically|actually|literally|just|simply|in order to)\b\s*/gi, (m) => (m.trim().toLowerCase() === "in order to" ? "to " : "")).replace(/[^\S\n]{2,}/g, " ").trim();
    } else if (kind === "tone") {
      out = sel.replace(/\bI (?:think|believe|feel)(?: that)?\b\s*/gi, "").replace(/[^\S\n]{2,}/g, " ").trimStart();
      out = out.charAt(0).toUpperCase() + out.slice(1);
    } else if (kind === "rewrite") {
      out = sel.replace(/[^\S\n]{2,}/g, " ").replace(/[^\S\n]+([,.;:!?])/g, "$1").trim();
      out = out.charAt(0).toUpperCase() + out.slice(1);
    } else if (kind === "expand") {
      out = `${sel.trimEnd()} [add a specific example or detail]`;
    }
    replaceRange(s, e, out, true);
    setSelBar(null);
  }

  function improveParagraph() {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = value.lastIndexOf("\n\n", caret - 1);
    const start = before === -1 ? 0 : before + 2;
    const after = value.indexOf("\n\n", caret);
    const end = after === -1 ? value.length : after;
    ta.focus();
    ta.setSelectionRange(start, end);
    requestAnimationFrame(refreshSelectionUi);
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setCard(null);
        setSelBar(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const openCount = suggestions.length;

  const markdownTools = [
    { label: "Heading", icon: Heading2, run: () => prefixLines("## ") },
    { label: "Bold", icon: Bold, run: () => wrapSelection("**", "**") },
    { label: "Italic", icon: Italic, run: () => wrapSelection("*", "*") },
    { label: "Bullet list", icon: List, run: () => prefixLines("- ") },
    { label: "Numbered list", icon: ListOrdered, run: () => prefixLines("1. ") },
    {
      label: "Link",
      icon: LinkIcon,
      run: () => {
        const url = window.prompt("Paste a link");
        if (url) wrapSelection("[", `](${url})`);
      },
    },
  ];

  const aiTools: Array<{ label: string; icon: typeof Wand2; run: () => void }> = [
    { label: "Rewrite", icon: Wand2, run: () => transformSelection("rewrite") },
    { label: "Shorten", icon: Scissors, run: () => transformSelection("shorten") },
    { label: "Expand", icon: Expand, run: () => transformSelection("expand") },
    { label: "Improve tone", icon: Palette, run: () => transformSelection("tone") },
  ];

  return (
    <div ref={containerRef} className={`relative flex min-h-0 flex-col ${className}`}>
      <div className="relative min-h-0 flex-1">
        {/* Underline backdrop (mirrors the textarea exactly) */}
        <div
          ref={backdropRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words text-transparent ${EDITOR_BOX}`}
        >
          {segments.map((seg, i) =>
            seg.sugg ? (
              <mark
                key={i}
                data-sugg-id={seg.sugg.id}
                className="bg-transparent text-transparent"
                style={{
                  textDecoration: "underline",
                  textDecorationStyle: "wavy",
                  textDecorationColor: CATEGORY_META[seg.sugg.category].color,
                  textDecorationThickness: "1.5px",
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
          <div className={`pointer-events-none absolute inset-0 text-muted-foreground/60 ${EDITOR_BOX}`}>
            Type or paste your essay draft here, or upload a PDF to get started.
          </div>
        )}

        <textarea
          ref={taRef}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onClick={handleClick}
          onKeyUp={refreshSelectionUi}
          onMouseUp={refreshSelectionUi}
          onSelect={refreshSelectionUi}
          onFocus={updateGutter}
          aria-label="Essay draft editor"
          className={`absolute inset-0 block h-full w-full resize-none whitespace-pre-wrap break-words border-0 bg-transparent text-foreground caret-foreground outline-none ${EDITOR_BOX}`}
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

        {/* Open-suggestions badge */}
        {openCount > 0 && (
          <button
            type="button"
            onClick={onOpenHighlights}
            className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-info px-3 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-info/25 transition-transform duration-150 hover:-translate-y-0.5"
          >
            <Sparkles className="size-3.5" />
            {openCount} suggestion{openCount === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {/* Bottom markdown toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-t border-border px-2 py-1.5">
        {markdownTools.map((tool) => {
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
      </div>

      {/* Floating selection mini-toolbar */}
      {mounted &&
        selBar &&
        createPortal(
        <div
          className="fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-xl animate-in fade-in zoom-in-95 duration-150"
          style={{ top: selBar.top, left: selBar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" title="Bold" onClick={() => wrapSelection("**", "**")} className="grid size-8 place-items-center rounded-md text-foreground transition-colors hover:bg-accent">
            <Bold className="size-4" />
          </button>
          <button type="button" title="Italic" onClick={() => wrapSelection("*", "*")} className="grid size-8 place-items-center rounded-md text-foreground transition-colors hover:bg-accent">
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
          className="fixed z-40 w-72 rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ top: card.top, left: Math.max(8, Math.min(card.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 296)) }}
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
              Dismiss
            </button>
          </div>
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
