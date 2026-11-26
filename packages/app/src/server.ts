import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safeParseState, type ArchState } from "../../core/src/state";
import {
  PACKAGE_MANAGERS,
  TEST_RUNNERS,
  type PackageManager,
  type TaskBuildOptions,
  type TestRunner,
} from "../../core/src/task-packet";
import { TOKENIZER_ID } from "../../core/src/tokenizer";
import {
  DEFAULT_LOCALE,
  localeNames,
  messagesFor,
  normalizeLocale,
  t,
  type Locale,
  type MessageKey,
} from "../../core/src/i18n";
import { buildPackage, type PackageResult } from "../../packager/src";
import { generateMermaid } from "../../generators/src";
import { detectRea, repoToState, repoToStateWithRea, summarizeReverse } from "../../reverse/src";
import {
  detectSandboxes,
  isSandboxType,
  resolveSandbox,
  SandboxUnavailableError,
  verifyPackage,
  type SandboxType,
} from "../../sandbox/src";
import { architectChat } from "./chat";
import { runPipeline, type PipelineOptions, type PipelineResult } from "./pipeline";
import { isSearchProvider, type WebSearchResult } from "./web-search";
import { isLoopbackHost, resolveListenHost } from "./listen-host";
import { parseReverseRoots, resolveReversePath, ReversePathError } from "./reverse-guard";
import { createReverseQueue, ReverseQueueError } from "./reverse-queue";

const MAX_BODY_BYTES = 256 * 1024;
export const APP_VERSION = "2.1.0";

type BuiltPackage = PackageResult & {
  state: ArchState;
  research?: WebSearchResult;
  searchNote?: string;
};

function researchOf(result: BuiltPackage | PipelineResult) {
  return {
    ...(result.research
      ? {
          research: {
            provider: result.research.provider,
            query: result.research.query,
            results: result.research.results,
          },
        }
      : {}),
    ...(result.searchNote ? { searchNote: result.searchNote } : {}),
  };
}

