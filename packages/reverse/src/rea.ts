import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * REA (Reverse Engineer Anything) bridge.
 *
 * The module speaks two dialects:
 *
 * 1. `rea` / `rea-agents` CLI — when the tool is installed it is executed and
 *    its findings are normalised into the evidence based shape below.
 * 2. Built-in static analysis — when the CLI is missing (or fails) artifacts,
 *    binaries, Electron bundles and minified JavaScript bundles are analysed
 *    locally, producing findings in exactly the same shape so downstream code
 *    never needs to know which engine ran.
 */

export type ReaCategory =
  | "runtime"
  | "framework"
  | "datastore"
  | "messaging"
  | "integration"
  | "artifact"
  | "package"
  | "secret"
  | "architecture";

export interface ReaEvidence {
  /** Where the evidence came from, for example `package.json` or `app.asar`. */
  source: string;
  path?: string;
  line?: number;
  snippet?: string;
}

export interface ReaFinding {
  id: string;
  category: ReaCategory;
  title: string;
  detail: string;
  confidence: number;
  evidence: ReaEvidence[];
}

export interface ReaDetection {
  available: boolean;
  engine: "rea" | "rea-agents" | "static";
  binary?: string;
  version?: string;
  reason?: string;
  /** Analysis modes the installed CLI advertises, best effort. */
  modes: string[];
}

export interface ReaOptions {
  maxFiles?: number;
  maxDepth?: number;
  ignore?: string[];
  /** Skip the CLI entirely and use the built-in analyzer. */
  staticOnly?: boolean;
  /** Maximum bytes read from any single artifact (default 256 KiB). */
  maxArtifactBytes?: number;
  timeoutMs?: number;
}

export interface ReaAnalysis {
  root: string;
  engine: ReaDetection["engine"];
  detection: ReaDetection;
  findings: ReaFinding[];
  warnings: string[];
  scannedArtifacts: number;
}

const REA_BINARIES = ["rea", "rea-agents"] as const;

const ARTIFACT_EXTENSIONS = new Set([
  ".asar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".jar",
  ".apk",
  ".dmg",
  ".appimage",
  ".node",
  ".pak",
]);

const BUNDLE_HINTS = [/bundle/i, /\.min\.js$/i, /^main\.[a-f0-9]{6,}\.js$/i, /^app\.[a-f0-9]{6,}\.js$/i, /^index\.[a-f0-9]{6,}\.js$/i];

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  "target",
  ".idea",
  ".vscode",
]);

