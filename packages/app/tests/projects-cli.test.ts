import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runProjectsCommand } from "../src/projects-cli";
import { createProjectStore, type ProjectStore } from "../src/store";

const dir = mkdtempSync(join(tmpdir(), "projects-cli-"));
const dbPath = join(dir, "projects.sqlite");
const statePath = join(dir, "state.json");
let store: ProjectStore;
let projectId: string;
let revisionId: string;

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

beforeAll(() => {
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

afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("architect projects", () => {
  it("saves a state file as a revision and lists it", () => {
    const saved = run(["save", projectId, statePath, "--message", "from test", "--db", dbPath]);
    expect(saved.code).toBe(0);
    revisionId = saved.lines[0];
    expect(revisionId).toMatch(/^[0-9a-f-]{36}$/);

    const list = run(["list", "--db", dbPath]);
    expect(list.code).toBe(0);
    expect(list.lines.join("\n")).toContain("CLI project");
    expect(list.lines.join("\n")).toContain(`\t1\t`);

    const shown = run(["show", projectId, "--db", dbPath]);
    expect(shown.code).toBe(0);
    const payload = JSON.parse(shown.lines.join("\n"));
    expect(payload.project.id).toBe(projectId);
    expect(payload.revisions[0].message).toBe("from test");
    expect(payload.revisions[0].source).toBe("cli");
    expect(payload.mode).toBe("file");
  });

  it("restores a revision and prints its state", () => {
    const restored = run(["restore", projectId, revisionId, "--db", dbPath]);
    expect(restored.code).toBe(0);
    const payload = JSON.parse(restored.lines.join("\n"));
    expect(payload.restoredFrom).toBe(revisionId);
    expect(payload.state.nodes[0].name).toBe("CLI Service");
    expect(store.listRevisions(projectId)).toHaveLength(2);
  });

  it("exits 2 for an unknown project and 1 for missing arguments", () => {
    expect(run(["show", "missing", "--db", dbPath]).code).toBe(2);
    expect(run(["save", projectId]).code).toBe(1);
    expect(run(["restore", projectId, "missing", "--db", dbPath]).code).toBe(2);
  });
});
