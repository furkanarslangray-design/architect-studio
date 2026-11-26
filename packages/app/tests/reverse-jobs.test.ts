import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  reverseJobCreatedSchema,
  reverseJobStatusSchema,
  reverseResponseSchema,
} from "../src/contract";
import { createServer } from "../src/server";

let server: Server;
let baseUrl: string;
let fixtures: string;
let cacheDir: string;

function makeRepo(name: string, dependency = "express"): string {
  const root = join(fixtures, name);
  mkdirSync(join(root, "prisma"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, dependencies: { [dependency]: "^4.0.0" } }),
  );
  writeFileSync(join(root, "prisma", "schema.prisma"), "model Invoice {\n  id String @id\n  amount Decimal\n}\n");
  writeFileSync(join(root, "index.ts"), "export const ready = true;\n");
  return root;
}

const post = (path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function waitForJob(jobId: string): Promise<any> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/reverse/jobs/${jobId}`);
    expect(response.status).toBe(200);
    const payload = reverseJobStatusSchema.parse(await response.json());
    if (payload.state !== "running") return payload;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`job ${jobId} did not finish`);
}

beforeAll(async () => {
  fixtures = mkdtempSync(join(tmpdir(), "reverse-jobs-"));
  cacheDir = join(fixtures, "cache");
  server = createServer({ reverseCacheDir: cacheDir });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  rmSync(fixtures, { recursive: true, force: true });
});

describe("reverse content cache", () => {
  it("serves the second identical request from the cache", async () => {
    const root = makeRepo("cached-service");

    const cold = await post("/api/reverse", { path: root });
    expect(cold.status).toBe(200);
    const coldPayload = reverseResponseSchema.parse(await cold.json());
    expect(coldPayload.cacheHit).toBe(false);

    const warm = await post("/api/reverse", { path: root });
    expect(warm.status).toBe(200);
    const warmPayload = reverseResponseSchema.parse(await warm.json());
    expect(warmPayload.cacheHit).toBe(true);
    expect(warmPayload.state).toEqual(coldPayload.state);
    expect(warmPayload.summary).toBe(coldPayload.summary);
  });

  it("skips the cache when the request asks for it", async () => {
    const root = makeRepo("uncached-service");
    const first = reverseResponseSchema.parse(await (await post("/api/reverse", { path: root })).json());
    expect(first.cacheHit).toBe(false);
    const forced = reverseResponseSchema.parse(
      await (await post("/api/reverse", { path: root, cache: false })).json(),
    );
    expect(forced.cacheHit).toBe(false);
  });

  it("invalidates when a manifest changes", async () => {
    const root = makeRepo("changing-service");
    expect(reverseResponseSchema.parse(await (await post("/api/reverse", { path: root })).json()).cacheHit).toBe(false);

    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "changing-service", dependencies: { express: "^4.0.0", redis: "^5.0.0" } }),
    );
    const after = reverseResponseSchema.parse(await (await post("/api/reverse", { path: root })).json());
    expect(after.cacheHit).toBe(false);
    expect(after.state.nodes.some((node) => node.kind === "queue")).toBe(true);
  });

  it("keeps separate entries per repository", async () => {
    const one = makeRepo("repo-one");
    const two = makeRepo("repo-two", "fastify");
    await post("/api/reverse", { path: one });
    const other = reverseResponseSchema.parse(await (await post("/api/reverse", { path: two })).json());
    expect(other.cacheHit).toBe(false);
  });
});

describe("reverse progress jobs", () => {
  it("reports phases and a final payload", async () => {
    const root = makeRepo("job-service");
    const created = await post("/api/reverse/jobs", { path: root, cache: false });
    expect(created.status).toBe(202);
    const job = reverseJobCreatedSchema.parse(await created.json());
    expect(job.events).toBe(`/api/reverse/jobs/${job.jobId}/events`);

    const finished = await waitForJob(job.jobId);
    expect(finished.state).toBe("done");
    const types = finished.events.map((event: any) => event.type);
    expect(types).toContain("scan");
    expect(types).toContain("done");
    expect(types.indexOf("done")).toBe(types.length - 1);
    // Sequence numbers are contiguous so a client can resume.
    expect(finished.events.map((event: any) => event.seq)).toEqual(
      finished.events.map((_: unknown, index: number) => index + 1),
    );
    const done = finished.events.at(-1);
    expect(done.payload.state.entities[0].name).toBe("Invoice");
  });

  it("streams the same events over SSE, including a finished job", async () => {
    const root = makeRepo("sse-service");
    const job = reverseJobCreatedSchema.parse(await (await post("/api/reverse/jobs", { path: root })).json());

    const response = await fetch(`${baseUrl}${job.events}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"type":"scan"');
    expect(body).toContain('"type":"done"');

    // A late subscriber replays the history and the stream closes immediately.
    const replay = await fetch(`${baseUrl}${job.events}`);
    expect(await replay.text()).toContain('"type":"done"');

    const status = reverseJobStatusSchema.parse(await (await fetch(`${baseUrl}${job.status}`)).json());
    expect(status.state).toBe("done");
  });

  it("rejects invalid jobs before creating one", async () => {
    const badPath = await post("/api/reverse/jobs", { path: join(fixtures, "missing") });
    expect(badPath.status).toBe(400);
    expect(((await badPath.json()) as any).code).toBe("invalid_path");

    const unknown = await fetch(`${baseUrl}/api/reverse/jobs/does-not-exist`);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as any).code).toBe("not_found");
  });
});
