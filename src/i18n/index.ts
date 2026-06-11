export type Language = "ru" | "en" | "de" | "es";

export const SUPPORTED_LANGUAGES: Language[] = ["ru", "en", "de", "es"];

export function isLanguage(value: string): value is Language {
  return (SUPPORTED_LANGUAGES as string[]).includes(value);
}

export function readStoredLanguage(): Language | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem("launcher_language");
    if (saved && isLanguage(saved)) return saved;
  } catch {
  }
  return null;
}

type Dict = Record<string, unknown>;

import ru from "../locales/ru.json";
import en from "../locales/en.json";
import de from "../locales/de.json";
import es from "../locales/es.json";

const dictionaries: Record<Language, Dict> = {
  ru: ru as Dict,
  en: en as Dict,
  de: de as Dict,
  es: es as Dict,
};

function getByPath(dict: Dict, path: string): string | null {
  const parts = path.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "string" ? cur : null;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

export function t(
  lang: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const dict = dictionaries[lang] ?? dictionaries.ru;
  const fallbackDict = dictionaries.ru;

  const raw = getByPath(dict, key) ?? getByPath(fallbackDict, key) ?? key;
  return interpolate(raw, vars);
}

export function useT(lang: Language) {
  return (key: string, vars?: Record<string, string | number>) => t(lang, key, vars);
}

export function localeTag(lang: Language): string {
  switch (lang) {
    case "ru":
      return "ru-RU";
    case "de":
      return "de-DE";
    case "es":
      return "es-ES";
    default:
      return "en-US";
  }
}

const BYTE_UNIT_KEYS = [
  "settings.launcher.cache.bytes",
  "settings.launcher.cache.kb",
  "settings.launcher.cache.mb",
  "settings.launcher.cache.gb",
] as const;

export function formatByteSize(
  lang: Language,
  bytes: number,
  options?: { zeroAt?: "bytes" | "megabytes" },
): string {
  const zeroAt = options?.zeroAt ?? "megabytes";
  if (!Number.isFinite(bytes) || bytes <= 0) {
    const key = zeroAt === "bytes" ? BYTE_UNIT_KEYS[0] : BYTE_UNIT_KEYS[2];
    return t(lang, key, { value: "0" });
  }
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < BYTE_UNIT_KEYS.length - 1) {
    value /= 1024;
    i += 1;
  }
  return t(lang, BYTE_UNIT_KEYS[i], {
    value: value.toFixed(i === 0 ? 0 : 1),
  });
}

export function formatPlaytimeShort(lang: Language, seconds: number | null): string {
  const s =
    seconds != null && Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return t(lang, "common.format.playtimeHoursMinutes", { h, m });
  return t(lang, "common.format.playtimeMinutes", { m });
}

export function formatPlaytimeDetailed(lang: Language, seconds: number | null): string {
  const s =
    seconds != null && Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(t(lang, "common.format.playtimeDays", { d }));
  if (h > 0) parts.push(t(lang, "common.format.playtimeHours", { h }));
  if (m > 0 || (d === 0 && h === 0)) parts.push(t(lang, "common.format.playtimeMinutesLong", { m }));
  if (s < 3600) parts.push(t(lang, "common.format.playtimeSeconds", { s: sec }));
  return parts.length > 0 ? parts.join(" ") : t(lang, "common.format.playtimeZero");
}
