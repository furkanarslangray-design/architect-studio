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
    expect(await response.text()).toContain("AI Principal Architect");
  });

  it("reports health", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
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
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  it("rejects an empty idea", async () => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "", demo: true }),
    });
    expect(response.status).toBe(400);
  });
});
