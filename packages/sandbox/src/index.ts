import { spawn } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

export const SANDBOX_TYPES = [
  "auto",
  "temp-dir",
  "bwrap",
  "podman",
  "docker",
  "firejail",
  "systemd-run",
] as const;

export type SandboxType = (typeof SANDBOX_TYPES)[number];
export type SandboxId = Exclude<SandboxType, "auto">;
export type IsolationLevel = "directory" | "process" | "namespace" | "container";

export interface SandboxAvailability {
  id: SandboxId;
  label: string;
  isolation: IsolationLevel;
  available: boolean;
  binary?: string;
  version?: string;
  reason?: string;
}

export interface SandboxRunSpec {
  command: string;
  args?: string[];
  workspace: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  image?: string;
  network?: boolean;
}

export interface SandboxRunResult {
  driver: SandboxId;
  isolation: IsolationLevel;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  command: string;
}

export interface SandboxRequest {
  sandbox?: SandboxType;
  command?: string;
  args?: string[];
  files?: Record<string, string>;
  env?: Record<string, string>;
  timeoutMs?: number;
  image?: string;
  network?: boolean;
  /** Fall back to the strongest available driver instead of failing. */
  fallback?: boolean;
  keepWorkspace?: boolean;
}

export interface SandboxRun extends SandboxRunResult {
  workspace: string;
  resolved: SandboxId;
  requested: SandboxType;
  fallback: boolean;
  files: number;
}

export class SandboxUnavailableError extends Error {
  readonly details: SandboxAvailability[];

  constructor(requested: SandboxType, details: SandboxAvailability[]) {
    const available = details.filter((item) => item.available).map((item) => item.id);
    super(
      `Sandbox "${requested}" is not available on this system. Available drivers: ${
        available.length > 0 ? available.join(", ") : "none"
      }.`,
    );
    this.name = "SandboxUnavailableError";
    this.details = details;
  }
}

const ENV_ALLOWLIST = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "SYSTEMROOT",
  "PATHEXT",
  "COMSPEC",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
];

/** Only non-secret variables cross the sandbox boundary. */
export function restrictedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CI = "1";
  env.NO_COLOR = "1";
  env.NODE_OPTIONS = "";
  return { ...env, ...extra };
}

export function findBinary(binary: string): string | undefined {
  if (binary.includes(sep) || isAbsolute(binary)) {
    return isExecutable(binary) ? binary : undefined;
  }
  const path = process.env.PATH ?? "";
  for (const entry of path.split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, binary);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

const MAX_OUTPUT_BYTES = 256 * 1024;

function exec(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    onTimeout?: () => void;
    cleanup?: () => Promise<void>;
  } = {},
): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const append = (current: string, chunk: Buffer) => {
      if (current.length >= MAX_OUTPUT_BYTES) return current;
      const next = current + chunk.toString("utf8");
      return next.length > MAX_OUTPUT_BYTES ? next.slice(0, MAX_OUTPUT_BYTES) : next;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        code: null,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    const finish = async (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.cleanup) {
        try {
          await options.cleanup();
        } catch {
          /* best effort */
        }
      }
      resolvePromise({
        code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("close", (code) => {
      void finish(code);
    });

    const timer = setTimeout(
      () => {
        timedOut = true;
        options.onTimeout?.();
        child.kill("SIGKILL");
        setTimeout(() => {
          void finish(null);
        }, 2000).unref?.();
      },
      options.timeoutMs ?? 30_000,
    );
    timer.unref?.();
  });
}

interface DriverContext {
  spec: SandboxRunSpec;
  timeoutMs: number;
}

export interface SandboxDriver {
  readonly id: SandboxId;
  readonly label: string;
  readonly isolation: IsolationLevel;
  detect(): Promise<SandboxAvailability>;
  run(context: DriverContext): Promise<SandboxRunResult>;
}

async function detectBinary(
  id: SandboxId,
  label: string,
  isolation: IsolationLevel,
  binary: string,
  versionArgs: string[] = ["--version"],
): Promise<SandboxAvailability> {
  const path = findBinary(binary);
  if (!path) {
    return { id, label, isolation, available: false, binary, reason: `${binary} is not installed` };
  }
  const probe = await exec(path, versionArgs, { env: restrictedEnv(), timeoutMs: 5000 });
  if (probe.code !== 0) {
    return {
      id,
      label,
      isolation,
      available: false,
      binary: path,
      reason: `${binary} is present but not usable: ${(probe.stderr || probe.stdout).trim().slice(0, 200)}`,
    };
  }
  const version = (probe.stdout || probe.stderr).split("\n")[0]?.trim().slice(0, 120);
  return { id, label, isolation, available: true, binary: path, version };
}

function result(id: SandboxId, isolation: IsolationLevel, spec: SandboxRunSpec, exec: ExecResult): SandboxRunResult {
  return {
    driver: id,
    isolation,
    exitCode: exec.code,
    stdout: exec.stdout,
    stderr: exec.stderr,
    durationMs: exec.durationMs,
    timedOut: exec.timedOut,
    command: [spec.command, ...(spec.args ?? [])].join(" "),
  };
}

