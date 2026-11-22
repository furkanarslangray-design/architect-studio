import { describe, expect, it } from "vitest";
import type { ArchState } from "../src/state";
import { contractCoverage, dependencyDepth, diffStates, hasCycle, validateState } from "../src/diff";

function baseState(): ArchState {
  return {
    version: 1,
    nodes: [
      { id: "db", kind: "database", name: "Orders DB", props: {} },
      { id: "svc", kind: "service", name: "Orders API", props: {} },
      { id: "ui", kind: "ui", name: "Storefront", props: {} },
    ],
    edges: [
      { id: "e1", from: "svc", to: "db", protocol: "sql" },
      { id: "e2", from: "ui", to: "svc", protocol: "http" },
    ],
    decisions: [],
  };
}

describe("state validation", () => {
  it("accepts a valid DAG and reports no errors", () => {
    expect(validateState(baseState())).toEqual([]);
  });

  it("reports duplicate node ids", () => {
    const state = baseState();
    state.nodes.push({ id: "db", kind: "database", name: "Other DB", props: {} });
    expect(validateState(state).some((error) => error.includes("Duplicate node id"))).toBe(true);
  });

  it("reports dangling edges", () => {
    const state = baseState();
    state.edges.push({ id: "e3", from: "svc", to: "missing", protocol: "http" });
    expect(validateState(state).some((error) => error.includes("Dangling edge"))).toBe(true);
  });

  it("detects cycles", () => {
    const state = baseState();
    state.edges.push({ id: "e3", from: "db", to: "svc", protocol: "http" });
    expect(hasCycle(state)).toBe(true);
    expect(validateState(state).some((error) => error.includes("cycle"))).toBe(true);
  });
});

describe("diff and dependency depth", () => {
  it("computes the longest dependency path", () => {
    expect(dependencyDepth(baseState())).toBe(2);
  });

  it("returns a sentinel depth for a cycle", () => {
    const state = baseState();
    state.edges.push({ id: "e3", from: "db", to: "svc", protocol: "http" });
    expect(dependencyDepth(state)).toBe(999);
  });

  it("diffs nodes and edges", () => {
    const before = baseState();
    const after = baseState();
    after.nodes.push({ id: "q", kind: "queue", name: "Events", props: {} });
    after.nodes[1].name = "Orders Service";
    after.edges.push({ id: "e3", from: "svc", to: "q", protocol: "event" });

    const diff = diffStates(before, after);
    expect(diff.addedNodes).toEqual(["q"]);
    expect(diff.changedNodes).toEqual(["svc"]);
    expect(diff.addedEdges).toEqual(["e3"]);
    expect(diff.removedNodes).toEqual([]);
  });

  it("computes contract coverage", () => {
    const state = baseState();
    expect(contractCoverage(state, ["db", "svc", "ui"], ["e1", "e2"])).toBe(1);
    expect(contractCoverage(state, ["db"], ["e1"])).toBeCloseTo(2 / 5);
  });
});
