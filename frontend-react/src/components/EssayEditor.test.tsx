// @vitest-environment happy-dom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EssayEditor, type EssayEditorHandle } from "./EssayEditor";
import type { Suggestion } from "@/lib/suggestions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mountEditor(value: string, richValue: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push({ root, host });

  act(() => {
    root.render(
      <EssayEditor
        value={value}
        richValue={richValue}
        onChange={vi.fn()}
        onRichChange={vi.fn()}
        suggestions={[]}
        onDismiss={vi.fn()}
      />,
    );
  });

  const editor = host.querySelector<HTMLElement>('[aria-label="Essay draft editor"]');
  expect(editor).not.toBeNull();
  return editor!;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (mountedRoots.length) {
    const mounted = mountedRoots.pop()!;
    act(() => mounted.root.unmount());
    mounted.host.remove();
  }
  window.localStorage.clear();
});

describe("EssayEditor rich-document restoration", () => {
  it("keeps bold and centered formatting after navigation unmounts and remounts the editor", () => {
    const savedRichHtml = [
      '<div style="text-align: center;"><strong>Bold opening</strong></div>',
      "<div>Second paragraph</div>",
    ].join("");

    // A stale or differently-normalized plain-text mirror must not replace the
    // saved formatted document when the workspace first mounts.
    const firstEditor = mountEditor(
      "A plain-text mirror with different line breaks",
      savedRichHtml,
    );
    expect(firstEditor.querySelector("strong")?.textContent).toBe("Bold opening");
    expect(firstEditor.querySelector<HTMLElement>("div")?.style.textAlign).toBe("center");

    const firstMount = mountedRoots.pop()!;
    act(() => firstMount.root.unmount());
    firstMount.host.remove();

    // Navigating back creates a new editor instance from the persisted values.
    const remountedEditor = mountEditor(
      "A plain-text mirror with different line breaks",
      savedRichHtml,
    );
    expect(remountedEditor.querySelector("strong")?.textContent).toBe("Bold opening");
    expect(remountedEditor.querySelector<HTMLElement>("div")?.style.textAlign).toBe("center");
  });
});

describe("EssayEditor suggestion reveal", () => {
  it("prevents focus scrolling and defers centering until selection has settled", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mountedRoots.push({ root, host });
    const handle = createRef<EssayEditorHandle>();
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      });
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const suggestion: Suggestion = {
      id: "fix-1",
      category: "correctness",
      start: 6,
      end: 10,
      original: "mist",
      title: "Spelling",
      explanation: "Correct the spelling.",
      replacement: "miss",
    };

    act(() => {
      root.render(
        <EssayEditor
          ref={handle}
          value="Start mist end"
          richValue=""
          onChange={vi.fn()}
          onRichChange={vi.fn()}
          suggestions={[suggestion]}
          onDismiss={vi.fn()}
        />,
      );
    });
    animationFrames.length = 0;
    focusSpy.mockClear();

    act(() => handle.current?.reveal(suggestion));

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(animationFrames.length).toBeGreaterThanOrEqual(1);

    act(() => {
      [...animationFrames].forEach((callback) => callback(0));
    });
  });
});

describe("EssayEditor accepted edit history", () => {
  it("allows the latest accepted suggestion to be undone safely", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mountedRoots.push({ root, host });
    const handle = createRef<EssayEditorHandle>();
    const onChange = vi.fn();
    const suggestion: Suggestion = {
      id: "coach-1",
      category: "engagement",
      start: 6,
      end: 10,
      original: "mist",
      title: "Develop the passage",
      explanation: "Adds the grounded outcome.",
      replacement: "clear result",
      source: "coach",
    };

    const render = (value: string) => {
      root.render(
        <EssayEditor
          ref={handle}
          value={value}
          richValue=""
          onChange={onChange}
          onRichChange={vi.fn()}
          suggestions={[]}
          onDismiss={vi.fn()}
        />,
      );
    };

    act(() => render("Start mist end"));
    act(() => handle.current?.accept(suggestion));
    expect(onChange).toHaveBeenLastCalledWith("Start clear result end");

    act(() => render("Start clear result end"));
    let undone = false;
    act(() => {
      undone = handle.current?.undoLastAccept() ?? false;
    });

    expect(undone).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith("Start mist end");
  });
});
