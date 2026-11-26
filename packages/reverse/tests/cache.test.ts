import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cachePath,
  digestContents,
  fingerprintKey,
  isContentRelevant,
  isReverseCacheEnabled,
  readCache,
  reverseCacheDir,
  REVERSE_CACHE_VERSION,
  writeCache,
} from "../src/cache";

let root: string;
let cacheDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "reverse-cache-"));
  cacheDir = join(root, "cache");
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "app", "package.json"), JSON.stringify({ name: "app", dependencies: { express: "^4" } }));
  writeFileSync(join(root, "app", "index.ts"), "export const x = 1;\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const files = () => [
  { relativePath: "app/package.json", path: join(root, "app", "package.json"), size: 55 },
  { relativePath: "app/index.ts", path: join(root, "app", "index.ts"), size: 20 },
];

describe("fingerprintKey", () => {
  it("is stable for identical inputs and independent of entry order", () => {
    const entries = digestContents(root, files());
    expect(fingerprintKey(entries)).toBe(fingerprintKey([...entries].reverse()));
  });

  it("changes when the content of a relevant file changes", () => {
    const before = fingerprintKey(digestContents(root, files()));
    writeFileSync(join(root, "app", "package.json"), JSON.stringify({ name: "app", dependencies: { fastify: "^4" } }));
    const after = fingerprintKey(digestContents(root, files()));
    expect(after).not.toBe(before);
  });

  it("changes when only the metadata of an irrelevant file changes", () => {
    const before = digestContents(root, files());
    const touched = before.map((entry) => ({ ...entry, mtimeMs: entry.mtimeMs + 1000 }));
    expect(fingerprintKey(touched)).not.toBe(fingerprintKey(before));
  });

  it("keys on the resolved root so identical trees in different checkouts differ", () => {
    const twin = mkdtempSync(join(tmpdir(), "reverse-cache-twin-"));
    mkdirSync(join(twin, "app"), { recursive: true });
    writeFileSync(join(twin, "app", "package.json"), readFileSync(join(root, "app", "package.json")));
    writeFileSync(join(twin, "app", "index.ts"), readFileSync(join(root, "app", "index.ts")));

    const twinFiles = [
      { relativePath: "app/package.json", path: join(twin, "app", "package.json"), size: 55 },
      { relativePath: "app/index.ts", path: join(twin, "app", "index.ts"), size: 20 },
    ];

    const here = fingerprintKey(digestContents(root, files()), { root });
    const there = fingerprintKey(digestContents(twin, twinFiles), { root: twin });
    expect(there).not.toBe(here);
    // Same root, same inputs → same key.
    expect(fingerprintKey(digestContents(root, files()), { root })).toBe(here);

    rmSync(twin, { recursive: true, force: true });
  });

  it("changes with the options that shape the result", () => {
    const entries = digestContents(root, files());
    const base = fingerprintKey(entries, { useRea: false, maxFiles: 2500 });
    expect(fingerprintKey(entries, { useRea: true, maxFiles: 2500 })).not.toBe(base);
    expect(fingerprintKey(entries, { useRea: false, maxFiles: 10 })).not.toBe(base);
    expect(fingerprintKey(entries, { useRea: false, maxFiles: 2500, ignore: ["x"] })).not.toBe(base);
  });

  it("hashes content only for files the analyzer reads", () => {
    expect(isContentRelevant("package.json")).toBe(true);
    expect(isContentRelevant("prisma/schema.prisma")).toBe(true);
    expect(isContentRelevant("docker-compose.yml")).toBe(true);
    expect(isContentRelevant("docs/adr/001-db.md")).toBe(true);
    expect(isContentRelevant(".env.example")).toBe(true);
    expect(isContentRelevant("Dockerfile")).toBe(true);
    expect(isContentRelevant("src/app/page.tsx")).toBe(false);

    const entries = digestContents(root, files());
    expect(entries.find((entry) => entry.relativePath === "app/package.json")?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(entries.find((entry) => entry.relativePath === "app/index.ts")?.digest).toBeUndefined();
  });
});

describe("cache entries", () => {
  it("ignores an entry written for a different root", () => {
    const entries = digestContents(root, files());
    const here = fingerprintKey(entries, { root });
    writeCache(cacheDir, here, { summary: "ok" });
    expect(readCache(cacheDir, fingerprintKey(entries, { root: join(root, "elsewhere") }))).toBeUndefined();
    expect(readCache(cacheDir, here)).toEqual({ summary: "ok" });
  });

  it("round-trips a result", () => {
    const key = fingerprintKey(digestContents(root, files()));
    writeCache(cacheDir, key, { summary: "ok" }, 1_700_000_000_000);
    expect(readCache<{ summary: string }>(cacheDir, key, { now: 1_700_000_000_000 })).toEqual({ summary: "ok" });
  });

  it("ignores entries past their TTL", () => {
    const key = fingerprintKey(digestContents(root, files()));
    writeCache(cacheDir, key, { summary: "ok" }, 1_000);
    expect(readCache(cacheDir, key, { ttlMs: 50, now: 2_000 })).toBeUndefined();
  });

  it("ignores corrupt or foreign entries", () => {
    const key = fingerprintKey(digestContents(root, files()));
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath(cacheDir, key), "{not json");
    expect(readCache(cacheDir, key)).toBeUndefined();

    writeCache(cacheDir, key, { summary: "ok" });
    const stored = JSON.parse(readFileSync(cachePath(cacheDir, key), "utf8"));
    writeFileSync(cachePath(cacheDir, key), JSON.stringify({ ...stored, version: REVERSE_CACHE_VERSION + 1 }));
    expect(readCache(cacheDir, key)).toBeUndefined();
  });

  it("honours ARCHITECT_CACHE_DIR and REVERSE_CACHE", () => {
    expect(reverseCacheDir({ ARCHITECT_CACHE_DIR: "/tmp/cache-root" })).toBe(join("/tmp/cache-root", "reverse"));
    expect(reverseCacheDir({})).toContain(join(".architect", "cache", "reverse"));
    expect(isReverseCacheEnabled({})).toBe(true);
    expect(isReverseCacheEnabled({ REVERSE_CACHE: "0" })).toBe(false);
    expect(isReverseCacheEnabled({ REVERSE_CACHE: "off" })).toBe(false);
  });
});
