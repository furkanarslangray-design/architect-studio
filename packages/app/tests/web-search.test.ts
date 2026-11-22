import { describe, expect, it } from "vitest";
import {
  formatSearchContext,
  resolveSearchProvider,
  WebSearchError,
  webSearch,
} from "../src/web-search";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("web search", () => {
  it("selects Tavily or Brave when a key is present and DuckDuckGo otherwise", () => {
    expect(resolveSearchProvider({})).toBe("duckduckgo");
    expect(resolveSearchProvider({ apiKey: "tvly-1" })).toBe("tavily");
    expect(resolveSearchProvider({ provider: "brave", apiKey: "brave-1" })).toBe("brave");
    expect(resolveSearchProvider({ provider: "duckduckgo", apiKey: "tvly-1" })).toBe("duckduckgo");
  });

  it("parses Tavily results", async () => {
    let requestedUrl = "";
    let requestedBody: any;
    const result = await webSearch("next.js server actions", {
      provider: "tavily",
      apiKey: "tvly-test",
      fetchImpl: (async (url: string, init: RequestInit) => {
        requestedUrl = url;
        requestedBody = JSON.parse(String(init.body));
        return jsonResponse({
          results: [
            { title: "Server Actions", url: "https://nextjs.org/docs", content: "Use server actions for mutations." },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(requestedUrl).toBe("https://api.tavily.com/search");
    expect(requestedBody.api_key).toBe("tvly-test");
    expect(result.provider).toBe("tavily");
    expect(result.results[0].url).toBe("https://nextjs.org/docs");
  });

  it("parses Brave results and strips markup", async () => {
    const result = await webSearch("prisma migrations", {
      provider: "brave",
      apiKey: "brave-test",
      fetchImpl: (async () =>
        jsonResponse({
          web: { results: [{ title: "Prisma Migrate", url: "https://prisma.io", description: "<b>Migrate</b> safely" }] },
        })) as unknown as typeof fetch,
    });
    expect(result.provider).toBe("brave");
    expect(result.results[0].snippet).toBe("Migrate safely");
  });

  it("falls back to the keyless DuckDuckGo instant answer API", async () => {
    const result = await webSearch("what is event sourcing", {
      provider: "duckduckgo",
      fetchImpl: (async () =>
        jsonResponse({
          Heading: "Event sourcing",
          AbstractText: "Event sourcing stores state as a sequence of events.",
          AbstractURL: "https://example.com/event-sourcing",
          RelatedTopics: [{ Text: "CQRS - command query responsibility segregation", FirstURL: "https://example.com/cqrs" }],
        })) as unknown as typeof fetch,
    });
    expect(result.provider).toBe("duckduckgo");
    expect(result.results.length).toBe(2);
    expect(formatSearchContext(result)).toContain("Event sourcing stores state");
  });

  it("requires a key for keyed providers", async () => {
    await expect(webSearch("query", { provider: "tavily", apiKey: "", tavilyApiKey: "" })).rejects.toBeInstanceOf(
      WebSearchError,
    );
  });

  it("surfaces HTTP failures clearly", async () => {
    await expect(
      webSearch("query", {
        provider: "tavily",
        apiKey: "tvly-test",
        fetchImpl: (async () => jsonResponse({}, 429)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/status 429/);
  });

  it("bounds prompt context", () => {
    const context = formatSearchContext(
      {
        provider: "duckduckgo",
        query: "q",
        results: Array.from({ length: 30 }, (_, index) => ({
          title: `Title ${index}`,
          url: "https://example.com",
          snippet: "x".repeat(200),
        })),
      },
      500,
    );
    expect(context.length).toBeLessThanOrEqual(502);
  });
});
