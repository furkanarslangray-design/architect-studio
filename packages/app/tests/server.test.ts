import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("HTTP server", () => {
  it("serves the web UI", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("AI Principal Architect");
  });

  it("reports health and version", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "0.2.0" });

    const version = await fetch(`${baseUrl}/api/version`);
    expect(await version.json()).toMatchObject({ name: "architect-studio", version: "0.2.0" });
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
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
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

  it("serves the Studio assets", async () => {
    const script = await fetch(`${baseUrl}/app.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(await script.text()).toContain("renderPreview");

    const styles = await fetch(`${baseUrl}/styles.css`);
    expect(styles.status).toBe(200);
    expect(styles.headers.get("content-type")).toContain("text/css");
  });
});
