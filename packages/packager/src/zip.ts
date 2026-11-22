import JSZip from "jszip";
import { PassThrough, Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ZipStream {
  /** Compressed archive size in bytes, measured without buffering the archive. */
  sizeBytes: number;
  /** Creates a fresh readable archive stream. Safe to call more than once. */
  stream: () => Readable;
}

/**
 * Builds the archive lazily. The archive is never held in memory as a single
 * buffer: size is measured through a counting sink and consumers receive a
 * Node stream that backpressure can throttle.
 */
export async function createZipStream(files: Record<string, string>): Promise<ZipStream> {
  const sizeBytes = await measureZip(files);
  return {
    sizeBytes,
    stream: () => generateStream(files),
  };
}

function generateStream(files: Record<string, string>): Readable {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    zip.file(path, content);
  }
  // JSZip bundles its own readable-stream implementation which is pipeable but
  // not async-iterable. Bridge it to a Node core PassThrough so consumers get a
  // normal modern Readable with backpressure and for-await support.
  const source = zip.generateNodeStream({
    type: "nodebuffer",
    streamFiles: true,
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const output = new PassThrough();
  source.on("error", (error: Error) => output.destroy(error));
  source.pipe(output);
  return output;
}

async function measureZip(files: Record<string, string>): Promise<number> {
  let size = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback();
    },
  });
  await pipeline(generateStream(files), sink);
  return size;
}