export interface ServerOptions {
  rateLimitPerMinute?: number;
  /** Absolute directories `/api/reverse` may read. Empty keeps the legacy permissive mode. */
  reverseRoots?: string[];
  reverseConcurrency?: number;
  reverseQueueTimeoutMs?: number;
  reverseTimeoutMs?: number;
  /** Address the server is bound to; non-loopback disables `/api/reverse` without roots. */
  host?: string;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createServer(options: ServerOptions = {}) {
  const rateLimit = options.rateLimitPerMinute ?? Number(process.env.RATE_LIMIT_PER_MIN ?? 120);
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const reverseRoots = options.reverseRoots ?? parseReverseRoots(process.env.REVERSE_ROOTS);
  const reverseQueue = createReverseQueue({
    concurrency: options.reverseConcurrency ?? numberFromEnv(process.env.REVERSE_CONCURRENCY, 2),
    queueTimeoutMs: options.reverseQueueTimeoutMs ?? numberFromEnv(process.env.REVERSE_QUEUE_TIMEOUT_MS, 30_000),
    timeoutMs: options.reverseTimeoutMs ?? numberFromEnv(process.env.REVERSE_TIMEOUT_MS, 120_000),
  });
  const listenHost = options.host ?? resolveListenHost(process.env);
  // An unauthenticated path reader must never be reachable from the network
  // without an allowlist: no roots + a wide bind is a misconfiguration, not a
  // warning.
  const reverseDisabled = !isLoopbackHost(listenHost) && reverseRoots.length === 0;

  return createHttpServer(async (request, response) => {
    let locale = normalizeLocale(request.headers["accept-language"]);
    try {
      applySecurityHeaders(response);

      if (request.method === "GET" && request.url === "/api/health") {
        sendJson(response, 200, { ok: true, version: APP_VERSION });
        return;
      }

      if (request.method === "GET" && request.url === "/api/version") {
        sendJson(response, 200, {
          name: "architect-studio",
          version: APP_VERSION,
          tokenizer: TOKENIZER_ID,
          locales: localeNames(),
        });
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/i18n")) {
        const url = new URL(request.url, "http://localhost");
        const requested = normalizeLocale(url.searchParams.get("locale") ?? undefined, DEFAULT_LOCALE);
        sendJson(response, 200, {
          locale: requested,
          defaultLocale: DEFAULT_LOCALE,
          locales: localeNames(),
          messages: messagesFor(requested),
        });
        return;
      }

      if (request.method === "GET" && request.url === "/api/sandboxes") {
        const sandboxes = await detectSandboxes();
        sendJson(response, 200, { sandboxes });
        return;
      }

      if (request.method === "GET" && request.url === "/api/rea") {
        const detection = await detectRea(true);
        sendJson(response, 200, { detection });
        return;
      }

      if (request.method === "GET" && request.url === "/vendor/mermaid.min.js") {
        const source = readFileSync(join(process.cwd(), "node_modules", "mermaid", "dist", "mermaid.min.js"));
        response.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
          "Content-Length": String(source.length),
        });
        response.end(source);
        return;
      }

      if (request.method === "GET" && (request.url === "/app.js" || request.url === "/styles.css")) {
        const file = request.url.slice(1);
        const source = readFileSync(join(process.cwd(), "web", file));
        response.writeHead(200, {
          "Content-Type": file.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/css; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Length": String(source.length),
        });
        response.end(source);
        return;
      }

      if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
        const html = readFileSync(join(process.cwd(), "web", "index.html"), "utf8");
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
        });
        response.end(html);
        return;
      }

      if (request.method === "POST" && request.url === "/api/reverse") {
        enforceRateLimit(buckets, rateLimit, clientKey(request));
        const body = await readJsonBody(request);
        const pathValue = typeof body.path === "string" ? body.path.trim() : "";
        if (!pathValue) {
          throw new HttpError(400, { key: "error.invalidPath", vars: { path: "" }, code: "invalid_path" });
        }
        if (reverseDisabled) {
          throw new HttpError(403, {
            key: "error.reverseFailed",
            vars: {
              detail: `REVERSE_ROOTS must be set when the server is not bound to loopback (HOST=${listenHost})`,
            },
            code: "reverse_disabled",
          });
        }

        let target: string;
        try {
          target = resolveReversePath(pathValue, reverseRoots);
        } catch (error) {
          if (error instanceof ReversePathError && error.code === "path_not_allowed") {
            throw new HttpError(400, {
              key: "error.reverseFailed",
              vars: { detail: `${error.message} (see REVERSE_ROOTS)` },
              code: "path_not_allowed",
            });
          }
          throw new HttpError(400, {
            key: "error.invalidPath",
            vars: { path: pathValue },
            code: "invalid_path",
          });
        }

        try {
          const reverseOptions = {
            maxFiles: typeof body.maxFiles === "number" ? body.maxFiles : undefined,
            maxDepth: typeof body.maxDepth === "number" ? body.maxDepth : undefined,
            ...(reverseQueue.timeoutMs > 0 ? { rea: { timeoutMs: reverseQueue.timeoutMs } } : {}),
          };
          const result = await reverseQueue.run(async () =>
            body.useRea === true
              ? await repoToStateWithRea(target, reverseOptions)
              : repoToState(target, reverseOptions),
          );
          sendJson(response, 200, {
            summary: summarizeReverse(result),
            root: result.root,
            state: result.state,
            findings: result.findings,
            warnings: result.warnings,
            scannedFiles: result.scannedFiles,
            ...(result.rea
              ? {
                  rea: {
                    engine: result.rea.engine,
                    detection: result.rea.detection,
                    scannedArtifacts: result.rea.scannedArtifacts,
                    warnings: result.rea.warnings,
                    findings: result.rea.findings,
                  },
                }
              : {}),
          });
        } catch (error) {
          if (error instanceof ReverseQueueError) {
            if (error.code === "reverse_busy") {
              throw new HttpError(429, {
                key: "error.rateLimited",
                code: "reverse_busy",
                headers: { "Retry-After": "1" },
              });
            }
            throw new HttpError(504, {
              key: "error.reverseFailed",
              vars: { detail: error.message },
              code: "reverse_timeout",
            });
          }
          const detail = error instanceof Error ? error.message : "unknown error";
          const key = /does not exist or is not a directory/i.test(detail) ? "error.invalidPath" : "error.reverseFailed";
          throw new HttpError(400, {
            key,
            vars: key === "error.invalidPath" ? { path: pathValue } : { detail },
            code: "invalid_path",
          });
        }
        return;
      }

      if (request.method === "POST" && request.url === "/api/sandbox") {
        enforceRateLimit(buckets, rateLimit, clientKey(request));
        const body = await readJsonBody(request);
        locale = normalizeLocale(typeof body.locale === "string" ? body.locale : request.headers["accept-language"], locale);
        const taskOptions = readTaskOptions(body);
        const result = await buildFromBody(body, { ...taskOptions, locale });
        const requested: SandboxType =
          body.sandbox === undefined ? "auto" : isSandboxType(body.sandbox) ? body.sandbox : "auto";
        if (body.sandbox !== undefined && !isSandboxType(body.sandbox)) {
          throw new HttpError(400, {
            key: "error.sandboxUnavailable",
            vars: { detail: `Unsupported sandbox: ${String(body.sandbox)}` },
            code: "invalid_sandbox",
          });
        }
        try {
          const run = await verifyPackage(result.files, {
            sandbox: requested,
            fallback: body.fallback !== false,
          });
          sendJson(response, 200, { ...run, validation: result.validation });
        } catch (error) {
          if (error instanceof SandboxUnavailableError) throw error;
          throw new HttpError(400, {
            key: "error.sandboxFailed",
            vars: { detail: error instanceof Error ? error.message : "unknown error" },
            code: "sandbox_failed",
          });
        }
        return;
      }

      if (request.method === "POST" && request.url === "/api/chat") {
        enforceRateLimit(buckets, rateLimit, clientKey(request));
        const body = await readJsonBody(request);
        locale = normalizeLocale(
          typeof body.locale === "string" ? body.locale : request.headers["accept-language"],
          locale,
        );
        const parsed = safeParseState(body.state);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const detail = issue ? `${issue.path.join(".") || "root"}: ${issue.message}` : "schema error";
          throw new HttpError(400, { key: "error.invalidState", vars: { detail }, code: "invalid_state" });
        }
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (message.length === 0) {
          throw new HttpError(400, { key: "error.emptyMessage", code: "empty_message" });
        }
        const taskOptions = readTaskOptions(body);
        const chat = await architectChat(parsed.data, message, {
          locale,
          demo: body.demo === true,
          apiKey: typeof body.apiKey === "string" && body.apiKey.length > 0 ? body.apiKey : undefined,
          baseUrl: typeof body.baseUrl === "string" && body.baseUrl.length > 0 ? body.baseUrl : undefined,
          model: typeof body.model === "string" && body.model.length > 0 ? body.model : undefined,
        });
        const built = await buildFromBody({ state: chat.state }, { ...taskOptions, locale });
        sendJson(response, 200, {
          ...previewPayload(built, locale),
          chat: {
            reply: chat.reply,
            changes: chat.changes,
            source: chat.source,
            intent: chat.intent,
            notes: chat.notes,
          },
        });
        return;
      }

      if (request.method === "POST" && (request.url === "/api/generate" || request.url === "/api/preview")) {
        enforceRateLimit(buckets, rateLimit, clientKey(request));
        const body = await readJsonBody(request);
        locale = normalizeLocale(
          typeof body.locale === "string" ? body.locale : request.headers["accept-language"],
          locale,
        );
        const taskOptions = readTaskOptions(body);
        const result = await buildFromBody(body, { ...taskOptions, locale });

        if (request.url === "/api/preview") {
          const sandbox = await describeSandbox(body.sandbox);
          sendJson(response, 200, {
            ...previewPayload(result, locale),
            ...(sandbox ? { sandbox } : {}),
          });
          return;
        }

        const passed = result.metrics.filter((metric) => metric.pass).length;
        const taskCount = Object.keys(result.files).filter((path) => path.startsWith("tasks/")).length;
        response.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="agent-package.zip"',
          "Content-Length": String(result.zip.sizeBytes),
          "Cache-Control": "no-store",
          "X-Metrics-Passed": `${passed}/${result.metrics.length}`,
          "X-Task-Count": String(taskCount),
          "X-Validation": result.validation.ok ? "ok" : "failed",
          "X-Entities": String(result.state.entities.length),
          "X-Tokenizer": TOKENIZER_ID,
          "X-Locale": locale,
        });
        const archive = result.zip.stream();
        archive.on("error", (error) => response.destroy(error));
        archive.pipe(response);
        return;
      }

      throw new HttpError(404, { key: "error.notFound", code: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (error instanceof HttpError) {
        sendJson(
          response,
          error.status,
          { error: error.key ? t(locale, error.key, error.vars) : message, code: error.code },
          error.headers,
        );
        return;
      }
      if (error instanceof SandboxUnavailableError) {
        sendJson(response, 400, {
          error: t(locale, "error.sandboxUnavailable", { detail: message }),
          code: "sandbox_unavailable",
          details: error.details,
        });
        return;
      }
      if (/^Invalid architecture state/.test(message)) {
        sendJson(response, 400, {
          error: t(locale, "error.invalidState", { detail: message.replace(/^Invalid architecture state:?\s*/, "") }),
          code: "invalid_state",
        });
        return;
      }
      if (/^LLM /.test(message)) {
        sendJson(response, 502, {
          error: t(locale, "error.llmFailed", { detail: message }),
          code: "llm_failed",
        });
        return;
      }
      if (/^Unsupported /.test(message)) {
        sendJson(response, 400, { error: message, code: "unsupported_runtime" });
        return;
      }
      sendJson(response, 500, {
        error: t(locale, "error.internal"),
        code: "internal_error",
        detail: process.env.NODE_ENV === "production" ? undefined : message,
      });
    }
  });
}

