import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * `architect init` — wires an existing repository to the MCP server.
 *
 * Writes three things and nothing else:
 *   - `.architect/config.json` (client, MCP command, reverse allowlist, runtime)
 *   - the per-client MCP configuration file(s)
 *   - a marked block inside `AGENTS.md`
 *
 * The command is idempotent: a second run reports every file as unchanged and
 * rewrites nothing. Files it does not own (any file without our marker, any
 * pre-existing JSON) are left alone unless `--force` is passed.
 */

export const INIT_CLIENTS = ["cursor", "claude", "opencode", "freebuff", "all"] as const;
export type InitClient = (typeof INIT_CLIENTS)[number];

export const MCP_SERVER_NAME = "architect-studio";
export const MARKER_START = "<!-- architect:start -->";
export const MARKER_END = "<!-- architect:end -->";

export interface InitOptions {
  /** Target repository (created if missing). Defaults to the working directory. */
  root?: string;
  /** Which client configuration to write. Defaults to `all`. */
  client?: InitClient;
  /** Overwrite files that already exist with different content. */
  force?: boolean;
  /** Checkout that owns `packages/mcp/src/index.ts`; defaults to this package's repo. */
  installDir?: string;
  packageManager?: string;
  testRunner?: string;
}

export interface InitResult {
  root: string;
  client: InitClient;
  /** Files created by this run. */
  written: string[];
  /** Files changed by this run (`--force` or the managed AGENTS.md block). */
  updated: string[];
  /** Files already in the desired state. */
  unchanged: string[];
  /** Files that differ but were left alone because `--force` was not given. */
  skipped: string[];
  /** Actions the tool cannot take for the user. */
  notes: string[];
}

export function isInitClient(value: unknown): value is InitClient {
  return typeof value === "string" && (INIT_CLIENTS as readonly string[]).includes(value);
}

function serverEntry(installDir: string) {
  return {
    command: "node",
    args: ["--import", "tsx", join(installDir, "packages", "mcp", "src", "index.ts")],
    cwd: installDir,
  };
}

interface PlannedFile {
  path: string;
  content: string;
}

function clientFiles(client: Exclude<InitClient, "all">, installDir: string): PlannedFile[] {
  const entry = serverEntry(installDir);
  switch (client) {
    case "cursor":
      return [
        {
          path: join(".cursor", "mcp.json"),
          content: JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: entry } }),
        },
      ];
    case "claude":
      return [{ path: ".mcp.json", content: JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: entry } }) }];
    case "opencode":
      return [
        {
          path: "opencode.json",
          content: JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcp: {
              [MCP_SERVER_NAME]: {
                type: "local",
                command: [entry.command, ...entry.args],
                enabled: true,
              },
            },
          }),
        },
      ];
    case "freebuff":
      return [];
  }
}

function uniqueByPath(files: PlannedFile[]): PlannedFile[] {
  const seen = new Map<string, PlannedFile>();
  for (const file of files) {
    if (!seen.has(file.path)) seen.set(file.path, file);
  }
  return [...seen.values()];
}

/** Stable, review-friendly JSON: two spaces, trailing newline, no key churn. */
function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function agentsBlock(root: string, installDir: string): string {
  return [
    MARKER_START,
    "## Architect Studio",
    "",
    "- MCP server: `pnpm mcp` — tools `architect_generate`, `architect_preview`,",
    "  `architect_validate`, `architect_reverse_engineer`.",
    "- Configuration: `.architect/config.json` (client, MCP command, reverse allowlist).",
    `- Reverse engineering is limited to \`${root}\` (set \`REVERSE_ROOTS\` to widen it).`,
    `- MCP entry point: \`${join(installDir, "packages", "mcp", "src", "index.ts")}\`.`,
    "- Node: 24.22.1 (`.nvmrc`); older runtimes silently downgrade the REA bridge.",
    MARKER_END,
  ].join("\n");
}

function applyFile(
  root: string,
  file: PlannedFile,
  force: boolean,
  result: InitResult,
): void {
  const absolute = join(root, file.path);
  const relative = file.path;
  const content = file.path.endsWith(".json") ? `${file.content.trimEnd()}\n` : file.content;

  if (!existsSync(absolute)) {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    result.written.push(relative);
    return;
  }

  const current = readFileSync(absolute, "utf8");
  if (current === content) {
    result.unchanged.push(relative);
    return;
  }
  if (!force) {
    result.skipped.push(relative);
    return;
  }
  writeFileSync(absolute, content);
  result.updated.push(relative);
}

