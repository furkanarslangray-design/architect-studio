import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const packagesDir = join(root, "packages");

function walk(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const sources = walk(packagesDir).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("module boundaries", () => {
  it("imports workspace packages through their public entry point", () => {
    const deepImports = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/@architect-studio\/[a-z-]+\/[^";]+/g)].map((match) => `${relative(root, path)}: ${match[0]}`),
    );
    expect(deepImports).toEqual([]);
  });

  it("keeps relative imports inside the owning package", () => {
    const crossPackage = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/from "\.\.\/\.\.\/(?:core|generators|packager|validators|reverse|sandbox)\/src/g)].map(
        (match) => `${relative(root, path)}: ${match[0]}`,
      ),
    );
    expect(crossPackage).toEqual([]);
  });

  it("never lets an application reach into type:tooling packages", () => {
    const toolingImports = sources
      .filter(({ path }) => /packages\/(app|mcp)\//.test(path) && !path.endsWith("module-boundaries.test.ts"))
      .flatMap(({ path, text }) =>
        text.includes("@architect-studio/workspace-plugin") ? [relative(root, path)] : [],
      );
    expect(toolingImports).toEqual([]);
  });
});
