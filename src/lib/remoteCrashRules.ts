import type { Language } from "../i18n";
import type { AnalyzerRule, LogAnalyzerSeverity } from "./logAnalyzer";
import { buildLauncherNewsUrls, fetchFirstAvailableMirror } from "./remoteMirrors";

const RULES_FILE = "crash-rules.json";
const SUPPORTED_VERSION = 1;
const CACHE_KEY = "launcher_crash_rules_v1";
const REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_RULES = 200;
const MAX_PATTERN_LENGTH = 600;
const SEVERITIES: LogAnalyzerSeverity[] = ["error", "warning", "info"];

type RuleText = { title: string; fix: string };

type RemoteRuleSpec = {
  id: string;
  severity: LogAnalyzerSeverity;
  pattern: string;
  flags?: string;
  exclude?: string;
  anyLevel?: boolean;
  strict?: boolean;
  subjectGroup?: number;
  text: Partial<Record<Language, RuleText>>;
};

type CachedRules = { fetchedAt: number; rules: RemoteRuleSpec[] };

let memory: CachedRules | null = null;
let inflight: Promise<CachedRules | null> | null = null;

function looksSafe(source: string): boolean {
  if (source.length > MAX_PATTERN_LENGTH) return false;
  return !/\([^()]*[+*][^()]*\)\s*[+*{]/.test(source);
}

function compile(source: string | undefined, flags: string | undefined): RegExp | null {
  if (!source || !looksSafe(source)) return null;
  const cleanFlags = (flags ?? "i").replace(/[^imsu]/g, "");
  try {
    return new RegExp(source, cleanFlags);
  } catch {
    return null;
  }
}

function asText(value: unknown): RuleText | null {
  if (!value || typeof value !== "object") return null;
  const { title, fix } = value as Record<string, unknown>;
  if (typeof title !== "string" || typeof fix !== "string") return null;
  if (!title.trim() || !fix.trim()) return null;
  return { title: title.trim(), fix: fix.trim() };
}

function sanitize(raw: unknown): RemoteRuleSpec[] {
  if (!raw || typeof raw !== "object") return [];
  const doc = raw as { version?: unknown; rules?: unknown };
  if (doc.version !== SUPPORTED_VERSION || !Array.isArray(doc.rules)) return [];

  const out: RemoteRuleSpec[] = [];
  const seen = new Set<string>();
  for (const item of doc.rules.slice(0, MAX_RULES)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!/^[\w.-]{2,64}$/.test(id) || seen.has(id)) continue;
    const severity = SEVERITIES.includes(r.severity as LogAnalyzerSeverity)
      ? (r.severity as LogAnalyzerSeverity)
      : "error";
    const pattern = typeof r.pattern === "string" ? r.pattern : "";
    const flags = typeof r.flags === "string" ? r.flags : undefined;
    if (!compile(pattern, flags)) continue;
    const exclude = typeof r.exclude === "string" ? r.exclude : undefined;
    if (exclude && !compile(exclude, flags)) continue;

    const text: Partial<Record<Language, RuleText>> = {};
    const rawText = (r.text ?? {}) as Record<string, unknown>;
    for (const lang of ["ru", "en", "de", "es"] as Language[]) {
      const t = asText(rawText[lang]);
      if (t) text[lang] = t;
    }
    if (!text.ru && !text.en) continue;

    const group = Number(r.subjectGroup);
    seen.add(id);
    out.push({
      id,
      severity,
      pattern,
      flags,
      exclude,
      anyLevel: r.anyLevel === true,
      strict: r.strict === true,
      subjectGroup: Number.isInteger(group) && group > 0 && group < 10 ? group : undefined,
      text,
    });
  }
  return out;
}

function readCache(): CachedRules | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRules;
    if (typeof parsed?.fetchedAt !== "number" || !Array.isArray(parsed.rules)) return null;
    return { fetchedAt: parsed.fetchedAt, rules: sanitize({ version: SUPPORTED_VERSION, rules: parsed.rules }) };
  } catch {
    return null;
  }
}

function writeCache(value: CachedRules) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
  }
}

async function refresh(): Promise<CachedRules | null> {
  try {
    const res = await fetchFirstAvailableMirror(buildLauncherNewsUrls(RULES_FILE));
    const rules = sanitize(await res.json());
    const next = { fetchedAt: Date.now(), rules };
    memory = next;
    writeCache(next);
    return next;
  } catch {
    const stale = memory ?? readCache() ?? { fetchedAt: 0, rules: [] };
    memory = { ...stale, fetchedAt: Date.now() };
    return memory;
  }
}

export function loadRemoteCrashRules(): Promise<RemoteRuleSpec[]> {
  memory ??= readCache();
  const fresh = memory && Date.now() - memory.fetchedAt < REFRESH_MS;
  if (fresh) return Promise.resolve(memory!.rules);
  inflight ??= refresh().finally(() => {
    inflight = null;
  });
  return memory ? Promise.resolve(memory.rules) : inflight.then((v) => v?.rules ?? []);
}

export function toAnalyzerRules(specs: RemoteRuleSpec[], language: Language): AnalyzerRule[] {
  const rules: AnalyzerRule[] = [];
  for (const spec of specs) {
    const pattern = compile(spec.pattern, spec.flags);
    if (!pattern) continue;
    const exclude = spec.exclude ? compile(spec.exclude, spec.flags) ?? undefined : undefined;
    const text = spec.text[language] ?? spec.text.en ?? spec.text.ru;
    if (!text) continue;
    const group = spec.subjectGroup;
    rules.push({
      id: spec.id,
      severity: spec.severity,
      pattern,
      exclude,
      anyLevel: spec.anyLevel,
      strict: spec.strict,
      text,
      inspect: group
        ? (_line, m) => {
            const subject = m[group]?.trim();
            return subject ? { subject: subject.slice(0, 120) } : {};
          }
        : undefined,
    });
  }
  return rules;
}

export type { RemoteRuleSpec };
