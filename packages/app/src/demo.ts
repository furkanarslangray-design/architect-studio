import type { ArchNode, ArchState, Entity } from "../../core/src/state";

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
    if (!nodes.some((node) => node.id === "db-main")) {
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

  const hasDatabase = nodes.some((node) => node.id === "db-main");
  return { version: 1, nodes, edges, decisions, entities: demoEntities(text, hasDatabase) };
}

function demoEntities(text: string, hasDatabase: boolean): Entity[] {
  const databaseId = hasDatabase ? "db-main" : undefined;
  const wantsOrders = /order|sipariş|siparis|cart|sepet|checkout|payment|ödeme|odeme|e-?ticaret|ecommerce/.test(text);
  const wantsUsers = /user|kullanıcı|kullanici|auth|login|account|hesap|profil|profile|üye|uye/.test(text);
  const wantsProducts = /product|ürün|urun|catalog|katalog|inventory|stok|shop|mağaza|magaza|store/.test(text);

  const entities: Entity[] = [];

  if (wantsUsers) {
    entities.push({
      id: "ent-user",
      name: "User",
      description: "A person who signs in to the system.",
      serviceId: "svc-core",
      databaseId,
      fields: [
        { name: "id", type: "uuid", required: true, unique: false, primary: true },
        { name: "email", type: "string", required: true, unique: true, primary: false },
        { name: "name", type: "string", required: true, unique: false, primary: false },
        { name: "createdAt", type: "datetime", required: true, unique: false, primary: false },
      ],
      relations: [],
    });
  }

  if (wantsProducts) {
    entities.push({
      id: "ent-product",
      name: "Product",
      description: "A sellable catalog item.",
      serviceId: "svc-core",
      databaseId,
      fields: [
        { name: "id", type: "uuid", required: true, unique: false, primary: true },
        { name: "name", type: "string", required: true, unique: false, primary: false },
        { name: "price", type: "decimal", required: true, unique: false, primary: false },
        { name: "stock", type: "int", required: true, unique: false, primary: false },
        { name: "createdAt", type: "datetime", required: true, unique: false, primary: false },
      ],
      relations: [],
    });
  }

  if (wantsOrders) {
    entities.push({
      id: "ent-order",
      name: "Order",
      description: "A customer purchase.",
      serviceId: "svc-core",
      databaseId,
      fields: [
        { name: "id", type: "uuid", required: true, unique: false, primary: true },
        { name: "total", type: "decimal", required: true, unique: false, primary: false },
        { name: "status", type: "string", required: true, unique: false, primary: false },
        { name: "createdAt", type: "datetime", required: true, unique: false, primary: false },
      ],
      relations: wantsUsers ? [{ target: "ent-user", field: "userId" }] : [],
    });
  }

  if (entities.length === 0) {
    entities.push({
      id: "ent-resource",
      name: "Resource",
      description: "Default domain object for the first service.",
      serviceId: "svc-core",
      databaseId,
      fields: [
        { name: "id", type: "uuid", required: true, unique: false, primary: true },
        { name: "name", type: "string", required: true, unique: false, primary: false },
        { name: "createdAt", type: "datetime", required: true, unique: false, primary: false },
      ],
      relations: [],
    });
  }

  return entities;
}
