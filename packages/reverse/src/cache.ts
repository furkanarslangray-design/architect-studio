import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Content-hash cache for reverse engineering.
 *
 * A cache key is the SHA-256 of the file inventory (relative path, size,
 * mtime) plus the content of every file small enough to influence the result,
 * plus the options that change the output. A run that does not change any input
 * therefore reuses the previous `ReverseResult` without re-parsing manifests,
 * re-running validators or spawning `rea`.
 *
 * Entries are stored one JSON file per key, written atomically (tmp + rename)
 * so an interrupted run cannot leave a half-written entry behind.
 */

export const REVERSE_CACHE_VERSION = 1;
/** Files larger than this contribute metadata only (they are usually binaries). */
export const CACHE_CONTENT_FILE_LIMIT = 64 * 1024;
/** Upper bound on bytes hashed per run; beyond it the inventory is metadata only. */
export const CACHE_CONTENT_BUDGET_BYTES = 8 * 1024 * 1024;
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface FingerprintEntry {
  relativePath: string;
  size: number;
  mtimeMs: number;
  /** Present when the file content was hashed. */
  digest?: string;
}

export interface CacheKeyOptions {
  useRea?: boolean;
  maxFiles?: number;
  maxDepth?: number;
  ignore?: string[];
  /** Identifies the analysis implementation; bump on output-shape changes. */
  version?: number;
}

export interface CacheEntry<T> {
  version: number;
  key: string;
  createdAt: string;
  result: T;
}

export function reverseCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.ARCHITECT_CACHE_DIR?.trim();
  return base && base.length > 0
    ? join(resolve(base), "reverse")
    : join(process.cwd(), ".architect", "cache", "reverse");
}

export function isReverseCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.REVERSE_CACHE?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

/** Hash of the inventory, the relevant contents and the options that shape the result. */
export function fingerprintKey(entries: FingerprintEntry[], options: CacheKeyOptions = {}): string {
  const hash = createHash("sha256");
  hash.update(`v${options.version ?? REVERSE_CACHE_VERSION}\n`);
  hash.update(
    `useRea=${options.useRea === true};maxFiles=${options.maxFiles ?? ""};maxDepth=${
      options.maxDepth ?? ""
    };ignore=${[...(options.ignore ?? [])].sort().join(",")}\n`,
  );
  const sorted = [...entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  for (const entry of sorted) {
    hash.update(`${entry.relativePath}\u0000${entry.size}\u0000${entry.mtimeMs}\u0000${entry.digest ?? "-"}\n`);
  }
  return hash.digest("hex");
}

/**
 * Only inputs the analyzer actually reads need their content hashed; for
 * everything else the inventory metadata (path, size, mtime) is enough, which
 * keeps a warm run to a single stat walk.
 */
export function isContentRelevant(relativePath: string): boolean {
  return (
    /(^|\/)package\.json$/.test(relativePath) ||
    /\.prisma$/.test(relativePath) ||
    /(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/i.test(relativePath) ||
    /(^|\/)(adr|decisions)\/.*\.md$/i.test(relativePath) ||
    /(^|\/)\.env\.example$/.test(relativePath) ||
    /(^|\/)Dockerfile$/i.test(relativePath)
  );
}

/** Reads and hashes up to `CACHE_CONTENT_BUDGET_BYTES` of relevant file content. */
export function digestContents(
  root: string,
  files: Array<{ relativePath: string; path: string; size: number }>,
): FingerprintEntry[] {
  let budget = CACHE_CONTENT_BUDGET_BYTES;
  return files.map((file) => {
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(file.path).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    const base: FingerprintEntry = { relativePath: file.relativePath, size: file.size, mtimeMs };
    if (!isContentRelevant(file.relativePath)) return base;
    if (file.size > CACHE_CONTENT_FILE_LIMIT || file.size > budget) return base;
    try {
      const content = readFileSync(file.path);
      budget -= content.length;
      return { ...base, digest: createHash("sha256").update(content).digest("hex") };
    } catch {
      return base;
    }
  });
}

export function cachePath(dir: string, key: string): string {
  return join(dir, `${key}.json`);
}

export function readCache<T>(
  dir: string,
  key: string,
  options: { ttlMs?: number; now?: number } = {},
): T | undefined {
  const file = cachePath(dir, key);
  if (!existsSync(file)) return undefined;
  try {
    const entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry<T>;
    if (!entry || entry.version !== REVERSE_CACHE_VERSION || entry.key !== key) return undefined;
    const createdAt = Date.parse(entry.createdAt);
    const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    const now = options.now ?? Date.now();
    if (!Number.isFinite(createdAt) || ttlMs > 0 && now - createdAt > ttlMs) return undefined;
    return entry.result;
  } catch {
    // A corrupt entry is ignored (and overwritten by the next write).
    return undefined;
  }
}

export function writeCache<T>(dir: string, key: string, result: T, now = Date.now()): string {
  mkdirSync(dir, { recursive: true });
  const file = cachePath(dir, key);
  const entry: CacheEntry<T> = {
    version: REVERSE_CACHE_VERSION,
    key,
    createdAt: new Date(now).toISOString(),
    result,
  };
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(entry)}\n`);
  try {
    renameSync(temporary, file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
  return file;
}