const tempDirDriver: SandboxDriver = {
  id: "temp-dir",
  label: "Isolated temporary directory",
  isolation: "directory",
  async detect() {
    return { id: "temp-dir", label: this.label, isolation: this.isolation, available: true, version: process.version };
  },
  async run({ spec, timeoutMs }) {
    const home = join(spec.workspace, ".sandbox-home");
    mkdirSync(home, { recursive: true });
    const env = restrictedEnv({ ...spec.env, HOME: home, TMPDIR: home, TMP: home, TEMP: home });
    const probe = await exec(spec.command, spec.args ?? [], {
      cwd: spec.workspace,
      env,
      timeoutMs: spec.timeoutMs ?? timeoutMs,
    });
    return result(this.id, this.isolation, spec, probe);
  },
};

const bwrapDriver: SandboxDriver = {
  id: "bwrap",
  label: "Bubblewrap namespaces",
  isolation: "namespace",
  async detect() {
    return detectBinary(this.id, this.label, this.isolation, "bwrap");
  },
  async run({ spec, timeoutMs }) {
    const binary = findBinary("bwrap");
    if (!binary) throw new Error("bwrap is not installed");
    const args = [
      "--die-with-parent",
      "--unshare-all",
      "--new-session",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
    ];
    for (const path of ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"]) {
      if (existsSync(path)) args.push("--ro-bind-try", path, path);
    }
    args.push("--bind", spec.workspace, "/workspace", "--chdir", "/workspace");
    if (spec.network) args.push("--share-net");
    args.push("--", spec.command, ...(spec.args ?? []));
    const probe = await exec(binary, args, {
      cwd: spec.workspace,
      env: restrictedEnv({ ...spec.env, HOME: "/workspace/.sandbox-home", TMPDIR: "/tmp" }),
      timeoutMs: spec.timeoutMs ?? timeoutMs,
    });
    return result(this.id, this.isolation, spec, probe);
  },
};

function containerDriver(id: "podman" | "docker", label: string): SandboxDriver {
  return {
    id,
    label,
    isolation: "container",
    async detect() {
      return detectBinary(id, label, "container", id);
    },
    async run({ spec, timeoutMs }) {
      const binary = findBinary(id);
      if (!binary) throw new Error(`${id} is not installed`);
      const name = `architect-sandbox-${process.pid}-${Date.now().toString(36)}`;
      const args = ["run", "--rm", "--name", name];
      if (!spec.network) args.push("--network", "none");
      args.push("--workdir", "/workspace", "--volume", `${spec.workspace}:/workspace:z`);
      for (const [key, value] of Object.entries(spec.env ?? {})) {
        args.push("--env", `${key}=${value}`);
      }
      args.push(spec.image ?? "node:22-alpine", spec.command, ...(spec.args ?? []));
      const probe = await exec(binary, args, {
        cwd: spec.workspace,
        env: restrictedEnv(),
        timeoutMs: spec.timeoutMs ?? timeoutMs,
        onTimeout: () => {
          void exec(binary, ["rm", "-f", name], { env: restrictedEnv(), timeoutMs: 10_000 });
        },
      });
      return result(this.id, this.isolation, spec, probe);
    },
  };
}

const firejailDriver: SandboxDriver = {
  id: "firejail",
  label: "Firejail process jail",
  isolation: "namespace",
  async detect() {
    return detectBinary(this.id, this.label, this.isolation, "firejail");
  },
  async run({ spec, timeoutMs }) {
    const binary = findBinary("firejail");
    if (!binary) throw new Error("firejail is not installed");
    const args = ["--quiet", "--private-tmp", "--private-dev", "--noroot", "--caps.drop=all", "--seccomp"];
    if (!spec.network) args.push("--net=none");
    args.push("--", spec.command, ...(spec.args ?? []));
    const probe = await exec(binary, args, {
      cwd: spec.workspace,
      env: restrictedEnv({ ...spec.env, HOME: spec.workspace }),
      timeoutMs: spec.timeoutMs ?? timeoutMs,
    });
    return result(this.id, this.isolation, spec, probe);
  },
};

const systemdRunDriver: SandboxDriver = {
  id: "systemd-run",
  label: "systemd-run transient scope",
  isolation: "process",
  async detect() {
    return detectBinary(this.id, this.label, this.isolation, "systemd-run", ["--user", "--version"]);
  },
  async run({ spec, timeoutMs }) {
    const binary = findBinary("systemd-run");
    if (!binary) throw new Error("systemd-run is not installed");
    const args = [
      "--user",
      "--scope",
      "--quiet",
      "--property=NoNewPrivileges=yes",
      "--property=PrivateTmp=yes",
      "--property=PrivateDevices=yes",
      `--property=WorkingDirectory=${spec.workspace}`,
      "--",
      spec.command,
      ...(spec.args ?? []),
    ];
    const probe = await exec(binary, args, {
      cwd: spec.workspace,
      env: restrictedEnv(spec.env),
      timeoutMs: spec.timeoutMs ?? timeoutMs,
    });
    return result(this.id, this.isolation, spec, probe);
  },
};

