import type { ArchNode, ArchState, Entity } from "./state";
import { contractCoverage, dependencyDepth } from "./diff";
import { slugify } from "./ids";
import { estimateTokens, percentile } from "./metrics";
import { normalizeLocale, t, type Locale } from "./i18n";

export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export const TEST_RUNNERS = ["vitest", "jest", "node"] as const;
export type TestRunner = (typeof TEST_RUNNERS)[number];

export interface TaskBuildOptions {
  packageManager?: PackageManager;
  testRunner?: TestRunner;
  locale?: Locale;
}

export interface ResolvedTaskOptions {
  packageManager: PackageManager;
  testRunner: TestRunner;
  locale: Locale;
}

export interface TaskPacket {
  id: string;
  title: string;
  dependsOn: string[];
  parallelGroup: string;
  files: string[];
  context: string;
  acceptance: string[];
  verifyCommand: string;
  tokenCount: number;
  covers: {
    nodes: string[];
    edges: string[];
  };
  entities: string[];
}

export interface TaskIndex {
  tasks: Array<Pick<TaskPacket, "id" | "title" | "dependsOn" | "parallelGroup" | "files" | "tokenCount">>;
}

export interface TaskMetrics {
  packetMaxTokens: number;
  packetP95Tokens: number;
  contextSliceRatio: number;
  duplicateContextRatio: number;
  maxFilesPerTask: number;
  parallelGroups: number;
  indexTokens: number;
  acceptanceCoverage: number;
  contractCoverage: number;
}

const KIND_ORDER: Record<ArchNode["kind"], number> = {
  database: 0,
  queue: 1,
  external: 2,
  service: 3,
  ui: 4,
};

export function resolveTaskOptions(options: TaskBuildOptions = {}): ResolvedTaskOptions {
  const packageManager = options.packageManager ?? "pnpm";
  const testRunner = options.testRunner ?? "vitest";
  if (!PACKAGE_MANAGERS.includes(packageManager)) {
    throw new Error(`Unsupported package manager: ${packageManager}. Use one of ${PACKAGE_MANAGERS.join(", ")}.`);
  }
  if (!TEST_RUNNERS.includes(testRunner)) {
    throw new Error(`Unsupported test runner: ${testRunner}. Use one of ${TEST_RUNNERS.join(", ")}.`);
  }
  return { packageManager, testRunner, locale: normalizeLocale(options.locale) };
}

export function buildTaskPackets(state: ArchState, options: TaskBuildOptions = {}): TaskPacket[] {
  const resolved = resolveTaskOptions(options);
  const nodes = [...state.nodes].sort((a, b) => {
    const depthDiff = nodeDepth(state, a.id) - nodeDepth(state, b.id);
    if (depthDiff !== 0) return depthDiff;
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kindDiff !== 0) return kindDiff;
    return a.name.localeCompare(b.name);
  });

  const taskByNode = new Map<string, TaskPacket>();
  const packets: TaskPacket[] = nodes.map((node, index) => {
    const tag = `T-${String(index + 1).padStart(3, "0")}`;
    const slug = slugify(node.name);
    const files = filesFor(node, slug);
    const connections = state.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
    const outgoing = state.edges.filter((edge) => edge.from === node.id);
    const dependsOn = outgoing
      .map((edge) => taskByNode.get(edge.to)?.id)
      .filter((id): id is string => Boolean(id));

    const owned = state.entities.filter(
      (entity) => entity.serviceId === node.id || (node.kind === "database" && entity.databaseId === node.id),
    );

    const context = JSON.stringify({
      node,
      ...(owned.length > 0 ? { entities: owned.map(entitySlice) } : {}),
      connections: connections.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        protocol: edge.protocol,
        contractRef: edge.contractRef,
      })),
      decisions: state.decisions
        .filter((decision) => node.props.decisionRef === decision.id)
        .map((decision) => ({ id: decision.id, title: decision.title, decision: decision.decision })),
    });

    const packet: TaskPacket = {
      id: tag,
      title: titleFor(node),
      dependsOn: [...new Set(dependsOn)],
      parallelGroup: `wave-${nodeDepth(state, node.id)}`,
      files,
      context,
      acceptance: acceptanceFor(node, owned, slug),
      verifyCommand: verifyFor(node, slug, resolved),
      tokenCount: 0,
      covers: {
        nodes: [node.id],
        edges: connections.map((edge) => edge.id),
      },
      entities: owned.map((entity) => entity.id),
    };
    packet.tokenCount = estimateTokens(renderTaskMarkdown(packet, resolved));
    taskByNode.set(node.id, packet);
    return packet;
  });

  return packets;
}

