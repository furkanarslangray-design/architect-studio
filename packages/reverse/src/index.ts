import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateState } from "../../core/src/diff";
import { sanitizeState, type ArchEdge, type ArchNode, type ArchState, type Decision, type Entity, type NodeKind } from "../../core/src/state";
import { analyzeWithRea, type ReaAnalysis, type ReaFinding, type ReaOptions } from "./rea";

export * from "./rea";

export interface ReverseOptions {
  maxFiles?: number;
  maxDepth?: number;
  ignore?: string[];
  /** Extra directories (for example monorepo packages) to treat as project roots. */
  roots?: string[];
  /** Merge REA (Reverse Engineer Anything) findings into the derived state. */
  useRea?: boolean;
  /** Tuning for the REA bridge / built-in artifact analyzer. */
  rea?: ReaOptions;
}

export interface ReverseFinding {
  kind: NodeKind | "entity" | "decision" | "workspace";
  source: string;
  detail: string;
}

export interface ReverseResult {
  root: string;
  state: ArchState;
  findings: ReverseFinding[];
  warnings: string[];
  scannedFiles: number;
  skipped: string[];
  /** Present when REA analysis ran alongside the source scan. */
  rea?: ReaAnalysis;
}

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  "target",
  ".idea",
  ".vscode",
]);

const MAX_FILE_BYTES = 512 * 1024;

interface ScannedFile {
  path: string;
  relativePath: string;
  size: number;
}

function scan(root: string, options: ReverseOptions): { files: ScannedFile[]; skipped: string[] } {
  const files: ScannedFile[] = [];
  const skipped: string[] = [];
  const maxFiles = options.maxFiles ?? 2500;
  const maxDepth = options.maxDepth ?? 8;
  const ignored = new Set([...IGNORED_DIRECTORIES, ...(options.ignore ?? [])]);

  const walk = (directory: string, depth: number) => {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      skipped.push(relative(root, directory) || ".");
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith(".") && !["github", "env.example"].includes(entry.name.replace(/^\./, ""))) {
        if (entry.isDirectory()) continue;
      }
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        skipped.push(relative(root, fullPath));
        continue;
      }
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) {
          skipped.push(relative(root, fullPath));
          continue;
        }
        walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = statSync(fullPath).size;
      } catch {
        skipped.push(relative(root, fullPath));
        continue;
      }
      if (size > MAX_FILE_BYTES) {
        skipped.push(relative(root, fullPath));
        continue;
      }
      files.push({ path: fullPath, relativePath: relative(root, fullPath).split(sep).join("/"), size });
    }
  };

  walk(root, 0);
  return { files, skipped };
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

function readJson(path: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "node";
}

const TECH_RULES: Array<{
  match: RegExp;
  kind: NodeKind;
  name: string;
  tech: string;
  protocol?: "http" | "event" | "sql" | "grpc";
}> = [
  { match: /^(next|nuxt|react|react-dom|vue|svelte|@angular\/core|solid-js|astro)$/, kind: "ui", name: "Web App", tech: "web" },
  { match: /^(express|fastify|hono|koa|@nestjs\/core|@hapi\/hapi|restify|apollo-server)$/, kind: "service", name: "API Service", tech: "http" },
  { match: /^(pg|postgres|mysql2|mysql|mongoose|mongodb|better-sqlite3|@prisma\/client|prisma|sequelize|knex|drizzle-orm|typeorm)$/, kind: "database", name: "Primary Database", tech: "sql", protocol: "sql" },
  { match: /^(redis|ioredis|bullmq|kafkajs|amqplib|@aws-sdk\/client-sqs|nats|@nestjs\/microservices)$/, kind: "queue", name: "Event Bus", tech: "queue", protocol: "event" },
  { match: /^(stripe)$/, kind: "external", name: "Stripe", tech: "payments" },
  { match: /^(openai|@anthropic-ai\/sdk|@google\/generative-ai)$/, kind: "external", name: "AI Provider", tech: "ai" },
  { match: /^(twilio|@sendgrid\/mail|nodemailer|resend)$/, kind: "external", name: "Messaging Provider", tech: "messaging" },
  { match: /^(aws-sdk|@aws-sdk\/client-s3)$/, kind: "external", name: "Cloud Services", tech: "cloud" },
];