export const SANDBOX_DRIVERS: SandboxDriver[] = [
  bwrapDriver,
  containerDriver("podman", "Rootless Podman container"),
  containerDriver("docker", "Docker container"),
  firejailDriver,
  systemdRunDriver,
  tempDirDriver,
];

/** Strongest isolation first; the always-available temporary directory is last. */
export const AUTO_ORDER: SandboxId[] = ["bwrap", "podman", "docker", "firejail", "systemd-run", "temp-dir"];

let detectionCache: Promise<SandboxAvailability[]> | undefined;

export function detectSandboxes(force = false): Promise<SandboxAvailability[]> {
  if (!detectionCache || force) {
    detectionCache = Promise.all(SANDBOX_DRIVERS.map((driver) => driver.detect())).then((items) =>
      [...items].sort((a, b) => AUTO_ORDER.indexOf(a.id) - AUTO_ORDER.indexOf(b.id)),
    );
  }
  return detectionCache;
}

export async function resolveSandbox(
  requested: SandboxType = "auto",
  options: { fallback?: boolean; force?: boolean } = {},
): Promise<{ id: SandboxId; driver: SandboxDriver; fallback: boolean; details: SandboxAvailability[] }> {
  const details = await detectSandboxes(options.force);
  if (requested === "auto") {
    const found = AUTO_ORDER.map((id) => details.find((item) => item.id === id && item.available)).find(Boolean);
    const driver = SANDBOX_DRIVERS.find((item) => item.id === found?.id) ?? tempDirDriver;
    return { id: driver.id, driver, fallback: false, details };
  }

  const match = details.find((item) => item.id === requested);
  if (match?.available) {
    const driver = SANDBOX_DRIVERS.find((item) => item.id === requested);
    if (driver) return { id: driver.id, driver, fallback: false, details };
  }
  if (options.fallback) {
    return { id: tempDirDriver.id, driver: tempDirDriver, fallback: true, details };
  }
  throw new SandboxUnavailableError(requested, details);
}

function writeWorkspace(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Refusing to write outside the sandbox workspace: ${path}`);
    }
    if (target === root) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

/**
 * Materialises package files into a throwaway directory and runs a command with
 * a restricted environment inside the selected isolation driver.
 */
export async function runInSandbox(request: SandboxRequest): Promise<SandboxRun> {
  const timeoutMs = request.timeoutMs ?? 30_000;
  const workspace = mkdtempSync(join(tmpdir(), "architect-sandbox-"));
  try {
    writeWorkspace(workspace, request.files ?? {});
    const resolved = await resolveSandbox(request.sandbox ?? "auto", { fallback: request.fallback });
    const command = request.command ?? process.execPath;
    const args =
      request.args ??
      (request.command
        ? []
        : ["-e", "const fs=require('fs');process.stdout.write(`sandbox ok: ${fs.readdirSync('.').join(',')}`)"]);
    const executed = await resolved.driver.run({
      spec: {
        command,
        args,
        workspace,
        env: request.env,
        timeoutMs,
        image: request.image,
        network: request.network,
      },
      timeoutMs,
    });
    return {
      ...executed,
      workspace: request.keepWorkspace ? workspace : "",
      resolved: resolved.id,
      requested: request.sandbox ?? "auto",
      fallback: resolved.fallback,
      files: Object.keys(request.files ?? {}).length,
    };
  } finally {
    if (!request.keepWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

const PACKAGE_CHECK = [
  "const fs=require('fs');",
  "const fail=(m)=>{console.error(m);process.exit(1)};",
  "if(!fs.existsSync('MANIFEST.md'))fail('MANIFEST.md missing');",
  "if(!fs.existsSync('ARCHITECTURE.md'))fail('ARCHITECTURE.md missing');",
  "if(!fs.existsSync('openapi.yaml'))fail('openapi.yaml missing');",
  "const tasks=fs.readdirSync('tasks').filter((f)=>f.endsWith('.md'));",
  "if(tasks.length===0)fail('no task packets');",
  "console.log(`package ok: ${tasks.length} task packets`);",
].join("");

/** Verifies that a generated package can be materialised and inspected in isolation. */
export async function verifyPackage(
  files: Record<string, string>,
  options: Omit<SandboxRequest, "files"> = {},
): Promise<SandboxRun> {
  return runInSandbox({
    ...options,
    files,
    command: options.command ?? process.execPath,
    args: options.args ?? (options.command ? [] : ["-e", PACKAGE_CHECK]),
  });
}

export function isSandboxType(value: unknown): value is SandboxType {
  return typeof value === "string" && (SANDBOX_TYPES as readonly string[]).includes(value);
}

export function normalizeSandboxType(value: unknown): SandboxType {
  if (isSandboxType(value)) return value;
  if (value === undefined || value === null) return "auto";
  if (typeof value === "string" && value.trim() === "") return "auto";
  throw new Error(`Unsupported sandbox: ${String(value)}. Use one of ${SANDBOX_TYPES.join(", ")}.`);
}

/** Normalises a path for diagnostics without following it. */
export function describePath(path: string): string {
  return normalize(path);
}
