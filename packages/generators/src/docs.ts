import type { ArchState } from "@architect-studio/core";
import type { TaskBuildOptions, TaskPacket } from "@architect-studio/core";
import { renderTaskIndexMarkdown, resolveTaskOptions } from "@architect-studio/core";
import { padNumber, slugify } from "@architect-studio/core";
import { t } from "@architect-studio/core";
import { generateMermaid } from "./mermaid";
import { nodeLabel } from "./util";

export function generateDocs(
  state: ArchState,
  packets: TaskPacket[],
  options: TaskBuildOptions = {},
): Record<string, string> {
  const { locale } = resolveTaskOptions(options);
  const mermaid = generateMermaid(state);
  const files: Record<string, string> = {
    "ARCHITECTURE.md": architectureMarkdown(state, mermaid, locale),
    "WHITEPAPER.md": whitepaperMarkdown(state, packets, mermaid, locale),
    "TASKS.md": renderTaskIndexMarkdown(packets, options),
    ".cursorrules": cursorRules(locale),
    "AGENTS.md": agentsMarkdown(packets, state, locale),
  };

  state.decisions.forEach((decision, index) => {
    const filename = `adr/ADR-${padNumber(index + 1)}-${slugify(decision.title)}.md`;
    files[filename] = adrMarkdown(decision, index + 1, locale);
  });

  return files;
}

function architectureMarkdown(state: ArchState, mermaid: string, locale: ReturnType<typeof resolveTaskOptions>["locale"]): string {
  const nodeRows = state.nodes
    .map(
      (node) =>
        `| ${node.id} | ${node.name} | ${node.kind} | ${Object.entries(node.props).map(([key, value]) => `${key}=${value}`).join(", ") || "-"} |`,
    )
    .join("\n");
  const edgeRows = state.edges
    .map((edge) => `| ${edge.id} | ${edge.from} | ${edge.to} | ${edge.protocol} | ${edge.contractRef ?? "-"} |`)
    .join("\n");
  const entityRows = state.entities
    .map((entity) => {
      const fields = entity.fields
        .map((field) => {
          const flags = [field.primary ? "PK" : "", field.required ? "required" : "optional", field.unique ? "unique" : ""]
            .filter(Boolean)
            .join(", ");
          return `${field.name}:${field.type}${flags ? ` (${flags})` : ""}`;
        })
        .join("; ");
      return `| ${entity.id} | ${entity.name} | ${entity.serviceId ?? "-"} | ${entity.databaseId ?? "-"} | ${fields} |`;
    })
    .join("\n");

  return [
    `# ${t(locale, "docs.architecture.title")}`,
    "",
    `> ${t(locale, "docs.architecture.sourceOfTruth")}`,
    "",
    `## ${t(locale, "docs.architecture.diagram")}`,
    "",
    "```mermaid",
    mermaid,
    "```",
    "",
    `## ${t(locale, "docs.architecture.components")}`,
    "",
    `| ${t(locale, "common.id")} | ${t(locale, "common.name")} | ${t(locale, "common.kind")} | ${t(locale, "common.props")} |`,
    "|---|---|---|---|",
    nodeRows || "| - | - | - | - |",
    "",
    `## ${t(locale, "docs.architecture.domainModel")}`,
    "",
    state.entities.length > 0
      ? [
          `| ${t(locale, "common.id")} | ${t(locale, "common.entity")} | ${t(locale, "common.service")} | ${t(locale, "common.storage")} | ${t(locale, "common.fields")} |`,
          "|---|---|---|---|---|",
          entityRows,
        ].join("\n")
      : t(locale, "docs.architecture.noEntities"),
    "",
    `## ${t(locale, "docs.architecture.connections")}`,
    "",
    `| ${t(locale, "common.id")} | ${t(locale, "common.from")} | ${t(locale, "common.to")} | ${t(locale, "common.protocol")} | ${t(locale, "common.contract")} |`,
    "|---|---|---|---|---|",
    edgeRows || "| - | - | - | - | - |",
    "",
    `## ${t(locale, "docs.architecture.howToUse")}`,
    "",
    `1. ${t(locale, "docs.architecture.step1")}`,
    `2. ${t(locale, "docs.architecture.step2")}`,
    `3. ${t(locale, "docs.architecture.step3")}`,
    `4. ${t(locale, "docs.architecture.step4")}`,
    "",
  ].join("\n");
}

