import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server";

let server: Server;
let baseUrl: string;
const fixtures = mkdtempSync(join(tmpdir(), "server-fixtures-"));

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

describe("HTTP server", () => {
  it("reports health and version", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "2.1.0" });

    const version = await fetch(`${baseUrl}/api/version`);
    expect(await version.json()).toMatchObject({ name: "architect-studio", version: "2.1.0" });
  });

  it("generates a ZIP in demo mode", async () => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "postgres redis react api", demo: true }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("x-validation")).toBe("ok");
    expect(response.headers.get("x-task-count")).toBe("4");
    expect(response.headers.get("x-entities")).toBe("1");
    const digest = response.headers.get("x-package-sha256") ?? "";
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(createHash("sha256").update(Buffer.from(buffer)).digest("hex")).toBe(digest);
  });

  it("previews architecture, tasks, metrics and validation without zipping", async () => {
    const response = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "online store with orders, users and products", demo: true }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.state.entities.map((entity: any) => entity.name)).toEqual(
      expect.arrayContaining(["Order", "User", "Product"]),
    );
    expect(payload.summary.entities).toBe(3);
    expect(payload.tasks).toHaveLength(payload.summary.nodes);
    expect(payload.metrics.length).toBeGreaterThanOrEqual(15);
    expect(payload.validation.ok).toBe(true);
    expect(payload.artifacts).toContain("openapi.yaml");
  });

  it("builds a package from an imported architecture state", async () => {
    const state = {
      version: 1,
      nodes: [
        { id: "svc", kind: "service", name: "Billing API", props: {} },
        { id: "db", kind: "database", name: "Billing DB", props: { engine: "postgres" } },
      ],
      edges: [{ id: "e1", from: "svc", to: "db", protocol: "sql" }],
      decisions: [],
      entities: [
        {
          id: "ent-invoice",
          name: "Invoice",
          serviceId: "svc",
          databaseId: "db",
          fields: [
            { name: "id", type: "uuid", required: true, primary: true },
            { name: "amount", type: "decimal", required: true },
          ],
        },
      ],
    };

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, packageManager: "npm", testRunner: "jest" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-entities")).toBe("1");
    expect(response.headers.get("x-task-count")).toBe("2");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("serves concurrent previews without leaking state between requests", async () => {
    const ideas = ["postgres orders api", "redis queue api", "react ui dashboard"];
    const responses = await Promise.all(
      ideas.map((idea) =>
        fetch(`${baseUrl}/api/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea, demo: true }),
        }),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<any>));
    expect(payloads[1].state.nodes.some((node: any) => node.kind === "queue")).toBe(true);
    expect(payloads[2].state.nodes.some((node: any) => node.kind === "ui")).toBe(true);
    expect(payloads[0].state.entities.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects an empty idea", async () => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "", demo: true }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_idea");
  });

  it("rejects invalid task runtime options", async () => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "postgres api", demo: true, packageManager: "maven" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_package_manager");
  });

  it("rejects an invalid imported state", async () => {
    const response = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: { nodes: [] } }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_state");
  });
});

describe("v2 endpoints", () => {
  it("reports the detected sandbox drivers", async () => {
    const response = await fetch(`${baseUrl}/api/sandboxes`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.sandboxes.map((item: any) => item.id)).toEqual([
      "bwrap",
      "podman",
      "docker",
      "firejail",
      "systemd-run",
      "temp-dir",
    ]);
    expect(payload.sandboxes.find((item: any) => item.id === "temp-dir").available).toBe(true);
  });

  it("reverse-engineers a repository from the HTTP API", async () => {
    const root = join(fixtures, "service");
    mkdirSync(join(root, "prisma"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "service", dependencies: { express: "^4.0.0", "@prisma/client": "^5.0.0" } }),
    );
    writeFileSync(join(root, "prisma/schema.prisma"), "model Invoice {\n  id String @id\n  amount Decimal\n}\n");

    const response = await fetch(`${baseUrl}/api/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.summary).toContain("files scanned");
    expect(payload.state.nodes.length).toBeGreaterThanOrEqual(2);
    expect(payload.state.entities[0].name).toBe("Invoice");
  });

  it("rejects a missing reverse-engineering path", async () => {
    const response = await fetch(`${baseUrl}/api/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: join(fixtures, "missing") }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as any;
    expect(payload.code).toBe("invalid_path");
  });

  it("verifies a package inside the temporary-directory sandbox", async () => {
    const response = await fetch(`${baseUrl}/api/sandbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "postgres orders api", demo: true, sandbox: "temp-dir" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.driver).toBe("temp-dir");
    expect(payload.exitCode).toBe(0);
    expect(payload.stdout).toContain("package ok");
    expect(payload.validation.ok).toBe(true);
  });

  it("includes sandbox availability in previews", async () => {
    const response = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "postgres orders api", demo: true, sandbox: "temp-dir" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.sandbox.resolved).toBe("temp-dir");
    expect(payload.sandbox.drivers).toHaveLength(6);
  });
});

describe("rate limiting", () => {
  it("returns 429 after the per-minute budget is exhausted", async () => {
    const limited = createServer({ rateLimitPerMinute: 1 });
    await new Promise<void>((resolve) => limited.listen(0, "127.0.0.1", () => resolve()));
    const address = limited.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/api/preview`;
    const body = JSON.stringify({ idea: "postgres api", demo: true });

    try {
      const first = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      expect(first.status).toBe(200);

      const second = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).toBeTruthy();
    } finally {
      await new Promise<void>((resolve, reject) => limited.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe("i18n", () => {
  it("serves the message catalog and locale list", async () => {
    const response = await fetch(`${baseUrl}/api/i18n?locale=de`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.locale).toBe("de");
    expect(payload.locales).toHaveLength(8);
    expect(payload.defaultLocale).toBe("en");
    expect(payload.messages["ui.preview"]).toBe("Zuerst ansehen");
  });

  it("localizes errors from the Accept-Language header", async () => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "de-DE,de;q=0.9" },
      body: JSON.stringify({ idea: "", demo: true }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as any;
    expect(payload.code).toBe("invalid_idea");
    expect(payload.error).toContain("mindestens");
  });

  it("builds Japanese artifacts when the body selects a locale", async () => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "postgres orders api", demo: true, locale: "ja" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-locale")).toBe("ja");
    expect(response.headers.get("x-validation")).toBe("ok");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("returns Turkish documents and diagram data in previews", async () => {
    const response = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "postgres orders api", demo: true, locale: "tr" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.locale).toBe("tr");
    expect(payload.diagram).toContain("flowchart");
    expect(payload.files["ARCHITECTURE.md"]).toContain("# Mimari");
    expect(payload.files["TASKS.md"]).toContain("# GÖREVLER");
    expect(payload.files["tasks/T-001.md"]).toContain("Kabul kriterleri");
  });
});

describe("reverse path allowlist", () => {
  let guarded: Server;
  let guardedUrl: string;
  const allowRoot = join(fixtures, "guard-allowed");
  const outsideRoot = join(fixtures, "guard-outside");

  beforeAll(async () => {
    mkdirSync(join(allowRoot, "app"), { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(
      join(allowRoot, "app", "package.json"),
      JSON.stringify({ name: "guard-app", dependencies: { express: "^4.0.0" } }),
    );
    writeFileSync(
      join(outsideRoot, "package.json"),
      JSON.stringify({ name: "outside", dependencies: { express: "^4.0.0" } }),
    );
    symlinkSync(outsideRoot, join(allowRoot, "escape"));

    guarded = createServer({ reverseRoots: [allowRoot] });
    await new Promise<void>((resolve) => guarded.listen(0, "127.0.0.1", () => resolve()));
    const address = guarded.address() as AddressInfo;
    guardedUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => guarded.close((error) => (error ? reject(error) : resolve())));
  });

  const reverse = (path: string) =>
    fetch(`${guardedUrl}/api/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });

  it("accepts a directory inside REVERSE_ROOTS", async () => {
    const response = await reverse(join(allowRoot, "app"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.root).toBe(join(allowRoot, "app"));
  });

  it("rejects a directory outside REVERSE_ROOTS", async () => {
    const response = await reverse(outsideRoot);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as any;
    expect(payload.code).toBe("path_not_allowed");
    // The message must not disclose the resolved path.
    expect(payload.error).not.toContain(outsideRoot);
  });

  it("rejects a symlink that escapes REVERSE_ROOTS", async () => {
    const response = await reverse(join(allowRoot, "escape"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).code).toBe("path_not_allowed");
  });

  it("rejects .. traversal out of REVERSE_ROOTS", async () => {
    const response = await reverse(join(allowRoot, "app", "..", "..", "guard-outside"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).code).toBe("path_not_allowed");
  });
});

describe("listen host policy", () => {
  it("defaults to loopback and accepts an explicit host", async () => {
    const { isLoopbackHost, resolveListenHost } = await import("../src/listen-host");
    expect(resolveListenHost({})).toBe("127.0.0.1");
    expect(resolveListenHost({ HOST: " " })).toBe("127.0.0.1");
    expect(resolveListenHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.4.5.6")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("10.0.0.7")).toBe(false);
  });
});

describe("reverse disabled on a wide bind", () => {
  let wide: Server;
  let wideUrl: string;

  beforeAll(async () => {
    // HOST is not loopback and REVERSE_ROOTS is empty: the endpoint must refuse.
    wide = createServer({ host: "0.0.0.0", reverseRoots: [] });
    await new Promise<void>((resolve) => wide.listen(0, "127.0.0.1", () => resolve()));
    const address = wide.address() as AddressInfo;
    wideUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => wide.close((error) => (error ? reject(error) : resolve())));
  });

  it("refuses every reverse request instead of reading the filesystem", async () => {
    const response = await fetch(`${wideUrl}/api/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: join(fixtures, "service") }),
    });
    expect(response.status).toBe(403);
    const payload = (await response.json()) as any;
    expect(payload.code).toBe("reverse_disabled");
    expect(payload.error).toContain("REVERSE_ROOTS");
  });

  it("stays available on a wide bind once roots are configured", async () => {
    const configured = createServer({ host: "0.0.0.0", reverseRoots: [join(fixtures, "service")] });
    await new Promise<void>((resolve) => configured.listen(0, "127.0.0.1", () => resolve()));
    const address = configured.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: join(fixtures, "service") }),
      });
      expect(response.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => configured.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
