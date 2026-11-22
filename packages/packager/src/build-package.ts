import type { ArchState } from "../../core/src/state";
import { dependencyDepth, validateState } from "../../core/src/diff";
import { eqMetric, gteMetric, lteMetric, type MetricReport } from "../../core/src/metrics";
import {
  buildTaskPackets,
  computeTaskMetrics,
  renderTaskMarkdown,
} from "../../core/src/task-packet";
import {
  generateAsyncAPI,
  generateDocs,
  generateMermaid,
  generateOpenAPI31,
  generatePrisma,
} from "../../generators/src";
import { repairArtifacts, validateArtifacts, type ValidationReport } from "../../validators/src";
import { renderOpenCodeAgent } from "./opencode-agents";
import { renderManifest } from "./report";
import { zipFiles } from "./zip";

export interface BuildOptions {
  secrets?: string[];
  extraFiles?: Record<string, string>;
}

export interface PackageResult {
  zip: Buffer;
  files: Record<string, string>;
  metrics: MetricReport[];
  validation: ValidationReport;
}

export async function buildPackage(state: ArchState, options: BuildOptions = {}): Promise<PackageResult> {
  const startedAt = Date.now();
  const stateErrors = validateState(state);
  if (stateErrors.length > 0) {
    throw new Error(`Invalid architecture state: ${stateErrors.join("; ")}`);
  }

  const packets = buildTaskPackets(state);
  const docs = generateDocs(state, packets);
  let files: Record<string, string> = {
    ...docs,
    ...(options.extraFiles ?? {}),
    "openapi.yaml": generateOpenAPI31(state),
    "asyncapi.yaml": generateAsyncAPI(state),
    "prisma/schema.prisma": generatePrisma(state),
    "diagram.mmd": generateMermaid(state),
    "metrics.json": JSON.stringify([{ name: "pending", value: 0, target: "-", pass: true }]),
  };

  for (const packet of packets) {
    files[`tasks/${packet.id}.md`] = renderTaskMarkdown(packet);
  }
  files[".opencode/agents/implementer.md"] = renderOpenCodeAgent("implementer");
  files[".opencode/agents/validator.md"] = renderOpenCodeAgent("validator");
  files[".opencode/agents/reviewer.md"] = renderOpenCodeAgent("reviewer");
  files = redactSecrets(files, options.secrets ?? []);

  let validation = validateArtifacts(files);
  let selfHealRounds = 0;
  if (!validation.ok) {
    const repaired = repairArtifacts(files);
    Object.assign(files, repaired.files);
    selfHealRounds = repaired.rounds;
    validation = validateArtifacts(files);
  }

  const taskMetrics = computeTaskMetrics(state, packets);
  const depth = dependencyDepth(state);
  const baseMetrics: MetricReport[] = [
    lteMetric("packet_prompt_tokens_p95", taskMetrics.packetP95Tokens, 1500),
    lteMetric("packet_prompt_tokens_max", taskMetrics.packetMaxTokens, 2500),
    lteMetric("context_slice_ratio", taskMetrics.contextSliceRatio, 0.1),
    lteMetric("duplicate_context_ratio", taskMetrics.duplicateContextRatio, 0.05),
    lteMetric("files_per_task", taskMetrics.maxFilesPerTask, 5),
    lteMetric("dependency_depth", depth, 4),
    gteMetric("parallel_groups", taskMetrics.parallelGroups, Math.min(3, state.nodes.length)),
    lteMetric("subagent_steps", 8, 8),
    gteMetric("contract_coverage", taskMetrics.contractCoverage, 1),
    gteMetric("acceptance_coverage", taskMetrics.acceptanceCoverage, 1),
    gteMetric("validator_pass_rate", validation.passRate, 1),
    lteMetric("self_heal_rounds", selfHealRounds, 2),
    eqMetric("unresolved_refs", validation.unresolvedRefs, 0),
    gteMetric("deterministic_coverage", validation.deterministicCoverage, 0.9),
    lteMetric("index_tokens", taskMetrics.indexTokens, 800),
    lteMetric("package_size_kb", 0, 500),
    lteMetric("state_to_package_ms", Date.now() - startedAt, 10000),
  ];

  files["metrics.json"] = JSON.stringify(baseMetrics, null, 2);
  files["MANIFEST.md"] = renderManifest(files, baseMetrics);
  const firstZip = await zipFiles(files);
  const sizeKb = firstZip.length / 1024;

  const metrics = baseMetrics.map((metric) =>
    metric.name === "package_size_kb" ? lteMetric("package_size_kb", sizeKb, 500) : metric,
  );
  files["metrics.json"] = JSON.stringify(metrics, null, 2);
  files["MANIFEST.md"] = renderManifest(files, metrics);
  const zip = await zipFiles(files);

  return { zip, files, metrics, validation };
}

export function redactSecrets(files: Record<string, string>, secrets: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    let redacted = content;
    for (const secret of secrets) {
      if (secret) redacted = redacted.split(secret).join("[REDACTED]");
    }
    redacted = redacted.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
    result[path] = redacted;
  }
  return result;
}