const DATABASE_PATTERN = /postgres|postgresql|mysql|mariadb|mongo|sqlite|cockroach|oracle/;
const QUEUE_PATTERN = /redis|kafka|rabbit|nats|sqs|pubsub|event/;
const UI_PATTERN = /react|next|vue|svelte|angular|astro|vite|web/;

function dependencyNames(pkg: PackageJson): string[] {
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
}

function createNodeFactory() {
  const ids = new Set<string>();
  return (kind: NodeKind, name: string, props: Record<string, string | number | boolean> = {}): ArchNode => {
    const base = `${slug(name)}-${kind === "service" ? "svc" : slug(kind)}`;
    let id = base;
    let counter = 2;
    while (ids.has(id)) id = `${base}-${counter++}`;
    ids.add(id);
    return { id, kind, name, props };
  };
}

interface PrismaModel {
  name: string;
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
    primary: boolean;
    unique: boolean;
    relationTarget?: string;
  }>;
}

function parsePrismaModels(source: string): PrismaModel[] {
  const models: PrismaModel[] = [];
  const modelPattern = /model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;
  const matches = [...source.matchAll(modelPattern)];
  const modelNames = new Set(matches.map((match) => match[1]));

  for (const match of matches) {
    const name = match[1];
    const body = match[2];
    const fields: PrismaModel["fields"] = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fieldMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*(?:\[\])?[?]?)\s*(.*)$/);
      if (!fieldMatch) continue;
      const [, fieldName, rawType, attributes] = fieldMatch;
      const baseType = rawType.replace(/\[\]/g, "").replace(/\?$/, "");
      const isRelation = modelNames.has(baseType);
      const optional = rawType.endsWith("?") || /@relation/.test(attributes) || /\[\]/.test(rawType);
      fields.push({
        name: fieldName,
        type: baseType,
        required: !optional,
        primary: /@id\b/.test(attributes),
        unique: /@unique\b/.test(attributes),
        relationTarget: isRelation ? baseType : undefined,
      });
    }
    models.push({ name, fields });
  }
  return models;
}

const PRISMA_TYPES: Record<string, Entity["fields"][number]["type"]> = {
  String: "string",
  Int: "int",
  Float: "float",
  Decimal: "decimal",
  Boolean: "boolean",
  DateTime: "datetime",
  Json: "json",
  BigInt: "int",
  Bytes: "json",
};

function mapPrismaType(type: string): Entity["fields"][number]["type"] {
  return PRISMA_TYPES[type] ?? "string";
}

interface ComposeService {
  name: string;
  image?: string;
  kind: NodeKind;
  dependsOn: string[];
}

