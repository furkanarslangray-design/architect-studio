import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseState, type ArchState } from "@architect-studio/core";
import { buildTaskPackets } from "@architect-studio/core";
import {
  generateAsyncAPI,
  generateDocs,
  generateMermaid,
  generateOpenAPI31,
  generatePrisma,
} from "../src";

function fixture(name: "minimal" | "ecommerce" | "domain"): ArchState {
  return parseState(JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8")));
}

describe("schema and diagram generators", () => {
  it("generates a parseable OpenAPI 3.1 document with health and resource paths", () => {
    const doc = YAML.parse(generateOpenAPI31(fixture("ecommerce"))) as any;
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toContain("Generated Architecture API");
    expect(doc.paths["/order-api/health"].get).toBeDefined();
    expect(doc.paths["/user-api/health"].get).toBeDefined();
    expect(doc.components.schemas.Health).toBeDefined();
    expect(Object.keys(doc.components.schemas)).toContain("OrderAPIItem");
  });

  it("generates entity-driven CRUD schemas instead of a generic Item", () => {
    const doc = YAML.parse(generateOpenAPI31(fixture("domain"))) as any;
    const orderPath = doc.paths["/api/order-api/order"];
    expect(orderPath.get.operationId).toBe("list_order_api_order");
    expect(orderPath.post.operationId).toBe("create_order_api_order");
    expect(doc.paths["/api/order-api/order/{id}"].delete).toBeDefined();
    expect(doc.paths["/api/order-api/user"].get).toBeDefined();

    const order = doc.components.schemas.Order;
    expect(order.required).toEqual(["id", "total", "status", "createdAt"]);
    expect(order.properties.total.type).toBe("number");
    expect(order.properties.createdAt.format).toBe("date-time");
    expect(order.properties.id.readOnly).toBe(true);
    expect(doc.components.schemas.OrderAPIItem).toBeUndefined();

    const operationIds = Object.values(doc.paths).flatMap((item: any) =>
      Object.values(item).map((operation: any) => operation.operationId),
    );
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("generates a Prisma schema with one model per database", () => {
    const prisma = generatePrisma(fixture("ecommerce"));
    expect(prisma).toContain("model OrdersDB");
    expect(prisma).toContain("model UsersDB");
    expect(prisma).toContain('@@map("orders-db")');
    expect(prisma).toContain('provider = "postgresql"');
  });

  it("derives the Prisma provider from the datastore engine", () => {
    const state = fixture("minimal");
    state.nodes[0].props.engine = "mysql";
    expect(generatePrisma(state)).toContain('provider = "mysql"');

    state.nodes[0].props.engine = "sqlite";
    expect(generatePrisma(state)).toContain('provider = "sqlite"');
  });

  it("generates Prisma models with typed fields and relation scalars", () => {
    const prisma = generatePrisma(fixture("domain"));
    expect(prisma).toContain("model Order {");
    expect(prisma).toMatch(/total\s+Decimal/);
    expect(prisma).toMatch(/status\s+String/);
    expect(prisma).toContain("userId String?");
    expect(prisma).toContain("@@index([userId])");
    expect(prisma).toContain("model User {");
    expect(prisma).toMatch(/email\s+String\s+@unique/);
  });

  it("generates a parseable AsyncAPI document with one channel per queue", () => {
    const doc = YAML.parse(generateAsyncAPI(fixture("ecommerce"))) as any;
    expect(doc.asyncapi).toBe("2.6.0");
    expect(doc.channels["domain-events"]).toBeDefined();
    expect(doc.channels["domain-events"].publish).toBeDefined();
    expect(doc.channels["domain-events"].subscribe.operationId).toBe("consume_domain_events");
    expect(doc.components.messages.DomainEventsEvent).toBeDefined();
  });

  it("generates a Mermaid flowchart with typed nodes and edges", () => {
    const mermaid = generateMermaid(fixture("ecommerce"));
    expect(mermaid.startsWith("flowchart LR")).toBe(true);
    expect(mermaid).toContain("n_svc_1");
    expect(mermaid).toContain("-->|sql|");
    expect(mermaid).toContain("classDef service");
  });

  it("keeps colliding service names distinct in generated contracts", () => {
    const state: ArchState = {
      version: 1,
      nodes: [
        { id: "a", kind: "service", name: "Orders API", props: {} },
        { id: "b", kind: "service", name: "Orders API", props: {} },
      ],
      edges: [],
      decisions: [],
      entities: [],
    };
    const doc = YAML.parse(generateOpenAPI31(state)) as any;
    expect(Object.keys(doc.paths)).toContain("/orders-api/health");
    expect(Object.keys(doc.paths)).toContain("/orders-api-2/health");
  });
});

describe("documentation generator", () => {
  it("produces the agent package documents and one ADR per decision", () => {
    const state = fixture("ecommerce");
    const packets = buildTaskPackets(state);
    const docs = generateDocs(state, packets);

    expect(docs["ARCHITECTURE.md"]).toContain("## Diagram");
    expect(docs["WHITEPAPER.md"]).toContain("## Delivery plan");
    expect(docs["TASKS.md"]).toContain("| ID | Task |");
    expect(docs[".cursorrules"]).toContain("Do not read the whole repository");
    expect(docs["AGENTS.md"]).toContain("Agent guide");
    expect(Object.keys(docs).filter((file) => file.startsWith("adr/"))).toHaveLength(2);
  });

  it("documents the domain model in the architecture and whitepaper", () => {
    const state = fixture("domain");
    const packets = buildTaskPackets(state);
    const docs = generateDocs(state, packets);

    expect(docs["ARCHITECTURE.md"]).toContain("## Domain model");
    expect(docs["ARCHITECTURE.md"]).toContain("| ent-order | Order | svc-1 | db-1 |");
    expect(docs["WHITEPAPER.md"]).toContain("## Technology stack");
    expect(docs["WHITEPAPER.md"]).toContain("**Order**");
    expect(docs["TASKS.md"]).toContain("pnpm install");
  });
});
