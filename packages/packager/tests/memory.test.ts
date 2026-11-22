import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface MemoryProfile {
  payloadBytes: number;
  sizeBytes: number;
  streamed: number;
  maxChunk: number;
  peakLive: number;
}

/**
 * Runs the ZIP producer in a child process with --expose-gc so live heap can be
 * sampled deterministically instead of relying on V8's lazy collection.
 */
function profileZip(files: number, fileSize: number): MemoryProfile {
  const moduleUrl = pathToFileURL(join(process.cwd(), "packages/packager/src/zip.ts")).href;
  const script = `
(async () => {
  const { createZipStream } = await import(${JSON.stringify(moduleUrl)});
  const { Writable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const crypto = await import("node:crypto");
  const files = {};
  for (let index = 0; index < ${files}; index += 1) {
    files["data/file-" + index + ".txt"] = crypto.randomBytes(${fileSize}).toString("base64");
  }
  const payloadBytes = Object.values(files).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  const zip = await createZipStream(files);
  if (global.gc) global.gc();
  const baseline = process.memoryUsage().heapUsed;
  let streamed = 0;
  let maxChunk = 0;
  let peakLive = 0;
  let chunks = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      streamed += chunk.length;
      maxChunk = Math.max(maxChunk, chunk.length);
      chunks += 1;
      if (global.gc && chunks % 8 === 0) {
        global.gc();
        peakLive = Math.max(peakLive, process.memoryUsage().heapUsed - baseline);
      }
      callback();
    },
  });
  await pipeline(zip.stream(), sink);
  if (global.gc) {
    global.gc();
    peakLive = Math.max(peakLive, process.memoryUsage().heapUsed - baseline);
  }
  console.log(JSON.stringify({ payloadBytes, sizeBytes: zip.sizeBytes, streamed, maxChunk, peakLive }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

  const raw = execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", "-e", script], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  return JSON.parse(raw.trim().split("\n").pop() ?? "{}") as MemoryProfile;
}

describe("ZIP memory profile", () => {
  it("streams a 24 MB package with a small, bounded live heap", () => {
    const profile = profileZip(96, 256 * 1024);
    expect(profile.payloadBytes).toBeGreaterThan(20 * 1024 * 1024);
    expect(profile.sizeBytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(profile.streamed).toBe(profile.sizeBytes);
    // A buffered implementation would hold the whole archive live; streaming
    // must stay well below half of it.
    expect(profile.peakLive).toBeLessThan(profile.payloadBytes / 2);
    expect(profile.maxChunk).toBeLessThan(4 * 1024 * 1024);
  }, 120_000);

  it("keeps memory flat as the package grows", () => {
    const small = profileZip(8, 256 * 1024);
    const large = profileZip(96, 256 * 1024);
    expect(large.payloadBytes).toBeGreaterThan(small.payloadBytes * 6);
    // Twelve times the payload must not translate into a proportional live heap.
    expect(large.peakLive).toBeLessThan(small.peakLive + large.payloadBytes / 2);
  }, 180_000);
});
