import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseState, type ArchState } from "../../core/src/state";
import { buildPackage } from "../src";

function fixture(name: "ecommerce" | "domain" = "ecommerce") {
  return parseState(JSON.parse(readFileSync(join(__dirname, "../../generators/tests/fixtures", `${name}.json`), "utf8")));
}

describe("packager", () => {
  it("builds a ZIP with tasks, OpenCode agents, docs, and metrics", async () => {
    const result = await buildPackage(fixture());
    const zip = await JSZip.loadAsync(result.zip);

    expect(result.files["TASKS.md"]).toBeDefined();
    expect(result.files["tasks/T-001.md"]).toBeDefined();
    expect(result.files[".opencode/agents/implementer.md"]).toContain("mode: subagent");
    expect(result.files[".opencode/agents/implementer.md"]).toContain("steps: 8");
    expect(result.files["metrics.json"]).toBeDefined();
    expect(result.files["MANIFEST.md"]).toContain("## Overview");
    expect(result.files["MANIFEST.md"]).toContain("## Task packets");
    expect(zip.file("TASKS.md")).not.toBeNull();
    expect(zip.file("tasks/T-001.md")).not.toBeNull();
    expect(zip.file(".opencode/agents/reviewer.md")).not.toBeNull();
    expect(result.packets).toHaveLength(Object.keys(result.files).filter((path) => path.startsWith("tasks/")).length);
  });

  it("reports every output metric as passing for the reference architecture", async () => {
    const result = await buildPackage(fixture());
    const failed = result.metrics.filter((metric) => !metric.pass);
    expect(failed).toEqual([]);
    expect(result.metrics.find((metric) => metric.name === "package_size_kb")!.value).toBeLessThanOrEqual(500);
    expect(result.metrics.find((metric) => metric.name === "deterministic_checks")!.value).toBeGreaterThanOrEqual(10);
  });

  it("keeps every metric passing for a minimal two-node architecture", async () => {
    const state: ArchState = {
      version: 1,
      nodes: [
        { id: "svc", kind: "service", name: "API", props: {} },
        { id: "db", kind: "database", name: "DB", props: { engine: "postgres" } },
      ],
      edges: [{ id: "e1", from: "svc", to: "db", protocol: "sql" }],
      decisions: [],
      entities: [],
    };
    const result = await buildPackage(state);
    expect(result.metrics.filter((metric) => !metric.pass)).toEqual([]);
  });

  it("packages domain entities into contracts, tasks and docs", async () => {
    const result = await buildPackage(fixture("domain"));
    expect(result.files["openapi.yaml"]).toContain("/api/order-api/order:");
    expect(result.files["prisma/schema.prisma"]).toContain("model Order {");
    expect(result.files["ARCHITECTURE.md"]).toContain("## Domain model");
    const tasks = Object.entries(result.files).filter(([path]) => path.startsWith("tasks/"));
    expect(tasks.some(([, content]) => content.includes('"Order"'))).toBe(true);
    expect(result.metrics.filter((metric) => !metric.pass)).toEqual([]);
    expect(result.validation.ok).toBe(true);
  });

  it("emits verification commands for the requested target runtime", async () => {
    const result = await buildPackage(fixture(), {
      taskOptions: { packageManager: "npm", testRunner: "jest" },
    });
    expect(result.files["tasks/T-001.md"]).toContain("npx jest");
    expect(result.files["TASKS.md"]).toContain("npm install");
  });

  it("redacts API keys from every generated file", async () => {
    const state = fixture();
    state.nodes[0].props.apiKey = "sk-test-secret-12345678";
    const result = await buildPackage(state, { secrets: ["sk-test-secret-12345678"] });

    const allText = Object.values(result.files).join("\n");
    expect(allText).not.toContain("sk-test-secret-12345678");
    expect(allText).toContain("[REDACTED]");
  });

  it("rejects invalid architecture state before packaging", async () => {
    const state = fixture();
    state.edges.push({ id: "broken", from: "svc-1", to: "missing", protocol: "http" });
    await expect(buildPackage(state)).rejects.toThrow(/Dangling edge/);
  });

  it("rejects invalid domain entity references before packaging", async () => {
    const state = fixture("domain");
    state.entities[0].serviceId = "missing-service";
    await expect(buildPackage(state)).rejects.toThrow(/missing service/);
  });
});
