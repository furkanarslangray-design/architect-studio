import type { ArchNode, ArchState, Entity, EntityField, NodeKind } from "@architect-studio/core";
import { slugify } from "@architect-studio/core";

export function nodesOfKind(state: ArchState, kind: NodeKind): ArchNode[] {
  return state.nodes.filter((node) => node.kind === kind);
}

export function uniqueSlugs(nodes: ArchNode[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const node of nodes) {
    const base = slugify(node.name);
    let slug = base;
    let counter = 2;
    while (used.has(slug)) {
      slug = `${base}-${counter}`;
      counter += 1;
    }
    used.add(slug);
    result.set(node.id, slug);
  }
  return result;
}

export function uniqueEntitySlugs(entities: Entity[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const entity of entities) {
    const base = slugify(entity.name);
    let slug = base;
    let counter = 2;
    while (used.has(slug)) {
      slug = `${base}-${counter}`;
      counter += 1;
    }
    used.add(slug);
    result.set(entity.id, slug);
  }
  return result;
}

export function pascalCase(value: string): string {
  const result = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return result || "Item";
}

export function camelCase(value: string): string {
  const pascal = pascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function nodeLabel(node: ArchNode): string {
  return `${node.name} (${node.kind})`;
}

export const PRISMA_PROVIDERS = ["postgresql", "mysql", "sqlite", "sqlserver", "mongodb", "cockroachdb"] as const;
export type PrismaProvider = (typeof PRISMA_PROVIDERS)[number];

const ENGINE_TO_PROVIDER: Record<string, PrismaProvider> = {
  postgres: "postgresql",
  postgresql: "postgresql",
  pg: "postgresql",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: "sqlite",
  sqlserver: "sqlserver",
  mssql: "sqlserver",
  mongo: "mongodb",
  mongodb: "mongodb",
  cockroach: "cockroachdb",
  cockroachdb: "cockroachdb",
};

export function prismaProviderFor(node?: ArchNode): PrismaProvider {
  const engine = String(node?.props.engine ?? "").toLowerCase();
  return ENGINE_TO_PROVIDER[engine] ?? "postgresql";
}

export function openapiFieldSchema(field: EntityField): Record<string, unknown> {
  switch (field.type) {
    case "uuid":
      return { type: "string", format: "uuid" };
    case "int":
      return { type: "integer" };
    case "float":
    case "decimal":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "date":
      return { type: "string", format: "date" };
    case "json":
      return { type: "object", additionalProperties: true };
    case "text":
    case "string":
    default:
      return { type: "string" };
  }
}

export function prismaFieldType(field: EntityField): string {
  switch (field.type) {
    case "int":
      return "Int";
    case "float":
      return "Float";
    case "decimal":
      return "Decimal";
    case "boolean":
      return "Boolean";
    case "datetime":
    case "date":
      return "DateTime";
    case "json":
      return "Json";
    case "uuid":
    case "text":
    case "string":
    default:
      return "String";
  }
}

export function entitiesForService(state: ArchState, serviceId: string): Entity[] {
  return state.entities.filter((entity) => entity.serviceId === serviceId);
}

export function entitiesForDatabase(state: ArchState, databaseId: string): Entity[] {
  return state.entities.filter((entity) => entity.databaseId === databaseId);
}

export function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let counter = 2;
  while (used.has(name)) {
    name = `${base}${counter}`;
    counter += 1;
  }
  used.add(name);
  return name;
}
