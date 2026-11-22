import type { MetricReport } from "../../core/src/metrics";
import { DEFAULT_LOCALE, t, type Locale } from "../../core/src/i18n";
import type { ValidationReport } from "../../validators/src";

export interface ManifestSummary {
  components?: number;
  entities?: number;
  tasks?: number;
  waves?: number;
  validation?: ValidationReport;
}

export function renderManifest(
  files: Record<string, string>,
  metrics: MetricReport[],
  summary: ManifestSummary = {},
  locale: Locale = DEFAULT_LOCALE,
): string {
  const paths = Object.keys(files).sort();
  const failed = metrics.filter((metric) => !metric.pass);
  const taskFiles = paths.filter((path) => path.startsWith("tasks/"));
  const validation = summary.validation;

  return [
    `# ${t(locale, "docs.manifest.title")}`,
    "",
    t(locale, "docs.manifest.generatedBy"),
    "",
    `## ${t(locale, "docs.manifest.overview")}`,
    "",
    `- ${t(locale, "docs.manifest.components")}: ${summary.components ?? "-"}`,
    `- ${t(locale, "docs.manifest.entities")}: ${summary.entities ?? "-"}`,
    `- ${t(locale, "docs.manifest.tasks")}: ${summary.tasks ?? taskFiles.length}`,
    `- ${t(locale, "docs.manifest.waves")}: ${summary.waves ?? "-"}`,
    `- ${t(locale, "docs.manifest.validation")}: ${validation ? (validation.ok ? t(locale, "common.passed") : t(locale, "common.failed")) : "-"}`,
    "",
    `## ${t(locale, "docs.manifest.contents")}`,
    "",
    ...paths.map((path) => `- \`${path}\``),
    "",
    `## ${t(locale, "docs.manifest.taskPackets")}`,
    "",
    ...(taskFiles.length > 0 ? taskFiles.map((path) => `- \`${path}\``) : [`- ${t(locale, "docs.manifest.noTasks")}`]),
    "",
    `## ${t(locale, "docs.manifest.metrics")}`,
    "",
    `| ${t(locale, "common.name")} | ${t(locale, "common.value")} | ${t(locale, "common.target")} | ${t(locale, "common.status")} |`,
    "|---|---|---|---|",
    ...metrics.map(
      (metric) =>
        `| ${metric.name} | ${metric.value} | ${metric.target} | ${metric.pass ? t(locale, "common.yes") : t(locale, "common.no")} |`,
    ),
    "",
    failed.length === 0
      ? t(locale, "docs.manifest.allPassed")
      : t(locale, "docs.manifest.outsideTarget", {
          count: failed.length,
          names: failed.map((metric) => metric.name).join(", "),
        }),
    "",
    ...(validation && validation.issues.length > 0
      ? [
          `## ${t(locale, "docs.manifest.validationIssues")}`,
          "",
          ...validation.issues.map((issue) => `- \`${issue.file}\`: ${issue.message}`),
          "",
        ]
      : []),
    "## Reproduce",
    "",
    "```bash",
    `# ${t(locale, "docs.manifest.reproduce", {
      checks: validation?.checksRun ?? 0,
      kinds: validation?.artifactsValidated.length ?? 0,
    })}`,
    "pnpm test",
    "```",
    "",
  ].join("\n");
}
