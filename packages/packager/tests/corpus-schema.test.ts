import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ArchEdgeSchema,
  ArchNodeSchema,
  ArchStateSchema,
  DecisionSchema,
  EntityFieldSchema,
  EntityRelationSchema,
  EntitySchema,
} from "../../core/src/state";
import { ARCH_STATE_JSON_SCHEMA, CURRENT_STATE_VERSION } from "../../core/src/state-schema";

const corpusDir = join(__dirname, "../../../examples/corpus");
const files = readdirSync(corpusDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

function readCorpus(name: string): unknown {
  return JSON.parse(readFileSync(join(corpusDir, name), "utf8"));
}

function issuesOf(error: { issues: Array<{ path: readonly PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

describe("corpus files conform to the ArchState schema", () => {
  it.each(files)("%s parses as archState@%s", (name) => {
    const raw = readCorpus(name);
    const parsed = ArchStateSchema.safeParse(raw);
    expect(parsed.success ? "" : issuesOf(parsed.error)).toBe("");
    if (!parsed.success) return;

    expect(parsed.data.version).toBe(CURRENT_STATE_VERSION);
    expect(parsed.data.nodes.length).toBeGreaterThan(0);
    // No corpus file carries a key the schema would silently strip.
    for (const key of Object.keys(raw as Record<string, unknown>)) {
      expect(["version", "nodes", "edges", "decisions", "entities"]).toContain(key);
    }
  });

  it.each(files)("%s carries every required field explicitly", (name) => {
    const raw = readCorpus(name) as Record<string, unknown>;
    expect(Array.isArray(raw.nodes)).toBe(true);

    for (const node of raw.nodes as Array<Record<string, unknown>>) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.kind).toBe("string");
      expect(typeof node.name).toBe("string");
    }
    for (const edge of (raw.edges ?? []) as Array<Record<string, unknown>>) {
      expect(typeof edge.id).toBe("string");
      expect(typeof edge.from).toBe("string");
      expect(typeof edge.to).toBe("string");
    }
    for (const decision of (raw.decisions ?? []) as Array<Record<string, unknown>>) {
      expect(typeof decision.id).toBe("string");
      expect(typeof decision.title).toBe("string");
      expect(typeof decision.decision).toBe("string");
    }
    for (const entity of (raw.entities ?? []) as Array<Record<string, unknown>>) {
      expect(typeof entity.id).toBe("string");
      expect(typeof entity.name).toBe("string");
      const fields = entity.fields as Array<Record<string, unknown>>;
      expect(Array.isArray(fields)).toBe(true);
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) expect(typeof field.name).toBe("string");
    }
  });
});

describe("ARCH_STATE_JSON_SCHEMA matches the zod schemas", () => {
  interface SchemaCase {
    name: string;
    schema: { safeParse: (value: unknown) => { success: boolean } };
    required: readonly string[];
    sample: Record<string, unknown>;
    /** Fields zod fills with a default, so a raw object may omit them. */
    defaulted?: readonly string[];
  }

  const cases: SchemaCase[] = [
    {
      name: "root",
      schema: ArchStateSchema,
      required: ARCH_STATE_JSON_SCHEMA.required,
      sample: { version: CURRENT_STATE_VERSION, nodes: [{ id: "n", kind: "service", name: "N" }] },
      // A persisted state must state its version, but pre-versioning files load through migrateState.
      defaulted: ["version"],
    },
    {
      name: "node",
      schema: ArchNodeSchema,
      required: ARCH_STATE_JSON_SCHEMA.$defs.node.required,
      sample: { id: "n", kind: "service", name: "N" },
    },
    {
      name: "edge",
      schema: ArchEdgeSchema,
      required: ARCH_STATE_JSON_SCHEMA.$defs.edge.required,
      sample: { id: "e", from: "a", to: "b" },
    },
    {
      name: "decision",
      schema: DecisionSchema,
      required: ARCH_STATE_JSON_SCHEMA.$defs.decision.required,
      sample: { id: "d", title: "T", decision: "D" },
    },
    {
      name: "entity",
      schema: EntitySchema,
      required: ARCH_STATE_JSON_SCHEMA.$defs.entity.required,
      sample: { id: "e", name: "E", fields: [{ name: "id" }] },
    },
    {
      name: "field",
      schema: EntityFieldSchema,
      required: ARCH_STATE_JSON_SCHEMA.$defs.field.required,
      sample: { name: "id" },
    },
    {
      name: "relation",
      schema: EntityRelationSchema,
      required: ARCH_STATE_JSON_SCHEMA.$defs.relation.required,
      sample: { target: "other" },
    },
  ];

  it("accepts a minimal sample for every definition", () => {
    for (const item of cases) {
      expect(item.schema.safeParse(item.sample).success, item.name).toBe(true);
    }
  });

  it("declares only fields zod actually requires (defaults excluded)", () => {
    for (const item of cases) {
      for (const field of item.required) {
        const sample = { ...item.sample };
        delete sample[field];
        const defaulted = item.defaulted?.includes(field) ?? false;
        expect(item.schema.safeParse(sample).success, `${item.name}.${field}`).toBe(defaulted);
      }
    }
  });

  it("rejects a corpus-like state that drops a required node, edge, entity or field", () => {
    const base = {
      version: CURRENT_STATE_VERSION,
      nodes: [
        { id: "svc-1", kind: "service", name: "API" },
        { id: "db-1", kind: "database", name: "DB" },
      ],
      edges: [{ id: "e1", from: "svc-1", to: "db-1" }],
      decisions: [{ id: "adr-1", title: "T", decision: "D" }],
      entities: [{ id: "ent-1", name: "Order", fields: [{ name: "id" }] }],
    };

    const mutations: Array<[string, (state: typeof base) => void]> = [
      ["node.id", (state) => delete (state.nodes[0] as { id?: string }).id],
      ["node.kind", (state) => delete (state.nodes[0] as { kind?: string }).kind],
      ["node.name", (state) => delete (state.nodes[0] as { name?: string }).name],
      ["edge.from", (state) => delete (state.edges[0] as { from?: string }).from],
      ["entity.fields", (state) => delete (state.entities[0] as { fields?: unknown }).fields],
      ["field.name", (state) => delete (state.entities[0].fields[0] as { name?: string }).name],
      ["decision.decision", (state) => delete (state.decisions[0] as { decision?: string }).decision],
    ];

    for (const [field, mutate] of mutations) {
      const state = structuredClone(base);
      mutate(state);
      expect(ArchStateSchema.safeParse(state).success, field).toBe(false);
    }
  });
});
