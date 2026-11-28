import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("studio UI", () => {
  it("serves the shell at / with a same-origin CSP and no-store cache", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");

    const html = await response.text();
    expect(html).toContain('src="/app.js"');
    expect(html).toContain('href="/styles.css"');
    expect(html).toContain('src="/vendor/mermaid.min.js"');
    expect(html).not.toMatch(/(?:src|href)="https?:\/\//);
    expect(html).toContain('id="preview-btn"');
    expect(html).toContain('id="toast-host"');
    expect(html).toContain('aria-live="polite"');
  });

  it("serves the client bundle and styles with the documented content types", async () => {
    const script = await fetch(`${baseUrl}/app.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(script.headers.get("cache-control")).toBe("no-store");

    const styles = await fetch(`${baseUrl}/styles.css`);
    expect(styles.status).toBe(200);
    expect(styles.headers.get("content-type")).toBe("text/css; charset=utf-8");

    const vendor = await fetch(`${baseUrl}/vendor/mermaid.min.js`);
    expect(vendor.status).toBe(200);
    expect(vendor.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(vendor.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("covers every screen and keeps the API key out of persistent storage", () => {
    const html = read("web/index.html");
    for (const view of [
      "composer",
      "architecture",
      "chat",
      "tasks",
      "metrics",
      "artifacts",
      "reverse",
      "sandbox",
      "settings",
      "status",
    ]) {
      expect(html).toContain(`id="view-${view}"`);
    }
    const app = read("web/app.js");
    expect(app).not.toMatch(/localStorage[^\n]*apiKey/i);
    expect(app).not.toMatch(/sessionStorage/);
    expect(app).toContain("/api/preview");
    expect(app).toContain("/api/chat");
    expect(app).toContain("/api/generate");
    expect(app).toContain("/api/reverse/jobs");
    expect(app).toContain("/api/sandbox");
    expect(app).toContain("/api/i18n");
    expect(app).toContain("EventSource");
    expect(app).toContain("prefers-color-scheme");
  });

  it("keeps the palette and layout tokens from the spec", () => {
    const css = read("web/styles.css");
    for (const token of ["#0a0e14", "#4cc2ff", "#3ddc97", "#ffb454", "#8f9bff", "#ff7ac6", "#f7f9fc"]) {
      expect(css.toLowerCase()).toContain(token);
    }
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("outline: 2px solid var(--accent)");
  });
});
