import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseState } from "../../core/src/state";
import { buildTaskPackets } from "../../core/src/task-packet";
import {
  generateAsyncAPI,
  generateDocs,
  generateMermaid,
  generateOpenAPI31,
  generatePrisma,
} from "../../generators/src";
import { repairArtifacts, validateArtifacts } from "../src";

function validFiles() {
  const state = parseState(
    JSON.parse(readFileSync(join(__dirname, "../../generators/tests/fixtures/ecommerce.json"), "utf8")),
  );
  const packets = buildTaskPackets(state);
  return {
    ...generateDocs(state, packets),
    "openapi.yaml": generateOpenAPI31(state),
    "asyncapi.yaml": generateAsyncAPI(state),
    "prisma/schema.prisma": generatePrisma(state),
    "diagram.mmd": generateMermaid(state),
    "metrics.json": JSON.stringify([{ name: "packet_prompt_tokens", value: 120, target: "<= 1500", pass: true }]),
  } as Record<string, string>;
}

describe("deterministic validation", () => {
  it("accepts the generated artifact set with a 100% pass rate", () => {
    const report = validateArtifacts(validFiles());
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.passRate).toBe(1);
    expect(report.unresolvedRefs).toBe(0);
    expect(report.deterministicCoverage).toBe(1);
    expect(report.checksRun).toBeGreaterThanOrEqual(10);
    expect(report.artifactsValidated).toContain("openapi");
  });

  it("detects an unresolved schema reference", () => {
    const files = validFiles();
    files["openapi.yaml"] = files["openapi.yaml"].replace(
      "#/components/schemas/Health",
      "#/components/schemas/Missing",
    );
    const report = validateArtifacts(files);
    expect(report.ok).toBe(false);
    expect(report.unresolvedRefs).toBe(1);
  });

  it("detects duplicate operation ids", () => {
    const files = validFiles();
    const doc = YAML.parse(files["openapi.yaml"]) as any;
    doc.paths["/user-api/health"].get.operationId = doc.paths["/order-api/health"].get.operationId;
    files["openapi.yaml"] = YAML.stringify(doc);
    const report = validateArtifacts(files);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.message.includes("duplicate operationId"))).toBe(true);
  });

  it("detects unbalanced Prisma braces", () => {
    const files = validFiles();
    files["prisma/schema.prisma"] += "\nmodel Broken {\n";
    const report = validateArtifacts(files);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.file === "prisma/schema.prisma")).toBe(true);
  });

  it("requires packet files when strict task validation is enabled", () => {
    const report = validateArtifacts(validFiles(), { requireTaskFiles: true });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.message.includes("missing packet file"))).toBe(true);
  });

  it("reports artifacts without a deterministic validator", () => {
    const files = validFiles();
    files["notes.txt"] = "free-form notes";
    const report = validateArtifacts(files);
    expect(report.deterministicCoverage).toBeLessThan(1);
    expect(report.issues.some((issue) => issue.message.includes("No deterministic validator"))).toBe(true);
  });

  it("rejects schemas that require undeclared properties", () => {
    const files = validFiles();
    const doc = YAML.parse(files["openapi.yaml"]) as any;
    doc.components.schemas.OrderAPIItem.required.push("missingField");
    files["openapi.yaml"] = YAML.stringify(doc);
    const report = validateArtifacts(files);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.message.includes("undeclared property"))).toBe(true);
  });
});

describe("deterministic self-heal", () => {
  it("repairs a missing OpenAPI header, info block and empty paths without an LLM", () => {
    const files = validFiles();
    files["openapi.yaml"] = "paths: {}\n";
    expect(validateArtifacts(files).ok).toBe(false);

    const repaired = repairArtifacts(files);
    expect(repaired.rounds).toBeGreaterThanOrEqual(1);
    expect(repaired.rounds).toBeLessThanOrEqual(2);
    expect(validateArtifacts(repaired.files).ok).toBe(true);
  });

  it("repairs an empty Mermaid diagram", () => {
    const files = validFiles();
    files["diagram.mmd"] = "";
    const repaired = repairArtifacts(files);
    expect(validateArtifacts(repaired.files).ok).toBe(true);
  });

  it("repairs invalid metrics and a missing manifest", () => {
    const files = validFiles();
    files["metrics.json"] = "not json";
    delete files["MANIFEST.md"];
    const repaired = repairArtifacts(files);
    expect(validateArtifacts(repaired.files).ok).toBe(true);
    expect(JSON.parse(repaired.files["metrics.json"])[0].name).toBeDefined();
  });
});
