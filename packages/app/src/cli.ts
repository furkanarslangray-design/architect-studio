import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseState } from "../../core/src/state";
import { buildPackage } from "../../packager/src";
import { runPipeline } from "./pipeline";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out ?? "out/agent-package.zip";

  const result = args.json
    ? await buildPackage(parseState(JSON.parse(readFileSync(args.json, "utf8"))))
    : await runPipeline(args.idea ?? "", { demo: args.demo, apiKey: args.apiKey, baseUrl: args.baseUrl, model: args.model });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.zip);

  const passed = result.metrics.filter((metric) => metric.pass).length;
  console.log(`Package written to ${out}`);
  console.log(`Metrics: ${passed}/${result.metrics.length} passed`);
  console.log(`Validation: ${result.validation.ok ? "ok" : "failed"}`);
  for (const metric of result.metrics.filter((item) => !item.pass)) {
    console.log(`  FAIL ${metric.name}: ${metric.value} (target ${metric.target})`);
  }
}

function parseArgs(argv: string[]) {
  const result: {
    idea?: string;
    json?: string;
    out?: string;
    demo: boolean;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  } = { demo: false };

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
      case "--demo":
        result.demo = true;
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
  --idea <text>       Natural-language architecture idea
  --json <path>       Import an existing ArchState JSON file
  --out <path>        Output ZIP path (default: out/agent-package.zip)
  --demo              Use the deterministic demo state producer
  --api-key <key>     BYOK key (never written to disk)
  --base-url <url>    OpenAI-compatible base URL
  --model <name>      Model name
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unexpected error");
  process.exit(1);
});
