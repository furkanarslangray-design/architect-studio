import { validateState } from "../../core/src/diff";
import {
  safeParseState,
  sanitizeState,
  type ArchEdge,
  type ArchNode,
  type ArchState,
  type Entity,
  type EntityField,
  type FieldType,
  type NodeKind,
  type Protocol,
} from "../../core/src/state";
import type { Locale } from "../../core/src/i18n";
import { extractJson } from "./llm";

/**
 * Conversational architecture editing.
 *
 * Two engines share one contract:
 *
 * - `deterministic` — a locale-aware (TR + EN) intent parser that mutates the
 *   `ArchState` without any network call. This is the demo mode and the safety
 *   net used whenever the LLM path fails.
 * - `llm` — BYOK. The model receives the current state plus the instruction and
 *   returns the updated state, which is sanitised and validated exactly like a
 *   deterministic edit before it is accepted.
 *
 * Every result reports the concrete diff so the Studio can show what changed.
 */

export type ChatIntent =
  | "add-cache"
  | "add-database"
  | "add-queue"
  | "add-external"
  | "add-ui"
  | "add-field"
  | "remove-field"
  | "remove-component"
  | "split-services"
  | "describe"
  | "unknown";

export interface ChatChange {
  type: "node" | "edge" | "entity" | "field";
  action: "added" | "removed" | "updated";
  target: string;
  detail: string;
}

export interface ChatResult {
  reply: string;
  state: ArchState;
  changes: ChatChange[];
  source: "deterministic" | "llm";
  intent: ChatIntent;
  notes: string[];
}