const MAX_FILE_BYTES = 16 * 1024 * 1024;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function findBinary(binary: string): string | undefined {
  if (binary.includes(sep) || isAbsolute(binary)) return isExecutable(binary) ? binary : undefined;
  const path = process.env.PATH ?? "";
  for (const entry of path.split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, binary);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_OUTPUT_BYTES = 512 * 1024;

function exec(file: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: { PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "C", HOME: process.env.HOME ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (current: string, chunk: Buffer) => {
      if (current.length >= MAX_OUTPUT_BYTES) return current;
      const next = current + chunk.toString("utf8");
      return next.length > MAX_OUTPUT_BYTES ? next.slice(0, MAX_OUTPUT_BYTES) : next;
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    };
    child.on("error", (error) => {
      stderr = `${stderr}${stderr ? "\n" : ""}${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGKILL");
        setTimeout(() => finish(null), 1500).unref?.();
      },
      options.timeoutMs ?? 60_000,
    );
    timer.unref?.();
  });
}

let detectionCache: Promise<ReaDetection> | undefined;

/** Detects a REA CLI on PATH. Results are cached; pass `force` to re-probe. */
export function detectRea(force = false): Promise<ReaDetection> {
  if (!detectionCache || force) {
    detectionCache = (async (): Promise<ReaDetection> => {
      // `ARCHITECT_REA_BIN` lets an operator point at a specific checkout of
      // morluto/rea (or a wrapper) before `rea` lands on PATH.
      const candidates: Array<{ name: (typeof REA_BINARIES)[number]; binary: string }> = [];
      const override = process.env.ARCHITECT_REA_BIN;
      if (override) {
        const resolved = findBinary(override);
        if (resolved) candidates.push({ name: "rea", binary: resolved });
      }
      for (const name of REA_BINARIES) {
        const binary = findBinary(name);
        if (binary && !candidates.some((candidate) => candidate.binary === binary)) {
          candidates.push({ name, binary });
        }
      }
      for (const candidate of candidates) {
        const probe = await exec(candidate.binary, ["--version"], { timeoutMs: 10_000 });
        if (probe.code === 0) {
          const version = (probe.stdout || probe.stderr).split("\n")[0]?.trim().slice(0, 120);
          const help = await exec(candidate.binary, ["--help"], { timeoutMs: 10_000 });
          const modes = [
            "analyze-javascript-application",
            "analyze",
            "inspect",
            "decompile",
            "function",
          ].filter((mode) => new RegExp(mode, "i").test(`${help.stdout}${help.stderr}`));
          return { available: true, engine: candidate.name, binary: candidate.binary, version, modes };
        }
      }
      return {
        available: false,
        engine: "static",
        ...(candidates[0] ? { binary: candidates[0].binary, reason: `${candidates[0].name} is present but did not report a version` } : { reason: "rea / rea-agents is not installed" }),
        modes: [],
      };
    })();
  }
  return detectionCache;
}

interface ScanEntry {
  path: string;
  relativePath: string;
  size: number;
}

function scanArtifacts(root: string, options: ReaOptions): ScanEntry[] {
  const entries: ScanEntry[] = [];
  const maxFiles = options.maxFiles ?? 20000;
  const maxDepth = options.maxDepth ?? 10;
  const ignored = new Set([...IGNORED_DIRECTORIES, ...(options.ignore ?? [])]);
  const walk = (directory: string, depth: number) => {
    if (entries.length >= maxFiles || depth > maxDepth) return;
    let listing;
    try {
      listing = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = statSync(fullPath).size;
      } catch {
        continue;
      }
      if (size > MAX_FILE_BYTES) continue;
      entries.push({
        path: fullPath,
        relativePath: relative(root, fullPath).split(sep).join("/"),
        size,
      });
    }
  };
  walk(root, 0);
  return entries;
}

let findingSeq = 0;

function finding(
  category: ReaCategory,
  title: string,
  detail: string,
  confidence: number,
  evidence: ReaEvidence[],
): ReaFinding {
  findingSeq += 1;
  return {
    id: `rea-${category}-${findingSeq}`,
    category,
    title,
    detail,
    confidence: Math.max(0, Math.min(1, confidence)),
    evidence,
  };
}

function readSnippet(path: string, length = 96): string | undefined {
  try {
    return readFileSync(path).subarray(0, length).toString("utf8").replace(/\u0000/g, "").trim() || undefined;
  } catch {
    return undefined;
  }
}

function detectBinaryKind(head: Buffer): string | undefined {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x7f454c46) return "ELF executable";
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return "Windows PE executable";
  if (head.length >= 4) {
    const magic = head.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return "Mach-O executable";
    if (magic === 0x0061736d) return "WebAssembly module";
  }
  if (head.length >= 16 && head.subarray(0, 15).toString("latin1") === "SQLite format 3") return "SQLite database";
  return undefined;
}

/** Reads the file map out of an Electron ASAR archive header. */
export function parseAsarHeader(buffer: Buffer): { fileCount: number; names: string[] } | undefined {
  if (buffer.length < 16) return undefined;
  try {
    const headerSize = buffer.readUInt32LE(12);
    if (headerSize === 0 || headerSize > 8 * 1024 * 1024 || 16 + headerSize > buffer.length) return undefined;
    const raw = buffer.subarray(16, 16 + headerSize).toString("utf8").replace(/\u0000+$/g, "");
    const parsed = JSON.parse(raw) as { files?: Record<string, unknown> };
    const names: string[] = [];
    const walk = (node: any, prefix: string) => {
      if (!node || typeof node !== "object") return;
      for (const [name, value] of Object.entries<any>(node.files ?? {})) {
        const full = prefix ? `${prefix}/${name}` : name;
        if (value && typeof value === "object" && value.files) walk(value, full);
        else names.push(full);
      }
    };
    walk(parsed, "");
    return { fileCount: names.length, names: names.slice(0, 50) };
  } catch {
    return undefined;
  }
}

const BUNDLE_SIGNATURES: Array<{ pattern: RegExp; title: string; category: ReaCategory; confidence: number }> = [
  { pattern: /__NEXT_DATA__|__next_f/, title: "Next.js bundle", category: "framework", confidence: 0.85 },
  { pattern: /webpackJsonp|__webpack_require__/, title: "Webpack bundle", category: "framework", confidence: 0.8 },
  { pattern: /vite\/client|__vite__/, title: "Vite bundle", category: "framework", confidence: 0.75 },
  { pattern: /react-dom|createRoot\(/, title: "React application", category: "framework", confidence: 0.75 },
  { pattern: /__VUE__|createApp\(/, title: "Vue application", category: "framework", confidence: 0.7 },
  { pattern: /svelte/, title: "Svelte application", category: "framework", confidence: 0.6 },
  { pattern: /firebase(?:app|io)?\.com|firebaseConfig/, title: "Firebase backend", category: "integration", confidence: 0.7 },
  { pattern: /stripe\.com\/v1|js\.stripe\.com/, title: "Stripe payments", category: "integration", confidence: 0.8 },
  { pattern: /supabase\.co/, title: "Supabase backend", category: "integration", confidence: 0.7 },
  { pattern: /graphql/i, title: "GraphQL API", category: "architecture", confidence: 0.55 },
  { pattern: /socket\.io|WebSocket\(/, title: "Realtime WebSocket transport", category: "messaging", confidence: 0.6 },
];

const DATABASE_HOSTS: Array<{ pattern: RegExp; title: string }> = [
  { pattern: /postgres|:5432/, title: "PostgreSQL" },
  { pattern: /mysql|:3306/, title: "MySQL" },
  { pattern: /mongo|:27017/, title: "MongoDB" },
  { pattern: /redis|:6379/, title: "Redis" },
  { pattern: /kafka|:9092/, title: "Kafka" },
  { pattern: /rabbitmq|amqp/, title: "RabbitMQ" },
];

/** Built-in evidence based static analysis used when the REA CLI is missing. */
export function staticReaAnalysis(root: string, options: ReaOptions = {}): ReaAnalysis {
  const resolvedRoot = resolve(root);
  const findings: ReaFinding[] = [];
  const warnings: string[] = [];
  const maxArtifactBytes = options.maxArtifactBytes ?? 256 * 1024;
  const entries = scanArtifacts(resolvedRoot, options);
  let scannedArtifacts = 0;

  const note = (file: string, extra: Partial<ReaEvidence> = {}): ReaEvidence => ({
    source: "static-analysis",
    path: file,
    ...extra,
  });

  for (const entry of entries) {
    if (entry.size < 1024) continue;
    const extension = extname(entry.relativePath).toLowerCase();
    const looksLikeBundle = extension === ".js" || extension === ".mjs" || extension === ".cjs";
    const isArtifact = ARTIFACT_EXTENSIONS.has(extension);
    if (!isArtifact && !(looksLikeBundle && entry.size > 150 * 1024)) continue;

    let buffer: Buffer;
    try {
      const handle = readFileSync(entry.path);
      buffer = handle.subarray(0, Math.min(handle.length, maxArtifactBytes));
    } catch {
      warnings.push(`Could not read ${entry.relativePath}`);
      continue;
    }
    scannedArtifacts += 1;

    if (extension === ".asar") {
      const header = parseAsarHeader(buffer);
      if (header) {
        findings.push(
          finding(
            "artifact",
            "Electron ASAR archive",
            `${entry.relativePath} contains ${header.fileCount} packaged files.`,
            0.9,
            [note(entry.relativePath, { snippet: header.names.slice(0, 5).join(", ") })],
          ),
        );
        const names = header.names.join(" ");
        if (/main\.js|preload\.js|renderer/i.test(names)) {
          findings.push(
            finding("runtime", "Electron desktop runtime", "Packaged Electron main/preload scripts detected.", 0.8, [
              note(entry.relativePath),
            ]),
          );
        }
        const dependencyHints = header.names.filter((name) => /package\.json$/.test(name));
        if (dependencyHints.length > 0) {
          findings.push(
            finding("package", "Bundled dependency manifests", `Found ${dependencyHints.length} package.json files inside the archive.`, 0.6, [
              note(entry.relativePath, { snippet: dependencyHints.slice(0, 3).join(", ") }),
            ]),
          );
        }
        continue;
      }
    }

    const kind = detectBinaryKind(buffer);
    if (kind) {
      const category: ReaCategory = kind === "SQLite database" ? "datastore" : "artifact";
      findings.push(
        finding(category, kind, `${entry.relativePath} is a ${kind} (${(entry.size / 1024).toFixed(0)} KiB).`, 0.85, [
          note(entry.relativePath, { snippet: buffer.subarray(0, 8).toString("hex") }),
        ]),
      );
      if (kind === "ELF executable" || kind === "Windows PE executable" || kind === "Mach-O executable") {
        findings.push(
          finding("artifact", "Native binary", `${entry.relativePath} can be inspected for embedded endpoints and strings.`, 0.7, [
            note(entry.relativePath),
          ]),
        );
      }
      continue;
    }

    if (!looksLikeBundle) continue;
    const text = buffer.toString("utf8");
    const matchedTitles = new Set<string>();
    for (const signature of BUNDLE_SIGNATURES) {
      if (!signature.pattern.test(text)) continue;
      matchedTitles.add(signature.title);
      findings.push(
        finding(signature.category, signature.title, `Signature found in ${entry.relativePath}.`, signature.confidence, [
          note(entry.relativePath, { snippet: signature.pattern.source.slice(0, 64) }),
        ]),
      );
    }
    for (const host of DATABASE_HOSTS) {
      if (matchedTitles.has(host.title) || !host.pattern.test(text)) continue;
      findings.push(
        finding("datastore", host.title, `${host.title} connection string referenced by ${entry.relativePath}.`, 0.6, [
          note(entry.relativePath),
        ]),
      );
    }
    const endpoints = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)(?::\d+)?/gi)]
      .map((match) => match[1].toLowerCase())
      .filter((host) => !/localhost|127\.0\.0\.1|example\.com|w3\.org|schema|github\.com|npmjs/.test(host));
    const uniqueEndpoints = [...new Set(endpoints)].slice(0, 8);
    for (const host of uniqueEndpoints) {
      findings.push(
        finding("integration", `External endpoint ${host}`, `Referenced from the client bundle ${entry.relativePath}.`, 0.5, [
          note(entry.relativePath, { snippet: host }),
        ]),
      );
    }
  }

  // Environment templates describe integrations without leaking secret values.
  for (const entry of entries) {
    if (!/(^|\/)(\.env\.example|\.env\.sample|\.env\.template|env\.example)$/i.test(entry.relativePath)) continue;
    let content = "";
    try {
      content = readFileSync(entry.path, "utf8");
    } catch {
      continue;
    }
    const keys = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.split("=")[0].trim());
    if (keys.length === 0) continue;
    findings.push(
      finding(
        "secret",
        "Environment contract",
        `${entry.relativePath} documents ${keys.length} configuration variables.`,
        0.75,
        [note(entry.relativePath, { snippet: keys.slice(0, 12).join(", ") })],
      ),
    );
    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (/stripe/.test(normalized)) {
        findings.push(finding("integration", "Stripe payments", `${key} configures Stripe.`, 0.8, [note(entry.relativePath, { snippet: key })]));
      } else if (/(openai|anthropic|gemini|llm)/.test(normalized)) {
        findings.push(finding("integration", "AI provider", `${key} configures an AI provider.`, 0.75, [note(entry.relativePath, { snippet: key })]));
      } else if (/(smtp|sendgrid|mailgun|resend|ses_)/.test(normalized)) {
        findings.push(finding("integration", "Transactional email", `${key} configures email delivery.`, 0.7, [note(entry.relativePath, { snippet: key })]));
      } else if (/(aws|s3_|gcs_|azure)/.test(normalized)) {
        findings.push(finding("integration", "Cloud storage", `${key} configures object storage.`, 0.7, [note(entry.relativePath, { snippet: key })]));
      } else if (/(redis|database|postgres|mysql|mongo)/.test(normalized)) {
        findings.push(finding("datastore", "Configured datastore", `${key} configures a datastore connection.`, 0.65, [note(entry.relativePath, { snippet: key })]));
      }
    }
  }

  // Dockerfiles and compose files are part of the artifact surface too.
  for (const entry of entries) {
    if (!/(^|\/)(Dockerfile|Containerfile)$/i.test(entry.relativePath)) continue;
    const snippet = readSnippet(entry.path, 160);
    if (!snippet) continue;
    const base = snippet.match(/FROM\s+([^\s]+)/i)?.[1];
    findings.push(
      finding("runtime", "Container image", `${entry.relativePath} builds${base ? ` from ${base}` : ""}.`, 0.8, [
        note(entry.relativePath, { snippet: base }),
      ]),
    );
  }

  return {
    root: resolvedRoot,
    engine: "static",
    detection: { available: false, engine: "static", reason: "rea / rea-agents is not installed", modes: [] },
    findings: dedupe(findings),
    warnings,
    scannedArtifacts,
  };
}

function dedupe(findings: ReaFinding[]): ReaFinding[] {
  const seen = new Map<string, ReaFinding>();
  for (const item of findings) {
    const key = `${item.category}:${item.title}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }
    for (const evidence of item.evidence) {
      if (existing.evidence.length >= 12) break;
      if (!existing.evidence.some((entry) => entry.path === evidence.path)) existing.evidence.push(evidence);
    }
    existing.confidence = Math.max(existing.confidence, item.confidence);
  }
  return [...seen.values()];
}

const CATEGORY_ALIASES: Record<string, ReaCategory> = {
  runtime: "runtime",
  framework: "framework",
  library: "framework",
  datastore: "datastore",
  database: "datastore",
  storage: "datastore",
  messaging: "messaging",
  queue: "messaging",
  integration: "integration",
  api: "integration",
  artifact: "artifact",
  binary: "artifact",
  package: "package",
  dependency: "package",
  secret: "secret",
  config: "secret",
  architecture: "architecture",
};

function normalizeCategory(value: unknown): ReaCategory {
  if (typeof value !== "string") return "artifact";
  return CATEGORY_ALIASES[value.toLowerCase()] ?? "artifact";
}

function normalizeEvidence(value: unknown): ReaEvidence[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return [{ source: "rea", path: item }];
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const source = typeof record.source === "string" ? record.source : "rea";
        const path = typeof record.path === "string" ? record.path : typeof record.file === "string" ? record.file : undefined;
        const line = typeof record.line === "number" ? record.line : undefined;
        const snippet = typeof record.snippet === "string" ? record.snippet : typeof record.detail === "string" ? record.detail : undefined;
        return [{ source, ...(path ? { path } : {}), ...(line ? { line } : {}), ...(snippet ? { snippet } : {}) }];
      }
      return [];
    });
  }
  if (typeof value === "string") return [{ source: "rea", snippet: value }];
  return [];
}

