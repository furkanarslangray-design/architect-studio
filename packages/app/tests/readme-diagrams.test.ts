import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

// Mermaid touches the DOM (and DOMPurify) while parsing, so give it a real one.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
for (const name of ["HTMLElement", "SVGElement", "Element", "Node", "DOMParser", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
  });
}

let mermaid: { parse: (text: string) => Promise<unknown> };

beforeAll(async () => {
  mermaid = (await import("mermaid")).default;
});

const files = ["README.md", "README.tr.md"];

describe("README diagrams", () => {
  for (const file of files) {
    it(`parses every Mermaid block in ${file}`, async () => {
      const blocks = [...readFileSync(file, "utf8").matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1]);
      expect(blocks.length).toBeGreaterThanOrEqual(10);
      for (const [index, block] of blocks.entries()) {
        await expect(mermaid.parse(block), `${file} block ${index + 1}`).resolves.toBeTruthy();
      }
    });
  }
});
