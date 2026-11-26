import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validateState } from "../../core/src/diff";
import { parseState, type ArchState } from "../../core/src/state";
import { repoToState } from "../../reverse/src";

/**
 * `architect doctor` — compares the architecture state saved in a repository
 * with the state the repository produces today, so a stale `.architect/state.json`
 * (or a stale generated package) is visible instead of silently wrong.
 *
 * Scope: structural drift only (nodes, edges, entities, fields, decisions).
 * Artifact files such as `openapi.yaml` are not parsed back yet; the report says so.
 */

export interface DoctorChange {
  kind: "node" | "edge" | "entity" | "field" | "decision";
  action: "added" | "removed" | "updated";
  target: string;
}

export interface StateCounts {
  nodes: number;
  edges: number;
  entities: number;
  fields: number;
  decisions: number;
}

export interface DoctorReport {
  ok: boolean;
  root: string;
  statePath: string;
  checkedAt: string;
  /** Present when the saved state could be read. */
  saved?: StateCounts;
  /** Present when the repository could be analysed. */
  current?: StateCounts;
  drift: DoctorChange[];
  /** Structural problems the validator found in either state. */
  errors: string[];
  notes: string[];
  /** Set to the written path when `--write` saved the current state. */
  written?: string;
}

export interface DoctorOptions {
  root?: string;
  statePath?: string;
  /** Saves the analysed state to `statePath` before reporting. */
  write?: boolean;
}

function counts(state: ArchState): StateCounts {
  return {
    nodes: state.nodes.length,
    edges: state.edges.length,
    entities: state.entities.length,
    fields: state.entities.reduce((total, entity) => total + entity.fields.length, 0),
    decisions: state.decisions.length,
  };
}

function pushChange(
  changes: DoctorChange[],
  kind: DoctorChange["kind"],
  action: DoctorChange["action"],
  target: string,
): void {
  changes.push({ kind, action, target });
}

/** Structural drift between the saved state and the repository as it is now. */
export function compareStates(saved: ArchState, current: ArchState): DoctorChange[] {
  const changes: DoctorChange[] = [];

  const savedNodes = new Map(saved.nodes.map((node) => [node.id, node]));
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  for (const id of currentNodes.keys()) {
    if (!savedNodes.has(id)) pushChange(changes, "node", "added", id);
  }
  for (const [id, node] of savedNodes) {
    const next = currentNodes.get(id);
    if (!next) {
      pushChange(changes, "node", "removed", id);
      continue;
    }
    if (JSON.stringify(node) !== JSON.stringify(next)) pushChange(changes, "node", "updated", id);
  }

  const savedEdges = new Map(saved.edges.map((edge) => [edge.id, edge]));
  const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]));
  for (const id of currentEdges.keys()) if (!savedEdges.has(id)) pushChange(changes, "edge", "added", id);
  for (const [id, edge] of savedEdges) {
    const next = currentEdges.get(id);
    if (!next) pushChange(changes, "edge", "removed", id);
    else if (JSON.stringify(edge) !== JSON.stringify(next)) pushChange(changes, "edge", "updated", id);
  }

  const savedEntities = new Map(saved.entities.map((entity) => [entity.id, entity]));
  const currentEntities = new Map(current.entities.map((entity) => [entity.id, entity]));
  for (const [id, entity] of currentEntities) {
    const previous = savedEntities.get(id);
    if (!previous) {
      pushChange(changes, "entity", "added", id);
      for (const field of entity.fields) pushChange(changes, "field", "added", `${id}.${field.name}`);
      continue;
    }
    const previousFields = new Map(previous.fields.map((field) => [field.name, field]));
    for (const field of entity.fields) {
      const old = previousFields.get(field.name);
      if (!old) pushChange(changes, "field", "added", `${id}.${field.name}`);
      else if (JSON.stringify(old) !== JSON.stringify(field)) pushChange(changes, "field", "updated", `${id}.${field.name}`);
    }
    for (const name of previousFields.keys()) {
      if (!entity.fields.some((field) => field.name === name)) pushChange(changes, "field", "removed", `${id}.${name}`);
    }
    if (
      previous.name !== entity.name ||
      previous.serviceId !== entity.serviceId ||
      previous.databaseId !== entity.databaseId
    ) {
      pushChange(changes, "entity", "updated", id);
    }
  }
  for (const id of savedEntities.keys()) {
    if (!currentEntities.has(id)) {
      pushChange(changes, "entity", "removed", id);
      for (const field of savedEntities.get(id)!.fields) {
        pushChange(changes, "field", "removed", `${id}.${field.name}`);
      }
    }
  }

  const savedDecisions = new Map(saved.decisions.map((decision) => [decision.id, decision]));
  const currentDecisions = new Map(current.decisions.map((decision) => [decision.id, decision]));
  for (const id of currentDecisions.keys()) if (!savedDecisions.has(id)) pushChange(changes, "decision", "added", id);
  for (const id of savedDecisions.keys()) if (!currentDecisions.has(id)) pushChange(changes, "decision", "removed", id);
  for (const [id, decision] of savedDecisions) {
    const next = currentDecisions.get(id);
    if (next && JSON.stringify(decision) !== JSON.stringify(next)) pushChange(changes, "decision", "updated", id);
  }

  return changes;
}

