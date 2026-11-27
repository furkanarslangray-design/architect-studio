/**
 * The persisted architecture state contract.
 *
 * `archState@1` is the only version that exists today: a state written before
 * the `version` field existed is upgraded to 1, and any other declared version
 * is rejected instead of guessed at. Bumping the version means adding a step
 * here and in `SUPPORTED_STATE_VERSIONS` — see `docs/state-versioning.md`.
 */

export const CURRENT_STATE_VERSION = 1;
export const SUPPORTED_STATE_VERSIONS = [1] as const;
export type StateVersion = (typeof SUPPORTED_STATE_VERSIONS)[number];

export class UnsupportedStateVersionError extends Error {
  readonly code = "unsupported_state_version";
  readonly version: number | string;

  constructor(version: number | string) {
    super(
      `Unsupported architecture state version: ${String(version)}. Supported: ${SUPPORTED_STATE_VERSIONS.join(", ")}.`,
    );
    this.name = "UnsupportedStateVersionError";
    this.version = version;
  }
}

export function isStateVersion(value: unknown): value is StateVersion {
  return typeof value === "number" && (SUPPORTED_STATE_VERSIONS as readonly number[]).includes(value);
}

export interface StateMigration {
  /** The input with `version` filled in; otherwise untouched. */
  value: unknown;
  /** Version the input declared, or null when the field was absent. */
  fromVersion: StateVersion | null;
  /** True when the input had to be rewritten to match the current contract. */
  migrated: boolean;
  warnings: string[];
}

/**
 * Accepts the shapes that have ever been persisted. A state without `version`
 * predates versioning and becomes 1 with a warning; a state that declares an
 * unknown version is an error, because silently coercing it could drop fields a
 * newer writer depends on. Non-objects pass through so the zod schema reports
 * the shape error with its own path.
 */
export function migrateState(input: unknown): StateMigration {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { value: input, fromVersion: null, migrated: false, warnings: [] };
  }

  const record = input as Record<string, unknown>;
  const declared = record.version;

  if (declared === undefined) {
    return {
      value: { ...record, version: CURRENT_STATE_VERSION },
      fromVersion: null,
      migrated: true,
      warnings: [
        `state.version is missing; assuming ${CURRENT_STATE_VERSION}. Add "version": ${CURRENT_STATE_VERSION} so the contract is explicit.`,
      ],
    };
  }

  if (!isStateVersion(declared)) {
    throw new UnsupportedStateVersionError(
      typeof declared === "number" || typeof declared === "string" ? declared : String(declared),
    );
  }

  return { value: input, fromVersion: declared, migrated: false, warnings: [] };
}

const NODE_KINDS = ["service", "database", "queue", "external", "ui"] as const;
const PROTOCOLS = ["http", "grpc", "event", "sql"] as const;
const FIELD_TYPES = [
  "string",
  "text",
  "int",
  "float",
  "decimal",
  "boolean",
  "datetime",
  "date",
  "uuid",
  "json",
] as const;

/** JSON Schema for `archState@1`; hand-written so it stays readable in editors. */
export const ARCH_STATE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://architect.studio/schemas/arch-state-v1.json",
  title: "ArchState v1",
  type: "object",
  additionalProperties: false,
  required: ["version", "nodes"],
  properties: {
    version: { const: 1 },
    nodes: { type: "array", minItems: 1, items: { $ref: "#/$defs/node" } },
    edges: { type: "array", items: { $ref: "#/$defs/edge" }, default: [] },
    decisions: { type: "array", items: { $ref: "#/$defs/decision" }, default: [] },
    entities: { type: "array", items: { $ref: "#/$defs/entity" }, default: [] },
  },
  $defs: {
    node: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "name"],
      properties: {
        id: { type: "string", minLength: 1 },
        kind: { enum: NODE_KINDS },
        name: { type: "string", minLength: 1 },
        props: {
          type: "object",
          additionalProperties: { type: ["string", "number", "boolean"] },
          default: {},
        },
      },
    },
    edge: {
      type: "object",
      additionalProperties: false,
      required: ["id", "from", "to"],
      properties: {
        id: { type: "string", minLength: 1 },
        from: { type: "string", minLength: 1 },
        to: { type: "string", minLength: 1 },
        protocol: { enum: PROTOCOLS, default: "http" },
        contractRef: { type: "string" },
      },
    },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["id", "title", "decision"],
      properties: {
        id: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        context: { type: "string", default: "" },
        decision: { type: "string", minLength: 1 },
        alternatives: { type: "array", items: { type: "string" }, default: [] },
      },
    },
    entity: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "fields"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        description: { type: "string", default: "" },
        serviceId: { type: "string" },
        databaseId: { type: "string" },
        fields: { type: "array", minItems: 1, items: { $ref: "#/$defs/field" } },
        relations: { type: "array", items: { $ref: "#/$defs/relation" }, default: [] },
      },
    },
    field: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        type: { enum: FIELD_TYPES, default: "string" },
        required: { type: "boolean", default: false },
        unique: { type: "boolean", default: false },
        primary: { type: "boolean", default: false },
        description: { type: "string" },
      },
    },
    relation: {
      type: "object",
      additionalProperties: false,
      required: ["target"],
      properties: {
        target: { type: "string", minLength: 1 },
        field: { type: "string" },
      },
    },
  },
} as const;

export function stateJsonSchema(version: number = CURRENT_STATE_VERSION) {
  if (!isStateVersion(version)) throw new UnsupportedStateVersionError(version);
  return ARCH_STATE_JSON_SCHEMA;
}
