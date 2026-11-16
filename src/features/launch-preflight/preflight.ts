import { invoke } from "@tauri-apps/api/core";
import { confirmDialog } from "../../lib/confirmDialog";
import { detectProfileConflicts, type JarModInfo } from "../../lib/profileConflicts";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type PreflightWarning = {
  code: string;
  critical: boolean;
  params: Record<string, string>;
};

type PreflightFinding = {
  signature: string;
  critical: boolean;
  text: string;
};

export type PreflightTarget = {
  profileId: string | null;
  loader?: string | null;
  gameVersion?: string | null;
  versionId: string;
};

const CHECK_TIMEOUT_MS = 6000;
const MAX_CONFLICTS_SHOWN = 3;
const MEMORY_PARAMS = new Set(["free", "heap", "limit", "available", "recommended"]);

const acknowledgedByProfile = new Map<string, string>();

function withTimeout<T>(task: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), CHECK_TIMEOUT_MS);
    task
      .then(resolve, () => resolve(fallback))
      .finally(() => window.clearTimeout(timer));
  });
}

function formatParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      MEMORY_PARAMS.has(key) ? (Number(value) / 1024).toFixed(1) : value,
    ]),
  );
}

async function systemFindings(target: PreflightTarget, tt: Tt): Promise<PreflightFinding[]> {
  const warnings = await invoke<PreflightWarning[]>("run_launch_preflight", {
    profileId: target.profileId,
    versionId: target.versionId,
  });
  return warnings.map((warning) => ({
    signature: warning.code,
    critical: warning.critical,
    text: tt(`app.preflight.${warning.code}`, formatParams(warning.params)),
  }));
}

async function conflictFindings(target: PreflightTarget, tt: Tt): Promise<PreflightFinding[]> {
  if (!target.profileId || !target.loader || target.loader === "vanilla") return [];
  const [entries, jarInfos] = await Promise.all([
    invoke<{ name: string; enabled: boolean }[]>("list_profile_items", {
      id: target.profileId,
      category: "mods",
    }),
    invoke<JarModInfo[]>("scan_profile_mod_jars", { profileId: target.profileId }),
  ]);
  const conflicts = detectProfileConflicts({
    entries,
    profile: { loader: target.loader, game_version: target.gameVersion },
    jarInfos,
    tt,
  }).filter((conflict) => conflict.severity === "error");
  if (conflicts.length === 0) return [];

  const shown = conflicts.slice(0, MAX_CONFLICTS_SHOWN).map((conflict) => `– ${conflict.reason}`);
  const hidden = conflicts.length - shown.length;
  if (hidden > 0) shown.push(tt("app.preflight.conflictsMore", { count: hidden }));
  return [
    {
      signature: conflicts.map((conflict) => conflict.id).sort().join(","),
      critical: false,
      text: [tt("app.preflight.conflicts", { count: conflicts.length }), ...shown].join("\n"),
    },
  ];
}

export async function confirmLaunchPreflight(target: PreflightTarget, tt: Tt): Promise<boolean> {
  const groups = await Promise.all([
    withTimeout(systemFindings(target, tt), []),
    withTimeout(conflictFindings(target, tt), []),
  ]);
  const findings = groups.flat();
  if (findings.length === 0) return true;

  const profileKey = target.profileId ?? "";
  const signature = findings.map((finding) => finding.signature).sort().join("|");
  const critical = findings.some((finding) => finding.critical);
  if (!critical && acknowledgedByProfile.get(profileKey) === signature) return true;

  const proceed = await confirmDialog({
    title: tt("app.preflight.title"),
    message: [...findings.map((finding) => finding.text), tt("app.preflight.footer")].join("\n\n"),
    confirmLabel: tt("app.preflight.confirm"),
    cancelLabel: tt("common.cancel"),
    tone: critical ? "danger" : "default",
  });
  if (proceed) acknowledgedByProfile.set(profileKey, signature);
  return proceed;
}
