import type { ArchState } from "./state";

export interface ArchDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
}

export function validateState(state: ArchState): string[] {
  const errors: string[] = [];
  const nodeIds = new Set<string>();

  for (const node of state.nodes) {
    if (!node.id || !node.name) errors.push(`Node with empty id or name: ${JSON.stringify(node)}`);
    if (nodeIds.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of state.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from)) errors.push(`Dangling edge ${edge.id}: missing from node ${edge.from}`);
    if (!nodeIds.has(edge.to)) errors.push(`Dangling edge ${edge.id}: missing to node ${edge.to}`);
    if (edge.from === edge.to) errors.push(`Self-loop edge ${edge.id}: ${edge.from}`);
  }

  if (hasCycle(state)) errors.push("Architecture graph contains a cycle");
  return errors;
}

export function hasCycle(state: ArchState): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of state.nodes) adjacency.set(node.id, []);
  for (const edge of state.edges) adjacency.get(edge.from)?.push(edge.to);

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return state.nodes.some((node) => visit(node.id));
}

export function diffStates(before: ArchState, after: ArchState): ArchDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Set(before.edges.map((edge) => edge.id));
  const afterEdges = new Set(after.edges.map((edge) => edge.id));

  const addedNodes = [...afterNodes.keys()].filter((id) => !beforeNodes.has(id));
  const removedNodes = [...beforeNodes.keys()].filter((id) => !afterNodes.has(id));
  const changedNodes = [...afterNodes.keys()].filter((id) => {
    const oldNode = beforeNodes.get(id);
    const newNode = afterNodes.get(id);
    return oldNode && newNode && JSON.stringify(oldNode) !== JSON.stringify(newNode);
  });

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges: [...afterEdges].filter((id) => !beforeEdges.has(id)),
    removedEdges: [...beforeEdges].filter((id) => !afterEdges.has(id)),
  };
}

export function dependencyDepth(state: ArchState): number {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of state.nodes) {
    adjacency.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of state.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const depth = new Map<string, number>(queue.map((id) => [id, 0]));
  let processed = 0;
  let maxDepth = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    processed += 1;
    const currentDepth = depth.get(current) ?? 0;
    maxDepth = Math.max(maxDepth, currentDepth);
    for (const next of adjacency.get(current) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, currentDepth + 1));
      const nextDegree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }

  return processed === state.nodes.length ? maxDepth : 999;
}

export function contractCoverage(
  state: ArchState,
  coveredNodeIds: Iterable<string>,
  coveredEdgeIds: Iterable<string>,
): number {
  const total = state.nodes.length + state.edges.length;
  if (total === 0) return 1;
  const nodes = new Set(coveredNodeIds);
  const edges = new Set(coveredEdgeIds);
  const coveredNodes = state.nodes.filter((node) => nodes.has(node.id)).length;
  const coveredEdges = state.edges.filter((edge) => edges.has(edge.id)).length;
  return (coveredNodes + coveredEdges) / total;
}
