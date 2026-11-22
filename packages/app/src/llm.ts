import type { ArchState } from "../../core/src/state";
import { safeParseState, sanitizeState } from "../../core/src/state";
import { validateState } from "../../core/src/diff";
import { demoState } from "./demo";

export interface LlmOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  demo?: boolean;
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT = `You are an AI principal architect. Return ONLY a JSON object, no markdown, matching this shape:
{"version":1,"nodes":[{"id":"string","kind":"service|database|queue|external|ui","name":"string","props":{}}],"edges":[{"id":"string","from":"string","to":"string","protocol":"http|grpc|event|sql"}],"decisions":[{"id":"string","title":"string","context":"string","decision":"string","alternatives":["string"]}],"entities":[{"id":"string","name":"string","description":"string","serviceId":"node id","databaseId":"node id","fields":[{"name":"string","type":"string|text|int|float|decimal|boolean|datetime|date|uuid|json","required":true,"unique":false,"primary":false}],"relations":[{"target":"entity id","field":"optional foreign key column"}]}]}
Rules: at least 2 nodes; ids are unique; every edge points to existing node ids; no cycles; add one decision for each major technology choice. Model the real domain: 1-4 entities with the fields the implementation needs, attach each entity to its owning service and its database, mark exactly one primary field per entity, and declare relations instead of duplicating foreign keys.`;

export async function ideaToState(idea: string, options: LlmOptions = {}): Promise<ArchState> {
  if (options.demo || !options.apiKey) return demoState(idea);

  const endpoint = `${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "gpt-4o-mini";

  let lastError = "LLM request failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content:
                attempt === 0
                  ? idea
                  : `${idea}\n\nReturn only valid JSON. Do not wrap it in markdown fences.`,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = `LLM request failed with status ${response.status}`;
        continue;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content ?? "";
      const parsed = safeParseState(extractJson(content));
      if (!parsed.success) {
        lastError = "LLM returned an invalid architecture state";
        continue;
      }

      const sanitized = sanitizeState(parsed.data);
      const stateErrors = validateState(sanitized.state);
      if (stateErrors.length === 0) return sanitized.state;
      lastError = `LLM returned an invalid architecture state: ${stateErrors[0]}`;
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? "LLM request timed out"
          : "LLM request failed";
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
