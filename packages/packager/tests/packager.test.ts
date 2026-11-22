import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseState } from "../../core/src/state";
import { buildPackage } from "../src";

function fixture() {
  return parseState(
    JSON.parse(readFileSync(join(__dirname, "../../generators/tests/fixtures/ecommerce.json"), "utf8")),
  );
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
    expect(zip.file("TASKS.md")).not.toBeNull();
    expect(zip.file("tasks/T-001.md")).not.toBeNull();
    expect(zip.file(".opencode/agents/reviewer.md")).not.toBeNull();
  });

  it("reports every output metric as passing for the reference architecture", async () => {
    const result = await buildPackage(fixture());
    const failed = result.metrics.filter((metric) => !metric.pass);
    expect(failed).toEqual([]);
    expect(result.metrics.find((metric) => metric.name === "package_size_kb")!.value).toBeLessThanOrEqual(500);
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
});
