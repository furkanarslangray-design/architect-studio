import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoState } from "../src/demo";
import { formatEvalReport, parseEvalArgs, runEvals } from "../src/eval";

const scratch = () => mkdtempSync(join(tmpdir(), "architect-eval-"));

describe("eval harness", () => {
  it("replays the committed recordings without a model key", async () => {
    const report = await runEvals();
    expect(report.total).toBeGreaterThanOrEqual(2);
    expect(report.failed).toBe(0);
    expect(report.validRate).toBe(1);
    expect(report.averageTokens).toBeGreaterThan(0);
    expect(formatEvalReport(report)).toContain("subscription-billing");
  });

  it("fails loudly when a recording is missing", async () => {
    const dir = scratch();
    try {
      writeFileSync(join(dir, "only.json"), JSON.stringify({ id: "only", idea: "a shop" }));
      await expect(runEvals({ dir })).rejects.toThrow(/Missing eval recording for "only"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records a run and replays it back", async () => {
    const dir = scratch();
    try {
      writeFileSync(
        join(dir, "demo.json"),
        JSON.stringify({ id: "demo", idea: "Postgres app", expect: { minNodes: 2, minEntities: 1 } }),
      );
      const recorded = await runEvals({ dir, mode: "record", generate: async (idea) => demoState(idea) });
      expect(recorded.failed).toBe(0);

      const replayed = await runEvals({ dir });
      expect(replayed.failed).toBe(0);
      expect(replayed.fallbackRate).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses replay and record flags", () => {
    expect(parseEvalArgs([])).toEqual({ dir: "examples/evals", mode: "replay" });
    expect(parseEvalArgs(["--record", "--dir", "tmp/evals"])).toEqual({ dir: "tmp/evals", mode: "record" });
  });
});
