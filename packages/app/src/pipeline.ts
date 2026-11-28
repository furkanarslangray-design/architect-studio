import type { ArchState } from "@architect-studio/core";
import type { MetricReport } from "@architect-studio/core";
import type { TaskBuildOptions, TaskPacket } from "@architect-studio/core";
import type { Locale } from "@architect-studio/core";
import type { ValidationReport } from "@architect-studio/validators";
import { buildPackage, type ZipStream } from "@architect-studio/packager";
import { ideaToState, type LlmOptions } from "./llm";
import {
  countFlaggedResults,
  externalNodesWithoutWebEvidence,
  formatSearchContext,
  webSearch,
  type SearchProvider,
  type WebSearchResult,
} from "./web-search";

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
  const notes: string[] = [];

  if (options.webSearch) {
    try {
      research = await webSearch(idea, {
        provider: options.searchProvider,
        apiKey: options.searchApiKey,
        fetchImpl: options.searchFetchImpl,
      });
      const context = formatSearchContext(research);
      if (context) prompt = `${idea}\n\n${context}`;
      const flagged = countFlaggedResults(research);
      if (flagged > 0) {
        notes.push(`Web search: ${flagged} result(s) contained instruction-like text; kept as untrusted data.`);
      }
      if (research.results.length === 0) notes.push("Web search returned no results; continuing with the idea only.");
    } catch (error) {
      notes.push(`Web search unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const state = await ideaToState(prompt, options);
  if (research) {
    const unsourced = externalNodesWithoutWebEvidence(state);
    if (unsourced.length > 0) {
      notes.push(`Web search was on but these external nodes carry no web evidence: ${unsourced.join(", ")}.`);
    }
  }
  const searchNote = notes.length > 0 ? notes.join(" ") : undefined;
  const pkg = await buildPackage(state, {
    secrets: options.apiKey ? [options.apiKey] : [],
    taskOptions: options.taskOptions,
    locale: options.locale,
  });
  return { state, ...pkg, ...(research ? { research } : {}), ...(searchNote ? { searchNote } : {}) };
}