export interface ChatOptions {
  locale?: Locale;
  demo?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const FIELD_WORDS = /(alan[ıi]?|field|kolon|column|s[üu]tun|attribute|property|özellik)/i;
const ADD_WORDS = /\b(ekle|koy|kur|add|introduce|include|should have|olmal[ıi]|olsun)\b/i;
const REMOVE_WORDS = /\b(kald[ıi]r|sil|remove|delete|drop|çıkar|cikar)\b/i;
const SPLIT_WORDS = /\b(mikroservis|microservices?|b[öo]l|split|ay[ıi]r|decompose)\b/i;
const SERVICE_WORDS = /\b(servis|service|servislere|services)\b/i;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "add",
  "ekle",
  "koy",
  "kur",
  "bir",
  "ve",
  "and",
  "for",
  "için",
  "icin",
  "with",
  "ile",
  "new",
  "yeni",
  "entity",
  "entities",
  "field",
  "alan",
  "alanı",
  "alanini",
  "column",
  "kolon",
  "property",
  "should",
  "have",
  "olmalı",
  "olsun",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(message: string, value: string): boolean {
  const first = value.split(/[\s/]+/)[0] ?? value;
  if (first.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(first)}`, "iu").test(message);
}

function findEntity(message: string, state: ArchState): Entity | undefined {
  return state.entities.find((entity) => mentions(message, entity.name));
}

function findNode(message: string, state: ArchState): ArchNode | undefined {
  const exact = state.nodes.find((node) => mentions(message, node.name));
  if (exact) return exact;
  return state.nodes.find((node) => mentions(message, node.props.engine ? String(node.props.engine) : node.name));
}

function serviceNode(state: ArchState): ArchNode | undefined {
  return state.nodes.find((node) => node.kind === "service");
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  let counter = 2;
  while (taken.has(id)) id = `${base}-${counter++}`;
  taken.add(id);
  return id;
}

function edgeId(from: string, to: string, taken: Set<string>): string {
  return uniqueId(`edge-${from}-${to}`, taken);
}

function addEdgeOnce(
  edges: ArchEdge[],
  taken: Set<string>,
  from: string,
  to: string,
  protocol: Protocol,
): boolean {
  if (from === to) return false;
  if (edges.some((edge) => edge.from === from && edge.to === to)) return false;
  edges.push({ id: edgeId(from, to, taken), from, to, protocol });
  return true;
}

interface TechSpec {
  name: string;
  kind: NodeKind;
  props: Record<string, string | number | boolean>;
  protocol: Protocol;
}

const TECH_CATALOG: Array<{ match: RegExp; spec: TechSpec; intent: ChatIntent }> = [
  {
    match: /(cache|önbellek|onbellek)/i,
    intent: "add-cache",
    spec: { name: "Redis Cache", kind: "database", props: { engine: "redis", role: "cache" }, protocol: "http" },
  },
  {
    match: /(postgres|postgresql|veritaban|database|mysql|mongo|sql\b)/i,
    intent: "add-database",
    spec: { name: "Primary DB", kind: "database", props: { engine: "postgres" }, protocol: "sql" },
  },
  {
    match: /(kafka)/i,
    intent: "add-queue",
    spec: { name: "Kafka", kind: "queue", props: { engine: "kafka" }, protocol: "event" },
  },
  {
    match: /(rabbit|amqp)/i,
    intent: "add-queue",
    spec: { name: "RabbitMQ", kind: "queue", props: { engine: "rabbitmq" }, protocol: "event" },
  },
  {
    match: /(kuyruk|queue|event bus|olay|mesaj|stream)/i,
    intent: "add-queue",
    spec: { name: "Event Bus", kind: "queue", props: { engine: "redis" }, protocol: "event" },
  },
  {
    match: /(stripe|ödeme|odeme|payment)/i,
    intent: "add-external",
    spec: { name: "Stripe", kind: "external", props: { tech: "payments" }, protocol: "http" },
  },
  {
    match: /(auth0|clerk|keycloak|identity|kimlik|sso)/i,
    intent: "add-external",
    spec: { name: "Identity Provider", kind: "external", props: { tech: "auth" }, protocol: "http" },
  },
  {
    match: /(smtp|sendgrid|mailgun|resend|e-?posta|email)/i,
    intent: "add-external",
    spec: { name: "Email Provider", kind: "external", props: { tech: "email" }, protocol: "http" },
  },
  {
    match: /(s3|blob storage|object storage|depolama)/i,
    intent: "add-external",
    spec: { name: "Object Storage", kind: "external", props: { tech: "storage" }, protocol: "http" },
  },
  {
    match: /(react|next\.?js|frontend|aray[üu]z|web app|\bui\b|mobile|mobil)/i,
    intent: "add-ui",
    spec: { name: "Web App", kind: "ui", props: { framework: "react" }, protocol: "http" },
  },
];

function detectIntent(message: string, state: ArchState): ChatIntent {
  const entity = findEntity(message, state);
  if (entity && REMOVE_WORDS.test(message) && FIELD_WORDS.test(message)) return "remove-field";
  if (entity && ADD_WORDS.test(message) && (FIELD_WORDS.test(message) || ADD_WORDS.test(message))) {
    if (FIELD_WORDS.test(message) || entity.fields.length > 0) return "add-field";
  }
  if (SPLIT_WORDS.test(message) && SERVICE_WORDS.test(message)) return "split-services";
  if (SPLIT_WORDS.test(message) && !/cache|redis/i.test(message)) return "split-services";
  if (/(kald[ıi]r|sil|remove|delete|drop)/i.test(message)) {
    const node = findNode(message, state);
    if (node) return "remove-component";
  }
  if (ADD_WORDS.test(message) || /(ekleyelim|koyal[ıi]m)/i.test(message)) {
    const hit = TECH_CATALOG.find((entry) => entry.match.test(message));
    if (hit) return hit.intent;
  }
  if (/(özetle|ozetle|durum|summary|summarize|what|neler|describ)/i.test(message)) return "describe";
  return "unknown";
}

function inferFieldType(text: string): FieldType {
  if (/\b(uuid)\b/i.test(text)) return "uuid";
  if (/\b(decimal|fiyat|price|tutar|amount|para|money)\b/i.test(text)) return "decimal";
  if (/\b(int|integer|say[ıi]|adet|count|quantity|stock|stok|s[ıi]ra)\b/i.test(text)) return "int";
  if (/\b(bool|boolean|flag|aktif|active|enabled|is[A-Z]\w*)\b/i.test(text)) return "boolean";
  if (/\b(datetime|timestamp|tarih|saat|createdAt|updatedAt)\b/i.test(text)) return "datetime";
  if (/\b(date|g[üu]n)\b/i.test(text)) return "date";
  if (/\b(json|metadata|payload|meta)\b/i.test(text)) return "json";
  if (/\b(text|a[çc][ıi]klama|description|note|not)\b/i.test(text)) return "text";
  if (/\b(float|oran|rate|puan|score)\b/i.test(text)) return "float";
  return "string";
}

const TYPE_WORDS = new Set([
  "int",
  "integer",
  "string",
  "text",
  "decimal",
  "float",
  "boolean",
  "bool",
  "datetime",
  "date",
  "uuid",
  "json",
  "number",
  "numeric",
]);

const MODIFIER_WORDS = new Set([
  "unique",
  "required",
  "primary",
  "optional",
  "nullable",
  "not",
  "null",
  "auto",
  "default",
  "benzersiz",
  "tekil",
  "zorunlu",
  "birincil",
]);

const FIELD_PATTERNS: RegExp[] = [
  /([A-Za-z_][A-Za-z0-9_]*)\s+(?:alan[ıi]?|field|kolon|column|s[üu]tun|property|attribute|özellik)/i,
  /([A-Za-z_][A-Za-z0-9_]*)\s+(?:ekle|koy|olsun|olmal[ıi])\b/i,
  /\b(?:add|ekle|koy)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
];

function isValidFieldCandidate(candidate: string, entity: Entity | undefined): boolean {
  const lower = candidate.toLowerCase();
  if (candidate.length < 2) return false;
  if (/^\d+$/.test(candidate)) return false;
  if (STOPWORDS.has(lower) || TYPE_WORDS.has(lower) || MODIFIER_WORDS.has(lower)) return false;
  if (entity && lower === entity.name.toLowerCase()) return false;
  return true;
}

function extractFieldName(message: string, entity: Entity | undefined): string | undefined {
  for (const pattern of FIELD_PATTERNS) {
    const candidate = message.match(pattern)?.[1];
    if (candidate && isValidFieldCandidate(candidate, entity)) return candidate;
  }
  // Last resort: the first meaningful identifier. Apostrophe fragments such as
  // "Order'a" or "entity'sine" are stripped first so only real names survive.
  const cleaned = message.replace(/[’'][A-Za-zÇĞİÖŞÜçğıöşü]*/g, " ");
  for (const token of cleaned.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (isValidFieldCandidate(token, entity)) return token;
  }
  return undefined;
}

function addTechnology(state: ArchState, spec: TechSpec, taken: { nodes: Set<string>; edges: Set<string> }): ArchState {
  const nodes = [...state.nodes];
  const edges = [...state.edges];
  const owner = serviceNode(state);
  let node = nodes.find(
    (candidate) =>
      candidate.name.toLowerCase() === spec.name.toLowerCase() ||
      (spec.props.engine !== undefined && candidate.props.engine === spec.props.engine && candidate.kind === spec.kind),
  );
  if (!node) {
    node = { id: uniqueId(`${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${spec.kind}`, taken.nodes), kind: spec.kind, name: spec.name, props: { ...spec.props } };
    nodes.push(node);
  }
  let nextEdges = edges;
  if (owner && node.id !== owner.id) {
    const copy = [...edges];
    addEdgeOnce(copy, taken.edges, owner.id, node.id, spec.protocol);
    nextEdges = copy;
  }
  return { ...state, nodes, edges: nextEdges };
}

function removeComponent(state: ArchState, node: ArchNode): ArchState | { error: "last-service" } {
  if (node.kind === "service" && state.nodes.filter((item) => item.kind === "service").length <= 1) {
    return { error: "last-service" };
  }
  const nodes = state.nodes.filter((item) => item.id !== node.id);
  const edges = state.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
  const entities = state.entities.map((entity) => ({
    ...entity,
    ...(entity.serviceId === node.id ? { serviceId: nodes.find((item) => item.kind === "service")?.id } : {}),
    ...(entity.databaseId === node.id ? { databaseId: nodes.find((item) => item.kind === "database")?.id } : {}),
  }));
  return { ...state, nodes, edges, entities };
}

function splitIntoMicroservices(state: ArchState, taken: { nodes: Set<string>; edges: Set<string> }): ArchState | { error: "no-entities" } {
  if (state.entities.length === 0) return { error: "no-entities" };
  const serviceIds = new Set(state.nodes.filter((node) => node.kind === "service").map((node) => node.id));
  const uiNodes = state.nodes.filter((node) => node.kind === "ui");
  const keptNodes = state.nodes.filter((node) => node.kind !== "service");
  if (serviceIds.size > 1 && state.entities.every((entity) => entity.serviceId && serviceIds.has(entity.serviceId))) {
    return { error: "no-entities" };
  }
  const databases = keptNodes.filter((node) => node.kind === "database");
  const queues = keptNodes.filter((node) => node.kind === "queue");
  const externals = keptNodes.filter((node) => node.kind === "external");

  const nodes = [...keptNodes];
  const edges = state.edges.filter((edge) => !serviceIds.has(edge.from) && !serviceIds.has(edge.to));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const created: ArchNode[] = [];
  const entityOwners = new Map<string, string>();

  for (const entity of state.entities) {
    const serviceName = `${entity.name} Service`;
    let node = nodes.find((item) => item.kind === "service" && item.name.toLowerCase() === serviceName.toLowerCase());
    if (!node) {
      node = {
        id: uniqueId(`${serviceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, taken.nodes),
        kind: "service",
        name: serviceName,
        props: { boundedContext: entity.name.toLowerCase(), runtime: "node" },
      };
      nodes.push(node);
      created.push(node);
    }
    entityOwners.set(entity.id, node.id);
  }

  const owners = [...new Set(entityOwners.values())];
  for (const ownerId of owners) {
    for (const database of databases) addEdgeOnce(edges, edgeIds, ownerId, database.id, "sql");
    for (const queue of queues) addEdgeOnce(edges, edgeIds, ownerId, queue.id, "event");
  }
  for (const ui of uiNodes) addEdgeOnce(edges, edgeIds, ui.id, owners[0]!, "http");
  for (const external of externals) addEdgeOnce(edges, edgeIds, owners[0]!, external.id, "http");

  const entities = state.entities.map((entity) => ({
    ...entity,
    serviceId: entityOwners.get(entity.id) ?? entity.serviceId,
  }));
  const decisions = state.decisions.some((decision) => /microservice|bounded context/i.test(decision.title))
    ? state.decisions
    : [
        ...state.decisions,
        {
          id: `adr-${String(state.decisions.length + 1).padStart(3, "0")}`,
          title: "Split into microservices per bounded context",
          context: "Each domain entity is owned by exactly one service so teams can deploy independently.",
          decision: `Run ${created.length} services, one per bounded context, sharing ${databases.length} datastore(s) and ${queues.length} event channel(s).`,
          alternatives: ["Modular monolith", "Serverless functions per entity"],
        },
      ];
  return { ...state, nodes, edges, entities, decisions };
}

