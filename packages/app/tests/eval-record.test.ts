import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEvals } from "../src/eval";

const modelState = {
  version: 1,
  nodes: [
    { id: "svc", kind: "service", name: "API", props: {} },
    { id: "db", kind: "database", name: "DB", props: {} },
  ],
  edges: [{ id: "e1", from: "svc", to: "db", protocol: "sql" }],
  decisions: [
    { id: "adr-001", title: "Use Postgres", context: "", decision: "Use Postgres.", alternatives: [] },
  ],
  entities: [
    {
      id: "ent-order",
      name: "Order",
      description: "",
      serviceId: "svc",
      databaseId: "db",
      fields: [{ name: "id", type: "uuid", required: true, unique: false, primary: true }],
      relations: [],
    },
  ],
};

let server: Server;
let baseUrl: string;
let requests = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    requests += 1;
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const content = JSON.stringify(modelState);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content } }],
          echo: { model: payload.model, touched: Boolean(payload.messages) },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("eval record mode over HTTP", () => {
  it("records the model answer and replays it without the endpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "architect-eval-record-"));
    try {
      writeFileSync(
        join(dir, "stub.json"),
        JSON.stringify({ id: "stub", idea: "Postgres API", expect: { minNodes: 2, minEntities: 1 } }),
      );
      const recorded = await runEvals({
        dir,
        mode: "record",
        llm: { apiKey: "test-key", baseUrl, model: "stub-model" },
      });
      expect(recorded.failed).toBe(0);
      expect(requests).toBe(1);
      const saved = JSON.parse(readFileSync(join(dir, "recordings", "stub.json"), "utf8"));
      expect(saved.entities[0].name).toBe("Order");

      const replayed = await runEvals({ dir, mode: "replay" });
      expect(replayed.failed).toBe(0);
      expect(requests).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
