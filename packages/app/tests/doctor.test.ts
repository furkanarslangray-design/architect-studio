import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repoToState } from "@architect-studio/reverse";
import {
  compareStates,
  doctorProject,
  formatDoctorReport,
  parseDoctorArgs,
  runDoctorCommand,
} from "../src/doctor";

let root: string;
let statePath: string;

function writePrisma(body: string) {
  mkdirSync(join(root, "prisma"), { recursive: true });
  writeFileSync(join(root, "prisma", "schema.prisma"), body);
}

function writeManifest(dependencies: Record<string, string>) {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "doctor-service", dependencies }));
}

function saveState(): void {
  const state = repoToState(root).state;
  mkdirSync(join(root, ".architect"), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "architect-doctor-"));
  statePath = join(root, ".architect", "state.json");
  writeManifest({ express: "^4.0.0" });
  writePrisma("model Invoice {\n  id String @id\n  amount Decimal\n}\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("doctorProject", () => {
  it("reports no drift when the repository matches the saved state", () => {
    saveState();
    const report = doctorProject({ root });
    expect(report.ok).toBe(true);
    expect(report.drift).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.saved).toMatchObject({ entities: 1, fields: 2 });
    expect(report.current).toEqual(report.saved);
    expect(formatDoctorReport(report)).toContain("no drift");
  });

  it("detects an added component and an added field", () => {
    saveState();

    writeManifest({ express: "^4.0.0", redis: "^5.0.0" });
    writePrisma("model Invoice {\n  id String @id\n  amount Decimal\n  status String\n}\n");

    const report = doctorProject({ root });
    expect(report.ok).toBe(false);
    expect(report.drift).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "node", action: "added" }),
        expect.objectContaining({ kind: "field", action: "added", target: "ent-invoice.status" }),
      ]),
    );
    const formatted = formatDoctorReport(report);
    expect(formatted).toContain("drift item");
    expect(formatted).toContain("ent-invoice.status");
  });

  it("detects removed nodes, entities and fields", () => {
    saveState();
    writePrisma("model Customer {\n  id String @id\n  email String\n}\n");

    const report = doctorProject({ root });
    const targets = report.drift.map((change) => `${change.kind}:${change.action}:${change.target}`);
    expect(targets).toContain("entity:removed:ent-invoice");
    expect(targets).toContain("field:removed:ent-invoice.amount");
    expect(targets).toContain("entity:added:ent-customer");
  });

  it("compares states directly", () => {
    const before = repoToState(root).state;
    writeManifest({ express: "^4.0.0", redis: "^5.0.0" });
    const after = repoToState(root).state;
    const changes = compareStates(before, after);
    expect(changes.some((change) => change.kind === "node" && change.action === "added")).toBe(true);
    expect(compareStates(after, after)).toEqual([]);
  });

  it("fails cleanly when the state file is missing", () => {
    const report = doctorProject({ root });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain("Saved state not found");
    expect(report.notes.join(" ")).toContain("--write");
  });

  it("creates the state file with --write when none exists", () => {
    expect(existsSync(statePath)).toBe(false);
    const report = doctorProject({ root, write: true });
    expect(report.ok).toBe(true);
    expect(report.written).toBe(statePath);
    expect(existsSync(statePath)).toBe(true);
    expect(formatDoctorReport(report)).toContain("wrote state");

    const rerun = doctorProject({ root });
    expect(rerun.ok).toBe(true);
    expect(rerun.drift).toEqual([]);
    expect(rerun.saved).toEqual(rerun.current);
  });

  it("refreshes a stale state with --write", () => {
    saveState();
    writeManifest({ express: "^4.0.0", redis: "^5.0.0" });
    expect(doctorProject({ root }).ok).toBe(false);

    const report = doctorProject({ root, write: true });
    expect(report.ok).toBe(true);
    expect(report.written).toBe(statePath);
    expect(report.saved).toEqual(report.current);
    expect(readFileSync(statePath, "utf8")).toContain("event-bus-queue");
    expect(doctorProject({ root })).toMatchObject({ ok: true, drift: [] });
  });

  it("writes to an explicit --state path, creating its directory", () => {
    const custom = join(root, "nested", "dir", "state.json");
    const report = doctorProject({ root, statePath: custom, write: true });
    expect(report.written).toBe(custom);
    expect(existsSync(custom)).toBe(true);
  });

  it("fails cleanly when the saved state is corrupt", () => {
    mkdirSync(join(root, ".architect"), { recursive: true });
    writeFileSync(statePath, "{not json");
    const report = doctorProject({ root });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain("not a valid ArchState");
  });

  it("rewrites a corrupt state with --write instead of failing", () => {
    mkdirSync(join(root, ".architect"), { recursive: true });
    writeFileSync(statePath, "{not json");
    expect(doctorProject({ root }).ok).toBe(false);

    const report = doctorProject({ root, write: true });
    expect(report.ok).toBe(true);
    expect(report.written).toBe(statePath);
    expect(report.notes.join(" ")).toContain("rewriting it");
    expect(() => JSON.parse(readFileSync(statePath, "utf8"))).not.toThrow();
    expect(doctorProject({ root })).toMatchObject({ ok: true, drift: [] });
  });

  it("rewrites a state that parses as JSON but fails the schema", () => {
    mkdirSync(join(root, ".architect"), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ version: 1, nodes: "nope" }));
    expect(doctorProject({ root }).ok).toBe(false);
    expect(doctorProject({ root, write: true }).ok).toBe(true);
    expect(doctorProject({ root }).ok).toBe(true);
  });

  it("accepts an explicit --state path", () => {
    const custom = join(root, "custom-state.json");
    writeFileSync(custom, JSON.stringify(repoToState(root).state));
    expect(doctorProject({ root, statePath: custom }).ok).toBe(true);
  });
});

