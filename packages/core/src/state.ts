import { z } from "zod";
import {
  CURRENT_STATE_VERSION,
  SUPPORTED_STATE_VERSIONS,
  UnsupportedStateVersionError,
  isStateVersion,
  migrateState,
} from "./state-schema";

export const NodeKindSchema = z.enum(["service", "database", "queue", "external", "ui"]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const ProtocolSchema = z.enum(["http", "grpc", "event", "sql"]);
export type Protocol = z.infer<typeof ProtocolSchema>;

const PropValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const ArchNodeSchema = z.object({
  id: z.string().min(1),
  kind: NodeKindSchema,
  name: z.string().min(1),
  props: z.record(PropValueSchema).default({}),
});
export type ArchNode = z.infer<typeof ArchNodeSchema>;

export const ArchEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  protocol: ProtocolSchema.default("http"),
  contractRef: z.string().optional(),
});
export type ArchEdge = z.infer<typeof ArchEdgeSchema>;

export const DecisionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  context: z.string().default(""),
  decision: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const FieldTypeSchema = z.enum([
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
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const EntityFieldSchema = z.object({
  name: z.string().min(1),
  type: FieldTypeSchema.default("string"),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  primary: z.boolean().default(false),
  description: z.string().optional(),
});
export type EntityField = z.infer<typeof EntityFieldSchema>;

export const EntityRelationSchema = z.object({
  target: z.string().min(1),
  field: z.string().min(1).optional(),
});
export type EntityRelation = z.infer<typeof EntityRelationSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  serviceId: z.string().optional(),
  databaseId: z.string().optional(),
  fields: z.array(EntityFieldSchema).min(1),
  relations: z.array(EntityRelationSchema).default([]),
});
export type Entity = z.infer<typeof EntitySchema>;

export const ArchStateSchema = z.object({
  version: z
    .number()
    .int()
    .positive()
    .refine(isStateVersion, {
      message: `Unsupported architecture state version. Supported: ${SUPPORTED_STATE_VERSIONS.join(", ")}.`,
    })
    .default(CURRENT_STATE_VERSION),
  nodes: z.array(ArchNodeSchema).min(1),
  edges: z.array(ArchEdgeSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  entities: z.array(EntitySchema).default([]),
});
export type ArchState = z.infer<typeof ArchStateSchema>;

/** Every entry point (HTTP bodies, CLI files, MCP tools) goes through here. */
export function parseState(input: unknown): ArchState {
  return ArchStateSchema.parse(migrateState(input).value);
}

export function safeParseState(input: unknown) {
  try {
    return ArchStateSchema.safeParse(migrateState(input).value);
  } catch (error) {
    if (!(error instanceof UnsupportedStateVersionError)) throw error;
    return {
      success: false as const,
      error: new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["version"], message: error.message }]),
    };
  }
}

export function emptyState(): ArchState {
  return { version: CURRENT_STATE_VERSION, nodes: [], edges: [], decisions: [], entities: [] };
}

export interface SanitizeResult {
  state: ArchState;
  removed: string[];
}

/**
 * Deterministically removes entries a model could reasonably get wrong:
 * duplicate node/edge/entity ids, dangling edges, self-loops and entity
 * references to nodes that do not exist. Structural errors that cannot be
 * repaired safely (cycles) are left in place for validateState to report.
 */
export function sanitizeState(state: ArchState): SanitizeResult {
  const removed: string[] = [];
  const nodes: ArchState["nodes"] = [];
  const nodeIds = new Set<string>();
  for (const node of state.nodes) {
    if (nodeIds.has(node.id)) {
      removed.push(`duplicate node ${node.id}`);
      continue;
    }
    nodeIds.add(node.id);
    nodes.push(node);
  }

  const edges: ArchState["edges"] = [];
  const edgeIds = new Set<string>();
  for (const edge of state.edges) {
    if (edgeIds.has(edge.id)) {
      removed.push(`duplicate edge ${edge.id}`);
      continue;
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      removed.push(`dangling edge ${edge.id}`);
      continue;
    }
    if (edge.from === edge.to) {
      removed.push(`self-loop edge ${edge.id}`);
      continue;
    }
    edgeIds.add(edge.id);
    edges.push(edge);
  }

  const decisions: ArchState["decisions"] = [];
  const decisionIds = new Set<string>();
  for (const decision of state.decisions) {
    if (decisionIds.has(decision.id)) {
      removed.push(`duplicate decision ${decision.id}`);
      continue;
    }
    decisionIds.add(decision.id);
    decisions.push(decision);
  }

  const entities: ArchState["entities"] = [];
  const entityIds = new Set<string>();
  for (const entity of state.entities) {
    if (entityIds.has(entity.id)) {
      removed.push(`duplicate entity ${entity.id}`);
      continue;
    }
    entityIds.add(entity.id);
    entities.push(entity);
  }
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    const serviceMissing = entity.serviceId && !nodeIds.has(entity.serviceId);
    const databaseMissing = entity.databaseId && !nodeIds.has(entity.databaseId);
    if (serviceMissing || databaseMissing) {
      removed.push(`entity ${entity.id} references a missing node`);
      entities[index] = { ...entity, serviceId: serviceMissing ? undefined : entity.serviceId, databaseId: databaseMissing ? undefined : entity.databaseId };
    }
  }

  return {
    state: {
      version: state.version,
      nodes,
      edges,
      decisions,
      entities,
    },
    removed,
  };
}