export function startServer(
  port = Number(process.env.PORT ?? 3000),
  host = resolveListenHost(process.env),
): void {
  const server = createServer({ host });
  const roots = parseReverseRoots(process.env.REVERSE_ROOTS);
  server.listen(port, host, () => {
    console.log(`AI Principal Architect running at http://${host}:${port}`);
    if (!isLoopbackHost(host) && roots.length === 0) {
      console.warn(
        `[architect] HOST=${host} is reachable from the network but REVERSE_ROOTS is unset: ` +
          "/api/reverse is disabled (403 reverse_disabled). Set REVERSE_ROOTS to enable it.",
      );
    }
  });
}

if (require.main === module) {
  startServer();
}

async function buildFromBody(
  body: Record<string, unknown>,
  taskOptions: TaskBuildOptions,
): Promise<BuiltPackage> {
  if (body.state !== undefined) {
    const parsed = safeParseState(body.state);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = issue ? `${issue.path.join(".") || "root"}: ${issue.message}` : "schema error";
      throw new HttpError(400, { key: "error.invalidState", vars: { detail }, code: "invalid_state" });
    }
    const result = await buildPackage(parsed.data, { taskOptions, locale: taskOptions.locale });
    return { state: parsed.data, ...result };
  }

  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (idea.length < 3) {
    throw new HttpError(400, { key: "error.invalidIdea", code: "invalid_idea" });
  }

  const options: PipelineOptions = {
    demo: body.demo === true,
    apiKey: typeof body.apiKey === "string" && body.apiKey.length > 0 ? body.apiKey : undefined,
    baseUrl: typeof body.baseUrl === "string" && body.baseUrl.length > 0 ? body.baseUrl : undefined,
    model: typeof body.model === "string" && body.model.length > 0 ? body.model : undefined,
    taskOptions,
    locale: taskOptions.locale,
    webSearch: body.webSearch === true,
    searchProvider: isSearchProvider(body.searchProvider) ? body.searchProvider : undefined,
    searchApiKey:
      typeof body.searchApiKey === "string" && body.searchApiKey.length > 0 ? body.searchApiKey : undefined,
  };
  return runPipeline(idea, options);
}

