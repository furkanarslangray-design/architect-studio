import JSZip from "jszip";

export async function zipFiles(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    zip.file(path, content);
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
