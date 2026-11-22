import { describe, expect, it, vi } from "vitest";
import { demoState } from "../src/demo";
import { ideaToState } from "../src/llm";
import { runPipeline } from "../src/pipeline";

const validState = {
  version: 1,
  nodes: [
    { id: "svc", kind: "service", name: "API", props: {} },
    { id: "db", kind: "database", name: "DB", props: { engine: "postgres" } },
  ],
  edges: [{ id: "e1", from: "svc", to: "db", protocol: "sql" }],
  decisions: [],
  entities: [],
};

function fakeResponse(content: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

describe("demo state producer", () => {
  it("turns keywords into a valid multi-node architecture", () => {
    const state = demoState("postgres redis react api");
    const kinds = state.nodes.map((node) => node.kind);
    expect(kinds).toContain("service");
    expect(kinds).toContain("database");
    expect(kinds).toContain("queue");
    expect(kinds).toContain("ui");
    expect(state.decisions.length).toBeGreaterThanOrEqual(2);
    expect(state.entities.length).toBeGreaterThanOrEqual(1);
  });

  it("derives domain entities from the idea", () => {
    const state = demoState("online store with orders, users and products");
    const names = state.entities.map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(["Order", "User", "Product"]));

    const order = state.entities.find((entity) => entity.name === "Order")!;
    expect(order.serviceId).toBe("svc-core");
    expect(order.databaseId).toBe("db-main");
    expect(order.relations).toEqual([{ target: "ent-user", field: "userId" }]);
    const user = state.entities.find((entity) => entity.name === "User")!;
    expect(user.fields.find((field) => field.name === "email")!.unique).toBe(true);
  });

  it("always returns at least two nodes and one entity", () => {
    const state = demoState("an app");
    expect(state.nodes.length).toBeGreaterThanOrEqual(2);
    expect(state.entities).toHaveLength(1);
    expect(state.entities[0].name).toBe("Resource");
  });
});

describe("BYOK state producer", () => {
  it("uses demo mode when no API key is present", async () => {
    const state = await ideaToState("postgres api");
    expect(state.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("parses a valid JSON response from an OpenAI-compatible endpoint", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      fakeResponse(JSON.stringify(validState)),
    );
    const state = await ideaToState("build an api", {
      apiKey: "sk-test-key",
      baseUrl: "https://example.test/v1",
      fetchImpl,
    });

    expect(state.nodes).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-key");
    expect(String((init.body as string))).toContain("entities");
  });

  it("sanitizes dangling edges and duplicate ids returned by the model", async () => {
    const dirty = {
      ...validState,
      nodes: [...validState.nodes, { id: "svc", kind: "service", name: "Duplicate", props: {} }],
      edges: [
        { id: "e1", from: "svc", to: "db", protocol: "sql" },
        { id: "ghost", from: "svc", to: "missing", protocol: "http" },
        { id: "loop", from: "db", to: "db", protocol: "sql" },
      ],
    };
    const fetchImpl = vi.fn(async () => fakeResponse(JSON.stringify(dirty)));
    const state = await ideaToState("build an api", { apiKey: "sk-test-key", fetchImpl });
    expect(state.nodes).toHaveLength(2);
    expect(state.edges.map((edge) => edge.id)).toEqual(["e1"]);
  });

  it("retries once when the first response is invalid", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse("not json"))
      .mockResolvedValueOnce(fakeResponse(JSON.stringify(validState)));

    const state = await ideaToState("build an api", {
      apiKey: "sk-test-key",
      fetchImpl,
    });

    expect(state.nodes).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never leaks the API key in an error message", async () => {
    const secret = "sk-super-secret-key-123";
    const fetchImpl = vi.fn(async () => {
      throw new Error(`network failed for ${secret}`);
    });

    await expect(ideaToState("build an api", { apiKey: secret, fetchImpl })).rejects.toThrow(
      /LLM request failed/,
    );
    try {
      await ideaToState("build an api", { apiKey: secret, fetchImpl });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("end-to-end pipeline", () => {
  it("produces a verified ZIP in demo mode", async () => {
    const result = await runPipeline("postgres redis react api", { demo: true });
    expect(result.zip.length).toBeGreaterThan(0);
    expect(result.files["TASKS.md"]).toBeDefined();
    expect(result.metrics.every((metric) => metric.pass)).toBe(true);
    expect(result.validation.ok).toBe(true);
    expect(result.packets).toHaveLength(4);
    expect(result.state.entities).toHaveLength(1);
  });

  it("honours target runtime options", async () => {
    const result = await runPipeline("postgres redis react api", {
      demo: true,
      taskOptions: { packageManager: "npm", testRunner: "jest" },
    });
    expect(result.files["tasks/T-001.md"]).toContain("npx jest");
    expect(result.files["TASKS.md"]).toContain("npm install");
  });
});