function whitepaperMarkdown(
  state: ArchState,
  packets: TaskPacket[],
  mermaid: string,
  locale: ReturnType<typeof resolveTaskOptions>["locale"],
): string {
  const services = state.nodes.filter((node) => node.kind === "service");
  const databases = state.nodes.filter((node) => node.kind === "database");
  const queues = state.nodes.filter((node) => node.kind === "queue");
  const decisions = state.decisions
    .map((decision, index) => `${index + 1}. **${decision.title}** — ${decision.decision}`)
    .join("\n");

  return [
    `# ${t(locale, "docs.whitepaper.title")}`,
    "",
    `## ${t(locale, "docs.whitepaper.summary")}`,
    "",
    t(locale, "docs.whitepaper.summaryLine", {
      components: state.nodes.length,
      services: services.length,
      datastores: databases.length,
      channels: queues.length,
    }),
    t(locale, "docs.whitepaper.summaryEntities", { entities: state.entities.length }),
    "",
    `## ${t(locale, "docs.whitepaper.overview")}`,
    "",
    "```mermaid",
    mermaid,
    "```",
    "",
    `## ${t(locale, "docs.whitepaper.techStack")}`,
    "",
    `| ${t(locale, "common.name")} | ${t(locale, "common.kind")} | ${t(locale, "docs.whitepaper.keyTechnology")} |`,
    "|---|---|---|",
    ...state.nodes.map((node) => {
      const tech = ["runtime", "engine", "framework", "provider"]
        .map((key) => node.props[key])
        .filter((value) => value !== undefined)
        .join(", ");
      return `| ${node.name} | ${node.kind} | ${tech || "-"} |`;
    }),
    "",
    `## ${t(locale, "docs.whitepaper.components")}`,
    "",
    ...state.nodes.map((node) => `- **${nodeLabel(node)}** — props: ${JSON.stringify(node.props)}`),
    "",
    `## ${t(locale, "docs.whitepaper.domainModel")}`,
    "",
    ...(state.entities.length > 0
      ? state.entities.map((entity) => {
          const fields = entity.fields.map((field) => `${field.name}:${field.type}`).join(", ");
          return `- **${entity.name}** — ${fields}`;
        })
      : [`- ${t(locale, "docs.architecture.noEntities")}`]),
    "",
    `## ${t(locale, "docs.whitepaper.dataFlows")}`,
    "",
    ...(state.edges.length > 0
      ? state.edges.map((edge) => `- \`${edge.from}\` → \`${edge.to}\` (${edge.protocol})`)
      : [`- ${t(locale, "docs.whitepaper.noConnections")}`]),
    "",
    `## ${t(locale, "docs.whitepaper.decisions")}`,
    "",
    decisions || t(locale, "docs.whitepaper.noDecisions"),
    "",
    `## ${t(locale, "docs.whitepaper.deliveryPlan")}`,
    "",
    t(locale, "docs.whitepaper.deliveryLine", {
      tasks: packets.length,
      waves: new Set(packets.map((packet) => packet.parallelGroup)).size,
    }),
    t(locale, "docs.whitepaper.deliveryHint"),
    "",
    `## ${t(locale, "docs.whitepaper.verification")}`,
    "",
    t(locale, "docs.whitepaper.verificationText"),
    "",
  ].join("\n");
}

function cursorRules(locale: ReturnType<typeof resolveTaskOptions>["locale"]): string {
  return [
    `# ${t(locale, "docs.rules.title")}`,
    "",
    t(locale, "docs.rules.intro"),
    "",
    `1. ${t(locale, "docs.rules.rule1")}`,
    `2. ${t(locale, "docs.rules.rule2")}`,
    `3. ${t(locale, "docs.rules.rule3")}`,
    `4. ${t(locale, "docs.rules.rule4")}`,
    `5. ${t(locale, "docs.rules.rule5")}`,
    `6. ${t(locale, "docs.rules.rule6")}`,
    `7. ${t(locale, "docs.rules.rule7")}`,
    `8. ${t(locale, "docs.rules.rule8")}`,
    "",
  ].join("\n");
}

function agentsMarkdown(
  packets: TaskPacket[],
  state: ArchState,
  locale: ReturnType<typeof resolveTaskOptions>["locale"],
): string {
  return [
    `# ${t(locale, "docs.agents.title")}`,
    "",
    t(locale, "docs.agents.intro"),
    "",
    `- ${t(locale, "docs.agents.start")}`,
    `- ${t(locale, "docs.agents.packet")}`,
    `- ${t(locale, "docs.agents.count", {
      packets: packets.length,
      components: state.nodes.length,
      entities: state.entities.length,
    })}`,
    `- ${t(locale, "docs.agents.notAll")}`,
    `- ${t(locale, "docs.agents.commits")}`,
    "",
  ].join("\n");
}

function adrMarkdown(
  decision: ArchState["decisions"][number],
  number: number,
  locale: ReturnType<typeof resolveTaskOptions>["locale"],
): string {
  return [
    `# ${t(locale, "docs.adr.title", { number: padNumber(number), title: decision.title })}`,
    "",
    `## ${t(locale, "docs.adr.status")}`,
    "",
    t(locale, "docs.adr.accepted"),
    "",
    `## ${t(locale, "docs.adr.context")}`,
    "",
    decision.context || t(locale, "docs.adr.noContext"),
    "",
    `## ${t(locale, "docs.adr.decision")}`,
    "",
    decision.decision,
    "",
    `## ${t(locale, "docs.adr.alternatives")}`,
    "",
    ...(decision.alternatives.length > 0
      ? decision.alternatives.map((item) => `- ${item}`)
      : [`- ${t(locale, "docs.adr.none")}`]),
    "",
    `## ${t(locale, "docs.adr.consequences")}`,
    "",
    t(locale, "docs.adr.consequencesText"),
    "",
  ].join("\n");
}
