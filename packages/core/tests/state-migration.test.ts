import { describe, expect, it } from "vitest";
import { parseState, safeParseState } from "../src/state";
import {
  ARCH_STATE_JSON_SCHEMA,
  CURRENT_STATE_VERSION,
  SUPPORTED_STATE_VERSIONS,
  UnsupportedStateVersionError,
  migrateState,
  stateJsonSchema,
} from "../src/state-schema";

const legacy = {
  nodes: [{ id: "svc-1", kind: "service", name: "Orders API" }],
  edges: [{ id: "e1", from: "svc-1", to: "db-1" }],
  entities: [
    {
      id: "ent-1",
      name: "Order",
      databaseId: "db-1",
      fields: [{ name: "id", type: "uuid", primary: true }],
    },
  ],
};

describe("migrateState", () => {
  it("upgrades a versionless state to 1 with a warning and leaves the input untouched", () => {
    const input = { ...legacy };
    const result = migrateState(input);

    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("state.version is missing");
    expect((result.value as { version?: number }).version).toBe(1);

    expect("version" in input).toBe(false);
    expect(input).not.toBe(result.value);
  });

  it("passes a current state through unchanged and warns about nothing", () => {
    const input = { version: CURRENT_STATE_VERSION, ...legacy };
    const result = migrateState(input);

    expect(result.migrated).toBe(false);
    expect(result.fromVersion).toBe(CURRENT_STATE_VERSION);
    expect(result.warnings).toEqual([]);
    expect(result.value).toBe(input);
  });

  it("rejects an unknown declared version instead of coercing it", () => {
    expect(() => migrateState({ version: 99, ...legacy })).toThrow(UnsupportedStateVersionError);
    try {
      migrateState({ version: 99, ...legacy });
    } catch (error) {
      const failure = error as UnsupportedStateVersionError;
      expect(failure.name).toBe("UnsupportedStateVersionError");
      expect(failure.code).toBe("unsupported_state_version");
      expect(failure.version).toBe(99);
      expect(failure.message).toContain("99");
      expect(failure.message).toContain(SUPPORTED_STATE_VERSIONS.join(", "));
    }
  });

  it("leaves a non-object to the schema so the shape error keeps its own path", () => {
    expect(() => parseState(null)).toThrow();
    expect(safeParseState([]).success).toBe(false);
  });
});

describe("parseState migration", () => {
  it("parses a legacy state as version 1 with defaults filled", () => {
    const state = parseState(legacy);

    expect(state.version).toBe(1);
    expect(state.nodes[0].props).toEqual({});
    expect(state.edges[0].protocol).toBe("http");
    expect(state.entities[0].fields[0]).toEqual({
      name: "id",
      type: "uuid",
      required: false,
      unique: false,
      primary: true,
    });
  });

  it("reports a versionless state as valid through safeParseState", () => {
    const result = safeParseState({ ...legacy, edges: [] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.version).toBe(1);
  });

  it("turns an unsupported version into a field-level safeParse issue", () => {
    const result = safeParseState({ version: 99, ...legacy });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["version"]);
      expect(result.error.issues[0].message).toContain("Unsupported architecture state version");
    }
  });
});

describe("archState@1 JSON schema", () => {
  it("pins the version and node kinds the zod schema accepts", () => {
    expect(ARCH_STATE_JSON_SCHEMA.$id).toBe("https://architect.studio/schemas/arch-state-v1.json");
    expect(ARCH_STATE_JSON_SCHEMA.required).toEqual(["version", "nodes"]);
    expect(ARCH_STATE_JSON_SCHEMA.properties.version).toEqual({ const: 1 });
    expect(ARCH_STATE_JSON_SCHEMA.$defs.node.properties.kind.enum).toEqual([
      "service",
      "database",
      "queue",
      "external",
      "ui",
    ]);
    expect(stateJsonSchema()).toBe(ARCH_STATE_JSON_SCHEMA);
  });

  it("refuses to describe an unsupported version", () => {
    expect(() => stateJsonSchema(2)).toThrow(UnsupportedStateVersionError);
  });
});
