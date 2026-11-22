import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseState, type ArchState } from "../../core/src/state";
import { buildTaskPackets } from "../../core/src/task-packet";
import {
  generateAsyncAPI,
  generateDocs,
  generateMermaid,
  generateOpenAPI31,
  generatePrisma,
} from "../src";

function fixture(name: "minimal" | "ecommerce"): ArchState {
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
  });

  it("generates a Prisma schema with one model per database", () => {
    const prisma = generatePrisma(fixture("ecommerce"));
    expect(prisma).toContain("model OrdersDB");
    expect(prisma).toContain("model UsersDB");
    expect(prisma).toContain('@@map("orders-db")');
    expect(prisma).toContain('provider = "postgresql"');
  });

  it("generates a parseable AsyncAPI document with one channel per queue", () => {
    const doc = YAML.parse(generateAsyncAPI(fixture("ecommerce"))) as any;
    expect(doc.asyncapi).toBe("2.6.0");
    expect(doc.channels["domain-events"]).toBeDefined();
    expect(doc.channels["domain-events"].publish).toBeDefined();
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
});
