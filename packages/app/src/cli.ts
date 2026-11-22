import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { parseState, type ArchState } from "../../core/src/state";
import type { PackageManager, TaskBuildOptions, TestRunner } from "../../core/src/task-packet";
import { isLocale, LOCALES, normalizeLocale } from "../../core/src/i18n";
import type { PackageResult } from "../../packager/src";
import { buildPackage } from "../../packager/src";
import { runPipeline } from "./pipeline";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out ?? "out/agent-package.zip";
  if (args.locale !== undefined && !isLocale(args.locale)) {
    throw new Error(`Unsupported locale: ${args.locale}. Use one of ${LOCALES.join(", ")}.`);
  }
  const locale = args.locale ? normalizeLocale(args.locale) : undefined;
  const taskOptions: TaskBuildOptions = { packageManager: args.packageManager, testRunner: args.testRunner, locale };

  let state: ArchState;
  let result: PackageResult;

  if (args.json) {
    state = parseState(JSON.parse(readFileSync(args.json, "utf8")));
    result = await buildPackage(state, { taskOptions, locale });
  } else {
    if (!args.idea) throw new Error("Provide --idea <text> or --json <path>");
    const pipelineResult = await runPipeline(args.idea, {
      demo: args.demo,
      apiKey: args.apiKey,
      baseUrl: args.baseUrl,
      model: args.model,
      taskOptions,
      locale,
    });
    state = pipelineResult.state;
    result = pipelineResult;
  }

  if (args.preview) {
    console.log(
      JSON.stringify(
        {
          state,
          tasks: result.packets.map((packet) => ({
            id: packet.id,
            title: packet.title,
            dependsOn: packet.dependsOn,
            wave: packet.parallelGroup,
            tokens: packet.tokenCount,
          })),
          metrics: result.metrics,
          validation: result.validation,
        },
        null,
        2,
      ),
    );
  }

  if (!args.preview || args.out !== undefined) {
    mkdirSync(dirname(out), { recursive: true });
    await pipeline(result.zip.stream(), createWriteStream(out));
    console.log(`Package written to ${out}`);
  }

  if (args.extract) {
    const root = resolve(args.extract);
    for (const [path, content] of Object.entries(result.files)) {
      const target = resolve(root, path);
      if (target !== root && !target.startsWith(root + sep)) {
        throw new Error(`Refusing to write outside --extract directory: ${path}`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    console.log(`Extracted ${Object.keys(result.files).length} files to ${root}`);
  }

  const passed = result.metrics.filter((metric) => metric.pass).length;
  console.log(`Components: ${state.nodes.length}, entities: ${state.entities.length}, tasks: ${result.packets.length}`);
  console.log(`Metrics: ${passed}/${result.metrics.length} passed`);
  console.log(
    `Validation: ${result.validation.ok ? "ok" : "failed"} (${result.validation.checksRun} deterministic checks)`,
  );
  for (const metric of result.metrics.filter((item) => !item.pass)) {
    console.log(`  FAIL ${metric.name}: ${metric.value} (target ${metric.target})`);
  }
  for (const issue of result.validation.issues) {
    console.log(`  ISSUE ${issue.file}: ${issue.message}`);
  }
  if (!result.validation.ok && args.json) process.exitCode = 2;
}

function parseArgs(argv: string[]) {
  const result: {
    idea?: string;
    json?: string;
    out?: string;
    extract?: string;
    demo: boolean;
    preview: boolean;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    packageManager?: PackageManager;
    testRunner?: TestRunner;
    locale?: string;
  } = { demo: false, preview: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    switch (arg) {
      case "--idea":
        result.idea = next();
        break;
      case "--json":
        result.json = next();
        break;
      case "--out":
        result.out = next();
        break;
      case "--extract":
        result.extract = next();
        break;
      case "--demo":
        result.demo = true;
        break;
      case "--preview":
        result.preview = true;
        break;
      case "--api-key":
        result.apiKey = next();
        break;
      case "--base-url":
        result.baseUrl = next();
        break;
      case "--model":
        result.model = next();
        break;
      case "--package-manager":
        result.packageManager = next() as PackageManager;
        break;
      case "--test-runner":
        result.testRunner = next() as TestRunner;
        break;
      case "--locale":
        result.locale = next();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        break;
    }
  }
  return result;
}

function printHelp(): void {
  console.log(`AI Principal Architect

Usage:
  pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo
  pnpm generate -- --json architecture.json --out out/package.zip
  pnpm generate -- --idea "..." --api-key sk-... --model gpt-4o-mini

Options:
  --idea <text>              Natural-language architecture idea
  --json <path>              Import an existing ArchState JSON file
  --out <path>               Output ZIP path (default: out/agent-package.zip)
  --extract <dir>            Also write every package file into a directory
  --preview                  Print the state, tasks, metrics and validation as JSON
  --demo                     Use the deterministic demo state producer
  --api-key <key>            BYOK key (never written to disk)
  --base-url <url>           OpenAI-compatible base URL
  --model <name>             Model name
  --package-manager <name>   pnpm | npm | yarn | bun (default: pnpm)
  --test-runner <name>       vitest | jest | node (default: vitest)
  --locale <code>            ${LOCALES.join(" | ")} (default: en)
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unexpected error");
  process.exit(1);
});
