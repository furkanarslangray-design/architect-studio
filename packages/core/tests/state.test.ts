import { describe, expect, it } from "vitest";
import { parseState, safeParseState } from "../src/state";

describe("ArchState schema", () => {
  it("parses a valid architecture state and fills defaults", () => {
    const state = parseState({
      nodes: [{ id: "svc-1", kind: "service", name: "Orders API" }],
    });

    expect(state.version).toBe(1);
    expect(state.nodes[0].props).toEqual({});
    expect(state.edges).toEqual([]);
    expect(state.decisions).toEqual([]);
  });

  it("rejects a node without an id", () => {
    const result = safeParseState({ nodes: [{ kind: "service", name: "Orders API" }] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown node kind", () => {
    const result = safeParseState({ nodes: [{ id: "x", kind: "cache", name: "Redis" }] });
    expect(result.success).toBe(false);
  });
});
