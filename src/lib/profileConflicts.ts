export type ConflictActionKind =
  | "disable_all_but"
  | "keep_latest"
  | "disable_all"
  | "disable_wrong_loader"
  | "enable";

export type ConflictAction = {
  id: string;
  label: string;
  kind: ConflictActionKind;
  keep?: string;
  targets?: string[];
};

export type ProfileConflict = {
  id: string;
  severity: "warning" | "error";
  title: string;
  reason: string;
  affected: string[];
  solutions: string[];
  category?: "duplicate" | "loader" | "incompatible" | "dependency" | "breaks";
  actions?: ConflictAction[];
};

export type JarModRelation = {
  modId: string;
  optional: boolean;
  versions?: string[];
};

export type JarNestedMod = {
  modId: string;
  version?: string | null;
};

export type JarModInfo = {
  filename: string;
  enabled: boolean;
  modId?: string | null;
  title?: string | null;
  version?: string | null;
  loader?: string | null;
  loaders?: string[];
  environment?: string | null;
  provides?: string[];
  nested?: JarNestedMod[];
  depends?: JarModRelation[];
  breaks?: JarModRelation[];
};

type Tt = (key: string, vars?: Record<string, string | number>) => string;

const PLATFORM_IDS = new Set([
  "minecraft",
  "java",
  "fabricloader",
  "fabric-loader",
  "quilt_loader",
  "quilt-loader",
  "forge",
  "neoforge",
  "mcp",
  "fabric",
  "quilt",
]);

const LOADER_BUNDLED_IDS = new Set(["mixinextras", "quilt_base", "javafml", "lowcodefml"]);

const FABRIC_ON_FORGE_BRIDGE_IDS = new Set(["connector"]);

const MAX_AFFECTED = 12;

function stripExt(s: string) {
  return s.replace(/\.(jar|zip|disabled)$/i, "").replace(/\.disabled$/i, "");
}

function extractVersionParts(filename: string): number[] | null {
  const base = stripExt(filename);
  const candidates = [...base.matchAll(/(?:^|[-_])(\d+(?:\.\d+){0,4})(?=[-_.]|$)/g)].map(
    (m) => m[1],
  );
  let best: number[] | null = null;
  for (const c of candidates) {
    const parts = c
      .split(".")
      .map((p) => Number.parseInt(p, 10))
      .filter((n) => Number.isFinite(n));
    if (parts.length === 0) continue;
    if (!best || parts.length >= best.length) best = parts;
  }
  if (best) return best;
  const m = base.match(/(\d+(?:\.\d+){0,4})/);
  if (!m) return null;
  const parts = m[1]
    .split(".")
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n));
  return parts.length > 0 ? parts : null;
}