function entitySlice(entity: Entity) {
  return {
    id: entity.id,
    name: entity.name,
    ...(entity.description ? { description: entity.description } : {}),
    fields: entity.fields.map((field) => ({
      name: field.name,
      type: field.type,
      ...(field.required ? { required: true } : {}),
      ...(field.unique ? { unique: true } : {}),
      ...(field.primary ? { primary: true } : {}),
    })),
    ...(entity.relations.length > 0
      ? { relations: entity.relations.map((relation) => ({ target: relation.target, field: relation.field })) }
      : {}),
  };
}

export function buildTaskIndex(packets: TaskPacket[]): TaskIndex {
  return {
    tasks: packets.map((packet) => ({
      id: packet.id,
      title: packet.title,
      dependsOn: packet.dependsOn,
      parallelGroup: packet.parallelGroup,
      files: packet.files,
      tokenCount: packet.tokenCount,
    })),
  };
}

export function renderTaskMarkdown(packet: TaskPacket, options: TaskBuildOptions = {}): string {
  const { locale } = resolveTaskOptions(options);
  return [
    `# ${packet.id} — ${packet.title}`,
    "",
    `## ${t(locale, "docs.packet.goal")}`,
    t(locale, "docs.packet.goalLine", { title: packet.title.toLowerCase() }),
    "",
    `## ${t(locale, "common.files")}`,
    ...packet.files.map((file) => `- ${file}`),
    "",
    `## ${t(locale, "common.dependsOn")}`,
    packet.dependsOn.length > 0 ? packet.dependsOn.join(", ") : t(locale, "common.none"),
    "",
    "## Context",
    "```json",
    packet.context,
    "```",
    "",
    `## ${t(locale, "docs.packet.acceptance")}`,
    ...packet.acceptance.map((item) => `- [ ] ${item}`),
    "",
    `## ${t(locale, "docs.whitepaper.verification")}`,
    t(locale, "docs.packet.verify", { command: packet.verifyCommand }),
    "",
    `## ${t(locale, "docs.packet.rules")}`,
    `- ${t(locale, "docs.rules.rule3")}`,
    `- ${t(locale, "docs.rules.rule5")}`,
    `- ${t(locale, "docs.rules.rule6")}`,
    "",
  ].join("\n");
}

export function renderTaskIndexMarkdown(packets: TaskPacket[], options: TaskBuildOptions = {}): string {
  const { packageManager, locale } = resolveTaskOptions(options);
  const installCommand =
    packageManager === "npm"
      ? "npm install"
      : packageManager === "yarn"
        ? "yarn install"
        : packageManager === "bun"
          ? "bun install"
          : "pnpm install";

  const lines = [
    `# ${t(locale, "docs.tasks.title")}`,
    "",
    t(locale, "docs.tasks.intro"),
    "",
    t(locale, "docs.tasks.environment", { command: installCommand }),
    "",
    `| ${t(locale, "common.id")} | ${t(locale, "common.task")} | ${t(locale, "common.dependsOn")} | ${t(locale, "common.wave")} | ${t(locale, "common.files")} | ${t(locale, "common.tokens")} |`,
    "|---|---|---|---|---|---|",
    ...packets.map(
      (packet) =>
        `| ${packet.id} | ${packet.title} | ${packet.dependsOn.join(", ") || "-"} | ${packet.parallelGroup} | ${packet.files.length} | ${packet.tokenCount} |`,
    ),
    "",
    t(locale, "docs.tasks.location"),
    "",
  ];
  return lines.join("\n");
}

export function computeTaskMetrics(
  state: ArchState,
  packets: TaskPacket[],
  options: TaskBuildOptions = {},
  artifactTokens = 0,
): TaskMetrics {
  const packetTokens = packets.map((packet) => packet.tokenCount);
  const stateTokens = Math.max(1, estimateTokens(JSON.stringify(state)));
  const indexTokens = estimateTokens(renderTaskIndexMarkdown(packets, options));
  // The denominator is the whole deliverable (state + packets + index + every
  // generated artifact), so a packet's context slice is measured against what
  // the implementation actually has to navigate.
  const totalArtifactTokens =
    stateTokens + packets.reduce((sum, packet) => sum + packet.tokenCount, 0) + indexTokens + artifactTokens;
  const contextRatios = packets.map((packet) => estimateTokens(packet.context) / Math.max(1, totalArtifactTokens));
  const contexts = new Set<string>();
  let duplicateTokens = 0;
  let totalContextTokens = 0;
  for (const packet of packets) {
    const tokens = estimateTokens(packet.context);
    totalContextTokens += tokens;
    if (contexts.has(packet.context)) duplicateTokens += tokens;
    contexts.add(packet.context);
  }
  const groups = new Map<string, number>();
  for (const packet of packets) {
    groups.set(packet.parallelGroup, (groups.get(packet.parallelGroup) ?? 0) + 1);
  }

  const coveredNodes = packets.flatMap((packet) => packet.covers.nodes);
  const coveredEdges = packets.flatMap((packet) => packet.covers.edges);

  return {
    packetMaxTokens: Math.max(0, ...packetTokens),
    packetP95Tokens: percentile(packetTokens, 95),
    contextSliceRatio:
      contextRatios.reduce((sum, value) => sum + value, 0) / Math.max(1, contextRatios.length),
    duplicateContextRatio: totalContextTokens === 0 ? 0 : duplicateTokens / totalContextTokens,
    maxFilesPerTask: Math.max(0, ...packets.map((packet) => packet.files.length)),
    parallelGroups: groups.size,
    indexTokens,
    acceptanceCoverage:
      packets.filter((packet) => packet.acceptance.length > 0 && packet.verifyCommand.length > 0).length /
      Math.max(1, packets.length),
    contractCoverage: contractCoverage(state, coveredNodes, coveredEdges),
  };
}

