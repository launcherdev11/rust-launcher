export type Language = "ru" | "en";

type Dict = Record<string, unknown>;

import ru from "../locales/ru.json";
import en from "../locales/en.json";

const dictionaries: Record<Language, Dict> = { ru: ru as Dict, en: en as Dict };

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
