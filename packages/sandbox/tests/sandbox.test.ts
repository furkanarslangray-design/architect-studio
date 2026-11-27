import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  AUTO_ORDER,
  detectSandboxes,
  isSandboxType,
  normalizeSandboxType,
  resolveSandbox,
  restrictedEnv,
  runInSandbox,
  SANDBOX_TYPES,
  SandboxUnavailableError,
  verifyPackage,
} from "../src";

const scratch = mkdtempSync(join(tmpdir(), "sandbox-test-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("sandbox drivers", () => {
  it("exposes every requested driver and detects the local system", async () => {
    expect([...SANDBOX_TYPES]).toEqual([
      "auto",
      "temp-dir",
      "bwrap",
      "podman",
      "docker",
      "firejail",
      "systemd-run",
    ]);
    const reported = await detectSandboxes(true);
    expect(reported.map((item) => item.id)).toEqual(AUTO_ORDER);
    expect(reported.find((item) => item.id === "temp-dir")?.available).toBe(true);
    // Detection probes every installed binary on the host, so the CI runner's
    // Docker/systemd probes need more than the default 5 s.
  }, 20_000);

  it("runs a command in an isolated temporary directory with a restricted environment", async () => {
    process.env.ARCHITECT_SANDBOX_SECRET = "must-not-leak";
    const run = await runInSandbox({
      sandbox: "temp-dir",
      files: { "input.txt": "hello sandbox" },
      command: process.execPath,
      args: [
        "-e",
        "const fs=require('fs');console.log(fs.readFileSync('input.txt','utf8'));console.log(String(process.env.ARCHITECT_SANDBOX_SECRET));console.log(String(process.env.HOME));",
      ],
    });
    expect(run.driver).toBe("temp-dir");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("hello sandbox");
    expect(run.stdout).toContain("undefined");
    expect(run.stdout).not.toContain("must-not-leak");
    expect(run.workspace).toBe("");
    delete process.env.ARCHITECT_SANDBOX_SECRET;
  });

  it("never forwards unrelated secrets through the allowlist", () => {
    process.env.TAVILY_API_KEY = "tvly-secret";
    const env = restrictedEnv({ CUSTOM: "1" });
    expect(env.TAVILY_API_KEY).toBeUndefined();
    expect(env.CUSTOM).toBe("1");
    expect(env.CI).toBe("1");
    delete process.env.TAVILY_API_KEY;
  });

  it("resolves auto to an available driver and falls back safely", async () => {
    const auto = await resolveSandbox("auto");
    expect(auto.id).toBeTruthy();
    expect(auto.fallback).toBe(false);

    const details = await detectSandboxes();
    const missing = details.find((item) => !item.available && item.id !== "temp-dir");
    if (missing) {
      await expect(resolveSandbox(missing.id)).rejects.toBeInstanceOf(SandboxUnavailableError);
      const fallback = await resolveSandbox(missing.id, { fallback: true });
      expect(fallback.id).toBe("temp-dir");
      expect(fallback.fallback).toBe(true);
    }
  });

  it("refuses to write outside the sandbox workspace", async () => {
    await expect(
      runInSandbox({ sandbox: "temp-dir", files: { "../escape.txt": "nope" }, command: process.execPath, args: ["-e", ""] }),
    ).rejects.toThrow(/outside the sandbox workspace/);
  });

  it("verifies a generated package inside the selected sandbox", async () => {
    const files = {
      "MANIFEST.md": "# Manifest",
      "ARCHITECTURE.md": "# Architecture",
      "openapi.yaml": "openapi: 3.1.0",
      "tasks/T-001.md": "# Task",
    };
    const run = await verifyPackage(files, { sandbox: "temp-dir" });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("package ok: 1 task packets");
    expect(run.files).toBe(4);
  });

  it("reports a failed package check with its exit code", async () => {
    const run = await verifyPackage({ "MANIFEST.md": "# Manifest" }, { sandbox: "temp-dir" });
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("ARCHITECTURE.md missing");
  });

  it("keeps the workspace when explicitly requested", async () => {
    const run = await runInSandbox({
      sandbox: "temp-dir",
      files: { "keep.txt": "kept" },
      keepWorkspace: true,
      command: process.execPath,
      args: ["-e", ""],
    });
    expect(readFileSync(join(run.workspace, "keep.txt"), "utf8")).toBe("kept");
    rmSync(run.workspace, { recursive: true, force: true });
  });

  it("never interprets the command through a shell", async () => {
    const run = await runInSandbox({
      sandbox: "temp-dir",
      keepWorkspace: true,
      command: "echo pwned; touch shell-ran.txt",
      args: [],
      timeoutMs: 5000,
    });
    // The whole string is a (missing) binary name, not a shell pipeline.
    expect(run.exitCode).toBeNull();
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/ENOENT|not found/i);
    expect(existsSync(join(run.workspace, "shell-ran.txt"))).toBe(false);
    rmSync(run.workspace, { recursive: true, force: true });
  });

  it("validates sandbox names", () => {
    expect(isSandboxType("bwrap")).toBe(true);
    expect(isSandboxType("qemu")).toBe(false);
    expect(normalizeSandboxType(undefined)).toBe("auto");
    expect(() => normalizeSandboxType("qemu")).toThrow(/Unsupported sandbox/);
  });

  it("times out a hanging command", async () => {
    const run = await runInSandbox({
      sandbox: "temp-dir",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      timeoutMs: 1500,
    });
    expect(run.timedOut).toBe(true);
    expect(run.exitCode).toBeNull();
  });

  it("writes nested files for the package check", async () => {
    mkdirSync(join(scratch, "nested"), { recursive: true });
    writeFileSync(join(scratch, "nested", "file.txt"), "ok");
    expect(readFileSync(join(scratch, "nested", "file.txt"), "utf8")).toBe("ok");
  });
});
