import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { generateMermaid } from "@architect-studio/generators";
import { validateArtifacts } from "@architect-studio/validators";
import { buildPackage } from "@architect-studio/packager";
import { repoToState, repoToStateWithRea, summarizeReverse } from "@architect-studio/reverse";
import { safeParseState, type ArchState } from "@architect-studio/core";
import type { Locale } from "@architect-studio/core";
import { runPipeline } from "../../app/src/pipeline";

export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface GenerateInput {
  idea?: string;
  state?: unknown;
  demo?: boolean;
  locale?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  packageManager?: "pnpm" | "npm" | "yarn" | "bun";
  testRunner?: "vitest" | "jest" | "node";
  outputPath?: string;
  webSearch?: boolean;
}

export interface PreviewInput {
  idea?: string;
  state?: unknown;
  demo?: boolean;
  locale?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  includeFiles?: boolean;
  webSearch?: boolean;
}

export interface ValidateInput {
  files?: Record<string, string>;
  state?: unknown;
  locale?: string;
}

export interface ReverseEngineerInput {
  path: string;
  maxFiles?: number;
  maxDepth?: number;
  /** Bridge morluto/rea (or the built-in artifact analyzer) into the result. */
  useRea?: boolean;
}

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function parseStateInput(input: unknown): ArchState {
  const parsed = safeParseState(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid architecture state: ${issue ? `${issue.path.join(".") || "root"}: ${issue.message}` : "schema error"}`);
  }
  return parsed.data;
}

async function buildFromInput(input: GenerateInput | PreviewInput) {
  const locale = (input.locale ?? "en") as Locale;
  if (input.state !== undefined) {
    const state = parseStateInput(input.state);
    return { state, ...(await buildPackage(state, { locale })) };
  }
  const idea = typeof input.idea === "string" ? input.idea.trim() : "";
  if (idea.length < 3) throw new Error("Provide either a non-empty `idea` or an ArchState `state`.");
  const result = await runPipeline(idea, {
    demo: input.demo ?? !input.apiKey,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    model: input.model,
    locale,
    taskOptions: { locale },
    webSearch: input.webSearch === true,
  });
  return { ...result, state: result.state };
}

function summaryOf(state: ArchState, packets: Array<{ id: string; title: string; parallelGroup: string }>) {
  return {
    components: state.nodes.length,
    edges: state.edges.length,
    entities: state.entities.length,
    decisions: state.decisions.length,
    tasks: packets.length,
    waves: new Set(packets.map((packet) => packet.parallelGroup)).size,
  };
}

/**
 * `architect_generate` — builds and verifies a complete agent package, writes
 * the ZIP to disk and returns the same summary the CLI prints.
 */
export async function architectGenerate(input: GenerateInput): Promise<ToolResult> {
  try {
    const built = await buildFromInput(input);
    const outputPath = resolve(input.outputPath ?? "out/agent-package.zip");
    mkdirSync(dirname(outputPath), { recursive: true });
    await pipeline(built.zip.stream(), createWriteStream(outputPath));
    return ok({
      outputPath,
      sizeBytes: built.zip.sizeBytes,
      locale: (input.locale ?? "en") as Locale,
      validation: built.validation,
      summary: summaryOf(built.state, built.packets),
      tasks: built.packets.map((packet) => ({
        id: packet.id,
        title: packet.title,
        wave: packet.parallelGroup,
        dependsOn: packet.dependsOn,
      })),
      artifacts: Object.keys(built.files).sort(),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Generation failed");
  }
}

/** `architect_preview` — the same payload as the Studio preview, without writing a ZIP. */
export async function architectPreview(input: PreviewInput): Promise<ToolResult> {
  try {
    const built = await buildFromInput(input);
    return ok({
      state: built.state,
      diagram: generateMermaid(built.state),
      summary: summaryOf(built.state, built.packets),
      tasks: built.packets.map((packet) => ({
        id: packet.id,
        title: packet.title,
        wave: packet.parallelGroup,
        dependsOn: packet.dependsOn,
        files: packet.files,
        tokens: packet.tokenCount,
      })),
      metrics: built.metrics,
      validation: {
        ok: built.validation.ok,
        passRate: built.validation.passRate,
        checksRun: built.validation.checksRun,
        issues: built.validation.issues,
      },
      artifacts: Object.keys(built.files).sort(),
      ...(input.includeFiles ? { files: built.files } : {}),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Preview failed");
  }
}

/** `architect_validate` — deterministic validation for explicit files or a state. */
export async function architectValidate(input: ValidateInput): Promise<ToolResult> {
  try {
    if (input.files && typeof input.files === "object") {
      const report = validateArtifacts(input.files, { requireTaskFiles: true });
      return ok({ validation: report });
    }
    if (input.state !== undefined) {
      const state = parseStateInput(input.state);
      const built = await buildPackage(state, { locale: (input.locale ?? "en") as Locale });
      return ok({ validation: built.validation, metrics: built.metrics, artifacts: Object.keys(built.files).sort() });
    }
    return fail("Provide `files` (a path → content map) or a `state`.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Validation failed");
  }
}

/** `architect_reverse_engineer` — derives an ArchState from an existing repository. */
export async function architectReverseEngineer(input: ReverseEngineerInput): Promise<ToolResult> {
  try {
    const options = { maxFiles: input.maxFiles, maxDepth: input.maxDepth };
    const result =
      input.useRea === true ? await repoToStateWithRea(input.path, options) : repoToState(input.path, options);
    return ok({
      summary: summarizeReverse(result),
      scannedFiles: result.scannedFiles,
      state: result.state,
      findings: result.findings,
      warnings: result.warnings,
      ...(result.rea
        ? {
            rea: {
              engine: result.rea.engine,
              detection: result.rea.detection,
              scannedArtifacts: result.rea.scannedArtifacts,
              findings: result.rea.findings,
            },
          }
        : {}),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Reverse engineering failed");
  }
}

export const TOOL_SUMMARIES = {
  architect_generate: "Build and verify an agent package from an idea, then write the ZIP.",
  architect_preview: "Preview architecture, tasks, metrics and validation without writing a ZIP.",
  architect_validate: "Run deterministic artifact validation on files or an architecture state.",
  architect_reverse_engineer:
    "Derive an ArchState from an existing repository on disk, optionally bridging morluto/rea artifact analysis.",
};
