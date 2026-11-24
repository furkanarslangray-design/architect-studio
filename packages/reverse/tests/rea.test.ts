import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  analyzeWithRea,
  detectRea,
  normalizeReaOutput,
  parseAsarHeader,
  resetReaDetectionCache,
  staticReaAnalysis,
} from "../src/rea";
import { mergeReaFindings, repoToStateWithRea, summarizeReverse } from "../src";
import { validateState } from "../../core/src/diff";
import type { ArchState } from "../../core/src/state";

const scratch = mkdtempSync(join(tmpdir(), "rea-test-"));
const originalPath = process.env.PATH;
const originalBin = process.env.ARCHITECT_REA_BIN;

afterAll(() => {
  process.env.PATH = originalPath;
  if (originalBin === undefined) delete process.env.ARCHITECT_REA_BIN;
  else process.env.ARCHITECT_REA_BIN = originalBin;
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.PATH = originalPath;
  if (originalBin === undefined) delete process.env.ARCHITECT_REA_BIN;
  else process.env.ARCHITECT_REA_BIN = originalBin;
  resetReaDetectionCache();
});

function asarBuffer(names: string[]): Buffer {
  const header = Buffer.from(
    JSON.stringify({
      files: Object.fromEntries(names.map((name, index) => [name, { size: 12, offset: String(index * 12) }])),
    }),
    "utf8",
  );
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(header.length, 12);
  return Buffer.concat([prefix, header, Buffer.alloc(2048)]);
}

