import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateState } from "../../core/src/diff";
import { buildPackage } from "../../packager/src";
import { repoToState, summarizeReverse } from "../src";

const scratch = mkdtempSync(join(tmpdir(), "reverse-test-"));

function write(root: string, path: string, content: string) {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("reverse engineering", () => {
  it("derives a valid architecture from package.json, Prisma, Compose and ADRs", async () => {
    const root = join(scratch, "shop");
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "shop",
        dependencies: {
          next: "^15.0.0",
          react: "^19.0.0",
          express: "^4.19.0",
          "@prisma/client": "^5.0.0",
          ioredis: "^5.0.0",
          stripe: "^16.0.0",
        },
      }),
    );
    write(
      root,
      "prisma/schema.prisma",
      `datasource db {\n  provider = "postgresql"\n}\n\nmodel User {\n  id String @id @default(uuid())\n  email String @unique\n  name String\n  createdAt DateTime\n}\n\nmodel Order {\n  id String @id\n  total Decimal\n  user User @relation(fields: [userId], references: [id])\n  userId String\n}\n`,
    );
    write(
      root,
      "docker-compose.yml",
      `services:\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n`,
    );
    write(root, "docs/adr/0001-use-postgres.md", "# Use PostgreSQL\n\nRelational orders need transactions.\n");
    write(root, "src/app/page.tsx", "export default function Page() { return null; }\n");
    write(root, "node_modules/ignored/index.js", "should not be scanned");
    write(root, ".git/config", "should not be scanned");

    const result = repoToState(root);
    const kinds = result.state.nodes.map((node) => node.kind);
    expect(kinds).toContain("ui");
    expect(kinds).toContain("service");
    expect(kinds).toContain("database");
    expect(kinds).toContain("queue");
    expect(kinds).toContain("external");
    expect(result.state.entities.map((entity) => entity.name)).toEqual(["User", "Order"]);
    expect(result.state.entities[1].relations[0].target).toBe(result.state.entities[0].id);
    expect(result.state.decisions.some((decision) => decision.title === "Use PostgreSQL")).toBe(true);
    expect(validateState(result.state)).toEqual([]);
    expect(result.scannedFiles).toBeGreaterThan(3);
    expect(summarizeReverse(result)).toContain("files scanned");
    expect(JSON.stringify(result.findings)).not.toContain("node_modules");

    const built = await buildPackage(result.state);
    expect(built.validation.ok).toBe(true);
    expect(built.files["ARCHITECTURE.md"]).toContain("Order");
  });

  it("falls back to a single service node for an empty directory", () => {
    const root = join(scratch, "empty");
    mkdirSync(root, { recursive: true });
    const result = repoToState(root);
    expect(result.state.nodes).toHaveLength(1);
    expect(result.state.nodes[0].kind).toBe("service");
    expect(validateState(result.state)).toEqual([]);
  });

  it("rejects a missing path with a clear message", () => {
    expect(() => repoToState(join(scratch, "does-not-exist"))).toThrow(/does not exist or is not a directory/);
  });

  it("scans workspace packages as separate services", () => {
    const root = join(scratch, "mono");
    write(root, "package.json", JSON.stringify({ name: "mono", workspaces: ["packages/*"] }));
    write(root, "packages/api/package.json", JSON.stringify({ name: "api", dependencies: { fastify: "^5.0.0" } }));
    write(root, "packages/web/package.json", JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }));
    const result = repoToState(root);
    expect(result.state.nodes.some((node) => node.name === "api")).toBe(true);
    expect(result.state.nodes.some((node) => node.kind === "ui")).toBe(true);
    expect(validateState(result.state)).toEqual([]);
  });

  it("respects file limits and ignores oversized files", () => {
    const root = join(scratch, "limits");
    mkdirSync(root, { recursive: true });
    for (let index = 0; index < 20; index += 1) {
      write(root, `src/file-${index}.ts`, "export {};\n");
    }
    const result = repoToState(root, { maxFiles: 5 });
    expect(result.scannedFiles).toBeLessThanOrEqual(5);
  });
});
