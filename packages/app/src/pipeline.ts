import type { ArchState } from "../../core/src/state";
import type { MetricReport } from "../../core/src/metrics";
import type { TaskBuildOptions, TaskPacket } from "../../core/src/task-packet";
import type { Locale } from "../../core/src/i18n";
import type { ValidationReport } from "../../validators/src";
import { buildPackage, type ZipStream } from "../../packager/src";
import { ideaToState, type LlmOptions } from "./llm";

export interface PipelineOptions extends LlmOptions {
  taskOptions?: TaskBuildOptions;
  locale?: Locale;
}

export interface PipelineResult {
  state: ArchState;
  zip: ZipStream;
  files: Record<string, string>;
  metrics: MetricReport[];
  validation: ValidationReport;
  packets: TaskPacket[];
}

export async function runPipeline(idea: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  const state = await ideaToState(idea, options);
  const pkg = await buildPackage(state, {
    secrets: options.apiKey ? [options.apiKey] : [],
    taskOptions: options.taskOptions,
    locale: options.locale,
  });
  return { state, ...pkg };
}