function addEntityField(state: ArchState, entity: Entity, name: string, message: string): ArchState {
  if (entity.fields.some((field) => field.name.toLowerCase() === name.toLowerCase())) return state;
  const field: EntityField = {
    name,
    type: inferFieldType(`${name} ${message}`),
    required: /\b(required|zorunlu|null olmas[ıi]n|not null)\b/i.test(message),
    unique: /\b(unique|benzersiz|tekil)\b/i.test(message),
    primary: /\b(primary|birincil|pk)\b/i.test(message),
  };
  return {
    ...state,
    entities: state.entities.map((item) =>
      item.id === entity.id ? { ...item, fields: [...item.fields, field] } : item,
    ),
  };
}

function removeEntityField(state: ArchState, entity: Entity, fieldName: string): ArchState {
  return {
    ...state,
    entities: state.entities.map((item) =>
      item.id === entity.id
        ? { ...item, fields: item.fields.filter((field) => field.name.toLowerCase() !== fieldName.toLowerCase()) }
        : item,
    ),
  };
}

function diffChanges(before: ArchState, after: ArchState): ChatChange[] {
  const changes: ChatChange[] = [];
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) {
      changes.push({ type: "node", action: "added", target: node.name, detail: `${node.kind} component added` });
    }
  }
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) {
      changes.push({ type: "node", action: "removed", target: node.name, detail: `${node.kind} component removed` });
    }
  }
  const beforeEdges = new Set(before.edges.map((edge) => `${edge.from}->${edge.to}`));
  const afterEdges = new Set(after.edges.map((edge) => `${edge.from}->${edge.to}`));
  for (const edge of after.edges) {
    if (!beforeEdges.has(`${edge.from}->${edge.to}`)) {
      const from = afterNodes.get(edge.from)?.name ?? edge.from;
      const to = afterNodes.get(edge.to)?.name ?? edge.to;
      changes.push({ type: "edge", action: "added", target: `${from} → ${to}`, detail: `${edge.protocol} connection added` });
    }
  }
  for (const edge of before.edges) {
    if (!afterEdges.has(`${edge.from}->${edge.to}`)) {
      const from = beforeNodes.get(edge.from)?.name ?? edge.from;
      const to = beforeNodes.get(edge.to)?.name ?? edge.to;
      changes.push({ type: "edge", action: "removed", target: `${from} → ${to}`, detail: "connection removed" });
    }
  }
  const beforeEntities = new Map(before.entities.map((entity) => [entity.id, entity]));
  for (const entity of after.entities) {
    const previous = beforeEntities.get(entity.id);
    if (!previous) {
      changes.push({ type: "entity", action: "added", target: entity.name, detail: "entity added" });
      continue;
    }
    const previousFields = new Map(previous.fields.map((field) => [field.name.toLowerCase(), field]));
    for (const field of entity.fields) {
      if (!previousFields.has(field.name.toLowerCase())) {
        changes.push({
          type: "field",
          action: "added",
          target: `${entity.name}.${field.name}`,
          detail: `${field.type} field added`,
        });
      }
    }
    const currentFields = new Set(entity.fields.map((field) => field.name.toLowerCase()));
    for (const field of previous.fields) {
      if (!currentFields.has(field.name.toLowerCase())) {
        changes.push({
          type: "field",
          action: "removed",
          target: `${entity.name}.${field.name}`,
          detail: "field removed",
        });
      }
    }
    if (previous.serviceId !== entity.serviceId && entity.serviceId) {
      const serviceName = after.nodes.find((node) => node.id === entity.serviceId)?.name ?? entity.serviceId;
      changes.push({ type: "entity", action: "updated", target: entity.name, detail: `now owned by ${serviceName}` });
    }
  }
  return changes;
}

