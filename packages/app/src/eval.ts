import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens, parseState, type ArchState } from "@architect-studio/core";
import { demoState } from "./demo";
import { ideaToState, type LlmOptions } from "./llm";

export interface EvalExpectation {
  minNodes?: number;
  minEntities?: number;
  minDecisions?: number;
}

export interface EvalCase {
  id: string;
  idea: string;
  expect?: EvalExpectation;
}

export interface EvalCaseResult {
  id: string;
  passed: boolean;
  failures: string[];
  tokens: number;
  /** True when the recorded state is exactly what the deterministic engine returns. */
  fallback: boolean;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  validRate: number;
  fallbackRate: number;
  averageTokens: number;
  cases: EvalCaseResult[];
}

export type EvalMode = "replay" | "record";

export interface RunEvalsOptions {
  /** Directory holding `<case>.json` files and the `recordings/` folder. */
  dir?: string;
  mode?: EvalMode;
  /** Model call used in record mode; defaults to `ideaToState`. */
  generate?: (idea: string, options: LlmOptions) => Promise<ArchState>;
  llm?: LlmOptions;
}

export const DEFAULT_EVAL_DIR = "examples/evals";

export function loadEvalCases(dir = DEFAULT_EVAL_DIR): EvalCase[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new Error(`No eval cases found in ${dir}`);
  return files.map((file) => {
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as Partial<EvalCase>;
    if (typeof parsed?.id !== "string" || typeof parsed?.idea !== "string") {
      throw new Error(`Invalid eval case ${file}: "id" and "idea" are required`);
    }
    return { id: parsed.id, idea: parsed.idea, expect: parsed.expect };
  });
}

function recordingPath(dir: string, id: string): string {
  return join(dir, "recordings", `${id}.json`);
}

function readRecording(dir: string, id: string): ArchState {
  const path = recordingPath(dir, id);
  if (!existsSync(path)) {
    throw new Error(`Missing eval recording for "${id}" at ${path}; run pnpm eval --record first.`);
  }
  return parseState(JSON.parse(readFileSync(path, "utf8")));
}

function checkExpectations(testCase: EvalCase, state: ArchState): string[] {
  const expect = testCase.expect ?? {};
  const failures: string[] = [];
  if (state.nodes.length < (expect.minNodes ?? 0)) {
    failures.push(`nodes ${state.nodes.length} < ${expect.minNodes}`);
  }
  if (state.entities.length < (expect.minEntities ?? 0)) {
    failures.push(`entities ${state.entities.length} < ${expect.minEntities}`);
  }
  if (state.decisions.length < (expect.minDecisions ?? 0)) {
    failures.push(`decisions ${state.decisions.length} < ${expect.minDecisions}`);
  }
  return failures;
}

/**
 * Replay runs keyless in CI from committed recordings; record mode calls the
 * configured model and writes a fresh recording. Metrics cover validity,
 * expectation pass rate, deterministic fallback and prompt size.
 */
export async function runEvals(options: RunEvalsOptions = {}): Promise<EvalReport> {
  const dir = options.dir ?? DEFAULT_EVAL_DIR;
  const mode = options.mode ?? "replay";
  const generate = options.generate ?? ideaToState;
  const cases = loadEvalCases(dir);
  const results: EvalCaseResult[] = [];

  for (const testCase of cases) {
    let state: ArchState;
    if (mode === "record") {
      state = await generate(testCase.idea, options.llm ?? {});
      mkdirSync(join(dir, "recordings"), { recursive: true });
      writeFileSync(recordingPath(dir, testCase.id), `${JSON.stringify(state, null, 2)}\n`);
    } else {
      state = readRecording(dir, testCase.id);
    }

    const fallback =
      mode === "replay" && JSON.stringify(demoState(testCase.idea)) === JSON.stringify(state);
    const failures = checkExpectations(testCase, state);
    results.push({
      id: testCase.id,
      passed: failures.length === 0,
      failures,
      tokens: estimateTokens(JSON.stringify(state)),
      fallback,
    });
  }

  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  return {
    total,
    passed,
    failed: total - passed,
    validRate: total === 0 ? 0 : Math.round((passed / total) * 1000) / 1000,
    fallbackRate: total === 0 ? 0 : Math.round((results.filter((result) => result.fallback).length / total) * 1000) / 1000,
    averageTokens: total === 0 ? 0 : Math.round(results.reduce((sum, result) => sum + result.tokens, 0) / total),
    cases: results,
  };
}

export function formatEvalReport(report: EvalReport): string {
  const lines = [
    "id                          result  tokens  fallback  notes",
    ...report.cases.map((result) => {
      const status = result.passed ? "pass" : "fail";
      const notes = result.failures.join("; ");
      return `${result.id.padEnd(27)} ${status.padEnd(6)} ${String(result.tokens).padStart(6)}  ${
        result.fallback ? "yes     " : "no      "
      }  ${notes}`;
    }),
    "",
    `cases ${report.passed}/${report.total} passed · valid ${report.validRate} · fallback ${report.fallbackRate} · avg tokens ${report.averageTokens}`,
  ];
  return lines.join("\n");
}

export function parseEvalArgs(argv: string[]): { dir: string; mode: EvalMode } {
  let dir = DEFAULT_EVAL_DIR;
  let mode: EvalMode = "replay";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--record") mode = "record";
    else if (arg === "--replay") mode = "replay";
    else if (arg === "--dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--dir needs a path");
      dir = value;
      index += 1;
    }
  }
  return { dir, mode };
}

export async function runEvalCli(argv: string[], io: Pick<Console, "log"> = console): Promise<number> {
  const { dir, mode } = parseEvalArgs(argv);
  const report = await runEvals({ dir, mode });
  io.log(formatEvalReport(report));
  return report.failed === 0 ? 0 : 1;
}
