import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runProjectsCommand } from "../src/projects-cli";
import { createProjectStore, type ProjectStore } from "../src/store";

// Each test gets its own directory, database and project, so no test depends on
// the order of another one.
let dir: string;
let dbPath: string;
let statePath: string;
let store: ProjectStore;
let projectId: string;

function run(argv: string[]) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = runProjectsCommand(argv, {
    cwd: dir,
    stdout: (line) => lines.push(line),
    stderr: (line) => errors.push(line),
  });
  return { code, lines, errors };
}

function saveState(): string {
  const saved = run(["save", projectId, statePath, "--message", "from test", "--db", dbPath]);
  expect(saved.code).toBe(0);
  return saved.lines[0];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "projects-cli-"));
  dbPath = join(dir, "projects.sqlite");
  statePath = join(dir, "state.json");
  writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      nodes: [{ id: "svc-1", kind: "service", name: "CLI Service" }],
    }),
  );
  store = createProjectStore({ path: dbPath });
  projectId = store.createProject("CLI project").id;
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("architect projects", () => {
  it("saves a state file as a revision", () => {
    const revisionId = saveState();
    expect(revisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.listRevisions(projectId)).toHaveLength(1);
  });

  it("lists and shows the saved revisions", () => {
    saveState();

    const list = run(["list", "--db", dbPath]);
    expect(list.code).toBe(0);
    expect(list.lines.join("\n")).toContain("CLI project");
    expect(list.lines.join("\n")).toContain("\t1\t");

    const shown = run(["show", projectId, "--db", dbPath]);
    expect(shown.code).toBe(0);
    const payload = JSON.parse(shown.lines.join("\n"));
    expect(payload.project.id).toBe(projectId);
    expect(payload.revisions[0].message).toBe("from test");
    expect(payload.revisions[0].source).toBe("cli");
    expect(payload.mode).toBe("file");
  });

  it("restores a revision and prints its state", () => {
    const revisionId = saveState();

    const restored = run(["restore", projectId, revisionId, "--db", dbPath]);
    expect(restored.code).toBe(0);
    const payload = JSON.parse(restored.lines.join("\n"));
    expect(payload.restoredFrom).toBe(revisionId);
    expect(payload.state.nodes[0].name).toBe("CLI Service");
    expect(store.listRevisions(projectId)).toHaveLength(2);
  });

  it("accepts --flag=value and rejects a flag without a value", () => {
    expect(run(["list", `--db=${dbPath}`]).code).toBe(0);
    expect(run(["save", projectId, statePath, "--db"]).code).toBe(1);
  });

  it("exits 2 for an unknown project, revision or invalid state", () => {
    const invalid = join(dir, "invalid.json");
    writeFileSync(invalid, JSON.stringify({ nodes: "not-an-array" }));

    expect(run(["show", "missing", "--db", dbPath]).code).toBe(2);
    expect(run(["save", projectId, invalid, "--db", dbPath]).code).toBe(2);
    expect(run(["save", projectId, join(dir, "absent.json"), "--db", dbPath]).code).toBe(2);
    expect(run(["restore", projectId, "missing", "--db", dbPath]).code).toBe(2);
  });

  it("exits 1 for missing arguments and prints help without opening the store", () => {
    expect(run(["save", projectId]).code).toBe(1);
    expect(run([]).code).toBe(1);

    const help = run(["nonsense", "--help"]);
    expect(help.code).toBe(0);
    expect(help.lines.join("\n")).toContain("Usage:");
  });
});
