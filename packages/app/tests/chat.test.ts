import { afterAll, describe, expect, it } from "vitest";
import { architectChat } from "../src/chat";
import { demoState } from "../src/demo";
import { createServer } from "../src/server";
import { validateState } from "../../core/src/diff";
import type { ArchState } from "../../core/src/state";

function baseState(): ArchState {
  return demoState("orders api on postgres with redis events, a react storefront and user accounts");
}

function entity(state: ArchState, name: string) {
  return state.entities.find((item) => item.name.toLowerCase() === name.toLowerCase());
}

describe("architectChat (deterministic)", () => {
  it("adds a Redis cache and connects it to the owning service", async () => {
    const state = baseState();
    const result = await architectChat(state, "Redis cache ekle", { locale: "tr" });

    expect(result.intent).toBe("add-cache");
    expect(result.source).toBe("deterministic");
    const cache = result.state.nodes.find((node) => /redis cache/i.test(node.name));
    expect(cache).toBeTruthy();
    expect(cache?.kind).toBe("database");
    expect(cache?.props.role).toBe("cache");
    const service = result.state.nodes.find((node) => node.kind === "service");
    expect(result.state.edges.some((edge) => edge.from === service?.id && edge.to === cache?.id)).toBe(true);
    expect(result.changes.some((change) => change.action === "added")).toBe(true);
    expect(result.reply).toContain("Redis Cache");
    expect(validateState(result.state)).toEqual([]);
  });

  it("adds a typed field to an existing entity", async () => {
    const state = baseState();
    const result = await architectChat(state, "Order entity'sine priorityCount int alanı koy", { locale: "tr" });

    expect(result.intent).toBe("add-field");
    const order = entity(result.state, "Order");
    const field = order?.fields.find((item) => item.name === "priorityCount");
    expect(field).toBeTruthy();
    expect(field?.type).toBe("int");
    expect(result.changes.some((change) => change.target === "Order.priorityCount")).toBe(true);
    expect(validateState(result.state)).toEqual([]);
  });

  it("keeps an entity mention plus ekle a technology request, not a field", async () => {
    const state = baseState();
    const order = entity(state, "Order");
    const result = await architectChat(state, "Order için Redis cache ekle", { locale: "tr" });

    expect(result.intent).toBe("add-cache");
    expect(result.changes.some((change) => change.type === "field")).toBe(false);
    expect(entity(result.state, "Order")?.fields).toEqual(order?.fields);
    expect(result.state.nodes.some((node) => /redis cache/i.test(node.name))).toBe(true);
  });

  it("adds a typed identifier even when the word alan is omitted", async () => {
    const state = baseState();
    const result = await architectChat(state, "Order'a priorityCount int ekle", { locale: "tr" });

    expect(result.intent).toBe("add-field");
    expect(entity(result.state, "Order")?.fields.some((field) => field.name === "priorityCount" && field.type === "int")).toBe(
      true,
    );
  });

  it("does not split the architecture for a bare böl", async () => {
    const state = baseState();
    const result = await architectChat(state, "böl", { locale: "tr" });

    expect(result.intent).not.toBe("split-services");
    expect(result.changes).toEqual([]);
    expect(result.state).toEqual(state);
  });

  it("infers a decimal type for money-ish fields and marks uniqueness", async () => {
    const state = baseState();
    const result = await architectChat(state, "Add a unique price field to Product", { locale: "en" });
    const product = entity(result.state, "Product");
    const price = product?.fields.find((item) => item.name === "price");
    // `price` already exists on the demo Product entity, so nothing is added.
    expect(price?.type).toBe("decimal");
    expect(result.changes).toEqual([]);

    const added = await architectChat(state, "Add a unique skuCode field to Product", { locale: "en" });
    const sku = entity(added.state, "Product")?.fields.find((item) => item.name === "skuCode");
    expect(sku?.type).toBe("string");
    expect(sku?.unique).toBe(true);
  });

  it("does not duplicate an existing field", async () => {
    const state = baseState();
    const result = await architectChat(state, "Order entity'sine status alanı koy", { locale: "tr" });
    expect(result.changes).toEqual([]);
    expect(result.reply).toContain("Order.status");
  });

  it("removes a component and its edges", async () => {
    const withCache = (await architectChat(baseState(), "add a redis cache", { locale: "en" })).state;
    const result = await architectChat(withCache, "remove the redis cache", { locale: "en" });

    expect(result.state.nodes.some((node) => /redis cache/i.test(node.name))).toBe(false);
    const cacheIds = withCache.nodes.filter((node) => /redis cache/i.test(node.name)).map((node) => node.id);
    expect(result.state.edges.some((edge) => cacheIds.includes(edge.from) || cacheIds.includes(edge.to))).toBe(false);
    expect(validateState(result.state)).toEqual([]);
  });

  it("refuses to remove the only service", async () => {
    const state: ArchState = {
      version: 1,
      nodes: [{ id: "svc-core", kind: "service", name: "Core API", props: {} }],
      edges: [],
      decisions: [],
      entities: [
        {
          id: "ent-item",
          name: "Item",
          description: "",
          serviceId: "svc-core",
          fields: [{ name: "id", type: "uuid", required: true, unique: false, primary: true }],
          relations: [],
        },
      ],
    };
    const result = await architectChat(state, "remove the Core API", { locale: "en" });
    expect(result.changes).toEqual([]);
    expect(result.state.nodes).toHaveLength(1);
    expect(result.reply.toLowerCase()).toContain("only service");
  });

  it("splits a monolith into one service per bounded context", async () => {
    const state = baseState();
    const result = await architectChat(state, "Mikroservislere böl", { locale: "tr" });

    expect(result.intent).toBe("split-services");
    const services = result.state.nodes.filter((node) => node.kind === "service");
    expect(services.length).toBeGreaterThan(1);
    for (const item of result.state.entities) {
      expect(item.serviceId).toBeTruthy();
      expect(services.some((service) => service.id === item.serviceId)).toBe(true);
    }
    expect(validateState(result.state)).toEqual([]);
    expect(result.state.decisions.some((decision) => /microservice/i.test(decision.title))).toBe(true);
  });

  it("answers a status question without changing the architecture", async () => {
    const state = baseState();
    const result = await architectChat(state, "özetle", { locale: "tr" });
    expect(result.changes).toEqual([]);
    expect(result.reply).toContain("bileşen");
  });

  it("returns a helpful reply for an unsupported instruction", async () => {
    const state = baseState();
    const result = await architectChat(state, "make it purple", { locale: "en" });
    expect(result.changes).toEqual([]);
    expect(result.state).toEqual(state);
    expect(result.reply.length).toBeGreaterThan(10);
  });
});

