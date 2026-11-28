import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateState } from "@architect-studio/core";
import { repoToState } from "../src";

const scratch = mkdtempSync(join(tmpdir(), "reverse-openapi-"));

function write(root: string, path: string, content: string) {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("OpenAPI reverse engineering", () => {
  it("turns components.schemas into entities with types and relations", () => {
    const root = join(scratch, "billing");
    write(root, "package.json", JSON.stringify({ name: "billing", dependencies: { express: "^4.19.0" } }));
    write(
      root,
      "openapi.yaml",
      `openapi: 3.0.3
info: { title: Billing, version: "1.0.0" }
paths: {}
components:
  schemas:
    User:
      type: object
      required: [id, email]
      properties:
        id: { type: string, format: uuid }
        email: { type: string }
        createdAt: { type: string, format: date-time }
    Order:
      type: object
      properties:
        id: { type: string, format: uuid }
        total: { type: number, format: decimal }
        quantity: { type: integer }
        paid: { type: boolean }
        metadata: { type: object }
        user: { $ref: "#/components/schemas/User" }
`,
    );

    const result = repoToState(root);
    const names = result.state.entities.map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(["User", "Order"]));
    expect(validateState(result.state)).toEqual([]);

    const user = result.state.entities.find((entity) => entity.name === "User")!;
    expect(user.fields.find((field) => field.name === "id")!.type).toBe("uuid");
    expect(user.fields.find((field) => field.name === "id")!.primary).toBe(true);
    expect(user.fields.find((field) => field.name === "email")!.required).toBe(true);
    expect(user.fields.find((field) => field.name === "createdAt")!.type).toBe("datetime");

    const order = result.state.entities.find((entity) => entity.name === "Order")!;
    const fieldTypes = Object.fromEntries(order.fields.map((field) => [field.name, field.type]));
    expect(fieldTypes).toMatchObject({ total: "decimal", quantity: "int", paid: "boolean", metadata: "json" });
    expect(order.relations).toEqual([{ target: user.id, field: "userId" }]);
    expect(order.databaseId).toBeDefined();
  });

  it("reads Swagger JSON definitions too", () => {
    const root = join(scratch, "legacy");
    write(root, "package.json", JSON.stringify({ name: "legacy", dependencies: { express: "^4.19.0" } }));
    write(
      root,
      "swagger.json",
      JSON.stringify({
        swagger: "2.0",
        definitions: {
          Invoice: {
            type: "object",
            properties: { id: { type: "string", format: "uuid" }, amount: { type: "number" } },
          },
        },
      }),
    );
    const result = repoToState(root);
    const invoice = result.state.entities.find((entity) => entity.name === "Invoice")!;
    expect(invoice.fields.map((field) => field.name)).toEqual(["id", "amount"]);
    expect(invoice.fields[1].type).toBe("float");
  });
});