const REPLIES = {
  en: {
    applied: (changes: ChatChange[]) =>
      `Applied ${changes.length} change${changes.length === 1 ? "" : "s"}: ${changes.map((item) => item.target).join(", ")}.`,
    nothing: "I could not turn that into a change. Try “add a Redis cache”, “add a status field to Order” or “split into microservices”.",
    already: (target: string) => `${target} already exists, so the architecture is unchanged.`,
    lastService: "I cannot remove the only service — add another service first.",
    noEntities: "There are no domain entities to split yet. Describe the domain first.",
    describe: (state: ArchState) =>
      `${state.nodes.length} components, ${state.entities.length} entities and ${state.decisions.length} decisions: ${state.nodes.map((node) => `${node.name} (${node.kind})`).join(", ")}.`,
    unchanged: "The architecture is already up to date for that request.",
  },
  tr: {
    applied: (changes: ChatChange[]) =>
      `${changes.length} değişiklik uygulandı: ${changes.map((item) => item.target).join(", ")}.`,
    nothing:
      "Bunu bir değişikliğe çeviremedim. Örneğin: “Redis cache ekle”, “Order entity'sine status alanı koy” veya “Mikroservislere böl”.",
    already: (target: string) => `${target} zaten var, mimari değişmedi.`,
    lastService: "Tek servisi kaldıramam — önce başka bir servis ekleyelim.",
    noEntities: "Henüz bölünecek bir domain entity yok. Önce domaini tanımla.",
    describe: (state: ArchState) =>
      `${state.nodes.length} bileşen, ${state.entities.length} entity ve ${state.decisions.length} karar: ${state.nodes.map((node) => `${node.name} (${node.kind})`).join(", ")}.`,
    unchanged: "Bu istek için mimari zaten güncel.",
  },
};

