import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectStore, SCHEMA_VERSION } from "../src/store";

describe("project store schema", () => {
  it("stamps the schema version and keeps an existing file usable", () => {
    const directory = mkdtempSync(join(tmpdir(), "store-schema-"));
    try {
      const path = join(directory, "projects.sqlite");
      const first = createProjectStore({ path });
      expect(first.schemaVersion).toBe(SCHEMA_VERSION);
      const project = first.createProject("Keep me");

      const reopened = createProjectStore({ path });
      expect(reopened.schemaVersion).toBe(SCHEMA_VERSION);
      expect(reopened.getProject(project.id)?.name).toBe("Keep me");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
