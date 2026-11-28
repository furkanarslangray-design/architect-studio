import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { parseState } from "@architect-studio/core";
import { buildPackage, createZipStream } from "../src";

function fixture() {
  return parseState(
    JSON.parse(readFileSync(join(__dirname, "../../generators/tests/fixtures", "ecommerce.json"), "utf8")),
  );
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sha(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

afterEach(() => {
  delete process.env.REPRODUCIBLE;
});

describe("reproducible packages", () => {
  it("gives two successive builds the same SHA-256 and the same bytes", async () => {
    const state = fixture();
    const first = await buildPackage(state, { reproducible: true });
    const second = await buildPackage(state, { reproducible: true });

    const firstBytes = await collect(first.zip.stream());
    const secondBytes = await collect(second.zip.stream());

    expect(second.zip.sha256).toBe(first.zip.sha256);
    expect(second.zip.sizeBytes).toBe(first.zip.sizeBytes);
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(firstBytes.length).toBe(first.zip.sizeBytes);
    expect(first.zip.sha256).toBe(sha(firstBytes));
  });

  it("pins entry timestamps and permissions so archives do not drift with the clock", async () => {
    const result = await buildPackage(fixture(), { reproducible: true });
    const zip = await JSZip.loadAsync(await collect(result.zip.stream()));
    for (const entry of Object.values(zip.files)) {
      expect(entry.date.toISOString()).toBe("1980-01-01T00:00:00.000Z");
    }
    expect(zip.file("TASKS.md")!.unixPermissions).toBe(0o644);
  });

  it("is stable in both store and deflate profiles", async () => {
    const result = await buildPackage(fixture(), { reproducible: true });
    for (const compression of ["store", "deflate"] as const) {
      const a = await createZipStream(result.files, { compression });
      const b = await createZipStream(result.files, { compression });
      const aBytes = await collect(a.stream());
      const bBytes = await collect(b.stream());
      expect(b.sha256).toBe(a.sha256);
      expect(aBytes.equals(bBytes)).toBe(true);
      expect(a.sha256).toBe(sha(aBytes));
    }

    const stored = await createZipStream(result.files, { compression: "store" });
    const deflated = await createZipStream(result.files, { compression: "deflate" });
    expect(stored.sizeBytes).toBeGreaterThan(deflated.sizeBytes);
    expect(stored.sha256).not.toBe(deflated.sha256);
  });

  it("honours REPRODUCIBLE=1 when no option is passed", async () => {
    process.env.REPRODUCIBLE = "1";
    const state = fixture();
    const first = await buildPackage(state);
    const second = await buildPackage(state);
    expect(second.zip.sha256).toBe(first.zip.sha256);
    expect(first.files["metrics.json"]).toContain('"state_to_package_ms"');
    expect(first.metrics.find((metric) => metric.name === "state_to_package_ms")!.value).toBe(0);
  });

  it("keeps validation and metrics green in reproducible mode", async () => {
    const result = await buildPackage(fixture(), { reproducible: true });
    expect(result.metrics.filter((metric) => !metric.pass)).toEqual([]);
    expect(result.validation.ok).toBe(true);
  });
});
