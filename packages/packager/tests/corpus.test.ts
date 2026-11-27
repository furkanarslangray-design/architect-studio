import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDocs } from "../../generators/src";
import { LOCALES, t } from "../../core/src/i18n";
import { parseState, type ArchState } from "../../core/src/state";
import { buildPackage, renderManifest } from "../src";

const corpusDir = join(__dirname, "../../../examples/corpus");
const snapshotDir = join(__dirname, "__snapshots__");
const snapshotPath = join(snapshotDir, "corpus.json");
const update = process.env.UPDATE_CORPUS === "1";

interface FileFingerprint {
  path: string;
  sha256: string;
}

interface MetricFingerprint {
  name: string;
  value: number;
  pass: boolean;
}

interface PackageFingerprint {
  files: FileFingerprint[];
  metrics: MetricFingerprint[];
}

type Snapshot = Record<string, PackageFingerprint>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fingerprint(state: ArchState): Promise<PackageFingerprint> {
  const result = await buildPackage(state, { reproducible: true });
  return {
    files: Object.keys(result.files)
      .sort()
      .map((path) => ({ path, sha256: sha256(result.files[path]) })),
    metrics: result.metrics.map(({ name, value, pass }) => ({ name, value, pass })),
  };
}

const states = readdirSync(corpusDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => ({
    name: name.replace(/\.json$/, ""),
    state: parseState(JSON.parse(readFileSync(join(corpusDir, name), "utf8"))),
  }));

const expected: Snapshot = update || !existsSync(snapshotPath)
  ? {}
  : (JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot);
const actual: Snapshot = {};

afterAll(() => {
  if (!update) return;
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
});

describe.each(states)("golden corpus: $name", ({ name, state }) => {
  it("keeps the package file list, per-file SHA-256 and numeric metrics stable", async () => {
    const current = await fingerprint(state);
    if (update) {
      actual[name] = current;
      return;
    }
    expect(
      current,
      `package output drifted; review the change, then run UPDATE_CORPUS=1 pnpm nx run packager:test to refresh ${snapshotPath}`,
    ).toEqual(expected[name]);
  });
});

describe("golden corpus: locales", () => {
  it("renders the document title and manifest heading in all eight locales", () => {
    const state = parseState({
      version: 1,
      nodes: [{ id: "svc-1", kind: "service", name: "API", props: {} }],
      edges: [],
      decisions: [],
    });

    for (const locale of LOCALES) {
      const docs = generateDocs(state, [], { locale });
      expect(docs["ARCHITECTURE.md"]).toContain(`# ${t(locale, "docs.architecture.title")}`);
      const manifest = renderManifest({ "ARCHITECTURE.md": "" }, [], {}, locale);
      expect(manifest).toContain(`# ${t(locale, "docs.manifest.title")}`);
    }
  });
});
