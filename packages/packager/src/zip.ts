import { createHash } from "node:crypto";
import JSZip from "jszip";
import { PassThrough, Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ZipStream {
  /** Compressed archive size in bytes, measured without buffering the archive. */
  sizeBytes: number;
  /** SHA-256 of the exact archive bytes; identical inputs give an identical hash. */
  sha256: string;
  /** Creates a fresh readable archive stream. Safe to call more than once. */
  stream: () => Readable;
}

export type ZipCompression = "store" | "deflate";

export interface ZipOptions {
  compression?: ZipCompression;
}

/**
 * Fixed entry timestamp. ZIP stores MS-DOS local time, so a real clock would make
 * two otherwise identical packages differ byte for byte.
 */
const FIXED_DATE = new Date("1980-01-01T00:00:00Z");
const FIXED_MODE = 0o644;

/**
 * Builds the archive lazily. The archive is never held in memory as a single
 * buffer: size and hash are measured through a counting sink and consumers
 * receive a Node stream that backpressure can throttle.
 */
export async function createZipStream(files: Record<string, string>, options: ZipOptions = {}): Promise<ZipStream> {
  const compression = options.compression ?? "deflate";
  const measured = await measureZip(files, compression);
  return {
    sizeBytes: measured.sizeBytes,
    sha256: measured.sha256,
    stream: () => generateStream(files, compression),
  };
}

function generateStream(files: Record<string, string>, compression: ZipCompression): Readable {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    zip.file(path, content, { date: FIXED_DATE, unixPermissions: FIXED_MODE, createFolders: false });
  }
  // JSZip bundles its own readable-stream implementation which is pipeable but
  // not async-iterable. Bridge it to a Node core PassThrough so consumers get a
  // normal modern Readable with backpressure and for-await support.
  const source = zip.generateNodeStream({
    type: "nodebuffer",
    streamFiles: true,
    platform: "UNIX",
    compression: compression === "store" ? "STORE" : "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const output = new PassThrough();
  source.on("error", (error: Error) => output.destroy(error));
  source.pipe(output);
  return output;
}

async function measureZip(
  files: Record<string, string>,
  compression: ZipCompression,
): Promise<{ sizeBytes: number; sha256: string }> {
  let size = 0;
  const hash = createHash("sha256");
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback();
    },
  });
  await pipeline(generateStream(files, compression), sink);
  return { sizeBytes: size, sha256: hash.digest("hex") };
}