function parseCompose(source: string): ComposeService[] {
  let document: any;
  try {
    document = parseYaml(source);
  } catch {
    return [];
  }
  const services = document?.services;
  if (!services || typeof services !== "object") return [];
  const result: ComposeService[] = [];
  for (const [name, value] of Object.entries<any>(services)) {
    const image = typeof value?.image === "string" ? value.image : undefined;
    const haystack = `${name} ${image ?? ""}`.toLowerCase();
    const kind: NodeKind = DATABASE_PATTERN.test(haystack)
      ? "database"
      : QUEUE_PATTERN.test(haystack)
        ? "queue"
        : "service";
    const depends = value?.depends_on;
    const dependsOn = Array.isArray(depends)
      ? depends.map(String)
      : depends && typeof depends === "object"
        ? Object.keys(depends)
        : [];
    result.push({ name, image, kind, dependsOn });
  }
  return result;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Derives an ArchState from an existing repository: package manifests,
 * Prisma models, docker-compose services and ADR documents.
 */
export function repoToState(root: string, options: ReverseOptions = {}): ReverseResult {
  const resolvedRoot = resolve(root);
  let isDirectory = false;
  try {
    isDirectory = statSync(resolvedRoot).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new Error(`Project path does not exist or is not a directory: ${root}`);
  }

  const { files, skipped } = scan(resolvedRoot, options);
  const findings: ReverseFinding[] = [];
  const warnings: string[] = [];
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const decisions: Decision[] = [];
  const entities: Entity[] = [];
  const node = createNodeFactory();

  const pkgPath = join(resolvedRoot, "package.json");
  const rootPkg = existsSync(pkgPath) ? readJson(pkgPath) : undefined;
  const projectName = rootPkg?.name ?? basename(resolvedRoot);

  const techNodes = new Map<string, ArchNode>();
  let serviceNode: ArchNode | undefined;
  let uiNode: ArchNode | undefined;
  let databaseNode: ArchNode | undefined;
  let queueNode: ArchNode | undefined;

  const applyPackage = (pkg: PackageJson | undefined, source: string, displayName: string) => {
    if (!pkg) return;
    const deps = dependencyNames(pkg);
    for (const dep of deps) {
      const rule = TECH_RULES.find((item) => item.match.test(dep));
      if (!rule) continue;
      const key = `${rule.kind}:${rule.name}`;
      if (techNodes.has(key)) continue;
      const created = node(rule.kind, rule.kind === "service" ? displayName : rule.name, { tech: rule.tech, dependency: dep });
      nodes.push(created);
      techNodes.set(key, created);
      findings.push({ kind: rule.kind, source, detail: `${dep} → ${rule.name}` });
      if (rule.kind === "service" && !serviceNode) serviceNode = created;
      if (rule.kind === "ui" && !uiNode) uiNode = created;
      if (rule.kind === "database" && !databaseNode) databaseNode = created;
      if (rule.kind === "queue" && !queueNode) queueNode = created;
    }
  };

  applyPackage(rootPkg, "package.json", rootPkg?.name ? `${rootPkg.name} API` : "API Service");

  const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  for (const composeFile of composeFiles) {
    const path = join(resolvedRoot, composeFile);
    if (!existsSync(path)) continue;
    const services = parseCompose(readText(path));
    for (const service of services) {
      const created = node(service.kind, service.name, {
        ...(service.image ? { image: service.image } : {}),
        source: composeFile,
      });
      nodes.push(created);
      findings.push({ kind: service.kind, source: composeFile, detail: `${service.name}${service.image ? ` (${service.image})` : ""}` });
      if (service.kind === "database" && !databaseNode) databaseNode = created;
      if (service.kind === "queue" && !queueNode) queueNode = created;
      if (service.kind === "service" && !serviceNode) serviceNode = created;
    }
    if (services.length > 0) break;
  }

  // Workspace packages become their own services.
  const workspacePatterns = Array.isArray(rootPkg?.workspaces)
    ? rootPkg?.workspaces
    : rootPkg?.workspaces?.packages ?? [];
  const workspaceDirs = new Set<string>();
  for (const pattern of workspacePatterns.slice(0, 24)) {
    const base = pattern.replace(/\/\*+$/, "").replace(/\*+$/, "");
    const directory = join(resolvedRoot, base);
    if (!existsSync(directory)) continue;
    if (pattern.endsWith("*")) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) workspaceDirs.add(join(directory, entry.name));
      }
    } else {
      workspaceDirs.add(directory);
    }
  }
  for (const directory of Array.from(workspaceDirs).slice(0, 12)) {
    const pkg = readJson(join(directory, "package.json"));
    if (!pkg) continue;
    const relativeDir = relative(resolvedRoot, directory).split(sep).join("/");
    const displayName = pkg.name ?? basename(directory);
    const before = nodes.length;
    applyPackage(pkg, `${relativeDir}/package.json`, displayName);
    if (nodes.length === before) {
      const created = node("service", displayName, { workspace: relativeDir });
      nodes.push(created);
      if (!serviceNode) serviceNode = created;
      findings.push({ kind: "workspace", source: `${relativeDir}/package.json`, detail: displayName });
    }
  }

  // Prisma models become entities.
  const prismaFile = files.find((file) => /(^|\/)prisma\/schema\.prisma$/.test(file.relativePath));
  const entityIds = new Map<string, string>();
  const parsedModels = prismaFile ? parsePrismaModels(readText(prismaFile.path)) : [];
  const modelToEntityId = new Map<string, string>();
  for (const model of parsedModels) {
    let id = `ent-${slug(model.name)}`;
    let counter = 2;
    while (entityIds.has(id)) id = `ent-${slug(model.name)}-${counter++}`;
    entityIds.set(id, model.name);
    modelToEntityId.set(model.name, id);
  }
  for (const model of parsedModels) {
    const fields = model.fields
      .filter((field) => !field.relationTarget)
      .map((field) => ({
        name: field.name,
        type: mapPrismaType(field.type),
        required: field.required,
        unique: field.unique,
        primary: field.primary,
      }));
    if (fields.length === 0) {
      fields.push({ name: "id", type: "uuid", required: true, unique: false, primary: true });
    }
    const relations = model.fields.flatMap((field) => {
      const target = field.relationTarget;
      if (!target || !modelToEntityId.has(target)) return [];
      return [{ target: modelToEntityId.get(target)!, field: `${slug(model.name)}Id` }];
    });
    const entity: Entity = {
      id: modelToEntityId.get(model.name)!,
      name: model.name,
      description: `Detected from ${prismaFile?.relativePath ?? "Prisma schema"}.`,
      ...(serviceNode ? { serviceId: serviceNode.id } : {}),
      ...(databaseNode ? { databaseId: databaseNode.id } : {}),
      fields,
      relations,
    };
    entities.push(entity);
    findings.push({ kind: "entity", source: prismaFile?.relativePath ?? "prisma", detail: `${model.name} (${fields.length} fields)` });
  }

  // ADR documents become decisions.
  const adrFiles = files.filter((file) => /(^|\/)(adr|decisions)\/[^/]+\.md$/i.test(file.relativePath)).slice(0, 10);
  for (const [index, file] of adrFiles.entries()) {
    const content = readText(file.path);
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (!title) continue;
    const paragraph = content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("|"));
    decisions.push({
      id: `adr-${String(index + 1).padStart(3, "0")}`,
      title,
      context: paragraph?.slice(0, 400) ?? "",
      decision: title,
      alternatives: [],
    });
    findings.push({ kind: "decision", source: file.relativePath, detail: title });
  }

  if (!databaseNode && parsedModels.length > 0) {
    const created = node("database", "Primary Database", { detected: "prisma" });
    nodes.push(created);
    databaseNode = created;
  }

  if (!serviceNode) {
    const created = node("service", projectName ? `${projectName} Service` : "Application", { detected: "fallback" });
    nodes.push(created);
    serviceNode = created;
    findings.push({ kind: "service", source: "fallback", detail: "No web framework detected; using a single service node" });
  }

  if (!uiNode) {
    const uiPackages = files.filter((file) => /(^|\/)(src\/)?(app|pages|components)\/[^/]+\.(tsx|jsx|vue|svelte)$/.test(file.relativePath));
    if (uiPackages.length > 0) {
      const created = node("ui", "Web App", { detected: "components" });
      nodes.push(created);
      uiNode = created;
      findings.push({ kind: "ui", source: "components", detail: `${uiPackages.length} component files` });
    }
  }

  const edgeIds = new Set<string>();
  const addEdge = (from: ArchNode, to: ArchNode, protocol: ArchEdge["protocol"]) => {
    if (from.id === to.id) return;
    const id = `edge-${from.id}-${to.id}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, from: from.id, to: to.id, protocol });
  };

  if (uiNode) addEdge(uiNode, serviceNode, "http");
  if (databaseNode) addEdge(serviceNode, databaseNode, "sql");
  if (queueNode) addEdge(serviceNode, queueNode, "event");
  for (const created of nodes) {
    if (created.kind === "external" && created.id !== serviceNode.id) addEdge(serviceNode, created, "http");
  }
  // Compose services that expose dependencies are represented as edges from the
  // owning service node rather than children, keeping the graph acyclic.
  for (const composeFile of composeFiles) {
    const path = join(resolvedRoot, composeFile);
    if (!existsSync(path)) continue;
    for (const service of parseCompose(readText(path))) {
      if (service.kind !== "service") continue;
      const created = nodes.find((item) => item.name === service.name && item.kind === "service");
      if (!created || created.id === serviceNode.id) continue;
      for (const dependency of service.dependsOn) {
        const target = nodes.find((item) => item.name === dependency);
        if (target) addEdge(created, target, target.kind === "database" ? "sql" : target.kind === "queue" ? "event" : "http");
      }
    }
    break;
  }

  if (databaseNode && !decisions.some((decision) => /database|datastore/i.test(decision.title))) {
    decisions.push({
      id: `adr-${String(decisions.length + 1).padStart(3, "0")}`,
      title: `Use ${databaseNode.name} as the primary datastore`,
      context: "Detected from the existing repository's dependencies or Compose services.",
      decision: `Keep ${databaseNode.name} as the system of record.`,
      alternatives: [],
    });
  }
  if (queueNode && !decisions.some((decision) => /event|queue|stream/i.test(decision.title))) {
    decisions.push({
      id: `adr-${String(decisions.length + 1).padStart(3, "0")}`,
      title: `Use ${queueNode.name} for asynchronous events`,
      context: "Detected from the existing repository's dependencies or Compose services.",
      decision: `Keep ${queueNode.name} for event delivery.`,
      alternatives: [],
    });
  }

  const candidate: ArchState = {
    version: 1,
    nodes,
    edges,
    decisions,
    entities,
  };
  const sanitized = sanitizeState(candidate);
  if (sanitized.removed.length > 0) warnings.push(...sanitized.removed);
  const errors = validateState(sanitized.state);
  if (errors.length > 0) {
    throw new Error(`Reverse engineering produced an invalid architecture: ${errors.join("; ")}`);
  }

  return {
    root: resolvedRoot,
    state: sanitized.state,
    findings,
    warnings,
    scannedFiles: files.length,
    skipped,
  };
}

const REA_NODE_KINDS: Partial<Record<ReaFinding["category"], NodeKind>> = {
  datastore: "database",
  messaging: "queue",
  integration: "external",
};

function reaNodeKind(item: ReaFinding): NodeKind | undefined {
  const direct = REA_NODE_KINDS[item.category];
  if (direct) return direct;
  if (item.category === "runtime" || item.category === "framework") {
    return /electron|react native|flutter|desktop|web app|react application|vue application|svelte application/i.test(item.title)
      ? "ui"
      : undefined;
  }
  return undefined;
}

function reaNodeName(item: ReaFinding): string {
  const endpoint = item.title.match(/^External endpoint (.+)$/i)?.[1];
  if (!endpoint) return item.title;
  // Endpoint findings become external nodes; the host reads better than a URL.
  try {
    return new URL(/^[a-z]+:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`).hostname;
  } catch {
    return endpoint;
  }
}