async function describeSandbox(requested: unknown) {
  if (requested === undefined) return undefined;
  const type: SandboxType = isSandboxType(requested) ? requested : "auto";
  const resolved = await resolveSandbox(type, { fallback: true });
  return {
    requested: type,
    resolved: resolved.id,
    fallback: resolved.fallback,
    drivers: resolved.details.map((item) => ({
      id: item.id,
      available: item.available,
      isolation: item.isolation,
      version: item.version,
    })),
  };
}

function previewPayload(result: BuiltPackage, locale: Locale) {
  return {
    locale,
    ...researchOf(result),
    state: result.state,
    diagram: generateMermaid(result.state),
    files: result.files,
    summary: {
      nodes: result.state.nodes.length,
      edges: result.state.edges.length,
      entities: result.state.entities.length,
      decisions: result.state.decisions.length,
      tasks: result.packets.length,
      waves: new Set(result.packets.map((packet) => packet.parallelGroup)).size,
      tokenizer: TOKENIZER_ID,
    },
    tasks: result.packets.map((packet) => ({
      id: packet.id,
      title: packet.title,
      dependsOn: packet.dependsOn,
      wave: packet.parallelGroup,
      files: packet.files,
      tokens: packet.tokenCount,
      entities: packet.entities,
    })),
    metrics: result.metrics,
    validation: {
      ok: result.validation.ok,
      passRate: result.validation.passRate,
      unresolvedRefs: result.validation.unresolvedRefs,
      deterministicCoverage: result.validation.deterministicCoverage,
      checksRun: result.validation.checksRun,
      issues: result.validation.issues,
    },
    artifacts: Object.keys(result.files).sort(),
  };
}