function nodeDepth(state: ArchState, nodeId: string): number {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const outgoing = state.edges.filter((edge) => edge.from === id);
    const depth = outgoing.length === 0 ? 0 : 1 + Math.max(...outgoing.map((edge) => visit(edge.to)));
    visiting.delete(id);
    memo.set(id, depth);
    return depth;
  };
  return state.nodes.length === 0 ? 0 : visit(nodeId);
}

function filesFor(node: ArchNode, slug: string): string[] {
  switch (node.kind) {
    case "service":
      return [`src/services/${slug}/controller.ts`, `src/services/${slug}/service.ts`, `tests/services/${slug}.test.ts`];
    case "database":
      return [`db/${slug}/schema.sql`, `tests/db/${slug}.test.ts`];
    case "queue":
      return [`src/events/${slug}.ts`, `tests/events/${slug}.test.ts`];
    case "external":
      return [`src/integrations/${slug}.ts`, `tests/integrations/${slug}.test.ts`];
    case "ui":
      return [`src/ui/${slug}.tsx`, `tests/ui/${slug}.test.tsx`];
  }
}

function titleFor(node: ArchNode): string {
  switch (node.kind) {
    case "service":
      return `Implement ${node.name} service`;
    case "database":
      return `Create ${node.name} schema`;
    case "queue":
      return `Configure ${node.name} queue`;
    case "external":
      return `Integrate ${node.name}`;
    case "ui":
      return `Build ${node.name} screen`;
  }
}

function acceptanceFor(node: ArchNode, entities: Entity[], slug: string): string[] {
  const entityRoutes = entities.slice(0, 4).map(
    (entity) => `GET /api/${slug}/${slugify(entity.name)} returns 200 and matches the ${entity.name} schema`,
  );

  switch (node.kind) {
    case "service":
      return [
        `${node.name} exposes a health check that returns 200`,
        ...entityRoutes,
        `Unit tests for ${node.name} pass`,
        `${node.name} only calls the connections listed in Context`,
      ];
    case "database": {
      const models = entities.map((entity) => entity.name);
      return [
        `${node.name} schema applies cleanly to an empty database`,
        models.length > 0 ? `Prisma schema contains a model for ${models.join(", ")}` : `Migration for ${node.name} is repeatable`,
        `A round-trip read/write test passes`,
      ];
    }
    case "queue":
      return [
        `${node.name} producer and consumer contract test passes`,
        `Failed messages are retried or parked`,
      ];
    case "external":
      return [
        `${node.name} integration handles timeouts and non-2xx responses`,
        `Secrets are read from environment variables, never hard-coded`,
      ];
    case "ui":
      return [
        `${node.name} renders without console errors`,
        `${node.name} shows loading and error states`,
      ];
  }
}

function verifyFor(node: ArchNode, slug: string, options: ResolvedTaskOptions): string {
  const file = verifyFileFor(node, slug);
  const { packageManager, testRunner } = options;

  if (testRunner === "node") return `node --test ${file}`;
  if (testRunner === "jest") {
    return packageManager === "npm" ? `npx jest ${file}` : `${packageManager} jest ${file}`;
  }
  return packageManager === "npm" ? `npx vitest ${file} --run` : `${packageManager} vitest ${file} --run`;
}

function verifyFileFor(node: ArchNode, slug: string): string {
  switch (node.kind) {
    case "service":
      return `tests/services/${slug}.test.ts`;
    case "database":
      return `tests/db/${slug}.test.ts`;
    case "queue":
      return `tests/events/${slug}.test.ts`;
    case "external":
      return `tests/integrations/${slug}.test.ts`;
    case "ui":
      return `tests/ui/${slug}.test.tsx`;
  }
}
