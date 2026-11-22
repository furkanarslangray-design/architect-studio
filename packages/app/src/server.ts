import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "./pipeline";

const MAX_BODY_BYTES = 64 * 1024;

export function createServer() {
  return createHttpServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/api/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
        const html = readFileSync(join(process.cwd(), "web", "index.html"), "utf8");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }

      if (request.method === "POST" && request.url === "/api/generate") {
        const body = await readJsonBody(request);
        const idea = typeof body.idea === "string" ? body.idea.trim() : "";
        if (idea.length < 3) {
          sendJson(response, 400, { error: "Fikrini en az 3 karakterle yaz." });
          return;
        }

        const result = await runPipeline(idea, {
          demo: body.demo === true,
          apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
          baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
        });

        const passed = result.metrics.filter((metric) => metric.pass).length;
        const taskCount = Object.keys(result.files).filter((path) => path.startsWith("tasks/")).length;
        response.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="agent-package.zip"',
          "Content-Length": String(result.zip.length),
          "X-Metrics-Passed": `${passed}/${result.metrics.length}`,
          "X-Task-Count": String(taskCount),
          "X-Validation": result.validation.ok ? "ok" : "failed",
        });
        response.end(result.zip);
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      sendJson(response, 500, { error: message });
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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(body);
}
