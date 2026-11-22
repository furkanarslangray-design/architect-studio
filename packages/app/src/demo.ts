import type { ArchNode, ArchState } from "../../core/src/state";

export function demoState(idea: string): ArchState {
  const text = idea.toLowerCase();
  const nodes: ArchNode[] = [
    { id: "svc-core", kind: "service", name: "Core API", props: { runtime: "node" } },
  ];
  const edges: ArchState["edges"] = [];
  const decisions: ArchState["decisions"] = [];

  const wantsDatabase = /postgres|postgresql|sql|mysql|mongo|database|veritaban|db\b/.test(text);
  const wantsQueue = /redis|queue|event|kafka|rabbit|mesaj|stream/.test(text);
  const wantsUi = /react|next|web|frontend|ui|arayüz|mobil|mobile|site/.test(text);

  if (wantsDatabase || (!wantsQueue && !wantsUi)) {
    nodes.push({ id: "db-main", kind: "database", name: "Primary DB", props: { engine: "postgres" } });
    edges.push({ id: "edge-api-db", from: "svc-core", to: "db-main", protocol: "sql" });
    decisions.push({
      id: "adr-001",
      title: "Use PostgreSQL",
      context: "The system needs transactional storage.",
      decision: "Use managed PostgreSQL as the primary datastore.",
      alternatives: ["SQLite", "MongoDB"],
    });
  }

  if (wantsQueue) {
    nodes.push({ id: "queue-events", kind: "queue", name: "Domain Events", props: { engine: "redis" } });
    edges.push({ id: "edge-api-queue", from: "svc-core", to: "queue-events", protocol: "event" });
    decisions.push({
      id: "adr-002",
      title: "Use Redis Streams",
      context: "Services need asynchronous domain events.",
      decision: "Use Redis Streams for event delivery.",
      alternatives: ["Kafka", "SQS"],
    });
  }

  if (wantsUi) {
    nodes.push({ id: "ui-web", kind: "ui", name: "Web App", props: { framework: "react" } });
    edges.push({ id: "edge-ui-api", from: "ui-web", to: "svc-core", protocol: "http" });
  }

  if (nodes.length === 1) {
    nodes.push({ id: "db-main", kind: "database", name: "Primary DB", props: { engine: "postgres" } });
    edges.push({ id: "edge-api-db", from: "svc-core", to: "db-main", protocol: "sql" });
  }

  return { version: 1, nodes, edges, decisions };
}
