import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ArchState } from "../../core/src/state";

/**
 * Project and revision history for "reopen where you left off".
 *
 * `node:sqlite` is used instead of `better-sqlite3` so the store adds no
 * dependency and no native build: the runtime is already pinned to a Node
 * version that ships it. `ARCHITECT_DB` selects the file; without one (the
 * default for `createServer()` and the tests) everything stays in memory, so
 * today's behavior is unchanged. An unopenable path also falls back to memory
 * instead of failing every request.
 */

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  revisionCount: number;
}

export interface RevisionSummary {
  id: string;
  projectId: string;
  message: string;
  source: string;
  createdAt: string;
}

export interface Revision extends RevisionSummary {
  state: ArchState;
}

export interface ProjectPackage {
  id: string;
  projectId: string;
  revisionId: string | null;
  sha256: string;
  bytes: number;
  createdAt: string;
}

export interface ProjectStoreOptions {
  /** SQLite file path; omitted or `":memory:"` keeps everything in memory. */
  path?: string;
  /** Newest revisions kept per project (default 50). */
  maxRevisions?: number;
  now?: () => Date;
}

export interface ProjectStore {
  readonly mode: "file" | "memory";
  readonly path: string | null;
  readonly maxRevisions: number;
  createProject(name: string): Project;
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  listRevisions(projectId: string): RevisionSummary[];
  getRevision(projectId: string, revisionId: string): Revision | undefined;
  addRevision(
    projectId: string,
    input: { state: ArchState; message?: string; source?: string },
  ): Revision | undefined;
  restoreRevision(projectId: string, revisionId: string): Revision | undefined;
  addPackage(input: {
    projectId: string;
    revisionId?: string;
    sha256: string;
    bytes: number;
  }): ProjectPackage | undefined;
  countPackages(projectId: string): number;
  close(): void;
}

type Row = Record<string, unknown>;
type Statement = {
  all: (...params: unknown[]) => Row[];
  get: (...params: unknown[]) => Row | undefined;
  run: (...params: unknown[]) => unknown;
};
type Database = {
  exec: (sql: string) => void;
  prepare: (sql: string) => Statement;
  close: () => void;
};

const DEFAULT_MAX_REVISIONS = 50;

function openDatabase(path: string | undefined): {
  db: Database;
  mode: ProjectStore["mode"];
  path: string | null;
} {
  if (!path || path === ":memory:" || path === "memory") {
    return { db: new DatabaseSync(":memory:") as unknown as Database, mode: "memory", path: null };
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    return { db: new DatabaseSync(path) as unknown as Database, mode: "file", path };
  } catch {
    return { db: new DatabaseSync(":memory:") as unknown as Database, mode: "memory", path: null };
  }
}

function projectFrom(row: Row): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    revisionCount: Number(row.revision_count ?? 0),
  };
}

function revisionSummaryFrom(row: Row): RevisionSummary {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    message: String(row.message),
    source: String(row.source),
    createdAt: String(row.created_at),
  };
}

export function createProjectStore(options: ProjectStoreOptions = {}): ProjectStore {
  const { db, mode, path } = openDatabase(options.path);
  const maxRevisions = Math.max(1, options.maxRevisions ?? DEFAULT_MAX_REVISIONS);
  const now = options.now ?? (() => new Date());

  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      state_json TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS revisions_by_project ON revisions(project_id, created_at);
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      revision_id TEXT,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const projectRow = (id: string): Row | undefined =>
    db
      .prepare(
        `SELECT p.id, p.name, p.created_at,
                (SELECT COUNT(*) FROM revisions r WHERE r.project_id = p.id) AS revision_count
           FROM projects p WHERE p.id = ?`,
      )
      .get(id);

  const prune = (projectId: string) => {
    db.prepare(
      `DELETE FROM revisions WHERE project_id = ? AND id NOT IN (
         SELECT id FROM revisions WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
       )`,
    ).run(projectId, projectId, maxRevisions);
  };

  const store: ProjectStore = {
    mode,
    path,
    maxRevisions,

    createProject(name) {
      const project: Project = {
        id: randomUUID(),
        name,
        createdAt: now().toISOString(),
        revisionCount: 0,
      };
      db.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)").run(
        project.id,
        project.name,
        project.createdAt,
      );
      return project;
    },

    listProjects() {
      return db
        .prepare(
          `SELECT p.id, p.name, p.created_at,
                  (SELECT COUNT(*) FROM revisions r WHERE r.project_id = p.id) AS revision_count
             FROM projects p ORDER BY p.created_at DESC, p.rowid DESC`,
        )
        .all()
        .map(projectFrom);
    },

    getProject(id) {
      const row = projectRow(id);
      return row ? projectFrom(row) : undefined;
    },

    listRevisions(projectId) {
      return db
        .prepare(
          `SELECT id, project_id, message, source, created_at FROM revisions
            WHERE project_id = ? ORDER BY created_at DESC, rowid DESC`,
        )
        .all(projectId)
        .map(revisionSummaryFrom);
    },

    getRevision(projectId, revisionId) {
      const row = db
        .prepare("SELECT * FROM revisions WHERE project_id = ? AND id = ?")
        .get(projectId, revisionId);
      if (!row) return undefined;
      return { ...revisionSummaryFrom(row), state: JSON.parse(String(row.state_json)) as ArchState };
    },

    addRevision(projectId, input) {
      if (!projectRow(projectId)) return undefined;
      const revision: Revision = {
        id: randomUUID(),
        projectId,
        message: input.message ?? "",
        source: input.source ?? "manual",
        createdAt: now().toISOString(),
        state: input.state,
      };
      db.prepare(
        "INSERT INTO revisions (id, project_id, state_json, message, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        revision.id,
        revision.projectId,
        JSON.stringify(revision.state),
        revision.message,
        revision.source,
        revision.createdAt,
      );
      prune(projectId);
      return revision;
    },

    restoreRevision(projectId, revisionId) {
      const revision = store.getRevision(projectId, revisionId);
      if (!revision) return undefined;
      return store.addRevision(projectId, {
        state: revision.state,
        message: `Restored ${revisionId}`,
        source: "restore",
      });
    },

    addPackage(input) {
      if (!projectRow(input.projectId)) return undefined;
      const record: ProjectPackage = {
        id: randomUUID(),
        projectId: input.projectId,
        revisionId: input.revisionId ?? null,
        sha256: input.sha256,
        bytes: input.bytes,
        createdAt: now().toISOString(),
      };
      db.prepare(
        "INSERT INTO packages (id, project_id, revision_id, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(record.id, record.projectId, record.revisionId, record.sha256, record.bytes, record.createdAt);
      return record;
    },

    countPackages(projectId) {
      const row = db.prepare("SELECT COUNT(*) AS total FROM packages WHERE project_id = ?").get(projectId);
      return Number(row?.total ?? 0);
    },

    close() {
      try {
        db.close();
      } catch {
        // Closing twice (or after a failed open) is harmless for callers.
      }
    },
  };

  return store;
}
