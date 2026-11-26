import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatInitResult,
  initProject,
  isInitClient,
  MARKER_END,
  MARKER_START,
  parseInitArgs,
} from "../src/init";

let root: string;
let installDir: string;

const read = (path: string) => readFileSync(join(root, path), "utf8");
const json = (path: string) => JSON.parse(read(path));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "architect-init-"));
  installDir = join(tmpdir(), "architect-checkout");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("initProject", () => {
  it("writes config, client files and the AGENTS.md block", () => {
    const result = initProject({ root, installDir });

    expect(result.client).toBe("all");
    expect(result.written.sort()).toEqual([
      ".architect/config.json",
      ".cursor/mcp.json",
      ".mcp.json",
      "AGENTS.md",
      "opencode.json",
    ]);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);

    const config = json(".architect/config.json");
    expect(config).toMatchObject({
      version: 1,
      client: "all",
      reverseRoots: [root],
      packageManager: "pnpm",
      testRunner: "vitest",
    });
    expect(config.mcp.command).toBe("node");
    expect(config.mcp.args).toEqual(["node", "--import", "tsx", join(installDir, "packages", "mcp", "src", "index.ts")].slice(1));
    expect(config.mcp.cwd).toBe(installDir);
  });

  it("emits a valid MCP document per client", () => {
    initProject({ root, installDir });

    const cursor = json(".cursor/mcp.json");
    expect(cursor.mcpServers["architect-studio"]).toMatchObject({
      command: "node",
      args: ["--import", "tsx", join(installDir, "packages/mcp/src/index.ts")],
      cwd: installDir,
    });
    expect(json(".mcp.json")).toEqual(cursor);
    expect(json("opencode.json").mcp["architect-studio"]).toMatchObject({
      type: "local",
      command: ["node", "--import", "tsx", join(installDir, "packages/mcp/src/index.ts")],
      enabled: true,
    });
    // Every JSON file ends with a newline so diffs stay stable.
    expect(read(".mcp.json").endsWith("\n")).toBe(true);
  });

  it("is idempotent: a second run rewrites nothing", () => {
    initProject({ root, installDir });
    const snapshot = [".architect/config.json", ".mcp.json", ".cursor/mcp.json", "opencode.json", "AGENTS.md"].map(read);

    const second = initProject({ root, installDir });
    expect(second.written).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.skipped).toEqual([]);
    expect(second.unchanged.sort()).toEqual([
      ".architect/config.json",
      ".cursor/mcp.json",
      ".mcp.json",
      "AGENTS.md",
      "opencode.json",
    ]);
    expect([".architect/config.json", ".mcp.json", ".cursor/mcp.json", "opencode.json", "AGENTS.md"].map(read)).toEqual(
      snapshot,
    );
  });

  it("creates a missing target directory", () => {
    const nested = join(root, "nested", "project");
    const result = initProject({ root: nested, installDir });
    expect(result.root).toBe(nested);
    expect(existsSync(join(nested, ".architect", "config.json"))).toBe(true);
  });

  it("writes only the requested client", () => {
    initProject({ root, installDir, client: "opencode" });
    expect(existsSync(join(root, "opencode.json"))).toBe(true);
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, ".cursor"))).toBe(false);
    expect(json(".architect/config.json").client).toBe("opencode");
  });

  it("leaves user files alone and reports them as skipped", () => {
    const userFile = JSON.stringify({ mcpServers: { other: { command: "node" } } }, null, 2);
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(join(root, ".cursor", "mcp.json"), userFile);

    const result = initProject({ root, installDir, client: "cursor" });
    expect(result.skipped).toContain(".cursor/mcp.json");
    expect(read(".cursor/mcp.json")).toBe(userFile);

    const forced = initProject({ root, installDir, client: "cursor", force: true });
    expect(forced.updated).toContain(".cursor/mcp.json");
    expect(json(".cursor/mcp.json").mcpServers["architect-studio"]).toBeTruthy();
  });

  it("updates only the marked block in an existing AGENTS.md", () => {
    const userText = "# Team notes\n\nKeep this paragraph.\n";
    writeFileSync(join(root, "AGENTS.md"), `${userText}\n${MARKER_START}\nstale config\n${MARKER_END}\n\ntrailing text\n`);

    const result = initProject({ root, installDir, client: "claude" });
    expect(result.updated).toContain("AGENTS.md");

    const content = read("AGENTS.md");
    expect(content).toContain("Keep this paragraph.");
    expect(content).toContain("trailing text");
    expect(content).not.toContain("stale config");
    expect(content.split(MARKER_START)).toHaveLength(2);
    expect(content.split(MARKER_END)).toHaveLength(2);
    expect(content).toContain(`Reverse engineering is limited to \`${root}\``);
  });

  it("appends the block to an existing AGENTS.md without a marker", () => {
    writeFileSync(join(root, "AGENTS.md"), "# Existing\n");
    initProject({ root, installDir, client: "claude" });
    const content = read("AGENTS.md");
    expect(content.startsWith("# Existing")).toBe(true);
    expect(content).toContain(MARKER_START);
    expect(content.trimEnd().endsWith(MARKER_END)).toBe(true);
  });

  it("explains the manual step for Freebuff instead of writing an unknown file", () => {
    const result = initProject({ root, installDir, client: "freebuff" });
    expect(result.notes.join(" ")).toContain("Freebuff");
    expect(existsSync(join(root, "opencode.json"))).toBe(false);
    expect(existsSync(join(root, ".architect", "config.json"))).toBe(true);
  });

  it("rejects unknown clients and non-directory targets", () => {
    expect(() => initProject({ root, installDir, client: "vim" as any })).toThrow(/Unsupported client/);
    const file = join(root, "file.txt");
    writeFileSync(file, "x");
    expect(() => initProject({ root: file, installDir })).toThrow(/not a directory/);
  });
});

describe("init CLI arguments", () => {
  it("parses the target, client and --force", () => {
    expect(parseInitArgs(["packages/api", "--client", "claude", "--force"])).toEqual({
      root: "packages/api",
      client: "claude",
      force: true,
    });
    expect(parseInitArgs(["--client=opencode"])).toEqual({ root: undefined, client: "opencode", force: false });
    expect(parseInitArgs([])).toEqual({ root: undefined, client: undefined, force: false });
  });

  it("rejects unknown clients and options", () => {
    expect(() => parseInitArgs(["--client", "vim"])).toThrow(/Unsupported client/);
    expect(() => parseInitArgs(["--unknown"])).toThrow(/Unknown option/);
    expect(() => parseInitArgs([".", "."])).toThrow(/Unexpected argument/);
    expect(isInitClient("all")).toBe(true);
    expect(isInitClient("vim")).toBe(false);
  });

  it("formats a readable summary", () => {
    const result = initProject({ root, installDir, client: "claude" });
    const summary = formatInitResult(result);
    expect(summary).toContain("architect init →");
    expect(summary).toContain("+ .architect/config.json");
    expect(formatInitResult({ ...result, written: [], updated: [] })).toContain("Nothing to do");
  });
});
