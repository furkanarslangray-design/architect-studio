import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStateReport, type ArchState } from "../../core/src/state";
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

const usageError = 1;
const inputError = 2;

export function defaultDatabasePath(cwd: string = process.cwd()): string {
  return process.env.ARCHITECT_DB ?? join(cwd, ".architect", "architect.db");
}

/** Splits argv into positional words plus `--flag value` / `--flag=value` pairs. */
function parseArgv(argv: string[]): { positional: string[]; flags: Record<string, string> } | string {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const value = equals === -1 ? argv[++index] : arg.slice(equals + 1);
    if (value === undefined) return `--${name} needs a value`;
    flags[name] = value;
  }
  return { positional, flags };
}

export function runProjectsCommand(argv: string[], deps: ProjectsCommandDeps = {}): number {
  const write = deps.stdout ?? ((line: string) => console.log(line));
  const warn = deps.stderr ?? ((line: string) => console.error(line));

  if (argv.includes("--help") || argv.includes("-h")) {
    write(HELP);
    return 0;
  }

  const parsed = parseArgv(argv);
  if (typeof parsed === "string") {
    warn(parsed);
    return usageError;
  }
  const { positional, flags } = parsed;
  const [command, ...args] = positional;
  if (!command) {
    write(HELP);
    return usageError;
  }

  const dbPath = flags.db ? resolve(flags.db) : defaultDatabasePath(deps.cwd);
  const message = flags.message ?? "";

  const loadState = (statePath: string): ArchState => {
    const report = parseStateReport(JSON.parse(readFileSync(resolve(statePath), "utf8")));
    if (!report.success) {
      throw new Error(`Invalid architecture state: ${report.error.issues[0]?.message ?? "schema error"}`);
    }
    for (const warning of report.warnings) warn(`State migration: ${warning}`);
    return report.data;
  };

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
      let state: ArchState;
      try {
        state = loadState(statePath);
      } catch (error) {
        warn(`Could not save ${statePath}: ${error instanceof Error ? error.message : "unknown error"}`);
        return inputError;
      }
      const revision = store.addRevision(projectId, { state, message, source: "cli" });
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
