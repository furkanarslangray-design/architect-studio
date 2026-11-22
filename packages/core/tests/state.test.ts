import { describe, expect, it } from "vitest";
import { parseState, safeParseState, sanitizeState } from "../src/state";

describe("ArchState schema", () => {
  it("parses a valid architecture state and fills defaults", () => {
    const state = parseState({
      nodes: [{ id: "svc-1", kind: "service", name: "Orders API" }],
    });

    expect(state.version).toBe(1);
    expect(state.nodes[0].props).toEqual({});
    expect(state.edges).toEqual([]);
    expect(state.decisions).toEqual([]);
    expect(state.entities).toEqual([]);
  });

  it("normalizes domain entity fields", () => {
    const state = parseState({
      nodes: [{ id: "svc-1", kind: "service", name: "Orders API" }],
      entities: [
        {
          id: "ent-1",
          name: "Order",
          serviceId: "svc-1",
          fields: [{ name: "id", type: "uuid", primary: true }],
        },
      ],
    });

    expect(state.entities[0].description).toBe("");
    expect(state.entities[0].relations).toEqual([]);
    expect(state.entities[0].fields[0]).toEqual({
      name: "id",
      type: "uuid",
      required: false,
      unique: false,
      primary: true,
    });
  });

  it("rejects a node without an id", () => {
    const result = safeParseState({ nodes: [{ kind: "service", name: "Orders API" }] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown node kind", () => {
    const result = safeParseState({ nodes: [{ id: "x", kind: "cache", name: "Redis" }] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown entity field type", () => {
    const result = safeParseState({
      nodes: [{ id: "svc", kind: "service", name: "API" }],
      entities: [{ id: "e", name: "Order", fields: [{ name: "id", type: "money" }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("sanitizeState", () => {
  it("drops duplicate nodes, dangling edges and self-loops", () => {
    const state = parseState({
      nodes: [
        { id: "svc", kind: "service", name: "API" },
        { id: "db", kind: "database", name: "DB" },
        { id: "svc", kind: "service", name: "API duplicate" },
      ],
      edges: [
        { id: "e1", from: "svc", to: "db", protocol: "sql" },
        { id: "e1", from: "svc", to: "db", protocol: "sql" },
        { id: "e2", from: "svc", to: "ghost", protocol: "http" },
        { id: "e3", from: "db", to: "db", protocol: "http" },
      ],
      entities: [
        {
          id: "ent",
          name: "Thing",
          serviceId: "missing-service",
          databaseId: "db",
          fields: [{ name: "id", type: "uuid", primary: true }],
        },
        {
          id: "ent",
          name: "Thing duplicate",
          fields: [{ name: "id", type: "uuid", primary: true }],
        },
      ],
    });

    const result = sanitizeState(state);
    expect(result.state.nodes).toHaveLength(2);
    expect(result.state.edges.map((edge) => edge.id)).toEqual(["e1"]);
    expect(result.state.entities).toHaveLength(1);
    expect(result.state.entities[0].serviceId).toBeUndefined();
    expect(result.removed.length).toBeGreaterThanOrEqual(4);
  });
});