describe("architectChat (BYOK)", () => {
  it("uses the LLM reply and state when the model answers with valid JSON", async () => {
    const state = baseState();
    const nextState: ArchState = {
      ...state,
      nodes: [...state.nodes, { id: "ext-search", kind: "external", name: "Search Cluster", props: { tech: "search" } }],
    };
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ reply: "Added a search cluster.", state: nextState }) } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const result = await architectChat(state, "add a search cluster", { apiKey: "sk-test", fetchImpl });
    expect(result.source).toBe("llm");
    expect(result.reply).toBe("Added a search cluster.");
    expect(result.state.nodes.some((node) => node.name === "Search Cluster")).toBe(true);
  });

  it("falls back to the deterministic parser when the LLM fails", async () => {
    const state = baseState();
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await architectChat(state, "Redis cache ekle", { apiKey: "sk-test", fetchImpl, locale: "tr" });
    expect(result.source).toBe("deterministic");
    expect(result.state.nodes.some((node) => /redis cache/i.test(node.name))).toBe(true);
    expect(result.notes.some((note) => /LLM unavailable/i.test(note))).toBe(true);
  });

  it("ignores an invalid LLM state", async () => {
    const state = baseState();
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ reply: "done", state: { nodes: "nope" } }) } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const result = await architectChat(state, "Redis cache ekle", { apiKey: "sk-test", fetchImpl });
    expect(result.source).toBe("deterministic");
    expect(validateState(result.state)).toEqual([]);
  });
});

describe("POST /api/chat", () => {
  const server = createServer();
  const listening = new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns the updated blueprint and the chat envelope", async () => {
    await listening;
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const state = baseState();

    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, message: "Mikroservislere böl", locale: "tr", demo: true }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.chat.reply.length).toBeGreaterThan(0);
    expect(payload.chat.intent).toBe("split-services");
    expect(payload.state.nodes.filter((node: any) => node.kind === "service").length).toBeGreaterThan(1);
    expect(payload.diagram).toContain("flowchart");
    expect(payload.artifacts).toContain("openapi.yaml");
    expect(payload.validation.ok).toBe(true);
  });

  it("rejects an empty instruction", async () => {
    await listening;
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: baseState(), message: "   ", demo: true }),
    });
    expect(response.status).toBe(400);
  });
});