describe("doctor CLI", () => {
  it("parses arguments", () => {
    expect(parseDoctorArgs(["packages/api", "--state", "s.json", "--json", "--fail-on-drift"])).toEqual({
      root: "packages/api",
      statePath: "s.json",
      json: true,
      failOnDrift: true,
      write: false,
    });
    expect(parseDoctorArgs(["--write"])).toMatchObject({ write: true });
    expect(parseDoctorArgs(["--state=other.json"])).toMatchObject({ statePath: "other.json" });
    expect(() => parseDoctorArgs(["--state"])).toThrow(/--state needs a path/);
    expect(() => parseDoctorArgs(["--nope"])).toThrow(/Unknown option/);
    expect(() => parseDoctorArgs([".", "."])).toThrow(/Unexpected argument/);
  });

  it("exits 0 when clean, 1 on drift with --fail-on-drift and 2 when the state is missing", () => {
    saveState();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runDoctorCommand([root])).toBe(0);

    writeManifest({ express: "^4.0.0", redis: "^5.0.0" });
    expect(runDoctorCommand([root, "--fail-on-drift"])).toBe(1);
    expect(runDoctorCommand([root])).toBe(0);

    const jsonCalls = log.mock.calls.length;
    const empty = join(root, "no-state-here");
    mkdirSync(empty, { recursive: true });
    expect(runDoctorCommand([empty])).toBe(2);
    expect(runDoctorCommand([empty, "--write"])).toBe(0);
    expect(existsSync(join(empty, ".architect", "state.json"))).toBe(true);

    const corrupt = join(root, "corrupt-repo");
    mkdirSync(join(corrupt, ".architect"), { recursive: true });
    writeFileSync(join(corrupt, ".architect", "state.json"), "{broken");
    expect(runDoctorCommand([corrupt])).toBe(2);
    expect(runDoctorCommand([corrupt, "--write"])).toBe(0);
    expect(runDoctorCommand([corrupt])).toBe(0);

    log.mockClear();
    expect(runDoctorCommand([root, "--json"])).toBe(0);
    expect(log.mock.calls.length).toBeGreaterThan(jsonCalls > 0 ? 0 : 0);
    const payload = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(payload).toMatchObject({ root, ok: false });
    expect(Array.isArray(payload.drift)).toBe(true);
  });

  it("prints the saved state path in the human report", () => {
    saveState();
    const report = doctorProject({ root });
    const text = formatDoctorReport(report);
    expect(text).toContain(statePath);
    expect(readFileSync(statePath, "utf8")).toContain('"entities"');
  });
});
