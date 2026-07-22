// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EssayEditor } from "./EssayEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
