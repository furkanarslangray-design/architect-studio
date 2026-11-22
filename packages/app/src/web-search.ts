export type SearchProvider = "auto" | "tavily" | "brave" | "duckduckgo";

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  provider: Exclude<SearchProvider, "auto">;
  query: string;
  results: WebSearchResultItem[];
  note?: string;
}

export interface WebSearchOptions {
  provider?: SearchProvider;
  /** Explicit key for the selected provider; falls back to environment keys. */
  apiKey?: string;
  tavilyApiKey?: string;
  braveApiKey?: string;
  maxResults?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class WebSearchError extends Error {
  constructor(
    message: string,
    readonly provider: SearchProvider,
  ) {
    super(message);
    this.name = "WebSearchError";
  }
}

export const WEB_SEARCH_PROVIDERS: SearchProvider[] = ["auto", "tavily", "brave", "duckduckgo"];

export function isSearchProvider(value: unknown): value is SearchProvider {
  return typeof value === "string" && (WEB_SEARCH_PROVIDERS as readonly string[]).includes(value);
}

export function resolveSearchProvider(options: WebSearchOptions = {}): Exclude<SearchProvider, "auto"> {
  const requested = options.provider ?? "auto";
  const tavily = options.apiKey ?? options.tavilyApiKey ?? process.env.TAVILY_API_KEY;
  const brave = options.apiKey ?? options.braveApiKey ?? process.env.BRAVE_API_KEY;
  if (requested !== "auto") return requested;
  if (tavily) return "tavily";
  if (brave) return "brave";
  return "duckduckgo";
}

function endpoint(provider: string): string {
  return provider === "tavily" ? "https://api.tavily.com/search" : "https://api.search.brave.com/res/v1/web/search";
}

async function requestJson(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new WebSearchError(`Search request failed with status ${response.status}`, "auto");
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Looks up current API and library references before architecture generation.
 * Tavily and Brave are used when a key is present; DuckDuckGo's keyless
 * instant-answer API is the zero-configuration fallback.
 */
export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) throw new WebSearchError("A search query is required", options.provider ?? "auto");
  const provider = resolveSearchProvider(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResults = Math.min(Math.max(options.maxResults ?? 5, 1), 10);
  const timeoutMs = options.timeoutMs ?? 8000;
  const apiKey = options.apiKey ?? (provider === "tavily" ? options.tavilyApiKey ?? process.env.TAVILY_API_KEY : provider === "brave" ? options.braveApiKey ?? process.env.BRAVE_API_KEY : undefined);

  if ((provider === "tavily" || provider === "brave") && !apiKey) {
    throw new WebSearchError(
      `${provider === "tavily" ? "Tavily" : "Brave"} search needs an API key (set ${
        provider === "tavily" ? "TAVILY_API_KEY" : "BRAVE_API_KEY"
      }).`,
      provider,
    );
  }

  let url: string;
  let init: RequestInit;
  if (provider === "tavily") {
    url = endpoint(provider);
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query: trimmed, search_depth: "basic", max_results: maxResults }),
    };
  } else if (provider === "brave") {
    const params = new URLSearchParams({ q: trimmed, count: String(maxResults) });
    url = `${endpoint(provider)}?${params.toString()}`;
    init = { headers: { Accept: "application/json", "X-Subscription-Token": apiKey ?? "" } };
  } else {
    const params = new URLSearchParams({ q: trimmed, format: "json", no_html: "1", no_redirect: "1" });
    url = `https://api.duckduckgo.com/?${params.toString()}`;
    init = { headers: { Accept: "application/json" } };
  }

  let payload: any;
  try {
    payload = await requestJson(fetchImpl, url, init, timeoutMs);
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new WebSearchError(`Search request failed: ${detail}`, provider);
  }

  if (provider === "tavily") {
    const results = Array.isArray(payload?.results)
      ? payload.results.slice(0, maxResults).map((item: any) => ({
          title: String(item?.title ?? item?.url ?? "Result"),
          url: String(item?.url ?? ""),
          snippet: String(item?.content ?? "").slice(0, 600),
        }))
      : [];
    return { provider, query: trimmed, results };
  }

  if (provider === "brave") {
    const raw = Array.isArray(payload?.web?.results) ? payload.web.results : [];
    return {
      provider,
      query: trimmed,
      results: raw.slice(0, maxResults).map((item: any) => ({
        title: String(item?.title ?? "Result"),
        url: String(item?.url ?? ""),
        snippet: String(item?.description ?? "").replace(/<[^>]+>/g, "").slice(0, 600),
      })),
    };
  }

  return { provider, query: trimmed, results: duckDuckGoResults(payload, maxResults) };
}

function duckDuckGoResults(payload: any, maxResults: number): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  if (typeof payload?.AbstractText === "string" && payload.AbstractText.trim()) {
    results.push({
      title: String(payload.Heading ?? "Summary"),
      url: String(payload.AbstractURL ?? ""),
      snippet: payload.AbstractText.slice(0, 600),
    });
  }
  const walk = (topics: any[]) => {
    for (const topic of topics) {
      if (results.length >= maxResults) return;
      if (topic && Array.isArray(topic.Topics)) {
        walk(topic.Topics);
        continue;
      }
      if (topic && typeof topic.Text === "string") {
        results.push({
          title: topic.Text.split(" - ")[0]?.slice(0, 120) ?? "Result",
          url: String(topic.FirstURL ?? ""),
          snippet: topic.Text.slice(0, 600),
        });
      }
    }
  };
  if (Array.isArray(payload?.RelatedTopics)) walk(payload.RelatedTopics);
  return results.slice(0, maxResults);
}

/** Compact prompt-ready context, bounded so it cannot crowd out the architecture state. */
export function formatSearchContext(result: WebSearchResult, maxCharacters = 4000): string {
  if (result.results.length === 0) return "";
  const lines = result.results.map(
    (item, index) => `${index + 1}. ${item.title}\n   ${item.url}\n   ${item.snippet.replace(/\s+/g, " ").trim()}`,
  );
  const header = `Current references (${result.provider} web search for "${result.query}"):`;
  const body = lines.join("\n");
  const combined = `${header}\n${body}`;
  return combined.length > maxCharacters ? `${combined.slice(0, maxCharacters)}\n…` : combined;
}
