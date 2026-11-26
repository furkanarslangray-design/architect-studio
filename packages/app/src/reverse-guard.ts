import { realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve, sep } from "node:path";

/**
 * Path guard for `POST /api/reverse`.
 *
 * The endpoint reads a directory the caller names, so the caller must not be
 * able to walk outside the directories the operator allowed. Both sides of the
 * comparison are canonicalised with `realpath`, which also resolves `..`
 * segments and symbolic links, so a symlink inside an allowed root that points
 * elsewhere is rejected instead of followed.
 */

export type ReversePathCode = "invalid_path" | "path_not_allowed";

export class ReversePathError extends Error {
  constructor(
    readonly code: ReversePathCode,
    message: string,
  ) {
    super(message);
    this.name = "ReversePathError";
  }
}

/** `REVERSE_ROOTS=/srv/app:/home/me/src` → absolute, de-duplicated roots. */
export function parseReverseRoots(value: string | undefined | null): string[] {
  if (!value) return [];
  const roots: string[] = [];
  for (const entry of value.split(delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const absolute = resolve(trimmed);
    if (!roots.includes(absolute)) roots.push(absolute);
  }
  return roots;
}

function canonical(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function within(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(prefix);
}

/** An empty root list keeps the previous permissive behaviour (loopback only). */
export function isInsideRoots(candidate: string, roots: readonly string[]): boolean {
  if (roots.length === 0) return true;
  return roots.some((root) => within(candidate, root));
}

/**
 * Resolves a caller supplied path to a canonical directory, or throws a
 * `ReversePathError`. Never returns a path outside `roots`.
 */
export function resolveReversePath(
  input: string,
  roots: readonly string[] = [],
  cwd = process.cwd(),
): string {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) throw new ReversePathError("invalid_path", "path is empty");

  const absolute = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  // `..` is normalised by resolve(); realpath() then resolves symlinks, so the
  // value compared against the allowlist is the directory that will be read.
  const resolved = canonical(absolute) ?? resolve(absolute);

  let isDirectory = false;
  try {
    isDirectory = statSync(resolved).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new ReversePathError("invalid_path", "path does not exist or is not a directory");
  }

  const allowed = roots.map((root) => canonical(root) ?? resolve(root));
  if (!isInsideRoots(resolved, allowed)) {
    throw new ReversePathError("path_not_allowed", "path is outside the allowed roots");
  }
  return resolved;
}