/**
 * Folds REA findings (from the CLI or the built-in analyzer) into an existing
 * ArchState. Findings keep their evidence on the node props so a reviewer can
 * trace every derived component back to an artifact.
 */
export function mergeReaFindings(state: ArchState, analysis: ReaAnalysis): { state: ArchState; added: ReaFinding[] } {
  const nodes = [...state.nodes];
  const edges = [...state.edges];
  const decisions = [...state.decisions];
  const existingNames = new Map(nodes.map((node) => [node.name.toLowerCase(), node]));
  const ids = new Set(nodes.map((node) => node.id));
  const added: ReaFinding[] = [];
  const serviceNode = nodes.find((node) => node.kind === "service");

  const addNode = (kind: NodeKind, name: string, item: ReaFinding) => {
    const base = `${slug(name)}-${kind === "service" ? "svc" : slug(kind)}`;
    let id = base;
    let counter = 2;
    while (ids.has(id)) id = `${base}-${counter++}`;
    ids.add(id);
    const evidencePaths = item.evidence
      .map((evidence) => evidence.path)
      .filter((path): path is string => typeof path === "string")
      .slice(0, 3);
    const created: ArchNode = {
      id,
      kind,
      name,
      props: {
        detected: "rea",
        confidence: Number(item.confidence.toFixed(2)),
        ...(evidencePaths.length > 0 ? { evidence: evidencePaths.join(", ") } : {}),
      },
    };
    nodes.push(created);
    existingNames.set(name.toLowerCase(), created);
    if (serviceNode && serviceNode.id !== created.id) {
      const protocol: ArchEdge["protocol"] =
        kind === "database" ? "sql" : kind === "queue" ? "event" : "http";
      const edgeId = `edge-${serviceNode.id}-${created.id}`;
      if (!edges.some((edge) => edge.id === edgeId)) {
        edges.push({ id: edgeId, from: serviceNode.id, to: created.id, protocol });
      }
    }
    return created;
  };

  for (const item of analysis.findings) {
    const kind = reaNodeKind(item);
    if (!kind) continue;
    const name = reaNodeName(item);
    if (existingNames.has(name.toLowerCase())) continue;
    addNode(kind, name, item);
    added.push(item);
  }

  const decisionSeed = analysis.findings.filter(
    (item) => item.category === "artifact" || item.category === "architecture" || item.category === "package",
  );
  for (const item of decisionSeed.slice(0, 3)) {
    if (decisions.length >= 12) break;
    if (decisions.some((decision) => decision.title === item.title)) continue;
    decisions.push({
      id: `adr-${String(decisions.length + 1).padStart(3, "0")}`,
      title: item.title,
      context: item.detail,
      decision: item.evidence.length > 0
        ? `Keep this artifact (evidence: ${item.evidence.map((evidence) => evidence.path ?? evidence.source).slice(0, 3).join(", ")}).`
        : "Keep this artifact in the target architecture.",
      alternatives: [],
    });
  }

  return { state: { ...state, nodes, edges, decisions }, added };
}