/** Builds a small project that exercises every static analyzer branch. */
function fixtureProject(): string {
  const root = join(scratch, `project-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-app", dependencies: { express: "^4" } }));
  writeFileSync(join(root, ".env.example"), "STRIPE_SECRET_KEY=\nOPENAI_API_KEY=\nREDIS_URL=\nSMTP_HOST=\n");
  writeFileSync(join(root, "Dockerfile"), "FROM node:22-alpine\nCMD [\"node\", \"server.js\"]\n");
  const elf = Buffer.alloc(2048);
  elf.writeUInt32BE(0x7f454c46, 0);
  writeFileSync(join(root, "helper.bin"), elf);
  writeFileSync(join(root, "app.asar"), asarBuffer(["main.js", "preload.js", "package.json"]));
  const bundle = `webpackJsonp([0],{});${"x".repeat(160 * 1024)}fetch("https://api.example-internal.test/v1/orders")`;
  writeFileSync(join(root, "app.bundle.js"), bundle);
  return root;
}

describe("REA bridge", () => {
  it("parses an Electron ASAR header", () => {
    const header = parseAsarHeader(asarBuffer(["main.js", "preload.js", "package.json"]));
    expect(header?.fileCount).toBe(3);
    expect(header?.names).toContain("main.js");
    expect(parseAsarHeader(Buffer.alloc(4))).toBeUndefined();
  });

  it("normalises a findings array with evidence", () => {
    const findings = normalizeReaOutput({
      findings: [
        {
          title: "Redis",
          category: "datastore",
          detail: "ioredis client",
          confidence: 0.92,
          evidence: [{ source: "bundle", path: "app.js", line: 4 }],
        },
        { name: "No category" },
      ],
    });
    expect(findings).toHaveLength(2);
    expect(findings[0].category).toBe("datastore");
    expect(findings[0].evidence[0].path).toBe("app.js");
    expect(findings[1].category).toBe("artifact");
  });

  it("projects REA Evidence documents into findings", () => {
    const findings = normalizeReaOutput({
      source: { kind: "inline" },
      evidence: {
        modules: [{ path: "src/main.js" }, { path: "src/renderer.js" }],
        boundaries: [{ path: "preload.js" }],
        packages: [{ name: "electron" }, { name: "electron-updater" }],
      },
    });
    expect(findings.some((item) => /modules/i.test(item.title))).toBe(true);
    expect(findings.some((item) => /boundaries/i.test(item.title))).toBe(true);
    expect(findings.some((item) => item.category === "package")).toBe(true);
    expect(findings.every((item) => item.evidence.length >= 0)).toBe(true);
  });

  it("projects a REA JavaScript application Evidence envelope", () => {
    const findings = normalizeReaOutput({
      evidence_id: "ev_test",
      subject: { name: "katex", local_path: "/tmp/app" },
      limitations: ["Graph coverage is incomplete."],
      normalized_result: {
        input_path: "/tmp/app",
        format: "directory",
        statistics: { parsed_javascript_files: 1, visited_ast_nodes: 120 },
        summary: { ipc: { operations: 2 } },
        graph: {
          nodes: [
            { kind: "javascript-module", identity: { key: "require:a" }, observations: [] },
            { kind: "javascript-module", identity: { key: "require:b" }, observations: [] },
            { kind: "endpoint", observations: [{ label: "https://api.example.test/v1/orders" }] },
            { kind: "endpoint", observations: [{ label: "\\\\@eqnsw" }] },
            { kind: "package", observations: [{ label: "mermaid" }] },
            { kind: "javascript-asset", observations: [{ label: "app.min.js" }] },
            { kind: "electron-renderer", observations: [{ label: "./dist/index.mjs" }] },
          ],
        },
      },
    });

    const titles = findings.map((finding) => finding.title);
    expect(titles).toContain("Reconstructed JavaScript modules");
    expect(findings.find((finding) => finding.title === "Reconstructed JavaScript modules")?.detail).toContain(
      "2 module reference(s)",
    );
    expect(titles).toContain("External endpoint https://api.example.test/v1/orders");
    expect(titles.some((title) => title.includes("eqnsw"))).toBe(false);
    expect(findings.some((finding) => finding.category === "package")).toBe(true);
    expect(findings.some((finding) => finding.category === "artifact")).toBe(true);
    expect(titles).toContain("Electron process boundaries");
  });

  it("falls back to the built-in analyzer when no CLI is installed", async () => {
    process.env.PATH = join(scratch, "empty-path");
    mkdirSync(join(scratch, "empty-path"), { recursive: true });
    const detection = await detectRea(true);
    expect(detection.available).toBe(false);
    expect(detection.engine).toBe("static");

    const analysis = await analyzeWithRea(fixtureProject());
    expect(analysis.engine).toBe("static");
    expect(analysis.scannedArtifacts).toBeGreaterThan(0);
    const titles = analysis.findings.map((finding) => finding.title).join(" | ");
    expect(titles).toMatch(/Electron ASAR archive/);
    expect(titles).toMatch(/ELF executable/);
    expect(titles).toMatch(/Environment contract/);
    expect(titles).toMatch(/Container image/);
    expect(titles).toMatch(/Webpack bundle|External endpoint/);
  });

  it("runs the rea CLI when ARCHITECT_REA_BIN points at it", async () => {
    const bin = join(scratch, "rea-fake");
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        'case "$1" in',
        '  --version) echo "rea 6.8.0"; exit 0 ;;',
        '  --help) echo "analyze analyze-javascript-application inspect"; exit 0 ;;',
        "esac",
        `echo '{"findings":[{"title":"Redis Client","category":"datastore","detail":"ioredis","confidence":0.93,"evidence":[{"path":"app.bundle.js"}]},{"title":"Electron Shell","category":"runtime","detail":"main process","confidence":0.8,"evidence":[{"path":"app.asar"}]}]}'`,
        "",
      ].join("\n"),
    );
    chmodSync(bin, 0o755);
    process.env.ARCHITECT_REA_BIN = bin;

    const detection = await detectRea(true);
    expect(detection.available).toBe(true);
    expect(detection.engine).toBe("rea");
    expect(detection.version).toContain("6.8.0");
    expect(detection.modes).toContain("analyze-javascript-application");

    const analysis = await analyzeWithRea(fixtureProject());
    expect(analysis.engine).toBe("rea");
    expect(analysis.findings.some((finding) => finding.title === "Redis Client")).toBe(true);
    expect(analysis.findings.some((finding) => finding.title === "Electron Shell")).toBe(true);
  });

  it("merges findings into an architecture state without duplicating nodes", () => {
    const state: ArchState = {
      version: 1,
      nodes: [{ id: "svc-core", kind: "service", name: "Core API", props: {} }],
      edges: [],
      decisions: [],
      entities: [],
    };
    const analysis = staticReaAnalysis(fixtureProject());
    const merged = mergeReaFindings(state, analysis);
    expect(merged.added.length).toBeGreaterThan(0);
    expect(merged.state.nodes.length).toBeGreaterThan(state.nodes.length);
    expect(merged.state.nodes.every((node) => node.props.detected === "rea" || node.id === "svc-core")).toBe(true);
    expect(validateState(merged.state)).toEqual([]);

    const twice = mergeReaFindings(merged.state, analysis);
    expect(twice.state.nodes.length).toBe(merged.state.nodes.length);
  });

  it("derives a valid state from a repository with REA findings attached", async () => {
    const root = fixtureProject();
    const result = await repoToStateWithRea(root);
    expect(result.rea).toBeTruthy();
    expect(result.rea?.engine).toBe("static");
    expect(validateState(result.state)).toEqual([]);
    expect(summarizeReverse(result)).toContain("REA");
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