function replyTable(locale: Locale | undefined) {
  return locale === "tr" ? REPLIES.tr : REPLIES.en;
}

function isTurkish(message: string): boolean {
  return /[çğıöşüÇĞİÖŞÜ]/.test(message) || /\b(ekle|koy|b[öo]l|kald[ıi]r|alan[ıi]|mikroservis|zaten|olsun|l[üu]tfen)\b/i.test(message);
}

interface DeterministicOutcome {
  state: ArchState;
  intent: ChatIntent;
  notes: string[];
  unchangedTarget?: string;
  error?: "last-service" | "no-entities";
}

function applyDeterministic(state: ArchState, message: string): DeterministicOutcome {
  const intent = detectIntent(message, state);
  const notes: string[] = [];
  const taken = {
    nodes: new Set(state.nodes.map((node) => node.id)),
    edges: new Set(state.edges.map((edge) => edge.id)),
  };

  if (intent === "split-services") {
    const result = splitIntoMicroservices(state, taken);
    if ("error" in result) return { state, intent, notes, error: result.error };
    return { state: result, intent, notes };
  }

  if (intent === "add-field") {
    const entity = findEntity(message, state);
    const fieldName = extractFieldName(message, entity);
    if (!entity || !fieldName) return { state, intent, notes };
    const exists = entity.fields.some((field) => field.name.toLowerCase() === fieldName.toLowerCase());
    if (exists) return { state, intent, notes, unchangedTarget: `${entity.name}.${fieldName}` };
    return { state: addEntityField(state, entity, fieldName, message), intent, notes };
  }

  if (intent === "remove-field") {
    const entity = findEntity(message, state);
    if (!entity) return { state, intent, notes };
    const field = entity.fields.find((item) => new RegExp(`(^|[^\\w])${escapeRegExp(item.name)}([^\\w]|$)`, "i").test(message));
    if (!field) return { state, intent, notes };
    return { state: removeEntityField(state, entity, field.name), intent, notes };
  }

  if (intent === "remove-component") {
    const node = findNode(message, state);
    if (!node) return { state, intent, notes };
    const result = removeComponent(state, node);
    if ("error" in result) return { state, intent, notes, error: result.error };
    return { state: result, intent, notes };
  }

  if (intent === "add-cache" || intent === "add-database" || intent === "add-queue" || intent === "add-external" || intent === "add-ui") {
    const hit = TECH_CATALOG.find((entry) => entry.intent === intent && entry.match.test(message))
      ?? TECH_CATALOG.find((entry) => entry.intent === intent);
    if (!hit) return { state, intent, notes };
    return { state: addTechnology(state, hit.spec, taken), intent, notes };
  }

  return { state, intent: intent === "describe" ? "describe" : "unknown", notes };
}