/** AGENTS.md is co-owned: only the marker block is ours to rewrite. */
function applyAgentsFile(root: string, block: string, result: InitResult): void {
  const absolute = join(root, "AGENTS.md");
  const relative = "AGENTS.md";

  if (!existsSync(absolute)) {
    writeFileSync(absolute, `${block}\n`);
    result.written.push(relative);
    return;
  }

  const current = readFileSync(absolute, "utf8");
  const pattern = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`, "m");
  const next = pattern.test(current)
    ? current.replace(pattern, block)
    : `${current.trimEnd()}\n\n${block}\n`;

  if (next === current) {
    result.unchanged.push(relative);
    return;
  }
  writeFileSync(absolute, next);
  result.updated.push(relative);
}

export function initProject(options: InitOptions = {}): InitResult {
  const client = options.client ?? "all";
  if (!isInitClient(client)) {
    throw new Error(`Unsupported client: ${String(client)}. Use one of ${INIT_CLIENTS.join(", ")}.`);
  }

  const root = resolve(options.root ?? ".");
  if (existsSync(root) && !statSync(root).isDirectory()) {
    throw new Error(`Target is not a directory: ${root}`);
  }
  mkdirSync(root, { recursive: true });

  const installDir = resolve(options.installDir ?? join(__dirname, "..", "..", ".."));
  const packageManager = options.packageManager ?? "pnpm";
  const testRunner = options.testRunner ?? "vitest";

  const result: InitResult = {
    root,
    client,
    written: [],
    updated: [],
    unchanged: [],
    skipped: [],
    notes: [],
  };

  const config = {
    version: 1,
    client,
    mcp: { name: MCP_SERVER_NAME, ...serverEntry(installDir) },
    reverseRoots: [root],
    packageManager,
    testRunner,
  };
  applyFile(root, { path: join(".architect", "config.json"), content: toJson(config).trimEnd() }, options.force === true, result);

  const clients = client === "all" ? (["cursor", "claude", "opencode", "freebuff"] as const) : [client];
  const planned = uniqueByPath(clients.flatMap((entry) => clientFiles(entry, installDir)));
  for (const file of planned) {
    applyFile(root, { path: file.path, content: toJson(JSON.parse(file.content)).trimEnd() }, options.force === true, result);
  }
  if (clients.includes("freebuff")) {
    result.notes.push(
      "Freebuff: add an MCP server manually (Account → MCP) with command `node --import tsx packages/mcp/src/index.ts`.",
    );
  }

  applyAgentsFile(root, agentsBlock(root, installDir), result);
  return result;
}

/** `pnpm architect init [dir] [--client cursor|claude|opencode|freebuff|all] [--force]` */
export function parseInitArgs(argv: string[]): { root?: string; client?: InitClient; force: boolean } {
  const result: { root?: string; client?: InitClient; force: boolean } = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      result.force = true;
      continue;
    }
    if (arg === "--client") {
      const value = argv[++index];
      if (!isInitClient(value)) {
        throw new Error(`Unsupported client: ${String(value)}. Use one of ${INIT_CLIENTS.join(", ")}.`);
      }
      result.client = value;
      continue;
    }
    if (arg.startsWith("--client=")) {
      const value = arg.slice("--client=".length);
      if (!isInitClient(value)) {
        throw new Error(`Unsupported client: ${value}. Use one of ${INIT_CLIENTS.join(", ")}.`);
      }
      result.client = value;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option for init: ${arg}`);
    }
    if (result.root === undefined) {
      result.root = arg;
      continue;
    }
    throw new Error(`Unexpected argument for init: ${arg}`);
  }
  return result;
}

export function formatInitResult(result: InitResult): string {
  const lines = [`architect init → ${result.root} (client: ${result.client})`];
  for (const file of result.written) lines.push(`  + ${file}`);
  for (const file of result.updated) lines.push(`  ~ ${file}`);
  for (const file of result.unchanged) lines.push(`  = ${file} (unchanged)`);
  for (const file of result.skipped) lines.push(`  · ${file} (exists, use --force to overwrite)`);
  for (const note of result.notes) lines.push(`  ! ${note}`);
  if (result.written.length === 0 && result.updated.length === 0) {
    lines.push("Nothing to do: the project is already initialised.");
  }
  return lines.join("\n");
}

export function runInitCommand(argv: string[]): number {
  const result = initProject(parseInitArgs(argv));
  console.log(formatInitResult(result));
  return 0;
}