/**
 * REA's Evidence record is a large, versioned document. When it does not carry
 * a flat `findings` list this projects the parts Architect Studio can consume
 * (modules, Electron boundaries, packages) into findings.
 */
function deriveEvidenceFindings(payload: unknown): ReaFinding[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const envelope =
    record.evidence && typeof record.evidence === "object"
      ? (record.evidence as Record<string, unknown>)
      : record;
  const derived: ReaFinding[] = [];
  const pathOf = (item: unknown): ReaEvidence | undefined => {
    if (typeof item === "string") return { source: "rea", path: item };
    if (item && typeof item === "object") {
      const entry = item as Record<string, unknown>;
      const path = [entry.path, entry.file, entry.id, entry.name].find((value): value is string => typeof value === "string");
      if (path) return { source: "rea", path };
    }
    return undefined;
  };

  const modules = Array.isArray(envelope.modules) ? envelope.modules : [];
  if (modules.length > 0) {
    const evidence = modules.map(pathOf).filter((item): item is ReaEvidence => item !== undefined).slice(0, 8);
    derived.push(
      finding(
        "architecture",
        "Reconstructed JavaScript modules",
        `REA reconstructed ${modules.length} module(s) from the JavaScript application.`,
        0.8,
        evidence,
      ),
    );
  }

  const boundaries = Array.isArray(envelope.boundaries) ? envelope.boundaries : [];
  if (boundaries.length > 0) {
    const evidence = boundaries.map(pathOf).filter((item): item is ReaEvidence => item !== undefined).slice(0, 8);
    derived.push(
      finding(
        "runtime",
        "Electron process boundaries",
        `REA mapped ${boundaries.length} boundary(ies) between the main and renderer processes.`,
        0.75,
        evidence,
      ),
    );
  }

  const packages = Array.isArray(envelope.packages) ? envelope.packages : [];
  if (packages.length > 0) {
    const names = packages
      .map((item) => (typeof item === "string" ? item : (item as Record<string, unknown>)?.name))
      .filter((name): name is string => typeof name === "string");
    derived.push(
      finding(
        "package",
        "Recovered dependencies",
        `REA recovered ${packages.length} package reference(s) from the artifact.`,
        0.7,
        names.slice(0, 8).map((name) => ({ source: "rea", snippet: name })),
      ),
    );
  }

  return derived;
}

