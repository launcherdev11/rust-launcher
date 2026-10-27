import type { LogAnalyzerFinding } from "./logAnalyzer";
import type { JarModInfo } from "./profileConflicts";

export type CrashFixAction =
  | { kind: "disableMod"; filename: string; label: string }
  | { kind: "raiseMemory"; fromMb: number; toMb: number }
  | { kind: "resetJava" };

export type CrashFixContext = {
  mods: JarModInfo[];
  memoryMb: number;
  systemMemoryMb: number;
  hasJavaOverride: boolean;
};

const DISABLE_FROM_SUBJECTS = new Set([
  "mixinConflict",
  "versionMismatch",
  "fabricLoader",
  "forgeVersion",
  "missingDependency",
  "dependencyVersion",
  "crashReport",
  "corruptJar",
  "tickingEntity",
  "optifineConflict",
]);

const NEVER_DISABLE = new Set([
  "minecraft",
  "java",
  "fabricloader",
  "fabric",
  "fabricapi",
  "forge",
  "neoforge",
  "quiltloader",
  "quiltedfabricapi",
  "qsl",
  "architectury",
  "cloth-config",
  "clothconfig",
]);

const MAX_DISABLE = 3;

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fileStem(filename: string): string {
  const base = filename.replace(/\.disabled$/i, "").replace(/\.(?:jar|zip)$/i, "");
  return norm(base.replace(/[-_+ ]v?\d[\w.+-]*$/i, ""));
}

function subjectRefs(findingId: string, subject: string): string[] {
  const s = subject.trim();
  if (s.includes("←")) return [s.split("←").pop()!.trim()];
  const trailing = s.match(/\(([^()]+)\)\s*$/)?.[1];
  if (findingId === "dependencyVersion" && trailing) return [trailing];
  if (findingId === "tickingEntity") {
    const ns = s.match(/^([\w-]+):/)?.[1];
    return ns && ns !== "minecraft" ? [ns] : [];
  }
  const refs = [s.replace(/\s*\([^()]*\)\s*$/, "")];
  if (trailing) refs.push(trailing);
  return refs.flatMap((r) => r.split(/,\s*/)).filter(Boolean);
}

function findMod(ref: string, mods: JarModInfo[]): JarModInfo | null {
  const key = norm(ref);
  if (!key || NEVER_DISABLE.has(key)) return null;
  const isFile = /\.(?:jar|zip)$/i.test(ref);
  for (const mod of mods) {
    if (!mod.enabled) continue;
    if (isFile) {
      if (mod.filename.toLowerCase() === ref.toLowerCase()) return mod;
      continue;
    }
    if (norm(mod.modId) === key || norm(mod.title) === key) return mod;
    if (mod.provides?.some((p) => norm(p) === key)) return mod;
  }
  if (isFile) return null;
  return mods.find((m) => m.enabled && fileStem(m.filename) === key) ?? null;
}

export function nextMemoryLimit(currentMb: number, systemMb: number): number | null {
  if (systemMb <= 0) return null;
  const step = Math.max(1024, Math.round(currentMb / 2 / 512) * 512);
  const ceiling = Math.floor((systemMb * 0.75) / 256) * 256;
  const next = Math.min(currentMb + step, ceiling);
  return next > currentMb ? next : null;
}

export function planCrashFixes(
  finding: LogAnalyzerFinding,
  ctx: CrashFixContext,
  all: LogAnalyzerFinding[] = [],
): CrashFixAction[] {
  const actions: CrashFixAction[] = [];

  if (finding.id === "mixinConflict" && all.some((f) => f.id === "optifineConflict")) {
    return actions;
  }

  if (finding.id === "oom") {
    const toMb = nextMemoryLimit(ctx.memoryMb, ctx.systemMemoryMb);
    if (toMb) actions.push({ kind: "raiseMemory", fromMb: ctx.memoryMb, toMb });
  }

  if (finding.id === "wrongJava" && ctx.hasJavaOverride) {
    actions.push({ kind: "resetJava" });
  }

  if (DISABLE_FROM_SUBJECTS.has(finding.id) && finding.subjects?.length) {
    const picked = new Set<string>();
    for (const subject of finding.subjects) {
      for (const ref of subjectRefs(finding.id, subject)) {
        const mod = findMod(ref, ctx.mods);
        if (!mod || picked.has(mod.filename)) continue;
        picked.add(mod.filename);
        actions.push({
          kind: "disableMod",
          filename: mod.filename,
          label: mod.title || mod.modId || mod.filename,
        });
        if (picked.size >= MAX_DISABLE) return actions;
      }
    }
  }

  return actions;
}

export function needsModList(findings: LogAnalyzerFinding[]): boolean {
  return findings.some((f) => DISABLE_FROM_SUBJECTS.has(f.id) && (f.subjects?.length ?? 0) > 0);
}

export function fixKey(action: CrashFixAction): string {
  switch (action.kind) {
    case "disableMod":
      return `disable:${action.filename}`;
    case "raiseMemory":
      return `memory:${action.toMb}`;
    case "resetJava":
      return "java";
  }
}