export function doctorProject(options: DoctorOptions = {}): DoctorReport {
  const root = resolve(options.root ?? ".");
  const statePath = resolve(options.statePath ?? join(root, ".architect", "state.json"));
  const report: DoctorReport = {
    ok: false,
    root,
    statePath,
    checkedAt: new Date().toISOString(),
    drift: [],
    errors: [],
    notes: [],
  };

  if (!existsSync(statePath) && !options.write) {
    report.errors.push(`Saved state not found: ${statePath}`);
    report.notes.push("Run `pnpm architect doctor . --write` to save the current architecture, or pass --state <path>.");
    return report;
  }

  let saved: ArchState | undefined;
  if (existsSync(statePath)) {
    try {
      saved = parseState(JSON.parse(readFileSync(statePath, "utf8")));
    } catch (error) {
      report.errors.push(
        `Saved state is not a valid ArchState: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return report;
    }
    report.saved = counts(saved);
  }

  let current: ArchState;
  try {
    current = repoToState(root).state;
  } catch (error) {
    report.errors.push(`Repository could not be analysed: ${error instanceof Error ? error.message : "unknown error"}`);
    return report;
  }
  report.current = counts(current);

  if (options.write) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(current, null, 2)}\n`);
    report.written = statePath;
    report.saved = report.current;
    report.notes.push("Wrote the analysed state; run doctor again to check for drift.");
  }

  report.errors.push(...validateState(current).map((issue) => `current: ${issue}`));
  if (saved) {
    report.errors.push(...validateState(saved).map((issue) => `saved: ${issue}`));
    report.drift = options.write ? [] : compareStates(saved, current);
  }
  report.notes.push("Artifact files (openapi.yaml, ARCHITECTURE.md) are not parsed back; drift is structural only.");
  report.ok = report.drift.length === 0 && report.errors.length === 0;
  return report;
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`architect doctor → ${report.root}`);
  lines.push(`  state: ${report.statePath}`);
  if (report.saved && report.current) {
    lines.push(
      `  saved:   ${report.saved.nodes} nodes, ${report.saved.entities} entities, ${report.saved.fields} fields, ${report.saved.decisions} decisions`,
    );
    lines.push(
      `  current: ${report.current.nodes} nodes, ${report.current.entities} entities, ${report.current.fields} fields, ${report.current.decisions} decisions`,
    );
  }
  if (report.ok) {
    lines.push("  ✓ no drift: the saved architecture still matches the repository");
  } else if (report.drift.length > 0) {
    lines.push(`  ! ${report.drift.length} drift item(s):`);
    for (const change of report.drift) lines.push(`     ${change.action.padEnd(7)} ${change.kind.padEnd(8)} ${change.target}`);
  }
  for (const error of report.errors) lines.push(`  ✗ ${error}`);
  if (report.written) lines.push(`  ✓ wrote state: ${report.written}`);
  for (const note of report.notes) lines.push(`  · ${note}`);
  return lines.join("\n");
}

export function parseDoctorArgs(argv: string[]): {
  root?: string;
  statePath?: string;
  json: boolean;
  failOnDrift: boolean;
  write: boolean;
} {
  const result: { root?: string; statePath?: string; json: boolean; failOnDrift: boolean; write: boolean } = {
    json: false,
    failOnDrift: false,
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      result.json = true;
      continue;
    }
    if (arg === "--fail-on-drift") {
      result.failOnDrift = true;
      continue;
    }
    if (arg === "--write") {
      result.write = true;
      continue;
    }
    if (arg === "--state") {
      const value = argv[++index];
      if (!value) throw new Error("--state needs a path");
      result.statePath = value;
      continue;
    }
    if (arg.startsWith("--state=")) {
      result.statePath = arg.slice("--state=".length);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option for doctor: ${arg}`);
    if (result.root === undefined) {
      result.root = arg;
      continue;
    }
    throw new Error(`Unexpected argument for doctor: ${arg}`);
  }
  return result;
}

/** 0 = clean, 1 = drift with --fail-on-drift, 2 = missing/invalid input. */
export function runDoctorCommand(argv: string[]): number {
  const args = parseDoctorArgs(argv);
  const report = doctorProject({ root: args.root, statePath: args.statePath, write: args.write });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatDoctorReport(report));

  const missingOrInvalid = report.errors.some((error) => /not found|not a valid ArchState|could not be analysed/.test(error));
  if (missingOrInvalid) return 2;
  if (!report.ok && args.failOnDrift) return 1;
  return 0;
}
