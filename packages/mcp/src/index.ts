#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  architectGenerate,
  architectPreview,
  architectReverseEngineer,
  architectValidate,
  TOOL_SUMMARIES,
  type ToolResult,
} from "./tools";

export const MCP_SERVER_VERSION = "2.0.0";

const locale = z.string().describe("Output language: en, tr, de, es, fr, pt, ja or zh").optional();
const runtime = {
  demo: z.boolean().optional().describe("Use the deterministic demo producer instead of an LLM call"),
  locale,
  apiKey: z.string().optional().describe("BYOK OpenAI-compatible key; never persisted"),
  baseUrl: z.string().optional().describe("OpenAI-compatible base URL"),
  model: z.string().optional().describe("Model name"),
};

/**
 * Registration is intentionally untyped at the SDK boundary: the SDK's
 * conditional generics over zod schemas can exceed the TypeScript instantiation
 * limit, while the tool handlers validate their own inputs at runtime.
 */
function register(
  server: McpServer,
  name: keyof typeof TOOL_SUMMARIES,
  inputSchema: z.ZodRawShape,
  handler: (args: any) => Promise<ToolResult>,
): void {
  (server.registerTool as any)(
    name,
    { title: name, description: TOOL_SUMMARIES[name], inputSchema },
    async (args: any) => handler(args),
  );
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "architect-studio", version: MCP_SERVER_VERSION });

  register(
    server,
    "architect_generate",
    {
      idea: z.string().optional().describe("Natural-language architecture idea"),
      state: z.unknown().optional().describe("Existing ArchState JSON"),
      ...runtime,
      webSearch: z.boolean().optional().describe("Augment the idea with live web search references"),
      packageManager: z.enum(["pnpm", "npm", "yarn", "bun"]).optional(),
      testRunner: z.enum(["vitest", "jest", "node"]).optional(),
      outputPath: z.string().optional().describe("Where to write the ZIP (default out/agent-package.zip)"),
    },
    (args) => architectGenerate(args),
  );

  register(
    server,
    "architect_preview",
    {
      idea: z.string().optional().describe("Natural-language architecture idea"),
      state: z.unknown().optional().describe("Existing ArchState JSON"),
      ...runtime,
      webSearch: z.boolean().optional(),
      includeFiles: z.boolean().optional().describe("Include every generated artifact in the response"),
    },
    (args) => architectPreview(args),
  );

  register(
    server,
    "architect_validate",
    {
      files: z.record(z.string()).optional().describe("Map of artifact path to content"),
      state: z.unknown().optional().describe("Existing ArchState JSON"),
      locale,
    },
    (args) => architectValidate(args),
  );

  register(
    server,
    "architect_reverse_engineer",
    {
      path: z.string().describe("Absolute or relative path to the repository"),
      maxFiles: z.number().int().positive().max(20_000).optional(),
      maxDepth: z.number().int().positive().max(32).optional(),
    },
    (args) => architectReverseEngineer(args),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel; diagnostics must go to stderr.
  console.error("architect-studio MCP server ready (stdio)");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "MCP server failed");
    process.exit(1);
  });
}
