import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { parseState, type ArchState } from "../../core/src/state";
import type { PackageManager, TaskBuildOptions, TestRunner } from "../../core/src/task-packet";
import { isLocale, LOCALES, normalizeLocale } from "../../core/src/i18n";
import type { PackageResult } from "../../packager/src";
import { buildPackage } from "../../packager/src";
import { repoToState, repoToStateWithRea, summarizeReverse, type ReverseResult } from "../../reverse/src";
import {
  isSandboxType,
  SANDBOX_TYPES,
  verifyPackage,
  type SandboxRun,
  type SandboxType,
} from "../../sandbox/src";
import { isSearchProvider, WEB_SEARCH_PROVIDERS, type SearchProvider } from "./web-search";
import { runPipeline } from "./pipeline";
import { runInitCommand } from "./init";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // `architect init` is a subcommand; everything else keeps the historical flags.
  if (argv[0] === "init") {
    process.exitCode = runInitCommand(argv.slice(1));
    return;
  }
  const args = parseArgs(argv);
  const out = args.out ?? "out/agent-package.zip";
  if (args.locale !== undefined && !isLocale(args.locale)) {
    throw new Error(`Unsupported locale: ${args.locale}. Use one of ${LOCALES.join(", ")}.`);
  }
  const locale = args.locale ? normalizeLocale(args.locale) : undefined;
  const taskOptions: TaskBuildOptions = { packageManager: args.packageManager, testRunner: args.testRunner, locale };

  let state: ArchState;
  let result: PackageResult;
  let reversed: ReverseResult | undefined;

  if (args.reverse) {
    reversed = args.useRea ? await repoToStateWithRea(args.reverse) : repoToState(args.reverse);
    state = reversed.state;
    result = await buildPackage(state, { taskOptions, locale });
    console.log(`Reverse engineering: ${summarizeReverse(reversed)}`);
    if (reversed.rea) {
      const { detection, engine, scannedArtifacts } = reversed.rea;
      console.log(
        detection.available
          ? `REA: ${detection.binary ?? engine} ${detection.version ?? ""} · ${reversed.rea.findings.length} findings · ${scannedArtifacts} artifacts`.trim()
          : `REA: not installed (${detection.reason ?? "unknown"}), built-in analyzer used · ${reversed.rea.findings.length} findings · ${scannedArtifacts} artifacts`,
      );
      for (const finding of reversed.rea.findings.slice(0, 20)) {
        console.log(`  rea/${finding.category} ${finding.title}: ${finding.detail}`);
      }
    }
    for (const finding of reversed.findings.slice(0, 40)) {
      console.log(`  ${finding.kind.padEnd(9)} ${finding.source}: ${finding.detail}`);
    }
    if (reversed.warnings.length > 0) {
      console.log(`  warnings: ${reversed.warnings.join("; ")}`);
    }
  } else if (args.json) {
    state = parseState(JSON.parse(readFileSync(args.json, "utf8")));
    result = await buildPackage(state, { taskOptions, locale });
  } else {
    if (!args.idea) throw new Error("Provide --idea <text>, --json <path> or --reverse <dir>");
    const pipelineResult = await runPipeline(args.idea, {
      demo: args.demo,
      apiKey: args.apiKey,
      baseUrl: args.baseUrl,
      model: args.model,
      taskOptions,
      locale,
      webSearch: args.webSearch,
      searchProvider: args.searchProvider,
    });
    state = pipelineResult.state;
    result = pipelineResult;
    if (pipelineResult.research) {
      console.log(
        `Web search: ${pipelineResult.research.provider} returned ${pipelineResult.research.results.length} reference(s)`,
      );
    }
    if (pipelineResult.searchNote) console.log(`Web search note: ${pipelineResult.searchNote}`);
  }

  if (args.preview) {
    console.log(
      JSON.stringify(
        {
          state,
          ...(reversed ? { reverse: { summary: summarizeReverse(reversed), findings: reversed.findings } } : {}),
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

  let sandboxRun: SandboxRun | undefined;
  if (args.sandbox) {
    sandboxRun = await verifyPackage(result.files, {
      sandbox: args.sandbox,
      fallback: true,
      ...(args.sandboxCommand ? { command: args.sandboxCommand, args: [] } : {}),
    });
    console.log(`Sandbox: ${sandboxRun.driver} (${sandboxRun.isolation}) exit=${String(sandboxRun.exitCode)}`);
    if (sandboxRun.stdout.trim()) console.log(sandboxRun.stdout.trim());
    if (sandboxRun.stderr.trim()) console.error(sandboxRun.stderr.trim());
    if (sandboxRun.timedOut || sandboxRun.exitCode !== 0) process.exitCode = 3;
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
    reverse?: string;
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
    sandbox?: SandboxType;
    sandboxCommand?: string;
    webSearch: boolean;
    searchProvider?: SearchProvider;
    useRea: boolean;
  } = { demo: false, preview: false, webSearch: false, useRea: false };

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
      case "--reverse":
        result.reverse = next();
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
      case "--sandbox": {
        const value = next();
        if (!isSandboxType(value)) {
          throw new Error(`Unsupported sandbox: ${value}. Use one of ${SANDBOX_TYPES.join(", ")}.`);
        }
        result.sandbox = value;
        break;
      }
      case "--sandbox-command":
        result.sandboxCommand = next();
        break;
      case "--web-search":
        result.webSearch = true;
        break;
      case "--use-rea":
        result.useRea = true;
        break;
      case "--search-provider": {
        const value = next();
        if (!isSearchProvider(value)) {
          throw new Error(`Unsupported search provider: ${value}. Use one of ${WEB_SEARCH_PROVIDERS.join(", ")}.`);
        }
        result.searchProvider = value;
        break;
      }
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
  pnpm architect init [dir] [--client cursor|claude|opencode|freebuff|all] [--force]
  pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo
  pnpm generate -- --json architecture.json --out out/package.zip
  pnpm generate -- --reverse ../my-project --use-rea --sandbox auto
  pnpm generate -- --idea "..." --web-search --search-provider auto

Options:
  --idea <text>              Natural-language architecture idea
  --json <path>              Import an existing ArchState JSON file
  --reverse <dir>            Derive the ArchState from an existing repository
  --use-rea                  Bridge morluto/rea when installed, built-in artifact analysis otherwise
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
  --sandbox <type>           ${SANDBOX_TYPES.join(" | ")}
  --sandbox-command <cmd>    Run a custom command instead of the built-in package check
  --web-search               Look up current references before generating
  --search-provider <name>   ${WEB_SEARCH_PROVIDERS.join(" | ")} (default: auto)
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unexpected error");
  process.exit(1);
});
