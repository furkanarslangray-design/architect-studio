import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

/**
 * Automated MCP scanners spawn `pnpm mcp`; this test does the same and walks the
 * handshake + tool list, so a missing build step or a stray stdout line fails
 * here instead of in the scanner.
 */
describe("MCP entry point", () => {
  it("starts through pnpm mcp and exposes the four tools", async () => {
    const root = join(__dirname, "../../..");
    const transport = new StdioClientTransport({
      command: "pnpm",
      args: ["mcp"],
      cwd: root,
      stderr: "pipe",
    });
    const client = new Client({ name: "entry-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "architect_generate",
        "architect_preview",
        "architect_reverse_engineer",
        "architect_validate",
      ]);
      expect(tools.every((tool) => Boolean(tool.description))).toBe(true);
    } finally {
      await client.close();
    }
  }, 60_000);
});