function readTaskOptions(body: Record<string, unknown>): TaskBuildOptions {
  const packageManager = body.packageManager;
  const testRunner = body.testRunner;
  if (packageManager !== undefined && !PACKAGE_MANAGERS.includes(packageManager as PackageManager)) {
    throw new HttpError(400, {
      key: "error.invalidPackageManager",
      vars: { values: PACKAGE_MANAGERS.join(", ") },
      code: "invalid_package_manager",
    });
  }
  if (testRunner !== undefined && !TEST_RUNNERS.includes(testRunner as TestRunner)) {
    throw new HttpError(400, {
      key: "error.invalidTestRunner",
      vars: { values: TEST_RUNNERS.join(", ") },
      code: "invalid_test_runner",
    });
  }
  return {
    packageManager: packageManager as PackageManager | undefined,
    testRunner: testRunner as TestRunner | undefined,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, { key: "error.payloadTooLarge", code: "payload_too_large" });
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new HttpError(400, { key: "error.invalidJson", code: "invalid_json" });
  }
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body);
}

function clientKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

function enforceRateLimit(
  buckets: Map<string, { count: number; resetAt: number }>,
  limit: number,
  key: string,
): void {
  if (!Number.isFinite(limit) || limit <= 0) return;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new HttpError(429, {
      key: "error.rateLimited",
      code: "rate_limited",
      headers: { "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))) },
    });
  }
}

interface HttpErrorOptions {
  key?: MessageKey;
  vars?: Record<string, string | number>;
  code?: string;
  headers?: Record<string, string>;
}

class HttpError extends Error {
  readonly key?: MessageKey;
  readonly vars: Record<string, string | number>;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(
    readonly status: number,
    options: HttpErrorOptions = {},
  ) {
    super(options.key ?? "HTTP error");
    this.name = "HttpError";
    this.key = options.key;
    this.vars = options.vars ?? {};
    this.code = options.code ?? "error";
    this.headers = options.headers ?? {};
  }
}