const CHAT_SYSTEM_PROMPT = `You are the architecture assistant inside Architect Studio.
You receive the current ArchState JSON and a natural-language instruction.
Return ONLY a JSON object: {"reply": "one short sentence", "state": <updated ArchState>}.
Keep the ArchState schema exactly ({version,nodes,edges,decisions,entities}). Rules:
- ids unique; every edge points to existing node ids; no self loops.
- node kinds: service|database|queue|external|ui; protocols: http|grpc|event|sql.
- entity fields use type string|text|int|float|decimal|boolean|datetime|date|uuid|json.
- Preserve unrelated components; change only what the instruction asks for.
- If the instruction cannot be expressed as an architecture change, return the state unchanged and explain briefly.
Never wrap the JSON in markdown fences.`;

async function applyLlm(
  state: ArchState,
  message: string,
  options: Required<Pick<ChatOptions, "apiKey">> & ChatOptions,
): Promise<{ state: ArchState; reply: string }> {
  const endpoint = `${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: CHAT_SYSTEM_PROMPT },
          { role: "user", content: `Instruction: ${message}\n\nCurrent ArchState:\n${JSON.stringify(state)}` },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`LLM request failed with status ${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content) as { reply?: unknown; state?: unknown } | null;
    if (!parsed || typeof parsed !== "object" || parsed.state === undefined) {
      throw new Error("LLM returned an invalid chat payload");
    }
    const parsedState = sanitizeState(parseJsonState(parsed.state));
    if (validateState(parsedState.state).length > 0) throw new Error("LLM returned an invalid architecture state");
    const reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : "Architecture updated.";
    return { state: parsedState.state, reply };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonState(value: unknown): ArchState {
  const parsed = safeParseState(value);
  if (!parsed.success) throw new Error("LLM returned an invalid architecture state");
  return parsed.data;
}

/**
 * Applies one natural-language instruction to an architecture state.
 *
 * The deterministic parser always runs first so the result is predictable in
 * demo mode and a broken LLM can never leave the workspace without a usable
 * architecture.
 */
export async function architectChat(
  state: ArchState,
  message: string,
  options: ChatOptions = {},
): Promise<ChatResult> {
  const trimmed = message.trim();
  const notes: string[] = [];
  const locale = options.locale ?? (isTurkish(trimmed) ? "tr" : "en");
  const replies = replyTable(locale);

  if (trimmed.length === 0) {
    return { reply: replies.nothing, state, changes: [], source: "deterministic", intent: "unknown", notes };
  }

  const deterministic = applyDeterministic(state, trimmed);
  let nextState = deterministic.state;
  let reply: string | undefined;
  let source: ChatResult["source"] = "deterministic";

  const sanitized = sanitizeState(nextState);
  if (sanitized.removed.length > 0) notes.push(...sanitized.removed.map((item) => `chat: ${item}`));
  nextState = sanitized.state;

  const errors = validateState(nextState);
  if (errors.length > 0) {
    notes.push(`Chat change reverted: ${errors.join("; ")}`);
    nextState = state;
  }

  let changes = diffChanges(state, nextState);

  const wantsLlm = options.demo !== true && typeof options.apiKey === "string" && options.apiKey.length > 0;
  if (wantsLlm) {
    try {
      const llm = await applyLlm(state, trimmed, { ...options, apiKey: options.apiKey! });
      const llmChanges = diffChanges(state, llm.state);
      const changed = llmChanges.length > 0;
      if (changed || changes.length === 0) {
        nextState = llm.state;
        changes = llmChanges;
        reply = llm.reply;
        source = "llm";
      }
    } catch (error) {
      notes.push(`LLM unavailable, used the deterministic parser: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  if (!reply) {
    if (changes.length > 0) reply = replies.applied(changes);
    else if (deterministic.unchangedTarget) reply = replies.already(deterministic.unchangedTarget);
    else if (deterministic.error === "last-service") reply = replies.lastService;
    else if (deterministic.error === "no-entities") reply = replies.noEntities;
    else if (deterministic.intent === "describe") reply = replies.describe(nextState);
    else if (nextState.nodes.length === state.nodes.length) reply = replies.nothing;
    else reply = replies.unchanged;
  }

  return {
    reply,
    state: nextState,
    changes,
    source,
    intent: deterministic.intent,
    notes,
  };
}
