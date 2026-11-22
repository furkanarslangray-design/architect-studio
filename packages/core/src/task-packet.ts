import type { ArchNode, ArchState } from "./state";
import { contractCoverage, dependencyDepth } from "./diff";
import { slugify } from "./ids";
import { estimateTokens } from "./metrics";

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

export function buildTaskPackets(state: ArchState): TaskPacket[] {
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

    const context = JSON.stringify({
      node,
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
      acceptance: acceptanceFor(node),
      verifyCommand: verifyFor(node, slug),
      tokenCount: 0,
      covers: {
        nodes: [node.id],
        edges: connections.map((edge) => edge.id),
      },
    };
    packet.tokenCount = estimateTokens(renderTaskMarkdown(packet));
    taskByNode.set(node.id, packet);
    return packet;
  });

  return packets;
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

export function renderTaskMarkdown(packet: TaskPacket): string {
  return [
    `# ${packet.id} — ${packet.title}`,
    "",
    "## Goal",
    `Implement the ${packet.title.toLowerCase()} slice. This packet is self-contained.`,
    "",
    "## Files",
    ...packet.files.map((file) => `- ${file}`),
    "",
    "## Depends on",
    packet.dependsOn.length > 0 ? packet.dependsOn.join(", ") : "none",
    "",
    "## Context",
    "```json",
    packet.context,
    "```",
    "",
    "## Acceptance criteria",
    ...packet.acceptance.map((item) => `- [ ] ${item}`),
    "",
    "## Verify",
    `Run: \`${packet.verifyCommand}\``,
    "",
    "## Rules",
    "- Only touch the files listed above.",
    "- Do not read the whole repository; this packet is the required context.",
    "- Do not dispatch other subagents.",
    "",
  ].join("\n");
}

export function renderTaskIndexMarkdown(packets: TaskPacket[]): string {
  const lines = [
    "# TASKS",
    "",
    "Execute one packet at a time. Each packet is self-contained and lists its own verification command.",
    "",
    "| ID | Task | Depends on | Wave | Files | Tokens |",
    "|---|---|---|---|---|---|",
    ...packets.map(
      (packet) =>
        `| ${packet.id} | ${packet.title} | ${packet.dependsOn.join(", ") || "-"} | ${packet.parallelGroup} | ${packet.files.length} | ${packet.tokenCount} |`,
    ),
    "",
    "Packet files live in `tasks/<ID>.md`.",
    "",
  ];
  return lines.join("\n");
}

export function computeTaskMetrics(state: ArchState, packets: TaskPacket[]): TaskMetrics {
  const packetTokens = packets.map((packet) => packet.tokenCount).sort((a, b) => a - b);
  const stateTokens = Math.max(1, estimateTokens(JSON.stringify(state)));
  const indexTokens = estimateTokens(renderTaskIndexMarkdown(packets));
  const totalArtifactTokens = stateTokens + packets.reduce((sum, packet) => sum + packet.tokenCount, 0) + indexTokens;
  const contextRatios = packets.map((packet) => estimateTokens(packet.context) / totalArtifactTokens);
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
    contextSliceRatio: contextRatios.reduce((sum, value) => sum + value, 0) / Math.max(1, contextRatios.length),
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

function acceptanceFor(node: ArchNode): string[] {
  switch (node.kind) {
    case "service":
      return [
        `${node.name} exposes a health check that returns 200`,
        `Unit tests for ${node.name} pass`,
        `${node.name} only calls the connections listed in Context`,
      ];
    case "database":
      return [
        `${node.name} schema applies cleanly to an empty database`,
        `Migration for ${node.name} is repeatable`,
        `A round-trip read/write test passes`,
      ];
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

function verifyFor(node: ArchNode, slug: string): string {
  switch (node.kind) {
    case "service":
      return `pnpm vitest tests/services/${slug}.test.ts --run`;
    case "database":
      return `pnpm vitest tests/db/${slug}.test.ts --run`;
    case "queue":
      return `pnpm vitest tests/events/${slug}.test.ts --run`;
    case "external":
      return `pnpm vitest tests/integrations/${slug}.test.ts --run`;
    case "ui":
      return `pnpm vitest tests/ui/${slug}.test.tsx --run`;
  }
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[index];
}