function cmpVersionParts(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

export function pickLatestFilename(files: string[]): string | null {
  let best: { file: string; ver: number[] | null } | null = null;
  for (const f of files) {
    const ver = extractVersionParts(f);
    if (!best) {
      best = { file: f, ver };
      continue;
    }
    if (!best.ver && ver) {
      best = { file: f, ver };
      continue;
    }
    if (best.ver && ver && cmpVersionParts(best.ver, ver) < 0) {
      best = { file: f, ver };
    }
  }
  return best?.file ?? null;
}

function pickLatestByMetadata(files: string[], infoByFile: Map<string, JarModInfo>): string | null {
  let best: { file: string; ver: SemVer } | null = null;
  for (const f of files) {
    const ver = parseSemVer(infoByFile.get(f)?.version ?? "");
    if (!ver) return pickLatestFilename(files);
    if (!best || compareSemVer(ver, best.ver) > 0) best = { file: f, ver };
  }
  return best?.file ?? pickLatestFilename(files);
}

export function guessLoaderVariant(filename: string): string | null {
  const f = stripExt(filename).toLowerCase();
  if (/(^|[-_.])(neoforge)([-_.]|$)/.test(f)) return "neoforge";
  if (/(^|[-_.])(forge)([-_.]|$)/.test(f)) return "forge";
  if (/(^|[-_.])(fabric)([-_.]|$)/.test(f)) return "fabric";
  if (/(^|[-_.])(quilt)([-_.]|$)/.test(f)) return "quilt";
  return null;
}

export function guessModKey(filename: string): string {
  let base = stripExt(filename).trim().toLowerCase();
  base = base
    .replace(/(^|[-_.])(neoforge|forge|fabric|quilt|bukkit|spigot|paper)(?=[-_.]|$)/g, "$1")
    .replace(/(^|[-_.])mc\d+(?:\.\d+)*(?=[-_.]|$)/g, "$1")
    .replace(/(^|[-_.])\d+\.\d+(?:\.\d+)*(?=[-_.]|$)/g, "$1")
    .replace(/(^|[-_.])(release|beta|alpha|rc\d*|snapshot|dev|build)(?=[-_.]|$)/gi, "$1")
    .replace(/[-_.]+/g, "-")
    .replace(/^-|-$/g, "");

  const idx = base.search(/\d/);
  const raw = (idx > 2 ? base.slice(0, idx) : base).replace(/[-_.]+$/g, "");
  return raw.trim().toLowerCase();
}

function normalizeId(id: string) {
  return id.trim().toLowerCase();
}

type SemVer = { core: number[]; pre: string[] };

function parseSemVer(raw: string): SemVer | null {
  const s = raw.trim().replace(/^v/i, "").split("+")[0];
  if (!s) return null;
  const dash = s.indexOf("-");
  const coreStr = dash >= 0 ? s.slice(0, dash) : s;
  const preStr = dash >= 0 ? s.slice(dash + 1) : "";
  if (!/^\d+(?:\.\d+)*$/.test(coreStr)) return null;
  return {
    core: coreStr.split(".").map((p) => Number.parseInt(p, 10)),
    pre: preStr ? preStr.split(".") : [],
  };
}

function compareSemVer(a: SemVer, b: SemVer): number {
  const c = cmpVersionParts(a.core, b.core);
  if (c !== 0) return c;
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  const n = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < n; i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function bumpCore(v: SemVer, index: number): SemVer {
  const core = v.core.slice(0, index + 1);
  while (core.length <= index) core.push(0);
  core[index] += 1;
  return { core, pre: [""] };
}

function matchFabricTerm(term: string, version: SemVer): boolean | null {
  const m = term.trim().match(/^(>=|<=|>|<|=|~|\^)?\s*(.+)$/);
  if (!m) return null;
  const op = m[1] ?? "";
  const body = m[2].trim();
  if (body === "*" || /^[xX]$/.test(body)) return true;

  const wildcardAt = body.split(".").findIndex((p) => /^[xX*]$/.test(p));
  if (wildcardAt > 0 && (op === "" || op === "=")) {
    const floor = parseSemVer(body.split(".").slice(0, wildcardAt).join("."));
    if (!floor) return null;
    return compareSemVer(version, floor) >= 0 && compareSemVer(version, bumpCore(floor, wildcardAt - 1)) < 0;
  }

  const target = parseSemVer(body);
  if (!target) return null;
  const cmp = compareSemVer(version, target);
  switch (op) {
    case "":
    case "=":
      return cmp === 0;
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "~":
      return cmp >= 0 && compareSemVer(version, bumpCore(target, Math.min(1, target.core.length - 1))) < 0;
    case "^":
      return cmp >= 0 && compareSemVer(version, bumpCore(target, 0)) < 0;
    default:
      return null;
  }
}

function matchFabricPredicate(predicate: string, version: SemVer): boolean | null {
  const p = predicate.trim();
  if (!p || p === "*") return true;
  let unknown = false;
  for (const alt of p.split("||")) {
    let all: boolean | null = true;
    for (const term of alt.trim().split(/\s+/).filter(Boolean)) {
      const r = matchFabricTerm(term, version);
      if (r === false) {
        all = false;
        break;
      }
      if (r === null) all = null;
    }
    if (all === true) return true;
    if (all === null) unknown = true;
  }
  return unknown ? null : false;
}

function parseNumericVersion(raw: string): number[] | null {
  const s = raw.trim();
  return /^\d+(?:\.\d+)*$/.test(s) ? s.split(".").map((p) => Number.parseInt(p, 10)) : null;
}

function matchMavenRange(range: string, rawVersion: string): boolean | null {
  const r = range.trim();
  if (!r || r === "*") return true;
  if (!/^[[(]/.test(r)) return true;
  const version = parseNumericVersion(rawVersion);
  if (!version) return null;
  let unknown = false;
  for (const m of r.matchAll(/([[(])([^\])]*)([\])])/g)) {
    const [, open, inner, close] = m;
    const [lo, hi] = inner.includes(",") ? inner.split(",", 2) : [inner, inner];
    const loV = lo.trim() ? parseNumericVersion(lo) : null;
    const hiV = hi.trim() ? parseNumericVersion(hi) : null;
    if ((lo.trim() && !loV) || (hi.trim() && !hiV)) {
      unknown = true;
      continue;
    }
    const loOk = !loV || (open === "[" ? cmpVersionParts(version, loV) >= 0 : cmpVersionParts(version, loV) > 0);
    const hiOk = !hiV || (close === "]" ? cmpVersionParts(version, hiV) <= 0 : cmpVersionParts(version, hiV) < 0);
    if (loOk && hiOk) return true;
  }
  return unknown ? null : false;
}

function versionSatisfies(
  predicates: string[] | undefined,
  version: string | null | undefined,
  mavenSyntax: boolean,
): boolean | null {
  if (!predicates || predicates.length === 0) return true;
  if (!version) return null;
  let unknown = false;
  for (const p of predicates) {
    let r: boolean | null;
    if (mavenSyntax) {
      r = matchMavenRange(p, version);
    } else {
      const v = parseSemVer(version);
      r = v ? matchFabricPredicate(p, v) : null;
    }
    if (r === true) return true;
    if (r === null) unknown = true;
  }
  return unknown ? null : false;
}

function compatibleLoaders(loader: string, gameVersion: string): string[] {
  switch (loader) {
    case "forge":
      return ["forge"];
    case "neoforge":
      return gameVersion.trim() === "1.20.1" ? ["neoforge", "forge"] : ["neoforge"];
    case "fabric":
      return ["fabric"];
    case "quilt":
      return ["quilt", "fabric"];
    default:
      return [];
  }
}

function isFabricApiModule(id: string): boolean {
  return (
    id === "fabric-api" ||
    id === "fabric-api-base" ||
    /^fabric-[a-z0-9-]+-(?:api|v\d+)$/.test(id) ||
    /^fabric-[a-z0-9-]+-api-v\d+$/.test(id)
  );
}

type Provider = { file: string; version?: string | null; enabled: boolean };

function providerKey(id: string): string {
  return normalizeId(id).replace(/_/g, "-");
}

function addProvider(map: Map<string, Provider[]>, id: string | null | undefined, p: Provider) {
  if (!id) return;
  const key = providerKey(id);
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.some((x) => x.file === p.file)) list.push(p);
  map.set(key, list);
}

function displayName(info: JarModInfo | undefined, fallback: string): string {
  return info?.title?.trim() || info?.modId?.trim() || fallback;
}

export function detectProfileConflicts(opts: {
  entries: { name: string; enabled: boolean }[];
  profile: { loader?: string | null; game_version?: string | null };
  jarInfos?: JarModInfo[];
  tt: Tt;
}): ProfileConflict[] {
  const { entries, profile, jarInfos = [], tt } = opts;
  const all = (entries ?? []).filter((e) => e && e.name);
  const enabled = all.filter((e) => e.enabled);
  const conflicts: ProfileConflict[] = [];
  const claimedFilenames = new Set<string>();

  const infoByFile = new Map<string, JarModInfo>();
  for (const info of jarInfos) {
    if (info?.filename) infoByFile.set(info.filename, info);
  }
  const hasMetadata = (name: string) => !!infoByFile.get(name)?.modId;

  const loader = (profile.loader ?? "").toLowerCase();
  const gameVersion = profile.game_version ?? "";
  const accepted = compatibleLoaders(loader, gameVersion);
  const hasFabricBridge =
    (loader === "forge" || loader === "neoforge") &&
    enabled.some((e) => {
      const id = infoByFile.get(e.name)?.modId;
      return !!id && FABRIC_ON_FORGE_BRIDGE_IDS.has(normalizeId(id));
    });

  const runsOnProfileLoader = (info: JarModInfo | undefined): boolean | null => {
    if (!accepted.length) return null;
    const loaders = (info?.loaders?.length ? info.loaders : info?.loader ? [info.loader] : []).map(
      (l) => l.toLowerCase(),
    );
    if (!loaders.length) return null;
    if (loaders.some((l) => accepted.includes(l))) return true;
    if (hasFabricBridge && loaders.some((l) => l === "fabric" || l === "quilt")) return true;
    return false;
  };

  const byModId = new Map<string, string[]>();
  for (const e of enabled) {
    const info = infoByFile.get(e.name);
    if (!info?.modId || runsOnProfileLoader(info) === false) continue;
    const id = normalizeId(info.modId);
    if (!id || PLATFORM_IDS.has(id)) continue;
    const arr = byModId.get(id) ?? [];
    arr.push(e.name);
    byModId.set(id, arr);
  }

  for (const [modId, files] of byModId.entries()) {
    if (files.length < 2) continue;
    const keepLatest = pickLatestByMetadata(files, infoByFile);
    const title =
      files.map((f) => infoByFile.get(f)?.title).find((t) => t && t.trim()) || modId;
    for (const f of files) claimedFilenames.add(f);
    conflicts.push({
      id: `modid:${modId}`,
      severity: "error",
      category: "duplicate",
      title: tt("modpacks.conflicts.duplicateId.title"),
      reason: tt("modpacks.conflicts.duplicateId.reason", { name: title, id: modId }),
      affected: files.slice(0, MAX_AFFECTED),
      solutions: [
        tt("modpacks.conflicts.duplicate.solutionDisableExtra"),
        tt("modpacks.conflicts.duplicate.solutionKeepLatest"),
      ],
      actions: [
        {
          id: "disable_extra",
          label: tt("modpacks.conflicts.actions.disableExtra"),
          kind: "disable_all_but",
        },
        ...(keepLatest
          ? [
              {
                id: "keep_latest",
                label: tt("modpacks.conflicts.actions.keepLatest"),
                kind: "keep_latest" as const,
                keep: keepLatest,
              },
            ]
          : []),
      ],
    });
  }

  const byKey = new Map<string, string[]>();
  for (const e of enabled) {
    if (claimedFilenames.has(e.name) || hasMetadata(e.name)) continue;
    const key = guessModKey(e.name);
    if (!key || key.length < 3) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(e.name);
    byKey.set(key, arr);
  }

  for (const [key, files] of byKey.entries()) {
    if (files.length < 2) continue;
    const variants = new Set(files.map(guessLoaderVariant).filter((v): v is string => !!v));
    if (variants.size > 1 && loader && loader !== "vanilla") {
      conflicts.push({
        id: `mixed:${key}`,
        severity: "warning",
        category: "loader",
        title: tt("modpacks.conflicts.mixedVariants.title"),
        reason: tt("modpacks.conflicts.mixedVariants.reason", {
          variants: [...variants].join(", "),
        }),
        affected: files.slice(0, MAX_AFFECTED),
        solutions: [
          tt("modpacks.conflicts.mixedVariants.solutionKeepOne"),
          tt("modpacks.conflicts.mixedVariants.solutionUseUniversal"),
        ],
        actions: [
          {
            id: "disable_wrong",
            label: tt("modpacks.conflicts.actions.disableWrongLoader"),
            kind: "disable_wrong_loader",
          },
        ],
      });
      continue;
    }
    const keepLatest = pickLatestFilename(files);
    conflicts.push({
      id: `dup:${key}`,
      severity: "warning",
      category: "duplicate",
      title: tt("modpacks.conflicts.duplicate.title"),
      reason: tt("modpacks.conflicts.duplicate.reason", { name: key }),
      affected: files.slice(0, MAX_AFFECTED),
      solutions: [
        tt("modpacks.conflicts.duplicate.solutionDisableExtra"),
        tt("modpacks.conflicts.duplicate.solutionKeepLatest"),
      ],
      actions: [
        {
          id: "disable_extra",
          label: tt("modpacks.conflicts.actions.disableExtra"),
          kind: "disable_all_but",
        },
        ...(keepLatest
          ? [
              {
                id: "keep_latest",
                label: tt("modpacks.conflicts.actions.keepLatest"),
                kind: "keep_latest" as const,
                keep: keepLatest,
              },
            ]
          : []),
      ],
    });
  }

  const wrongLoader = new Set<string>();
  if (accepted.length) {
    const mismatch = new Map<string, { files: string[]; fromMetadata: boolean }>();
    for (const e of enabled) {
      const info = infoByFile.get(e.name);
      const runs = runsOnProfileLoader(info);
      let variant: string | null = null;
      let fromMetadata = false;
      if (runs === false) {
        variant = (info?.loaders?.length ? info.loaders : [info?.loader ?? ""]).join("/");
        fromMetadata = true;
      } else if (runs === null && !hasMetadata(e.name)) {
        const guess = guessLoaderVariant(e.name);
        const guessRuns =
          !guess ||
          accepted.includes(guess) ||
          (hasFabricBridge && (guess === "fabric" || guess === "quilt"));
        if (!guessRuns) variant = guess;
      }
      if (!variant) continue;
      if (fromMetadata) wrongLoader.add(e.name);
      const key = `${variant}|${fromMetadata ? "meta" : "name"}`;
      const group = mismatch.get(key) ?? { files: [], fromMetadata };
      group.files.push(e.name);
      mismatch.set(key, group);
    }

    for (const [key, group] of mismatch.entries()) {
      const variant = key.split("|")[0];
      conflicts.push({
        id: `loader:${key}`,
        severity: "warning",
        category: "loader",
        title: tt("modpacks.conflicts.loaderMismatch.title"),
        reason: tt(
          group.fromMetadata
            ? "modpacks.conflicts.loaderMismatch.reasonMeta"
            : "modpacks.conflicts.loaderMismatch.reason",
          { loader, variants: variant },
        ),
        affected: group.files.slice(0, MAX_AFFECTED),
        solutions: [
          tt("modpacks.conflicts.loaderMismatch.solutionPickCorrect", { loader }),
          tt("modpacks.conflicts.loaderMismatch.solutionSwitchLoader"),
        ],
        actions: [
          {
            id: "disable_all",
            label: tt("modpacks.conflicts.actions.disableAll"),
            kind: "disable_all",
          },
        ],
      });
    }
  }

  const providers = new Map<string, Provider[]>();
  for (const e of all) {
    const info = infoByFile.get(e.name);
    if (!info || wrongLoader.has(e.name)) continue;
    const base = { file: e.name, enabled: e.enabled };
    addProvider(providers, info.modId, { ...base, version: info.version });
    for (const p of info.provides ?? []) addProvider(providers, p, { ...base, version: info.version });
    for (const n of info.nested ?? []) addProvider(providers, n.modId, { ...base, version: n.version });
  }
  const allProviders = (id: string) => providers.get(providerKey(id)) ?? [];
  const enabledProviders = (id: string) => allProviders(id).filter((p) => p.enabled);
  const isFabricApiPresent = enabledProviders("fabric-api").length > 0;

  const activeInfos: JarModInfo[] = [];
  for (const e of enabled) {
    const info = infoByFile.get(e.name);
    if (!info || wrongLoader.has(e.name)) continue;
    if ((info.environment ?? "").toLowerCase() === "server") continue;
    activeInfos.push(info);
  }

  const missingByDep = new Map<string, string[]>();
  const disabledByDep = new Map<string, { dependents: string[]; targets: string[] }>();
  const wrongVersionByDep = new Map<
    string,
    { dependents: string[]; required: Set<string>; installed: Set<string> }
  >();

  for (const info of activeInfos) {
    const maven = info.loader === "forge" || info.loader === "neoforge";
    for (const dep of info.depends ?? []) {
      if (!dep?.modId || dep.optional) continue;
      const id = normalizeId(dep.modId);
      if (!id || PLATFORM_IDS.has(id) || LOADER_BUNDLED_IDS.has(id)) continue;

      const present = enabledProviders(id);
      if (present.length === 0) {
        const fabricModule = isFabricApiModule(providerKey(id));
        if (fabricModule && isFabricApiPresent) continue;
        const reportId = fabricModule ? "fabric-api" : id;
        const off = [...allProviders(reportId), ...allProviders(id)].filter((p) => !p.enabled);
        if (off.length > 0) {
          const entry = disabledByDep.get(reportId) ?? { dependents: [], targets: [] };
          entry.dependents.push(info.filename);
          for (const p of off) if (!entry.targets.includes(p.file)) entry.targets.push(p.file);
          disabledByDep.set(reportId, entry);
        } else {
          const arr = missingByDep.get(reportId) ?? [];
          arr.push(info.filename);
          missingByDep.set(reportId, arr);
        }
        continue;
      }

      const results = present.map((p) => versionSatisfies(dep.versions, p.version, maven));
      if (results.some((r) => r !== false)) continue;
      const entry = wrongVersionByDep.get(id) ?? {
        dependents: [],
        required: new Set<string>(),
        installed: new Set<string>(),
      };
      entry.dependents.push(info.filename);
      for (const v of dep.versions ?? []) entry.required.add(v);
      for (const p of present) if (p.version) entry.installed.add(p.version);
      wrongVersionByDep.set(id, entry);
    }
  }

  for (const [depId, files] of missingByDep.entries()) {
    const uniqueFiles = [...new Set(files)];
    conflicts.push({
      id: `missing:${depId}`,
      severity: "error",
      category: "dependency",
      title: tt("modpacks.conflicts.missingDep.title"),
      reason: tt("modpacks.conflicts.missingDep.reason", { id: depId }),
      affected: uniqueFiles.slice(0, MAX_AFFECTED),
      solutions: [
        tt("modpacks.conflicts.missingDep.solutionInstall"),
        tt("modpacks.conflicts.missingDep.solutionDisable"),
      ],
      actions: [
        {
          id: "disable_all",
          label: tt("modpacks.conflicts.actions.disableDependents"),
          kind: "disable_all",
        },
      ],
    });
  }

  for (const [depId, entry] of disabledByDep.entries()) {
    const dependents = [...new Set(entry.dependents)];
    const target = entry.targets[0];
    conflicts.push({
      id: `disabled-dep:${depId}`,
      severity: "error",
      category: "dependency",
      title: tt("modpacks.conflicts.disabledDep.title"),
      reason: tt("modpacks.conflicts.disabledDep.reason", {
        id: depId,
        file: displayName(infoByFile.get(target), target),
      }),
      affected: [...entry.targets, ...dependents].slice(0, MAX_AFFECTED),
      solutions: [
        tt("modpacks.conflicts.disabledDep.solutionEnable"),
        tt("modpacks.conflicts.missingDep.solutionDisable"),
      ],
      actions: [
        {
          id: "enable_dependency",
          label: tt("modpacks.conflicts.actions.enableDependency"),
          kind: "enable",
          targets: entry.targets.slice(0, 1),
        },
      ],
    });
  }

  for (const [depId, entry] of wrongVersionByDep.entries()) {
    const dependents = [...new Set(entry.dependents)];
    const holders = enabledProviders(depId).map((p) => p.file);
    conflicts.push({
      id: `dep-version:${depId}`,
      severity: "error",
      category: "dependency",
      title: tt("modpacks.conflicts.depVersion.title"),
      reason: tt("modpacks.conflicts.depVersion.reason", {
        id: depId,
        required: [...entry.required].join(" | ") || "?",
        installed: [...entry.installed].join(", ") || "?",
      }),
      affected: [...new Set([...holders, ...dependents])].slice(0, MAX_AFFECTED),
      solutions: [
        tt("modpacks.conflicts.depVersion.solutionUpdate"),
        tt("modpacks.conflicts.missingDep.solutionDisable"),
      ],
      actions: [
        {
          id: "disable_dependents",
          label: tt("modpacks.conflicts.actions.disableDependents"),
          kind: "disable_all",
          targets: dependents,
        },
      ],
    });
  }

  const breakPairs = new Map<string, { a: string; b: string; soft: boolean }>();
  for (const info of activeInfos) {
    const maven = info.loader === "forge" || info.loader === "neoforge";
    for (const br of info.breaks ?? []) {
      if (!br?.modId) continue;
      const id = normalizeId(br.modId);
      if (!id || PLATFORM_IDS.has(id)) continue;
      for (const other of enabledProviders(id)) {
        if (other.file === info.filename || wrongLoader.has(other.file)) continue;
        if (versionSatisfies(br.versions, other.version, maven) !== true) continue;
        const pairKey = [info.filename, other.file].sort().join("||");
        if (breakPairs.has(pairKey)) continue;
        breakPairs.set(pairKey, { a: info.filename, b: other.file, soft: !!br.optional });
      }
    }
  }

  for (const [pairKey, pair] of breakPairs.entries()) {
    const titleA = displayName(infoByFile.get(pair.a), pair.a);
    const titleB = displayName(infoByFile.get(pair.b), pair.b);
    conflicts.push({
      id: `breaks:${pairKey}`,
      severity: pair.soft ? "warning" : "error",
      category: "breaks",
      title: tt("modpacks.conflicts.breaks.title"),
      reason: tt("modpacks.conflicts.breaks.reason", {
        a: String(titleA),
        b: String(titleB),
      }),
      affected: [pair.a, pair.b],
      solutions: [
        tt("modpacks.conflicts.breaks.solutionDisableOne"),
        tt("modpacks.conflicts.breaks.solutionFindAlt"),
      ],
      actions: [
        {
          id: "disable_a",
          label: tt("modpacks.conflicts.actions.disableFirst"),
          kind: "disable_all_but",
          keep: pair.b,
        },
        {
          id: "disable_b",
          label: tt("modpacks.conflicts.actions.disableSecond"),
          kind: "disable_all_but",
          keep: pair.a,
        },
      ],
    });
  }

  conflicts.sort(compareConflicts);
  return conflicts;
}

const CATEGORY_WEIGHT: Record<string, number> = {
  duplicate: 0,
  breaks: 1,
  dependency: 2,
  loader: 3,
  incompatible: 4,
};

export function compareConflicts(a: ProfileConflict, b: ProfileConflict): number {
  if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
  return (CATEGORY_WEIGHT[a.category ?? ""] ?? 9) - (CATEGORY_WEIGHT[b.category ?? ""] ?? 9);
}

export function conflictAffectedSet(conflicts: ProfileConflict[]): Set<string> {
  const set = new Set<string>();
  for (const c of conflicts) {
    for (const f of c.affected) set.add(f);
  }
  return set;
}
