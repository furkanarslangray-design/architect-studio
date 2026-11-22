import { en, type MessageKey } from "./locales/en";
import { tr } from "./locales/tr";
import { de } from "./locales/de";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { pt } from "./locales/pt";
import { ja } from "./locales/ja";
import { zh } from "./locales/zh";

export const LOCALES = ["tr", "en", "de", "es", "fr", "pt", "ja", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  pt: "Português",
  ja: "日本語",
  zh: "中文",
};

export const catalogs: Record<Locale, Record<MessageKey, string>> = { tr, en, de, es, fr, pt, ja, zh };

export type { MessageKey };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Accepts an exact locale, a BCP-47 tag (de-DE), or an Accept-Language header
 * (fr-CA,fr;q=0.9,en;q=0.8) and returns the best supported locale.
 */
export function normalizeLocale(value: string | undefined | null, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (!value) return fallback;
  const candidates = value
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean);
  for (const candidate of candidates) {
    const base = candidate.split("-")[0];
    if (isLocale(base)) return base;
  }
  return fallback;
}

export interface TranslateVars {
  [key: string]: string | number | undefined;
}

export function t(locale: Locale, key: MessageKey, vars: TranslateVars = {}): string {
  const catalog = catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
  const template = catalog[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function messagesFor(locale: Locale): Record<MessageKey, string> {
  return catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
}

export function localeNames(): Array<{ id: Locale; label: string }> {
  return LOCALES.map((id) => ({ id, label: LOCALE_LABELS[id] }));
}
