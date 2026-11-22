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
}

export function validateArtifacts(files: Record<string, string>): ValidationReport {
  const issues: ValidationIssue[] = [];
  let checks = 0;
  let unresolvedRefs = 0;

  const check = (file: string, fn: () => void) => {
    checks += 1;
    try {
      fn();
    } catch (error) {
      issues.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  };

  check("openapi.yaml", () => {
    const doc = parseYaml(files["openapi.yaml"], "openapi.yaml") as any;
    if (!String(doc.openapi ?? "").startsWith("3.1")) throw new Error("openapi must be 3.1.x");
    if (!doc.info || typeof doc.info !== "object") throw new Error("missing info object");
    if (!doc.paths || typeof doc.paths !== "object") throw new Error("missing paths object");
    unresolvedRefs += countUnresolvedRefs(doc, doc.components?.schemas ?? {});
  });

  check("asyncapi.yaml", () => {
    const doc = parseYaml(files["asyncapi.yaml"], "asyncapi.yaml") as any;
    if (!doc.asyncapi) throw new Error("missing asyncapi version");
    if (!doc.channels || typeof doc.channels !== "object") throw new Error("missing channels object");
    unresolvedRefs += countUnresolvedRefs(doc, doc.components?.schemas ?? {});
  });

  check("prisma/schema.prisma", () => {
    const prisma = files["prisma/schema.prisma"] ?? "";
    if (!prisma.includes("datasource db")) throw new Error("missing datasource block");
    if (!prisma.includes("generator client")) throw new Error("missing generator block");
    if (count(prisma, "{") !== count(prisma, "}")) throw new Error("unbalanced braces");
  });

  check("diagram.mmd", () => {
    const diagram = files["diagram.mmd"] ?? "";
    if (!/^(flowchart|graph)\s/.test(diagram)) throw new Error("mermaid must start with flowchart or graph");
  });

  check("TASKS.md", () => {
    const tasks = files["TASKS.md"] ?? "";
    if (!tasks.includes("| ID | Task |")) throw new Error("missing task index table");
    if (!tasks.includes("tasks/<ID>.md")) throw new Error("missing packet path instruction");
  });

  check("metrics.json", () => {
    const metrics = JSON.parse(files["metrics.json"] ?? "[]") as unknown;
    if (!Array.isArray(metrics) || metrics.length === 0) throw new Error("metrics must be a non-empty array");
  });

  check(".cursorrules", () => {
    if (!(files[".cursorrules"] ?? "").trim()) throw new Error("cursor rules are empty");
  });

  const passed = checks - issues.length;
  if (unresolvedRefs > 0) {
    issues.push({ file: "schemas", message: `${unresolvedRefs} unresolved $ref target(s)` });
  }
  return {
    ok: issues.length === 0,
    issues,
    passRate: checks === 0 ? 1 : Math.max(0, passed) / checks,
    unresolvedRefs,
    deterministicCoverage: 1,
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

  if (!next["openapi.yaml"]?.includes("openapi:")) {
    next["openapi.yaml"] = `openapi: 3.1.0\n${next["openapi.yaml"] ?? ""}`;
  }
  if (next["openapi.yaml"] && !/(^|\n)info:/.test(next["openapi.yaml"])) {
    next["openapi.yaml"] = `info:\n  title: Repaired API\n  version: 1.0.0\n${next["openapi.yaml"]}`;
  }
  if (next["asyncapi.yaml"] && !next["asyncapi.yaml"].includes("asyncapi:")) {
    next["asyncapi.yaml"] = `asyncapi: 2.6.0\n${next["asyncapi.yaml"]}`;
  }
  if (!next["diagram.mmd"] || !/^(flowchart|graph)\s/.test(next["diagram.mmd"])) {
    next["diagram.mmd"] = `flowchart LR\n${next["diagram.mmd"] ?? ""}`;
  }
  if (next["TASKS.md"] && !next["TASKS.md"].includes("| ID | Task |")) {
    next["TASKS.md"] = `# TASKS\n\n| ID | Task |\n|---|---|\n\nPacket files live in \`tasks/<ID>.md\`.\n${next["TASKS.md"]}`;
  }

  return next;
}

function parseYaml(source: string | undefined, file: string): unknown {
  if (!source) throw new Error(`${file} is missing`);
  try {
    return YAML.parse(source);
  } catch (error) {
    throw new Error(`${file} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function countUnresolvedRefs(doc: unknown, schemas: Record<string, unknown>): number {
  const refs = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
          refs.add(child.replace("#/components/schemas/", ""));
        } else {
          walk(child);
        }
      }
    }
  };
  walk(doc);
  return [...refs].filter((name) => !(name in schemas)).length;
}

function count(value: string, char: string): number {
  return value.split(char).length - 1;
}
