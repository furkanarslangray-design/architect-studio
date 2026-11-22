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
import { buildPackage, type PackageResult } from "../../packager/src";
import { runPipeline } from "./pipeline";

const MAX_BODY_BYTES = 256 * 1024;
export const APP_VERSION = "0.2.0";

type BuiltPackage = PackageResult & { state: ArchState };

export function createServer(options: { rateLimitPerMinute?: number } = {}) {
  const rateLimit = options.rateLimitPerMinute ?? Number(process.env.RATE_LIMIT_PER_MIN ?? 120);
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return createHttpServer(async (request, response) => {
    try {
      applySecurityHeaders(response);

      if (request.method === "GET" && request.url === "/api/health") {
        sendJson(response, 200, { ok: true, version: APP_VERSION });
        return;
      }

      if (request.method === "GET" && request.url === "/api/version") {
        sendJson(response, 200, { name: "architect-studio", version: APP_VERSION, tokenizer: TOKENIZER_ID });
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

      if (request.method === "POST" && (request.url === "/api/generate" || request.url === "/api/preview")) {
        enforceRateLimit(buckets, rateLimit, clientKey(request));
        const body = await readJsonBody(request);
        const taskOptions = readTaskOptions(body);
        const result = await buildFromBody(body, taskOptions);

        if (request.url === "/api/preview") {
          sendJson(response, 200, previewPayload(result));
          return;
        }

        const passed = result.metrics.filter((metric) => metric.pass).length;
        const taskCount = Object.keys(result.files).filter((path) => path.startsWith("tasks/")).length;
        response.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="agent-package.zip"',
          "Content-Length": String(result.zip.length),
          "Cache-Control": "no-store",
          "X-Metrics-Passed": `${passed}/${result.metrics.length}`,
          "X-Task-Count": String(taskCount),
          "X-Validation": result.validation.ok ? "ok" : "failed",
          "X-Entities": String(result.state.entities.length),
          "X-Tokenizer": TOKENIZER_ID,
        });
        response.end(result.zip);
        return;
      }

      sendJson(response, 404, { error: "Not found", code: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: message, code: error.code }, error.headers);
        return;
      }
      const status = /^Invalid architecture state|^Unsupported/.test(message)
        ? 400
        : /^LLM /.test(message)
          ? 502
          : 500;
      sendJson(response, status, { error: message });
    }
  });
}

export function startServer(port = Number(process.env.PORT ?? 3000)): void {
  const server = createServer();
  server.listen(port, () => {
    console.log(`AI Principal Architect running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

async function buildFromBody(body: Record<string, unknown>, taskOptions: TaskBuildOptions): Promise<BuiltPackage> {
  if (body.state !== undefined) {
    const parsed = safeParseState(body.state);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(
        400,
        `Invalid architecture state payload: ${issue ? `${issue.path.join(".") || "root"}: ${issue.message}` : "schema error"}`,
        "invalid_state",
      );
    }
    const result = await buildPackage(parsed.data, { taskOptions });
    return { state: parsed.data, ...result };
  }

  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (idea.length < 3) {
    throw new HttpError(400, "Fikrini en az 3 karakterle yaz.", "invalid_idea");
  }

  const result = await runPipeline(idea, {
    demo: body.demo === true,
    apiKey: typeof body.apiKey === "string" && body.apiKey.length > 0 ? body.apiKey : undefined,
    baseUrl: typeof body.baseUrl === "string" && body.baseUrl.length > 0 ? body.baseUrl : undefined,
    model: typeof body.model === "string" && body.model.length > 0 ? body.model : undefined,
    taskOptions,
  });
  return result;
}

function previewPayload(result: BuiltPackage) {
  return {
    state: result.state,
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
    throw new HttpError(400, `packageManager must be one of ${PACKAGE_MANAGERS.join(", ")}`, "invalid_package_manager");
  }
  if (testRunner !== undefined && !TEST_RUNNERS.includes(testRunner as TestRunner)) {
    throw new HttpError(400, `testRunner must be one of ${TEST_RUNNERS.join(", ")}`, "invalid_test_runner");
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
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large", "payload_too_large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new HttpError(400, "Invalid JSON body", "invalid_json");
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
    throw new HttpError(429, "Too many requests. Try again shortly.", "rate_limited", {
      "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
    });
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}
