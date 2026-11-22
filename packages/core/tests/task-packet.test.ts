import { describe, expect, it } from "vitest";
import type { ArchState } from "../src/state";
import {
  buildTaskIndex,
  buildTaskPackets,
  computeTaskMetrics,
  renderTaskIndexMarkdown,
  renderTaskMarkdown,
} from "../src/task-packet";

function fixture(): ArchState {
  return {
    version: 1,
    nodes: [
      { id: "db-1", kind: "database", name: "Orders DB", props: { engine: "postgres" } },
      { id: "db-2", kind: "database", name: "Users DB", props: { engine: "postgres" } },
      { id: "q-1", kind: "queue", name: "Domain Events", props: { engine: "redis" } },
      { id: "svc-1", kind: "service", name: "Order API", props: { runtime: "node" } },
      { id: "svc-2", kind: "service", name: "User API", props: { runtime: "node" } },
      { id: "ui-1", kind: "ui", name: "Storefront", props: { framework: "react" } },
    ],
    edges: [
      { id: "e1", from: "svc-1", to: "db-1", protocol: "sql" },
      { id: "e2", from: "svc-2", to: "db-2", protocol: "sql" },
      { id: "e3", from: "svc-1", to: "q-1", protocol: "event" },
      { id: "e4", from: "ui-1", to: "svc-1", protocol: "http" },
      { id: "e5", from: "ui-1", to: "svc-2", protocol: "http" },
    ],
    decisions: [
      {
        id: "adr-1",
        title: "Use PostgreSQL",
        context: "Orders need transactions",
        decision: "Use PostgreSQL for Orders DB",
        alternatives: ["MongoDB"],
      },
    ],
    entities: [
      {
        id: "ent-order",
        name: "Order",
        description: "A purchase",
        serviceId: "svc-1",
        databaseId: "db-1",
        fields: [
          { name: "id", type: "uuid", required: true, unique: false, primary: true },
          { name: "total", type: "decimal", required: true, unique: false, primary: false },
        ],
        relations: [],
      },
    ],
  };
}

describe("TaskPacketBuilder", () => {
  it("creates one self-contained packet per node", () => {
    const packets = buildTaskPackets(fixture());
    expect(packets).toHaveLength(6);
    for (const packet of packets) {
      expect(packet.acceptance.length).toBeGreaterThan(0);
      expect(packet.verifyCommand).toContain("pnpm vitest");
      expect(packet.files.length).toBeGreaterThan(0);
      expect(packet.files.length).toBeLessThanOrEqual(5);
    }
  });

  it("orders dependencies before dependents", () => {
    const packets = buildTaskPackets(fixture());
    const byTitle = new Map(packets.map((packet) => [packet.title, packet]));
    const service = byTitle.get("Implement Order API service")!;
    const db = byTitle.get("Create Orders DB schema")!;
    expect(service.dependsOn).toContain(db.id);
  });

  it("puts owned domain entities into the owning service packet only", () => {
    const packets = buildTaskPackets(fixture());
    const service = packets.find((packet) => packet.covers.nodes.includes("svc-1"))!;
    const otherService = packets.find((packet) => packet.covers.nodes.includes("svc-2"))!;
    const database = packets.find((packet) => packet.covers.nodes.includes("db-1"))!;

    expect(service.entities).toEqual(["ent-order"]);
    expect(service.context).toContain('"Order"');
    expect(service.context).toContain('"total"');
    expect(otherService.entities).toEqual([]);
    expect(database.entities).toEqual(["ent-order"]);
    expect(service.acceptance.join(" ")).toContain("/api/order-api/order");
  });

  it("keeps every packet within the token budget and covers every node and edge", () => {
    const state = fixture();
    const packets = buildTaskPackets(state);
    const metrics = computeTaskMetrics(state, packets);

    expect(metrics.packetMaxTokens).toBeLessThanOrEqual(2500);
    expect(metrics.packetP95Tokens).toBeLessThanOrEqual(1500);
    expect(metrics.contextSliceRatio).toBeLessThanOrEqual(0.1);
    expect(metrics.duplicateContextRatio).toBeLessThanOrEqual(0.05);
    expect(metrics.maxFilesPerTask).toBeLessThanOrEqual(5);
    expect(metrics.parallelGroups).toBeGreaterThanOrEqual(3);
    expect(metrics.acceptanceCoverage).toBe(1);
    expect(metrics.contractCoverage).toBe(1);
    expect(metrics.indexTokens).toBeLessThanOrEqual(800);
  });

  it("renders a compact index and a self-contained task file", () => {
    const packets = buildTaskPackets(fixture());
    const index = buildTaskIndex(packets);
    const indexMarkdown = renderTaskIndexMarkdown(packets);
    const taskMarkdown = renderTaskMarkdown(packets[0]);

    expect(index.tasks).toHaveLength(packets.length);
    expect(indexMarkdown).toContain("| ID | Task |");
    expect(indexMarkdown).toContain("pnpm install");
    expect(taskMarkdown).toContain("## Acceptance criteria");
    expect(taskMarkdown).toContain("Do not read the whole repository");
  });
});

describe("configurable verification commands", () => {
  it("uses the target package manager and test runner", () => {
    const npmJest = buildTaskPackets(fixture(), { packageManager: "npm", testRunner: "jest" });
    expect(npmJest[0].verifyCommand).toContain("npx jest");

    const bunNode = buildTaskPackets(fixture(), { packageManager: "bun", testRunner: "node" });
    expect(bunNode[0].verifyCommand).toContain("node --test");

    const yarnVitest = buildTaskPackets(fixture(), { packageManager: "yarn", testRunner: "vitest" });
    expect(yarnVitest[0].verifyCommand).toContain("yarn vitest");

    const indexMarkdown = renderTaskIndexMarkdown(yarnVitest, { packageManager: "yarn" });
    expect(indexMarkdown).toContain("yarn install");
  });

  it("rejects unknown runtimes instead of emitting a broken command", () => {
    expect(() => buildTaskPackets(fixture(), { packageManager: "maven" as never })).toThrow(
      /Unsupported package manager/,
    );
    expect(() => buildTaskPackets(fixture(), { testRunner: "mocha" as never })).toThrow(
      /Unsupported test runner/,
    );
  });
});
