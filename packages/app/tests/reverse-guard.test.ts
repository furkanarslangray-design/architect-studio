import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isInsideRoots,
  parseReverseRoots,
  resolveReversePath,
  ReversePathError,
} from "../src/reverse-guard";

const base = mkdtempSync(join(tmpdir(), "reverse-guard-"));

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof ReversePathError ? error.code : "unexpected";
  }
}

beforeAll(() => {
  mkdirSync(join(base, "allowed", "nested"), { recursive: true });
  mkdirSync(join(base, "outside"), { recursive: true });
  mkdirSync(join(base, "sibling"), { recursive: true });
  writeFileSync(join(base, "allowed", "package.json"), "{}");
  writeFileSync(join(base, "allowed", "file.txt"), "x");
  // A symlink inside the allowlist that points outside it must not be followed.
  symlinkSync(join(base, "outside"), join(base, "allowed", "escape"));
  symlinkSync(join(base, "allowed", "nested"), join(base, "allowed", "inner-link"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("parseReverseRoots", () => {
  it("splits on the platform delimiter, resolves and de-duplicates", () => {
    const raw = [`${base}/allowed`, ` ${base}/outside `, `${base}/allowed`, ""].join(delimiter);
    expect(parseReverseRoots(raw)).toEqual([
      realpathSync(join(base, "allowed")),
      realpathSync(join(base, "outside")),
    ]);
  });

  it("treats an empty value as no allowlist", () => {
    expect(parseReverseRoots(undefined)).toEqual([]);
    expect(parseReverseRoots("")).toEqual([]);
    expect(parseReverseRoots("   ")).toEqual([]);
  });
});

describe("isInsideRoots", () => {
  it("matches the root itself and its children only", () => {
    expect(isInsideRoots("/srv/app", ["/srv/app"])).toBe(true);
    expect(isInsideRoots(`/srv/app${sep}packages`, ["/srv/app"])).toBe(true);
    // A sibling sharing the prefix must not match.
    expect(isInsideRoots("/srv/application", ["/srv/app"])).toBe(false);
    expect(isInsideRoots("/etc", ["/srv/app"])).toBe(false);
  });

  it("is permissive when no roots are configured", () => {
    expect(isInsideRoots("/etc", [])).toBe(true);
  });
});

describe("resolveReversePath", () => {
  const roots = [join(base, "allowed")];

  it("returns the canonical directory inside the allowlist", () => {
    expect(resolveReversePath(join(base, "allowed", "nested"), roots)).toBe(
      realpathSync(join(base, "allowed", "nested")),
    );
  });

  it("resolves relative paths against the working directory", () => {
    expect(resolveReversePath("nested", roots, join(base, "allowed"))).toBe(
      realpathSync(join(base, "allowed", "nested")),
    );
  });

  it("follows a symlink that stays inside the allowlist", () => {
    expect(resolveReversePath(join(base, "allowed", "inner-link"), roots)).toBe(
      realpathSync(join(base, "allowed", "nested")),
    );
  });

  it("rejects a directory outside the allowlist", () => {
    expect(codeOf(() => resolveReversePath(join(base, "outside"), roots))).toBe("path_not_allowed");
  });

  it("rejects a symlink that escapes the allowlist", () => {
    expect(codeOf(() => resolveReversePath(join(base, "allowed", "escape"), roots))).toBe(
      "path_not_allowed",
    );
  });

  it("rejects traversal with .. after resolving it", () => {
    const traversal = join(base, "allowed", "..", "outside");
    expect(codeOf(() => resolveReversePath(traversal, roots))).toBe("path_not_allowed");
    const deep = join(base, "allowed", "nested", "..", "..", "sibling");
    expect(codeOf(() => resolveReversePath(deep, roots))).toBe("path_not_allowed");
  });

  it("rejects missing paths and files", () => {
    expect(codeOf(() => resolveReversePath(join(base, "allowed", "missing"), roots))).toBe("invalid_path");
    expect(codeOf(() => resolveReversePath(join(base, "allowed", "file.txt"), roots))).toBe("invalid_path");
  });

  it("rejects an empty path", () => {
    expect(codeOf(() => resolveReversePath("   ", roots))).toBe("invalid_path");
  });

  it("still canonicalises when no allowlist is configured", () => {
    expect(resolveReversePath(join(base, "outside"))).toBe(realpathSync(join(base, "outside")));
  });
});
