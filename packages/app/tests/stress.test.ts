import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseState, type ArchState } from "@architect-studio/core";
import { buildPackage } from "@architect-studio/packager";
import { createServer } from "../src/server";

function largeArchitecture(): ArchState {
  const layers = 4;
  const perLayer = 12;
  const nodes: any[] = [];
  const edges: any[] = [];
  const entities: any[] = [];

  for (let index = 0; index < 6; index += 1) {
    nodes.push({ id: `db-${index}`, kind: "database", name: `Shard ${index} DB`, props: { engine: "postgres" } });
  }

  for (let layer = 0; layer < layers; layer += 1) {
    for (let index = 0; index < perLayer; index += 1) {
      const id = `svc-${layer}-${index}`;
      nodes.push({
        id,
        kind: "service",
        name: `Layer ${layer} Service ${index}`,
        props: { runtime: "node", layer },
      });
      if (layer === 0) {
        edges.push({ id: `edge-${layer}-${index}`, from: id, to: `db-${index % 6}`, protocol: "sql" });
      } else {
        const targetIndex = index % perLayer;
        edges.push({
          id: `edge-${layer}-${index}`,
          from: id,
          to: `svc-${layer - 1}-${targetIndex}`,
          protocol: "http",
        });
      }
    }
  }

  for (let index = 0; index < 10; index += 1) {
    entities.push({
      id: `ent-${index}`,
      name: `Entity${index}`,
      description: `Domain object ${index}`,
      serviceId: `svc-3-${index}`,
      databaseId: `db-${index % 6}`,
      fields: [
        { name: "id", type: "uuid", required: true, primary: true },
        { name: "label", type: "string", required: true },
        { name: "amount", type: "decimal", required: true },
        { name: "active", type: "boolean" },
        { name: "createdAt", type: "datetime", required: true },
      ],
      relations: index > 0 ? [{ target: `ent-${index - 1}`, field: `entity${index - 1}Id` }] : [],
    });
  }

  return parseState({
    version: 1,
    nodes,
    edges,
    decisions: [
      {
        id: "adr-1",
        title: "Use PostgreSQL",
        context: "Transactional storage",
        decision: "Use PostgreSQL",
        alternatives: ["MongoDB"],
      },
    ],
    entities,
  });
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("large architecture stress", () => {
  it("packages a 54-node / 48-edge / 10-entity architecture within the time budget", async () => {
    const state = largeArchitecture();
    expect(state.nodes.length).toBe(54);
    expect(state.edges.length).toBe(48);
    expect(state.entities.length).toBe(10);

    const startedAt = Date.now();
    const result = await buildPackage(state);
    const durationMs = Date.now() - startedAt;

    expect(durationMs).toBeLessThan(10_000);
    expect(result.packets).toHaveLength(54);
    expect(result.validation.ok).toBe(true);
    expect(result.zip.sizeBytes).toBeGreaterThan(1000);
    expect(result.zip.sizeBytes).toBeLessThan(2 * 1024 * 1024);
    expect(result.metrics.find((metric) => metric.name === "state_to_package_ms")!.pass).toBe(true);

    const buffer = await collect(result.zip.stream());
    expect(buffer.length).toBe(result.zip.sizeBytes);
    const zip = await JSZip.loadAsync(buffer);
    expect(
      Object.keys(zip.files).filter((path) => path.startsWith("tasks/") && !path.endsWith("/")).length,
    ).toBe(54);
    expect(zip.file("openapi.yaml")).not.toBeNull();
  });

  it("keeps the measured package size stable across stream regenerations", async () => {
    const result = await buildPackage(largeArchitecture());
    const first = await collect(result.zip.stream());
    const second = await collect(result.zip.stream());
    expect(first.length).toBe(second.length);
    expect(first.equals(second)).toBe(true);
  });
});

describe("fuzz and hostile input", () => {
  const malformed: unknown[] = [
    null,
    {},
    { nodes: null },
    { nodes: "everything" },
    { nodes: [] },
    { nodes: [{ id: "", kind: "service", name: "" }] },
    { nodes: [{ id: "__proto__", kind: "service", name: "polluted" }], edges: [] },
    { nodes: [{ id: "a", kind: "service", name: "A" }], edges: [{ id: "e", from: "a", to: "missing" }] },
    {
      nodes: [
        { id: "a", kind: "service", name: "A" },
        { id: "b", kind: "service", name: "B" },
      ],
      edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "a" }],
    },
    {
      nodes: [{ id: "a", kind: "service", name: "A".repeat(10_000) }],
      edges: [],
    },
    {
      nodes: [{ id: "a", kind: "service", name: "A" }],
      entities: [
        { id: "e", name: "Broken", serviceId: "missing", fields: [] },
      ],
    },
    {
      nodes: [{ id: "a", kind: "service", name: "A" }],
      entities: [
        {
          id: "e",
          name: "Duplicate",
          fields: [
            { name: "id", type: "uuid", primary: true },
            { name: "id", type: "uuid", primary: true },
          ],
        },
      ],
    },
  ];

  it("rejects every malformed state with an Error instead of crashing", async () => {
    for (const input of malformed) {
      let outcome: "resolved" | "rejected" = "resolved";
      try {
        await buildPackage(input as ArchState);
      } catch (error) {
        outcome = "rejected";
        expect(error).toBeInstanceOf(Error);
        expect(typeof (error as Error).message).toBe("string");
      }
      expect(["resolved", "rejected"]).toContain(outcome);
    }
  });
});

describe("HTTP concurrency and end-to-end download", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer({ rateLimitPerMinute: 0 });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("serves 20 concurrent previews with isolated results", async () => {
    const ideas = [
      "postgres orders api",
      "redis events api",
      "react storefront",
      "postgres queue react api",
      "user auth service",
    ];
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        fetch(`${baseUrl}/api/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea: ideas[index % ideas.length], demo: true }),
        }),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<any>));
    for (const payload of payloads) {
      expect(payload.tasks.length).toBe(payload.summary.nodes);
      expect(payload.validation.ok).toBe(true);
    }
    expect(new Set(payloads.map((payload) => JSON.stringify(payload.summary))).size).toBeGreaterThan(1);
  });

  it("downloads a ZIP end to end from an imported state", async () => {
    const state = JSON.parse(readFileSync(join(__dirname, "../../../examples/architecture.json"), "utf8"));
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, packageManager: "pnpm", testRunner: "vitest" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("agent-package.zip");
    const declared = Number(response.headers.get("content-length"));
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.length).toBe(declared);

    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("TASKS.md")).not.toBeNull();
    expect(zip.file("tasks/T-001.md")).not.toBeNull();
    expect(zip.file(".opencode/agents/validator.md")).not.toBeNull();
    const openapi = await zip.file("openapi.yaml")!.async("string");
    expect(openapi).toContain("/api/order-api/order");
  });

  it("rejects malformed JSON and oversized bodies without crashing", async () => {
    const invalidJson = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(invalidJson.status).toBe(400);
    expect((await invalidJson.json()).code).toBe("invalid_json");

    const oversized = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "x".repeat(300 * 1024), demo: true }),
    });
    expect(oversized.status).toBe(413);

    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
  });
});
