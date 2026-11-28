import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseState } from "@architect-studio/core";
import { createProjectStore } from "../src/store";

const dir = mkdtempSync(join(tmpdir(), "architect-store-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stateA = parseState({
  version: 1,
  nodes: [{ id: "svc-1", kind: "service", name: "Storefront API" }],
});
const stateB = parseState({
  version: 1,
  nodes: [
    { id: "svc-1", kind: "service", name: "Storefront API" },
    { id: "db-1", kind: "database", name: "Primary DB" },
  ],
});

describe("project store", () => {
  it("stays in memory when no path is given", () => {
    const store = createProjectStore();
    expect(store.mode).toBe("memory");
    expect(store.path).toBeNull();

    const project = store.createProject("Storefront");
    expect(project.revisionCount).toBe(0);
    expect(store.listProjects().map((item) => item.id)).toEqual([project.id]);
    expect(store.getProject(project.id)?.name).toBe("Storefront");

    store.close();
  });

  it("stores revisions and restores an earlier state byte-for-byte", () => {
    const store = createProjectStore();
    const project = store.createProject("Storefront");
    const first = store.addRevision(project.id, { state: stateA, message: "initial" });
    const second = store.addRevision(project.id, { state: stateB, message: "add db" });
    expect(first && second).toBeTruthy();

    const restored = store.restoreRevision(project.id, first!.id);
    expect(restored?.state).toEqual(stateA);
    expect(restored?.source).toBe("restore");
    expect(restored?.message).toContain(first!.id);

    const revisions = store.listRevisions(project.id);
    expect(revisions).toHaveLength(3);
    expect(revisions[0].id).toBe(restored!.id);
    expect(store.getProject(project.id)?.revisionCount).toBe(3);
    expect(store.getRevision(project.id, second!.id)?.state).toEqual(stateB);

    store.close();
  });

  it("keeps only the newest revisions per project", () => {
    const store = createProjectStore({ maxRevisions: 2 });
    const project = store.createProject("Capped");
    const ids = [stateA, stateB, stateA].map(
      (state, index) => store.addRevision(project.id, { state, message: `r${index}` })!.id,
    );

    expect(store.listRevisions(project.id).map((item) => item.id)).toEqual([ids[2], ids[1]]);
    store.close();
  });

  it("reopens a file database with its history intact", () => {
    const path = join(dir, "projects.sqlite");
    const store = createProjectStore({ path });
    expect(store.mode).toBe("file");
    const project = store.createProject("Persisted");
    const revision = store.addRevision(project.id, { state: stateB, message: "saved" });
    store.close();

    const reopened = createProjectStore({ path });
    expect(reopened.getProject(project.id)?.name).toBe("Persisted");
    expect(reopened.getRevision(project.id, revision!.id)?.state).toEqual(stateB);
    reopened.close();
  });

  it("falls back to memory when the path cannot be opened", () => {
    const blocker = join(dir, "not-a-directory");
    writeFileSync(blocker, "x");

    const store = createProjectStore({ path: join(blocker, "projects.sqlite") });
    expect(store.mode).toBe("memory");
    expect(store.createProject("Fallback").name).toBe("Fallback");
    store.close();
  });

  it("serializes writes from separate processes on the same file", async () => {
    const path = join(dir, "shared.sqlite");
    const store = createProjectStore({ path });
    const project = store.createProject("Shared");
    const worker = join(__dirname, "fixtures", "store-worker.ts");
    const tsxCli = join(__dirname, "../../../node_modules/tsx/dist/cli.mjs");

    const runWorker = (tag: string) =>
      new Promise<string>((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [tsxCli, worker, path, project.id, tag, "10"], {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("error", rejectPromise);
        child.on("close", (code) => {
          if (code === 0) resolvePromise(tag);
          else rejectPromise(new Error(`worker ${tag} exited ${String(code)}: ${stderr}`));
        });
      });

    await Promise.all([runWorker("a"), runWorker("b")]);
    expect(store.getProject(project.id)?.revisionCount).toBe(20);
    store.close();
  }, 60_000);

  it("records packages against a known project only", () => {
    const store = createProjectStore();
    const project = store.createProject("Packages");

    expect(store.addPackage({ projectId: "missing", sha256: "a".repeat(64), bytes: 10 })).toBeUndefined();
    const record = store.addPackage({ projectId: project.id, sha256: "b".repeat(64), bytes: 42 });
    expect(record?.bytes).toBe(42);
    expect(store.countPackages(project.id)).toBe(1);

    store.close();
  });
});
