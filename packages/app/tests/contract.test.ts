import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeParseState } from "../../core/src/state";
import {
  ENDPOINTS,
  archStateSchema,
  chatResponseSchema,
  errorEnvelopeSchema,
  generateHeadersSchema,
  healthSchema,
  i18nSchema,
  previewResponseSchema,
  reaSchema,
  reverseResponseSchema,
  sandboxResponseSchema,
  sandboxesSchema,
  versionSchema,
} from "../src/contract";
import { createServer } from "../src/server";

let server: Server;
let baseUrl: string;
const fixtures = mkdtempSync(join(tmpdir(), "contract-fixtures-"));

const specPath = join(process.cwd(), "FRONTEND_SPEC.md");

function post(path: string, body: unknown, raw?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

async function expectSchema<T>(response: Response, schema: { parse: (value: unknown) => T }): Promise<T> {
  expect(response.status).toBe(200);
  const payload = await response.json();
  const parsed = schema.parse(payload);
  return parsed;
}

function reverseFixture(): string {
  const root = join(fixtures, "service");
  mkdirSync(join(root, "prisma"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "contract-service", dependencies: { express: "^4.0.0" } }),
  );
  writeFileSync(join(root, "prisma/schema.prisma"), "model Invoice {\n  id String @id\n  amount Decimal\n}\n");
  return root;
}

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  rmSync(fixtures, { recursive: true, force: true });
});

