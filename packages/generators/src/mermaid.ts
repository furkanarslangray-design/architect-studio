import type { ArchState } from "@architect-studio/core";

export function generateMermaid(state: ArchState): string {
  const ids = new Map(state.nodes.map((node) => [node.id, mermaidId(node.id)]));
  const lines = ["flowchart LR"];

  for (const node of state.nodes) {
    const id = ids.get(node.id)!;
    const label = node.name.replace(/"/g, '\\"');
    const shape = shapeFor(node.kind);
    lines.push(`  ${id}${shape.open}"${label}"${shape.close}`);
  }

  for (const edge of state.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to) continue;
    lines.push(`  ${from} -->|${edge.protocol}| ${to}`);
  }

  lines.push("");
  lines.push("  classDef service fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;");
  lines.push("  classDef database fill:#dcfce7,stroke:#16a34a,color:#14532d;");
  lines.push("  classDef queue fill:#fef3c7,stroke:#d97706,color:#78350f;");
  lines.push("  classDef external fill:#f3e8ff,stroke:#9333ea,color:#581c87;");
  lines.push("  classDef ui fill:#ffe4e6,stroke:#e11d48,color:#881337;");

  for (const node of state.nodes) {
    lines.push(`  class ${ids.get(node.id)} ${node.kind};`);
  }

  return lines.join("\n");
}

function mermaidId(id: string): string {
  return `n_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function shapeFor(kind: string): { open: string; close: string } {
  switch (kind) {
    case "database":
      return { open: "[(", close: ")]" };
    case "queue":
      return { open: "[[", close: "]]" };
    case "ui":
      return { open: "(", close: ")" };
    default:
      return { open: "[", close: "]" };
  }
}