/** Normalises whatever JSON shape the REA CLI printed into `ReaFinding`s. */
export function normalizeReaOutput(payload: unknown): ReaFinding[] {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as any).findings)
      ? ((payload as any).findings as unknown[])
      : payload && typeof payload === "object" && Array.isArray((payload as any).results)
        ? ((payload as any).results as unknown[])
        : [];
  const normalized = list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title =
      (typeof record.title === "string" && record.title) ||
      (typeof record.name === "string" && record.name) ||
      (typeof record.kind === "string" && record.kind) ||
      undefined;
    if (!title) return [];
    const detail =
      (typeof record.detail === "string" && record.detail) ||
      (typeof record.description === "string" && record.description) ||
      (typeof record.summary === "string" && record.summary) ||
      title;
    const confidence = typeof record.confidence === "number" ? record.confidence : 0.7;
    return [
      finding(normalizeCategory(record.category ?? record.type ?? record.kind), title, detail, confidence, normalizeEvidence(record.evidence ?? record.evidence_list ?? record.paths)      ),
    ];
  });
  if (normalized.length > 0) return normalized;
  return deriveEvidenceFindings(payload);
}

/**
 * REA commands that accept a filesystem path and print JSON. The JavaScript
 * application workflow is the one that understands Electron app directories and
 * `.asar` archives; `analyze` is the generic entry point from the REA docs.
 */
