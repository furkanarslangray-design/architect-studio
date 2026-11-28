import { describe, expect, it } from "vitest";
import {
  catalogs,
  DEFAULT_LOCALE,
  isLocale,
  LOCALES,
  messagesFor,
  normalizeLocale,
  t,
} from "../src/i18n";
import { buildTaskPackets } from "../src/task-packet";
import { buildPackage } from "@architect-studio/packager";
import { parseState } from "../src/state";

const state = parseState({
  version: 1,
  nodes: [
    { id: "svc", kind: "service", name: "Orders API", props: { framework: "fastify" } },
    { id: "db", kind: "database", name: "Orders DB", props: { engine: "postgres" } },
  ],
  edges: [{ id: "e1", from: "svc", to: "db", protocol: "sql" }],
  entities: [
    {
      id: "ent-order",
      name: "Order",
      serviceId: "svc",
      databaseId: "db",
      fields: [
        { name: "id", type: "uuid", required: true, primary: true },
        { name: "total", type: "decimal", required: true },
      ],
    },
  ],
  decisions: [
    {
      id: "adr-001",
      title: "Use PostgreSQL",
      context: "Relational orders",
      decision: "Use PostgreSQL",
      alternatives: ["SQLite"],
    },
  ],
});

const placeholderNames = (value: string) =>
  Array.from(new Set(Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]))).sort();

describe("i18n catalogs", () => {
  it("ships all eight locales with complete, non-empty dictionaries", () => {
    expect([...LOCALES].sort()).toEqual(["de", "en", "es", "fr", "ja", "pt", "tr", "zh"]);
    const keys = Object.keys(catalogs.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(catalogs[locale]).sort(), `${locale} key parity`).toEqual(keys);
      for (const [key, value] of Object.entries(catalogs[locale])) {
        expect(value.trim(), `${locale}.${key} is empty`).not.toBe("");
        expect(placeholderNames(value), `${locale}.${key} placeholders`).toEqual(
          placeholderNames(catalogs.en[key as keyof typeof catalogs.en]),
        );
      }
    }
  });

  it("normalizes locale tags and Accept-Language headers", () => {
    expect(normalizeLocale("de-DE")).toBe("de");
    expect(normalizeLocale("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh");
    expect(normalizeLocale("xx-YY")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe("en");
    expect(normalizeLocale("tr")).toBe("tr");
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("ko")).toBe(false);
  });

  it("interpolates variables and falls back to English for missing translations", () => {
    expect(t("tr", "error.invalidIdea")).toContain("3");
    expect(t("de", "docs.packet.verify", { command: "pnpm test" })).toContain("pnpm test");
    expect(t("ja", "docs.manifest.outsideTarget", { count: 2, names: "a, b" })).toContain("2");
  });
});

describe("localized artifact generation", () => {
  it("produces valid Turkish documentation and task packets", async () => {
    const result = await buildPackage(state, { locale: "tr" });
    expect(result.validation.issues).toEqual([]);
    expect(result.validation.ok).toBe(true);
    expect(result.files["ARCHITECTURE.md"]).toContain(t("tr", "docs.architecture.title"));
    expect(result.files["TASKS.md"]).toContain(t("tr", "docs.tasks.title"));
    expect(result.files["AGENTS.md"]).toContain(t("tr", "docs.agents.title"));
    expect(result.files["adr/ADR-001-use-postgresql.md"]).toContain(t("tr", "docs.adr.status"));
    for (const packet of result.packets) {
      expect(result.files[`tasks/${packet.id}.md`]).toContain(packet.id);
    }
  });

  it("localizes every document, index and manifest for all eight locales", async () => {
    for (const locale of LOCALES) {
      const packets = buildTaskPackets(state, { locale });
      const result = await buildPackage(state, { locale });
      const docs = result.files;

      expect(docs["ARCHITECTURE.md"]).toContain(t(locale, "docs.architecture.title"));
      expect(docs["WHITEPAPER.md"]).toContain(t(locale, "docs.whitepaper.title"));
      expect(docs["TASKS.md"]).toContain(t(locale, "docs.tasks.title"));
      expect(docs["AGENTS.md"]).toContain(t(locale, "docs.agents.title"));
      expect(docs["MANIFEST.md"]).toContain(t(locale, "docs.manifest.title"));
      expect(docs["TASKS.md"]).toContain(packets[0].id);
      expect(result.validation.issues, `${locale} validation`).toEqual([]);

      if (locale !== "en") {
        expect(docs["ARCHITECTURE.md"]).not.toContain("## Components");
        expect(docs["TASKS.md"]).not.toContain("| ID | Task |");
      }
    }
  });

  it("records the localized catalog through the messages helper", () => {
    for (const locale of LOCALES) {
      expect(messagesFor(locale)["ui.preview"]).toBe(catalogs[locale]["ui.preview"]);
    }
  });
});
