import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  architectGenerate,
  architectPreview,
  architectReverseEngineer,
  architectValidate,
  TOOL_SUMMARIES,
} from "../src/tools";
import { createMcpServer, MCP_SERVER_VERSION } from "../src";

const scratch = mkdtempSync(join(tmpdir(), "mcp-test-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("MCP tools", () => {
  it("creates a stdio server with the four documented tools", () => {
    const server = createMcpServer();
    expect(server).toBeTruthy();
    expect(MCP_SERVER_VERSION).toBe("2.2.0");
    expect(Object.keys(TOOL_SUMMARIES)).toEqual([
      "architect_generate",
      "architect_preview",
      "architect_validate",
      "architect_reverse_engineer",
    ]);
  });

  it("architect_preview returns the Studio payload", async () => {
    const result = await architectPreview({ idea: "postgres orders api with redis events", demo: true, locale: "tr" });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.summary.components).toBeGreaterThanOrEqual(2);
    expect(payload.tasks.length).toBeGreaterThan(0);
    expect(payload.validation.ok).toBe(true);
    expect(payload.diagram).toContain("flowchart");
    expect(payload.artifacts).toContain("openapi.yaml");
  });

  it("architect_generate writes a ZIP and reports its size", async () => {
    const outputPath = join(scratch, "package.zip");
    const result = await architectGenerate({ idea: "fastify billing api with postgres", demo: true, outputPath });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.outputPath).toBe(outputPath);
    expect(payload.sizeBytes).toBeGreaterThan(1000);
    expect(statSync(outputPath).size).toBe(payload.sizeBytes);
    expect(payload.validation.ok).toBe(true);
    expect(readFileSync(outputPath).subarray(0, 2).toString()).toBe("PK");
  });

  it("architect_validate checks explicit artifacts", async () => {
    const preview = await architectPreview({
      idea: "postgres orders api with redis events",
      demo: true,
      includeFiles: true,
    });
    const files = JSON.parse(preview.content[0].text).files as Record<string, string>;
    const result = await architectValidate({ files });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.validation.ok).toBe(true);
    expect(payload.validation.checksRun).toBeGreaterThan(0);
  });

  it("architect_reverse_engineer derives state from a repository", async () => {
    const root = join(scratch, "repo");
    mkdirSync(join(root, "prisma"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "billing", dependencies: { express: "^4.0.0", "@prisma/client": "^5.0.0" } }),
    );
    writeFileSync(
      join(root, "prisma/schema.prisma"),
      "model Invoice {\n  id String @id\n  amount Decimal\n}\n",
    );
    const result = await architectReverseEngineer({ path: root });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.state.nodes.length).toBeGreaterThanOrEqual(2);
    expect(payload.state.entities[0].name).toBe("Invoice");
    expect(payload.summary).toContain("files scanned");
  });

  it("reports tool-level errors as MCP error content", async () => {
    const result = await architectValidate({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Provide `files`");

    const reverse = await architectReverseEngineer({ path: join(scratch, "missing") });
    expect(reverse.isError).toBe(true);
  });
});
