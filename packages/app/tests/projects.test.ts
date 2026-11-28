import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  errorEnvelopeSchema,
  projectDetailSchema,
  projectsResponseSchema,
  revisionResponseSchema,
} from "../src/contract";
import { parseState } from "@architect-studio/core";
import { createServer } from "../src/server";

let server: Server;
let baseUrl: string;

const stateA = parseState({
  version: 1,
  nodes: [{ id: "svc-1", kind: "service", name: "Storefront API" }],
});
const stateB = parseState({
  version: 1,
  nodes: [
    { id: "svc-1", kind: "service", name: "Storefront API" },
    { id: "db-1", kind: "database", name: "Primary DB" },
  ],
  edges: [{ id: "e1", from: "svc-1", to: "db-1", protocol: "sql" }],
});

function post(path: string, body: unknown = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createProject(name = "Storefront"): Promise<string> {
  const response = await post("/api/projects", { name });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { project: { id: string } };
  return payload.project.id;
}

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("projects API", () => {
  it("creates a project, adds two revisions and restores the first", async () => {
    const projectId = await createProject();

    const first = revisionResponseSchema.parse(
      await (await post(`/api/projects/${projectId}/revisions`, { state: stateA, message: "initial" })).json(),
    );
    const second = revisionResponseSchema.parse(
      await (await post(`/api/projects/${projectId}/revisions`, { state: stateB, message: "add db" })).json(),
    );
    expect(first.revision.state).toEqual(stateA);
    expect(second.revision.state).toEqual(stateB);

    const restoredResponse = await post(`/api/projects/${projectId}/restore/${first.revision.id}`);
    expect(restoredResponse.status).toBe(201);
    const restored = revisionResponseSchema.parse(await restoredResponse.json());
    expect(restored.restoredFrom).toBe(first.revision.id);
    expect(restored.revision.state).toEqual(stateA);
    expect(restored.revision.source).toBe("restore");

    const detail = projectDetailSchema.parse(
      await (await fetch(`${baseUrl}/api/projects/${projectId}`)).json(),
    );
    expect(detail.project.revisionCount).toBe(3);
    expect(detail.revisions.map((item) => item.message)).toEqual([
      `Restored ${first.revision.id}`,
      "add db",
      "initial",
    ]);

    const list = projectsResponseSchema.parse(await (await fetch(`${baseUrl}/api/projects`)).json());
    expect(list.mode).toBe("memory");
    expect(list.projects.map((item) => item.id)).toContain(projectId);
  });

  it("lists the revisions of a project", async () => {
    const projectId = await createProject("Listed");
    await post(`/api/projects/${projectId}/revisions`, { state: stateA });

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/revisions`);
    expect(response.status).toBe(200);
    const payload = projectDetailSchema.parse(await response.json());
    expect(payload.revisions).toHaveLength(1);
    expect(payload.revisions[0].source).toBe("manual");
  });

  it("records a generated package against the project", async () => {
    const projectId = await createProject("Packaged");
    const generated = await post("/api/generate", {
      idea: "postgres orders api",
      demo: true,
      projectId,
    });
    expect(generated.status).toBe(200);
    await generated.arrayBuffer();

    const detail = projectDetailSchema.parse(
      await (await fetch(`${baseUrl}/api/projects/${projectId}`)).json(),
    );
    expect(detail.packages).toBe(1);
  });

  it("rejects an empty name and an invalid revision state", async () => {
    const named = await post("/api/projects", { name: "   " });
    expect(named.status).toBe(400);
    expect(errorEnvelopeSchema.parse(await named.json()).code).toBe("invalid_name");

    const projectId = await createProject("Validated");
    const invalid = await post(`/api/projects/${projectId}/revisions`, { state: { nodes: [] } });
    expect(invalid.status).toBe(400);
    expect(errorEnvelopeSchema.parse(await invalid.json()).code).toBe("invalid_state");
  });

  it("returns 404 for unknown projects and revisions", async () => {
    const missingProject = await fetch(`${baseUrl}/api/projects/nope`);
    expect(missingProject.status).toBe(404);
    expect(errorEnvelopeSchema.parse(await missingProject.json()).code).toBe("not_found");

    const projectId = await createProject("Missing revision");
    const missingRevision = await post(`/api/projects/${projectId}/restore/does-not-exist`);
    expect(missingRevision.status).toBe(404);
    expect(errorEnvelopeSchema.parse(await missingRevision.json()).code).toBe("not_found");
  });
});
