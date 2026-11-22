import type { ArchState } from "../../core/src/state";
import type { MetricReport } from "../../core/src/metrics";
import type { ValidationReport } from "../../validators/src";
import { buildPackage } from "../../packager/src";
import { ideaToState, type LlmOptions } from "./llm";

export interface PipelineResult {
  state: ArchState;
  zip: Buffer;
  files: Record<string, string>;
  metrics: MetricReport[];
  validation: ValidationReport;
}

export async function runPipeline(idea: string, options: LlmOptions = {}): Promise<PipelineResult> {
  const state = await ideaToState(idea, options);
  const pkg = await buildPackage(state, {
    secrets: options.apiKey ? [options.apiKey] : [],
  });
  return { state, ...pkg };
}
