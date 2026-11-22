import { z } from "zod";

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

export const ArchStateSchema = z.object({
  version: z.number().int().positive().default(1),
  nodes: z.array(ArchNodeSchema).min(1),
  edges: z.array(ArchEdgeSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
});
export type ArchState = z.infer<typeof ArchStateSchema>;

export function parseState(input: unknown): ArchState {
  return ArchStateSchema.parse(input);
}

export function safeParseState(input: unknown) {
  return ArchStateSchema.safeParse(input);
}

export function emptyState(): ArchState {
  return { version: 1, nodes: [], edges: [], decisions: [] };
}