const REA_COMMAND_VARIANTS: Array<{ command: string; args: (root: string) => string[] }> = [
  { command: "analyze-javascript-application", args: (root) => [root, "--json"] },
  { command: "analyze", args: (root) => [root, "--json"] },
  { command: "analyze", args: (root) => ["--json", root] },
  { command: "inspect", args: (root) => [root, "--json"] },
];

async function runReaCli(root: string, detection: ReaDetection, timeoutMs: number): Promise<{ findings: ReaFinding[]; warnings: string[] }> {
  const binary = detection.binary;
  if (!binary) return { findings: [], warnings: ["REA CLI binary was not resolved"] };
  const warnings: string[] = [];
  for (const variant of REA_COMMAND_VARIANTS) {
    const args = [variant.command, ...variant.args(root)];
    const result = await exec(binary, args, { cwd: root, timeoutMs });
    if (result.timedOut) {
      warnings.push(`REA command "${variant.command}" timed out after ${timeoutMs} ms`);
      continue;
    }
    if (result.code !== 0) {
      const message = (result.stderr || result.stdout).trim().split("\n")[0]?.slice(0, 200);
      if (message) warnings.push(`REA ${variant.command} exited with ${result.code}: ${message}`);
      continue;
    }
    const parsed = parseJsonPayload(result.stdout);
    const findings = parsed === undefined ? [] : normalizeReaOutput(parsed);
    if (findings.length > 0) return { findings, warnings };
  }
  return { findings: [], warnings };
}

