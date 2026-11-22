import type { ArchState } from "../../core/src/state";
import type { MetricReport } from "../../core/src/metrics";
import type { TaskBuildOptions, TaskPacket } from "../../core/src/task-packet";
import type { Locale } from "../../core/src/i18n";
import type { ValidationReport } from "../../validators/src";
import { buildPackage, type ZipStream } from "../../packager/src";
import { ideaToState, type LlmOptions } from "./llm";
import { formatSearchContext, webSearch, type SearchProvider, type WebSearchResult } from "./web-search";

export interface PipelineOptions extends LlmOptions {
  taskOptions?: TaskBuildOptions;
  locale?: Locale;
  /** Look up current references before asking the model for an architecture. */
  webSearch?: boolean;
  searchProvider?: SearchProvider;
  searchApiKey?: string;
  searchFetchImpl?: typeof fetch;
}

export interface PipelineResult {
  state: ArchState;
  zip: ZipStream;
  files: Record<string, string>;
  metrics: MetricReport[];
  validation: ValidationReport;
  packets: TaskPacket[];
  research?: WebSearchResult;
  searchNote?: string;
}

export async function runPipeline(idea: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  let prompt = idea;
  let research: WebSearchResult | undefined;
  let searchNote: string | undefined;

  if (options.webSearch) {
    try {
      research = await webSearch(idea, {
        provider: options.searchProvider,
        apiKey: options.searchApiKey,
        fetchImpl: options.searchFetchImpl,
      });
      const context = formatSearchContext(research);
      if (context) prompt = `${idea}\n\n${context}`;
      if (research.results.length === 0) searchNote = "Web search returned no results; continuing with the idea only.";
    } catch (error) {
      searchNote = `Web search unavailable: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }

  const state = await ideaToState(prompt, options);
  const pkg = await buildPackage(state, {
    secrets: options.apiKey ? [options.apiKey] : [],
    taskOptions: options.taskOptions,
    locale: options.locale,
  });
  return { state, ...pkg, ...(research ? { research } : {}), ...(searchNote ? { searchNote } : {}) };
}
