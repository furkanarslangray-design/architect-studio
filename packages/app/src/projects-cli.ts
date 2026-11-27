import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStateReport } from "../../core/src/state";
import { createProjectStore } from "./store";

/**
 * `architect projects` — the CLI half of Plan §9.
 *
 * Commands are deliberately small and JSON-friendly so a human can inspect the
 * store and a script can save/restore revisions. Errors go to stderr; exit code
 * 2 matches `doctor` for missing/invalid input.
 */

export interface ProjectsCommandDeps {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

const HELP = `AI Principal Architect — projects

Usage:
  pnpm architect projects list [--db <path>]
  pnpm architect projects show <projectId> [--db <path>]
  pnpm architect projects save <projectId> <state.json> [--message <text>] [--db <path>]
  pnpm architect projects restore <projectId> <revisionId> [--db <path>]

The store is a SQLite file; --db overrides ARCHITECT_DB (default .architect/architect.db).`;

export function defaultDatabasePath(cwd: string = process.cwd()): string {
  return process.env.ARCHITECT_DB ?? join(cwd, ".architect", "architect.db");
}

const usageError = 1;
const inputError = 2;

export function runProjectsCommand(argv: string[], deps: ProjectsCommandDeps = {}): number {
  const write = deps.stdout ?? ((line: string) => console.log(line));
  const warn = deps.stderr ?? ((line: string) => console.error(line));

  let dbPath = defaultDatabasePath(deps.cwd);
  let message = "";
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      const value = argv[++index];
      if (!value) {
        warn("--db needs a path");
        return usageError;
      }
      dbPath = resolve(value);
      continue;
    }
    if (arg.startsWith("--db=")) {
      dbPath = resolve(arg.slice("--db=".length));
      continue;
    }
    if (arg === "--message") {
      const value = argv[++index];
      if (value === undefined) {
        warn("--message needs a value");
        return usageError;
      }
      message = value;
      continue;
    }
    if (arg.startsWith("--message=")) {
      message = arg.slice("--message=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      write(HELP);
      return 0;
    }
    positional.push(arg);
  }

  const [command, ...args] = positional;
  if (!command) {
    write(HELP);
    return usageError;
  }

  const store = createProjectStore({ path: dbPath });
  try {
    if (command === "list") {
      const projects = store.listProjects();
      if (projects.length === 0) {
        write("No projects yet. Create one with POST /api/projects or the Studio UI.");
        return 0;
      }
      for (const project of projects) {
        write(`${project.id}\t${project.revisionCount}\t${project.name}`);
      }
      return 0;
    }

    if (command === "show") {
      const [projectId] = args;
      if (!projectId) {
        warn("projects show needs a project id");
        return usageError;
      }
      const project = store.getProject(projectId);
      if (!project) {
        warn(`Project not found: ${projectId}`);
        return inputError;
      }
      write(
        JSON.stringify(
          {
            project,
            revisions: store.listRevisions(projectId),
            packages: store.countPackages(projectId),
            mode: store.mode,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    if (command === "save") {
      const [projectId, statePath] = args;
      if (!projectId || !statePath) {
        warn("projects save needs a project id and a state JSON path");
        return usageError;
      }
      if (!store.getProject(projectId)) {
        warn(`Project not found: ${projectId}`);
        return inputError;
      }
      let parsed: ReturnType<typeof parseStateReport>;
      try {
        parsed = parseStateReport(JSON.parse(readFileSync(resolve(statePath), "utf8")));
      } catch (error) {
        warn(`Could not read ${statePath}: ${error instanceof Error ? error.message : "unknown error"}`);
        return inputError;
      }
      if (!parsed.success) {
        warn(`Invalid architecture state: ${parsed.error.issues[0]?.message ?? "schema error"}`);
        return inputError;
      }
      for (const warning of parsed.warnings) warn(`State migration: ${warning}`);
      const revision = store.addRevision(projectId, { state: parsed.data, message, source: "cli" });
      if (!revision) {
        warn(`Project not found: ${projectId}`);
        return inputError;
      }
      write(revision.id);
      return 0;
    }

    if (command === "restore") {
      const [projectId, revisionId] = args;
      if (!projectId || !revisionId) {
        warn("projects restore needs a project id and a revision id");
        return usageError;
      }
      const revision = store.restoreRevision(projectId, revisionId);
      if (!revision) {
        warn(`Revision not found: ${revisionId} in project ${projectId}`);
        return inputError;
      }
      write(JSON.stringify({ revision: revision.id, restoredFrom: revisionId, state: revision.state }, null, 2));
      return 0;
    }

    warn(`Unknown projects command: ${command}`);
    write(HELP);
    return usageError;
  } finally {
    store.close();
  }
}