/**
 * `repoToState` plus REA: source scan first, then artifact/binary analysis
 * (the `rea` CLI when installed, the built-in analyzer otherwise).
 */
export async function repoToStateWithRea(root: string, options: ReverseOptions = {}): Promise<ReverseResult> {
  const base = repoToState(root, options);
  const analysis = await analyzeWithRea(base.root, {
    maxFiles: options.maxFiles,
    maxDepth: options.maxDepth,
    ignore: options.ignore,
    ...options.rea,
  });
  const merged = mergeReaFindings(base.state, analysis);
  const sanitized = sanitizeState(merged.state);
  const warnings = [...base.warnings, ...analysis.warnings, ...sanitized.removed.map((item) => `rea: ${item}`)];
  const errors = validateState(sanitized.state);
  if (errors.length > 0) {
    warnings.push(`REA merge produced an invalid architecture, keeping the source scan: ${errors.join("; ")}`);
    return { ...base, rea: analysis };
  }
  return {
    ...base,
    state: sanitized.state,
    findings: [
      ...base.findings,
      ...merged.added.map((item) => ({
        kind: (reaNodeKind(item) ?? "decision") as ReverseFinding["kind"],
        source: item.evidence[0]?.path ?? "rea",
        detail: `${item.title} (${Math.round(item.confidence * 100)}% confidence)`,
      })),
    ],
    warnings,
    rea: analysis,
  };
}

export function summarizeReverse(result: ReverseResult): string {
  const kinds = new Map<string, number>();
  for (const node of result.state.nodes) kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
  const parts = [...kinds.entries()].map(([kind, count]) => `${count} ${kind}`);
  const rea = result.rea
    ? ` · REA ${result.rea.engine} (${result.rea.findings.length} findings, ${result.rea.scannedArtifacts} artifacts)`
    : "";
  return `${result.scannedFiles} files scanned · ${parts.join(", ") || "no components"} · ${
    result.state.entities.length
  } entities · ${result.state.decisions.length} decisions${rea}`;
}