function parseJsonPayload(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return undefined;
  const direct = tryParse(text);
  if (direct !== undefined) return direct;
  const start = text.search(/[[{]/);
  if (start === -1) return undefined;
  return tryParse(text.slice(start, Math.max(text.lastIndexOf("}"), text.lastIndexOf("]")) + 1));
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Produces REA findings for a repository: the installed CLI when available,
 * otherwise the built-in static analyzer. Never throws for a missing binary.
 */
export async function analyzeWithRea(root: string, options: ReaOptions = {}): Promise<ReaAnalysis> {
  const resolvedRoot = resolve(root);
  let isDirectory = false;
  try {
    isDirectory = statSync(resolvedRoot).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new Error(`Project path does not exist or is not a directory: ${root}`);

  if (options.staticOnly) {
    const staticResult = staticReaAnalysis(resolvedRoot, options);
    const detection = await detectRea();
    return { ...staticResult, detection };
  }

  const detection = await detectRea();
  if (!detection.available) {
    const staticResult = staticReaAnalysis(resolvedRoot, options);
    return { ...staticResult, detection };
  }

  const cli = await runReaCli(resolvedRoot, detection, options.timeoutMs ?? 60_000);
  const staticResult = staticReaAnalysis(resolvedRoot, options);
  const findings = dedupe([...cli.findings, ...staticResult.findings]);
  if (cli.findings.length === 0) {
    cli.warnings.push("REA CLI produced no findings; built-in static analysis supplied the evidence");
  }
  return {
    root: resolvedRoot,
    engine: detection.engine === "static" ? "static" : detection.engine,
    detection,
    findings,
    warnings: [...cli.warnings, ...staticResult.warnings],
    scannedArtifacts: staticResult.scannedArtifacts,
  };
}

/** Installs an in-process shim so tests can simulate a REA installation. */
export function resetReaDetectionCache(): void {
  detectionCache = undefined;
  findingSeq = 0;
}
