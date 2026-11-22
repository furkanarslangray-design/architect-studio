import type { ArchNode, ArchState, NodeKind } from "../../core/src/state";
import { slugify } from "../../core/src/ids";

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

export function pascalCase(value: string): string {
  const result = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return result || "Item";
}

export function nodeLabel(node: ArchNode): string {
  return `${node.name} (${node.kind})`;
}
