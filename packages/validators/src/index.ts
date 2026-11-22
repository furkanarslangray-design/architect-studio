import YAML from "yaml";

export interface ValidationIssue {
  file: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  passRate: number;
  unresolvedRefs: number;
  deterministicCoverage: number;
  checksRun: number;
  artifactsValidated: string[];
}

export interface ValidateOptions {
  /** When true, every task id listed in TASKS.md must have a matching tasks/<id>.md file. */
  requireTaskFiles?: boolean;
}

const PRISMA_PROVIDERS = new Set(["postgresql", "mysql", "sqlite", "sqlserver", "mongodb", "cockroachdb"]);
const AGENT_ROLES = ["implementer", "validator", "reviewer"] as const;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const VALID_SCHEMA_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

export function validateArtifacts(files: Record<string, string>, options: ValidateOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  let checksRun = 0;
  let failedChecks = 0;
  let unresolvedRefs = 0;

  const check = (file: string, fn: () => void) => {
    checksRun += 1;
    try {
      fn();
    } catch (error) {
      failedChecks += 1;
      issues.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  };

  check("openapi.yaml", () => {
    const doc = parseYaml(files["openapi.yaml"], "openapi.yaml") as any;
    if (!String(doc.openapi ?? "").startsWith("3.1")) throw new Error("openapi must be 3.1.x");
    if (!doc.info || typeof doc.info !== "object") throw new Error("missing info object");
    if (!doc.info.title) throw new Error("info.title is required");
    if (!doc.info.version) throw new Error("info.version is required");
    if (!doc.paths || typeof doc.paths !== "object" || Object.keys(doc.paths).length === 0) {
      throw new Error("missing or empty paths object");
    }

    const operationIds = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths as Record<string, any>)) {
      if (!path.startsWith("/")) throw new Error(`path must start with /: ${path}`);
      for (const method of HTTP_METHODS) {
        const operation = item?.[method];
        if (!operation) continue;
        if (typeof operation.operationId !== "string" || operation.operationId.length === 0) {
          throw new Error(`${method.toUpperCase()} ${path} is missing operationId`);
        }
        if (operationIds.has(operation.operationId)) {
          throw new Error(`duplicate operationId: ${operation.operationId}`);
        }
        operationIds.add(operation.operationId);
        if (!operation.responses || Object.keys(operation.responses).length === 0) {
          throw new Error(`${method.toUpperCase()} ${path} is missing responses`);
        }
      }
    }

    const schemas = (doc.components?.schemas ?? {}) as Record<string, any>;
    for (const [name, schema] of Object.entries(schemas)) {
      if (schema && typeof schema === "object" && typeof schema.type === "string" && !VALID_SCHEMA_TYPES.has(schema.type)) {
        throw new Error(`schema ${name} has unsupported type ${schema.type}`);
      }
    }
    unresolvedRefs += countUnresolvedRefs(doc);
  });

  check("asyncapi.yaml", () => {
    const doc = parseYaml(files["asyncapi.yaml"], "asyncapi.yaml") as any;
    if (!String(doc.asyncapi ?? "").startsWith("2.")) throw new Error("asyncapi must be 2.x");
    if (!doc.channels || typeof doc.channels !== "object") throw new Error("missing channels object");
    for (const [channel, item] of Object.entries(doc.channels as Record<string, any>)) {
      if (!item || typeof item !== "object") throw new Error(`channel ${channel} is not an object`);
      if (!item.publish && !item.subscribe) throw new Error(`channel ${channel} has no publish or subscribe operation`);
      for (const operation of [item.publish, item.subscribe]) {
        if (!operation) continue;
        if (typeof operation.operationId !== "string") throw new Error(`channel ${channel} operation is missing operationId`);
        if (!operation.message) throw new Error(`channel ${channel} operation is missing a message`);
      }
    }
    unresolvedRefs += countUnresolvedRefs(doc);
  });

  check("components/schemas", () => {
    for (const path of ["openapi.yaml", "asyncapi.yaml"]) {
      const doc = parseYaml(files[path], path) as any;
      for (const [name, schema] of Object.entries((doc.components?.schemas ?? {}) as Record<string, unknown>)) {
        validateJsonSchema(name, schema);
      }
    }
  });

  check("prisma/schema.prisma", () => {
    const prisma = files["prisma/schema.prisma"] ?? "";
    if (!prisma.includes("datasource db")) throw new Error("missing datasource block");
    if (!prisma.includes("generator client")) throw new Error("missing generator block");
    const provider = /datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/.exec(prisma)?.[1];
    if (!provider || !PRISMA_PROVIDERS.has(provider)) {
      throw new Error(`unsupported or missing Prisma provider: ${provider ?? "none"}`);
    }
    if (count(prisma, "{") !== count(prisma, "}")) throw new Error("unbalanced braces");

    const models = [...prisma.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
    if (models.length === 0) throw new Error("schema declares no models");
    for (const model of models) {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(model)) throw new Error(`model ${model} must be PascalCase`);
    }
    const maps = [...prisma.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]);
    if (new Set(maps).size !== maps.length) throw new Error("duplicate @@map table names");
  });

  check("diagram.mmd", () => {
    const diagram = files["diagram.mmd"] ?? "";
    if (!/^(flowchart|graph)\s/.test(diagram)) throw new Error("mermaid must start with flowchart or graph");
    if (diagram.split("\n").filter((line) => line.trim().startsWith("n_") || line.includes("-->")).length === 0) {
      throw new Error("mermaid diagram has no nodes or edges");
    }
  });

  check("TASKS.md", () => {
    const tasks = files["TASKS.md"] ?? "";
    const ids = tasks
      .split("\n")
      .map((line) => /^\|\s*(T-\d{3,})\s*\|/.exec(line)?.[1])
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) throw new Error("missing task index rows");
    if (!tasks.includes("tasks/")) throw new Error("missing packet path instruction");
    if (new Set(ids).size !== ids.length) throw new Error("duplicate task ids in the index");
    if (options.requireTaskFiles) {
      for (const id of ids) {
        const packet = files[`tasks/${id}.md`];
        if (!packet) throw new Error(`missing packet file tasks/${id}.md`);
        if (!packet.includes("- [ ]")) throw new Error(`tasks/${id}.md is missing acceptance criteria`);
        if ((packet.match(/^## /gm) ?? []).length < 4) throw new Error(`tasks/${id}.md is missing sections`);
      }
    }
  });

  check("metrics.json", () => {
    let metrics: unknown;
    try {
      metrics = JSON.parse(files["metrics.json"] ?? "");
    } catch {
      throw new Error("metrics.json is not valid JSON");
    }
    if (!Array.isArray(metrics) || metrics.length === 0) throw new Error("metrics must be a non-empty array");
    const names = new Set<string>();
    for (const metric of metrics as Array<Record<string, unknown>>) {
      if (typeof metric.name !== "string" || metric.name.length === 0) throw new Error("metric is missing a name");
      if (typeof metric.value !== "number") throw new Error(`metric ${metric.name} value must be a number`);
      if (typeof metric.target !== "string") throw new Error(`metric ${metric.name} is missing a target`);
      if (typeof metric.pass !== "boolean") throw new Error(`metric ${metric.name} is missing a pass flag`);
      if (names.has(metric.name)) throw new Error(`duplicate metric name: ${metric.name}`);
      names.add(metric.name);
    }
  });

  check("MANIFEST.md", () => {
    if (files["MANIFEST.md"] === undefined) return;
    const manifest = files["MANIFEST.md"];
    if ((manifest.match(/^## /gm) ?? []).length < 3) throw new Error("manifest is missing sections");
    if (!manifest.includes("metrics.json")) throw new Error("manifest is missing the metrics section");
  });

  check(".cursorrules", () => {
    const rules = files[".cursorrules"] ?? "";
    if (!rules.trim()) throw new Error("cursor rules are empty");
    if (!rules.includes("TASKS.md")) throw new Error("cursor rules must point to TASKS.md");
  });

  check("ARCHITECTURE.md", () => {
    if (files["ARCHITECTURE.md"] === undefined) return;
    const doc = files["ARCHITECTURE.md"];
    if (!doc.includes("```mermaid")) throw new Error("architecture doc is missing the diagram");
    if ((doc.match(/^## /gm) ?? []).length < 3) throw new Error("architecture doc is missing sections");
  });

  check("WHITEPAPER.md", () => {
    if (files["WHITEPAPER.md"] === undefined) return;
    const doc = files["WHITEPAPER.md"];
    if (!doc.includes("```mermaid")) throw new Error("whitepaper is missing the diagram");
    if ((doc.match(/^## /gm) ?? []).length < 4) throw new Error("whitepaper is missing sections");
  });

  check("AGENTS.md", () => {
    if (files["AGENTS.md"] === undefined) return;
    const doc = files["AGENTS.md"];
    if (!doc.includes("TASKS.md")) throw new Error("agent guide must point to TASKS.md");
    if ((doc.match(/^## /gm) ?? []).length + (doc.match(/^# /gm) ?? []).length < 1) {
      throw new Error("agent guide is missing");
    }
  });

  check(".opencode/agents", () => {
    const agentFiles = Object.keys(files).filter((file) => file.startsWith(".opencode/agents/"));
    if (agentFiles.length === 0) return;
    for (const role of AGENT_ROLES) {
      const path = `.opencode/agents/${role}.md`;
      const content = files[path];
      if (!content) throw new Error(`missing agent definition ${path}`);
      if (!content.startsWith("---")) throw new Error(`${path} is missing frontmatter`);
      if (!content.includes("mode: subagent")) throw new Error(`${path} must declare mode: subagent`);
      const steps = Number(/steps:\s*(\d+)/.exec(content)?.[1] ?? NaN);
      if (!Number.isFinite(steps) || steps > 8) throw new Error(`${path} must declare steps <= 8`);
    }
  });

  check("adr", () => {
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith("adr/")) continue;
      if (!content.startsWith("# ADR-")) throw new Error(`${path} is missing an ADR heading`);
      if ((content.match(/^## /gm) ?? []).length < 3) throw new Error(`${path} is missing sections`);
    }
  });

  const { presentKinds, validatedKinds, unvalidated } = coverage(files);
  const deterministicCoverage =
    presentKinds.size === 0 ? 1 : Math.round((validatedKinds.size / presentKinds.size) * 1000) / 1000;
  if (unvalidated.length > 0) {
    issues.push({
      file: "package",
      message: `No deterministic validator for: ${unvalidated.slice(0, 5).join(", ")}${unvalidated.length > 5 ? "…" : ""}`,
    });
  }
  if (unresolvedRefs > 0) {
    issues.push({ file: "schemas", message: `${unresolvedRefs} unresolved $ref target(s)` });
  }

  return {
    ok: issues.length === 0,
    issues,
    passRate: checksRun === 0 ? 1 : Math.max(0, checksRun - failedChecks) / checksRun,
    unresolvedRefs,
    deterministicCoverage,
    checksRun,
    artifactsValidated: [...validatedKinds],
  };
}

export function repairArtifacts(files: Record<string, string>): { files: Record<string, string>; rounds: number } {
  let current = { ...files };
  let rounds = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = JSON.stringify(current);
    current = repairOnce(current);
    if (JSON.stringify(current) === before) break;
    rounds += 1;
    if (validateArtifacts(current).ok) break;
  }

  return { files: current, rounds };
}

function repairOnce(files: Record<string, string>): Record<string, string> {
  const next = { ...files };

  if (next["openapi.yaml"] !== undefined && !next["openapi.yaml"].includes("openapi:")) {
    next["openapi.yaml"] = `openapi: 3.1.0\n${next["openapi.yaml"]}`;
  }
  if (next["openapi.yaml"] !== undefined && !/(^|\n)info:/.test(next["openapi.yaml"])) {
    next["openapi.yaml"] = `info:\n  title: Repaired API\n  version: 1.0.0\n${next["openapi.yaml"]}`;
  }
  if (next["openapi.yaml"] !== undefined) {
    const minimalPaths = [
      "paths:",
      "  /health:",
      "    get:",
      "      operationId: repaired_health",
      "      responses:",
      '        "200":',
      "          description: OK",
      "",
    ].join("\n");
    if (/paths:\s*\{\s*\}/.test(next["openapi.yaml"])) {
      next["openapi.yaml"] = next["openapi.yaml"].replace(/paths:\s*\{\s*\}/, minimalPaths);
    } else if (!/(^|\n)paths:/.test(next["openapi.yaml"])) {
      next["openapi.yaml"] = `${next["openapi.yaml"]}\n${minimalPaths}`;
    }
  }
  if (next["asyncapi.yaml"] !== undefined && !next["asyncapi.yaml"].includes("asyncapi:")) {
    next["asyncapi.yaml"] = `asyncapi: 2.6.0\n${next["asyncapi.yaml"]}`;
  }
  if (next["asyncapi.yaml"] !== undefined && !/(^|\n)channels:/.test(next["asyncapi.yaml"])) {
    next["asyncapi.yaml"] = `${next["asyncapi.yaml"]}\nchannels: {}\n`;
  }
  if (next["prisma/schema.prisma"] !== undefined && !next["prisma/schema.prisma"].includes("datasource db")) {
    next["prisma/schema.prisma"] = [
      'generator client {\n  provider = "prisma-client-js"\n}',
      "",
      'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}',
      "",
      next["prisma/schema.prisma"],
    ].join("\n");
  }
  if (!next["diagram.mmd"] || !/^(flowchart|graph)\s/.test(next["diagram.mmd"])) {
    const body = (next["diagram.mmd"] ?? "").trim();
    next["diagram.mmd"] =
      body.length > 0
        ? `flowchart LR\n${body}\n  n_placeholder["placeholder"]\n`
        : 'flowchart LR\n  n_placeholder["placeholder"]\n';
  } else if (!next["diagram.mmd"].split("\n").some((line) => line.trim().startsWith("n_") || line.includes("-->") )) {
    next["diagram.mmd"] = `${next["diagram.mmd"].trimEnd()}\n  n_placeholder["placeholder"]\n`;
  }
  if (next["TASKS.md"] !== undefined && !next["TASKS.md"].split("\n").some((line) => /^\|\s*T-\d{3,}\s*\|/.test(line))) {
    next["TASKS.md"] = `# TASKS\n\n| ID | Task |\n|---|---|\n\nPacket files live in \`tasks/<ID>.md\`.\n${next["TASKS.md"]}`;
  }
  if (!isValidMetrics(next["metrics.json"])) {
    next["metrics.json"] = JSON.stringify([{ name: "repaired_package", value: 1, target: ">= 1", pass: true }], null, 2);
  }
  if (!next["MANIFEST.md"]) {
    next["MANIFEST.md"] = [
      "# Package Manifest",
      "",
      "## Overview",
      "",
      "- Validation: repaired deterministically",
      "",
      "## Contents",
      "",
      ...Object.keys(next)
        .sort()
        .map((path) => `- \`${path}\``),
      "",
      "## Metrics",
      "",
      "See `metrics.json`.",
      "",
    ].join("\n");
  }

  return next;
}

function isValidMetrics(source: string | undefined): boolean {
  if (!source) return false;
  try {
    const parsed = JSON.parse(source);
    return (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (metric) =>
          metric &&
          typeof metric.name === "string" &&
          typeof metric.value === "number" &&
          typeof metric.target === "string" &&
          typeof metric.pass === "boolean",
      )
    );
  } catch {
    return false;
  }
}

function coverage(files: Record<string, string>): {
  presentKinds: Set<string>;
  validatedKinds: Set<string>;
  unvalidated: string[];
} {
  const presentKinds = new Set<string>();
  const validatedKinds = new Set<string>();
  const unvalidated: string[] = [];
  for (const path of Object.keys(files)) {
    const kind = artifactKind(path);
    presentKinds.add(kind);
    if (kind === "unvalidated") {
      unvalidated.push(path);
    } else {
      validatedKinds.add(kind);
    }
  }
  return { presentKinds, validatedKinds, unvalidated };
}

function artifactKind(path: string): string {
  if (path === "openapi.yaml") return "openapi";
  if (path === "asyncapi.yaml") return "asyncapi";
  if (path === "prisma/schema.prisma") return "prisma";
  if (path === "diagram.mmd") return "mermaid";
  if (path === "metrics.json") return "metrics";
  if (path === "MANIFEST.md") return "manifest";
  if (path === ".cursorrules") return "cursorrules";
  if (path === "TASKS.md" || path.startsWith("tasks/")) return "tasks";
  if (path.startsWith(".opencode/agents/")) return "agents";
  if (path.startsWith("adr/")) return "adr";
  if (path === "ARCHITECTURE.md" || path === "WHITEPAPER.md" || path === "AGENTS.md") return "docs";
  return "unvalidated";
}

function parseYaml(source: string | undefined, file: string): unknown {
  if (!source) throw new Error(`${file} is missing`);
  try {
    return YAML.parse(source);
  } catch (error) {
    throw new Error(`${file} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function countUnresolvedRefs(doc: unknown): number {
  const refs = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref" && typeof child === "string" && child.startsWith("#/")) {
          refs.add(child);
        } else {
          walk(child);
        }
      }
    }
  };
  walk(doc);
  return [...refs].filter((ref) => !resolvePointer(doc, ref)).length;
}

function validateJsonSchema(name: string, schema: unknown, path = name): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`schema ${path} must be an object`);
  }
  const node = schema as Record<string, any>;

  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    for (const type of types) {
      if (typeof type !== "string" || !VALID_SCHEMA_TYPES.has(type)) {
        throw new Error(`schema ${path} has unsupported type ${String(type)}`);
      }
    }
  }

  if (node.properties !== undefined) {
    if (!node.properties || typeof node.properties !== "object" || Array.isArray(node.properties)) {
      throw new Error(`schema ${path}.properties must be an object`);
    }
    for (const [key, child] of Object.entries(node.properties)) {
      validateJsonSchema(name, child, `${path}.properties.${key}`);
    }
  }

  if (node.required !== undefined) {
    if (!Array.isArray(node.required) || node.required.some((item: unknown) => typeof item !== "string")) {
      throw new Error(`schema ${path}.required must be an array of strings`);
    }
    for (const required of node.required as string[]) {
      if (node.properties && !(required in node.properties)) {
        throw new Error(`schema ${path} requires undeclared property ${required}`);
      }
    }
  }

  if (node.items !== undefined) validateJsonSchema(name, node.items, `${path}.items`);
  if (node.type === "array" && node.items === undefined) throw new Error(`schema ${path} is an array without items`);
  if (node.enum !== undefined && !Array.isArray(node.enum)) throw new Error(`schema ${path}.enum must be an array`);
  if (node.format !== undefined && typeof node.format !== "string") {
    throw new Error(`schema ${path}.format must be a string`);
  }
}

function resolvePointer(doc: unknown, ref: string): boolean {
  const segments = ref
    .replace(/^#\//, "")
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = doc;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in (current as Record<string, unknown>))) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current !== undefined;
}

function count(value: string, char: string): number {
  return value.split(char).length - 1;
}
