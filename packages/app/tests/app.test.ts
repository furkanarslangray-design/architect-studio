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
  });

  it("always returns at least two nodes", () => {
    expect(demoState("an app").nodes.length).toBeGreaterThanOrEqual(2);
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
  });
});