describe("FRONTEND_SPEC.md parity", () => {
  it("documents exactly the endpoints the server ships", () => {
    const spec = readFileSync(specPath, "utf8");
    const start = spec.search(/##\s*4\./);
    const end = spec.search(/##\s*5\./);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = spec.slice(start, end);

    const documented = new Set<string>();
    // Paths may contain `/` (job routes), and `/api/reverse/jobs/{id}` must map
    // to the collection route that ENDPOINTS declares.
    for (const match of section.matchAll(/`(GET|POST)\s+(\/api\/[A-Za-z0-9/-]+)/g)) {
      const path = match[2].replace(/\{[^}]*\}/g, "").replace(/\/+$/, "");
      documented.add(`${match[1]} ${path}`);
    }

    const shipped = new Set(ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    expect([...documented].sort()).toEqual([...shipped].sort());
  });

  it("keeps the new reverse codes in the error table", () => {
    const spec = readFileSync(specPath, "utf8");
    for (const code of ["path_not_allowed", "reverse_busy", "reverse_timeout", "reverse_disabled"]) {
      expect(spec).toContain(`\`${code}\``);
    }
  });
});

describe("GET contract", () => {
  it("health, version, i18n, sandboxes and rea match their schemas", async () => {
    expect(await expectSchema(await fetch(`${baseUrl}/api/health`), healthSchema)).toMatchObject({ ok: true });

    const version = await expectSchema(await fetch(`${baseUrl}/api/version`), versionSchema);
    expect(version.locales).toHaveLength(8);
    expect(version.locales[0]).toHaveProperty("id");
    expect(version.locales[0].label.length).toBeGreaterThan(0);

    const i18n = await expectSchema(await fetch(`${baseUrl}/api/i18n?locale=de`), i18nSchema);
    expect(i18n.locale).toBe("de");
    expect(i18n.messages["ui.preview"]).toBeTruthy();

    const sandboxes = await expectSchema(await fetch(`${baseUrl}/api/sandboxes`), sandboxesSchema);
    expect(sandboxes.sandboxes.map((item) => item.id)).toContain("temp-dir");

    const rea = await expectSchema(await fetch(`${baseUrl}/api/rea`), reaSchema);
    expect(["rea", "rea-agents", "static"]).toContain(rea.detection.engine);
  });
});

describe("POST contract", () => {
  it("preview returns a state that the core schema also accepts", async () => {
    const preview = await expectSchema(
      await post("/api/preview", { idea: "online store with orders and products", demo: true }),
      previewResponseSchema,
    );
    expect(archStateSchema.parse(preview.state)).toBeTruthy();
    expect(safeParseState(preview.state).success).toBe(true);
    expect(preview.summary.entities).toBeGreaterThanOrEqual(1);
    expect(preview.validation.ok).toBe(true);
    expect(preview.artifacts).toContain("openapi.yaml");
    expect(preview.tasks).toHaveLength(preview.summary.nodes);
  });

  it("chat returns the preview envelope plus a chat block", async () => {
    const preview = await expectSchema(
      await post("/api/preview", { idea: "postgres orders api", demo: true }),
      previewResponseSchema,
    );
    const chat = await expectSchema(
      await post("/api/chat", { state: preview.state, message: "Redis cache ekle", demo: true }),
      chatResponseSchema,
    );
    expect(chat.chat.source).toBe("deterministic");
    expect(chat.chat.reply.length).toBeGreaterThan(0);
    expect(chat.chat.changes.length).toBeGreaterThan(0);
    expect(safeParseState(chat.state).success).toBe(true);
  });

  it("generate streams a ZIP and exposes the documented headers", async () => {
    const response = await post("/api/generate", { idea: "postgres orders api", demo: true });
    expect(response.status).toBe(200);
    const headers = generateHeadersSchema.parse(Object.fromEntries(response.headers.entries()));
    expect(Number(headers["x-task-count"])).toBeGreaterThan(0);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // ZIP local file header magic.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it("reverse returns the documented envelope", async () => {
    const reverse = await expectSchema(
      await post("/api/reverse", { path: reverseFixture(), maxFiles: 50, maxDepth: 4 }),
      reverseResponseSchema,
    );
    expect(reverse.scannedFiles).toBeGreaterThan(0);
    expect(safeParseState(reverse.state).success).toBe(true);
    expect(reverse.state.entities[0].name).toBe("Invoice");
  });

  it("sandbox returns a run result plus validation", async () => {
    const run = await expectSchema(
      await post("/api/sandbox", { idea: "postgres orders api", demo: true, sandbox: "temp-dir" }),
      sandboxResponseSchema,
    );
    expect(run.driver).toBe("temp-dir");
    expect(run.exitCode).toBe(0);
    expect(run.validation.ok).toBe(true);
  });
});

describe("error contract", () => {
  const cases: Array<{ name: string; run: () => Promise<Response>; status: number; code: string }> = [
    {
      name: "empty idea",
      run: () => post("/api/generate", { idea: "", demo: true }),
      status: 400,
      code: "invalid_idea",
    },
    {
      name: "invalid state",
      run: () => post("/api/preview", { state: { nodes: [] } }),
      status: 400,
      code: "invalid_state",
    },
    {
      name: "chat without a state",
      run: () => post("/api/chat", { message: "  " }),
      status: 400,
      code: "invalid_state",
    },
    {
      name: "malformed json",
      run: () => post("/api/preview", undefined, "{"),
      status: 400,
      code: "invalid_json",
    },
    {
      name: "missing reverse path",
      run: () => post("/api/reverse", { path: join(fixtures, "missing") }),
      status: 400,
      code: "invalid_path",
    },
    {
      name: "unsupported sandbox",
      run: () => post("/api/sandbox", { idea: "postgres api", demo: true, sandbox: "chroot" }),
      status: 400,
      code: "invalid_sandbox",
    },
    {
      name: "oversized body",
      run: () => post("/api/preview", { idea: "x".repeat(300 * 1024), demo: true }),
      status: 413,
      code: "payload_too_large",
    },
    {
      name: "unknown route",
      run: () => fetch(`${baseUrl}/api/nope`),
      status: 404,
      code: "not_found",
    },
  ];

  for (const testCase of cases) {
    it(`returns ${testCase.status} ${testCase.code} for ${testCase.name}`, async () => {
      const response = await testCase.run();
      expect(response.status).toBe(testCase.status);
      const payload = errorEnvelopeSchema.parse(await response.json());
      expect(payload.code).toBe(testCase.code);
    });
  }

  it("rejects an empty chat message with empty_message", async () => {
    const preview = await expectSchema(
      await post("/api/preview", { idea: "postgres orders api", demo: true }),
      previewResponseSchema,
    );
    const response = await post("/api/chat", { state: preview.state, message: "   " });
    expect(response.status).toBe(400);
    expect(errorEnvelopeSchema.parse(await response.json()).code).toBe("empty_message");
  });
});
