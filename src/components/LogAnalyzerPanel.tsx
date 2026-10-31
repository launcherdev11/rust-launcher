import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT, type Language } from "../i18n";
import {
  analyzeGameLogs,
  type LogAnalyzerFinding,
  type LogAnalyzerInputSource,
  type LogAnalyzerSeverity,
} from "../lib/logAnalyzer";
import { INSTALL_CONSOLE_PROFILE_ID } from "../lib/gameConsoleWindow";
import {
  loadRemoteCrashRules,
  toAnalyzerRules,
  type RemoteRuleSpec,
} from "../lib/remoteCrashRules";
import {
  fixKey,
  needsModList,
  planCrashFixes,
  type CrashFixAction,
  type CrashFixContext,
} from "../lib/crashFixes";
import type { JarModInfo } from "../lib/profileConflicts";

type DiskLogSourceDto = {
  kind: string;
  name: string;
  path: string;
  content: string;
  truncated: boolean;
  modifiedAt: number;
};

type InstanceAnalysisLogsDto = {
  sources: DiskLogSourceDto[];
  skippedStale?: number;
};

type LogAnalyzerPanelProps = {
  lines: string[];
  language: Language;
  profileId?: string | null;
  gameStatus?: string;
  className?: string;
  compact?: boolean;
  includeDiskLogs?: boolean;
};

function severityBar(severity: LogAnalyzerSeverity): string {
  switch (severity) {
    case "error":
      return "bg-danger-line/80";
    case "warning":
      return "bg-warn-line/80";
    default:
      return "bg-sky-400/80";
  }
}

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type FixState = "pending" | "done" | "failed";

function fixLabel(action: CrashFixAction, tt: Tt): string {
  switch (action.kind) {
    case "disableMod":
      return tt("crashFixes.disableMod", { mod: action.label });
    case "installDependency":
      return tt("crashFixes.installDependency", { mod: action.label });
    case "raiseMemory":
      return tt("crashFixes.raiseMemory", {
        from: (action.fromMb / 1024).toFixed(1),
        to: (action.toMb / 1024).toFixed(1),
      });
    case "resetJava":
      return tt("crashFixes.resetJava");
  }
}

function CrashFixButtons({
  actions,
  states,
  disabled,
  onApply,
  tt,
}: {
  actions: CrashFixAction[];
  states: Record<string, FixState>;
  disabled: boolean;
  onApply: (action: CrashFixAction) => void;
  tt: Tt;
}) {
  if (!actions.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {actions.map((action) => {
        const key = fixKey(action);
        const state = states[key];
        if (state === "done") {
          return (
            <span key={key} className="rounded-md bg-emerald-500/15 px-2 py-1 text-[0.75rem] text-emerald-200/90">
              {tt("crashFixes.applied", { action: fixLabel(action, tt) })}
            </span>
          );
        }
        return (
          <button
            key={key}
            type="button"
            disabled={disabled || state === "pending"}
            onClick={() => onApply(action)}
            className="btn btn-sm btn-tint max-w-full disabled:opacity-50"
            title={disabled ? tt("crashFixes.gameRunning") : undefined}
          >
            <span className="truncate">{fixLabel(action, tt)}</span>
          </button>
        );
      })}
      {actions.some((a) => states[fixKey(a)] === "failed") ? (
        <span className="text-[0.75rem] text-danger-fg/80">{tt("crashFixes.failed")}</span>
      ) : null}
    </div>
  );
}

function FindingCard({
  finding,
  tt,
  actions = [],
  fixStates = {},
  fixesDisabled = false,
  onApplyFix,
}: {
  finding: LogAnalyzerFinding;
  tt: Tt;
  compact?: boolean;
  actions?: CrashFixAction[];
  fixStates?: Record<string, FixState>;
  fixesDisabled?: boolean;
  onApplyFix?: (action: CrashFixAction) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-white/[0.04] py-2 pl-3.5 pr-2.5">
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${severityBar(finding.severity)}`}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.8125rem] font-semibold leading-snug text-white/90">
          {finding.title ?? tt(finding.titleKey)}
        </p>
        {finding.matchCount > 1 ? (
          <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-white/60">
            ×{finding.matchCount}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[0.8125rem] leading-snug text-white/60">
        {finding.fix ?? tt(finding.fixKey, finding.fixVars)}
      </p>
      {finding.subjects && finding.subjects.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {finding.subjects.map((s) => (
            <span
              key={s}
              className="max-w-full truncate rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.6875rem] text-white/70"
              title={s}
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}
      {finding.detail ? (
        <p
          className="mt-1.5 line-clamp-2 rounded-md bg-[var(--ink-0)] px-2 py-1 font-mono text-[0.75rem] leading-snug text-white/55"
          title={finding.detail}
        >
          {finding.detail}
        </p>
      ) : finding.sample && !finding.subjects?.length ? (
        <p
          className="mt-1.5 truncate rounded-md bg-[var(--ink-0)] px-2 py-1 font-mono text-[0.75rem] text-white/40"
          title={finding.sample}
        >
          {finding.sample}
        </p>
      ) : null}
      {finding.sources && finding.sources.length > 0 ? (
        <p className="mt-1 text-[0.6875rem] text-white/35">
          {finding.sources.join(", ")}
        </p>
      ) : null}
      {onApplyFix ? (
        <CrashFixButtons
          actions={actions}
          states={fixStates}
          disabled={fixesDisabled}
          onApply={onApplyFix}
          tt={tt}
        />
      ) : null}
    </div>
  );
}

function useCrashFixContext(profileId: string | null, findings: LogAnalyzerFinding[], reloadTick: number) {
  const [ctx, setCtx] = useState<CrashFixContext | null>(null);
  const relevant = findings.some(
    (f) => f.id === "oom" || f.id === "wrongJava",
  ) || needsModList(findings);

  useEffect(() => {
    if (!profileId || !relevant) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [mods, settings, systemGb, java] = await Promise.all([
        invoke<JarModInfo[]>("scan_profile_mod_jars", { profileId }).catch(() => []),
        invoke<{ ram_mb: number }>("get_effective_settings", { profileId }).catch(() => null),
        invoke<number>("get_system_memory_gb").catch(() => 0),
        invoke<{ java_path?: string | null }>("get_profile_java_settings", { id: profileId }).catch(
          () => null,
        ),
      ]);
      if (cancelled) return;
      setCtx({
        mods,
        memoryMb: settings?.ram_mb ?? 0,
        systemMemoryMb: Math.round(systemGb * 1024),
        hasJavaOverride: !!java?.java_path?.trim(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, relevant, reloadTick]);

  return ctx;
}

async function applyCrashFix(profileId: string, action: CrashFixAction): Promise<void> {
  switch (action.kind) {
    case "disableMod":
      await invoke("set_profile_item_enabled", {
        id: profileId,
        category: "mods",
        filename: action.filename,
        enabled: false,
      });
      return;
    case "installDependency":
      await invoke("install_missing_mod_dependency", { profileId, modRef: action.ref });
      return;
    case "raiseMemory":
      await invoke("update_profile_settings", { id: profileId, patch: { ram_mb: action.toMb } });
      return;
    case "resetJava": {
      const current = await invoke<Record<string, unknown>>("get_profile_java_settings", {
        id: profileId,
      });
      await invoke("update_profile_settings", {
        id: profileId,
        patch: { java_settings: { ...current, java_path: null } },
      });
      return;
    }
  }
}

function toInputSources(disk: DiskLogSourceDto[]): LogAnalyzerInputSource[] {
  return disk.map((s) => ({
    id: s.kind === "latest" ? "latest" : s.kind === "jvm_crash" ? `jvm:${s.name}` : `crash:${s.name}`,
    label: s.kind === "latest" ? "latest.log" : s.name,
    text: s.content,
  }));
}

export function LogAnalyzerPanel({
  lines,
  language,
  profileId = null,
  gameStatus,
  className = "",
  compact = false,
  includeDiskLogs = true,
}: LogAnalyzerPanelProps) {
  const tt = useT(language);
  const [open, setOpen] = useState(false);
  const [diskSources, setDiskSources] = useState<DiskLogSourceDto[]>([]);
  const [skippedStale, setSkippedStale] = useState(0);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskError, setDiskError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const canReadDisk =
    includeDiskLogs &&
    !!profileId &&
    profileId !== INSTALL_CONSOLE_PROFILE_ID &&
    !profileId.startsWith("__");

  useEffect(() => {
    if (!canReadDisk || !profileId) {
      setDiskSources([]);
      setSkippedStale(0);
      setDiskError(false);
      setDiskLoading(false);
      return;
    }

    let cancelled = false;
    setDiskLoading(true);
    setDiskError(false);

    void (async () => {
      try {
        const result = await invoke<InstanceAnalysisLogsDto>(
          "read_instance_analysis_logs",
          { profileId },
        );
        if (cancelled) return;
        setDiskSources(result.sources ?? []);
        setSkippedStale(result.skippedStale ?? 0);
      } catch {
        if (!cancelled) {
          setDiskSources([]);
          setSkippedStale(0);
          setDiskError(true);
        }
      } finally {
        if (!cancelled) setDiskLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canReadDisk, profileId, gameStatus, reloadTick]);

  useEffect(() => {
    if (gameStatus !== "crashed" || !canReadDisk) return;
    const t1 = window.setTimeout(() => setReloadTick((n) => n + 1), 1500);
    const t2 = window.setTimeout(() => setReloadTick((n) => n + 1), 4000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [gameStatus, canReadDisk]);

  const inputSources = useMemo(() => toInputSources(diskSources), [diskSources]);

  const [remoteSpecs, setRemoteSpecs] = useState<RemoteRuleSpec[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadRemoteCrashRules().then((specs) => {
      if (!cancelled) setRemoteSpecs(specs);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const remoteRules = useMemo(() => toAnalyzerRules(remoteSpecs, language), [remoteSpecs, language]);

  const findings = useMemo(
    () => analyzeGameLogs(lines, inputSources, remoteRules),
    [lines, inputSources, remoteRules],
  );

  const [fixTick, setFixTick] = useState(0);
  const [fixStates, setFixStates] = useState<Record<string, FixState>>({});
  const [appliedFixes, setAppliedFixes] = useState<Record<string, CrashFixAction[]>>({});
  const fixProfileId = canReadDisk ? profileId : null;
  const fixContext = useCrashFixContext(fixProfileId, findings, fixTick);
  const fixesDisabled = gameStatus === "running";

  useEffect(() => {
    setFixStates({});
    setAppliedFixes({});
  }, [profileId]);

  const handleApplyFix = useCallback(
    (findingId: string, action: CrashFixAction) => {
      if (!fixProfileId) return;
      const key = fixKey(action);
      setFixStates((prev) => ({ ...prev, [key]: "pending" }));
      void applyCrashFix(fixProfileId, action)
        .then(() => {
          setFixStates((prev) => ({ ...prev, [key]: "done" }));
          setAppliedFixes((prev) => ({
            ...prev,
            [findingId]: [...(prev[findingId] ?? []), action],
          }));
          setFixTick((n) => n + 1);
        })
        .catch(() => setFixStates((prev) => ({ ...prev, [key]: "failed" })));
    },
    [fixProfileId],
  );

  const fixesByFinding = useMemo(() => {
    const map = new Map<string, CrashFixAction[]>();
    for (const f of findings) {
      const planned = fixContext ? planCrashFixes(f, fixContext, findings) : [];
      const done = (appliedFixes[f.id] ?? []).filter(
        (a) => !planned.some((p) => fixKey(p) === fixKey(a)),
      );
      const actions = [...done, ...planned];
      if (actions.length) map.set(f.id, actions);
    }
    return map;
  }, [findings, fixContext, appliedFixes]);

  const errorCount = useMemo(
    () => findings.filter((f) => f.severity === "error").length,
    [findings],
  );

  const sourceSummary = useMemo(() => {
    return [
      lines.length > 0 ? tt("play.console.analyzer.sourceConsole") : null,
      diskSources.some((s) => s.kind === "latest")
        ? tt("play.console.analyzer.sourceLatest")
        : null,
      diskSources.some((s) => s.kind === "crash_report")
        ? tt("play.console.analyzer.sourceCrash", {
            count: diskSources.filter((s) => s.kind === "crash_report").length,
          })
        : null,
      diskSources.some((s) => s.kind === "jvm_crash")
        ? tt("play.console.analyzer.sourceJvmCrash")
        : null,
    ].filter(Boolean) as string[];
  }, [lines.length, diskSources, tt]);

  useEffect(() => {
    if (findings.length > 0 && (gameStatus === "crashed" || errorCount > 0)) {
      setOpen(true);
    }
  }, [findings.length, gameStatus, errorCount]);

  const hasAnyInput = lines.length > 0 || diskSources.length > 0;
  if (!hasAnyInput && !diskLoading) return null;

  const statusDot =
    diskLoading || findings.length === 0
      ? findings.length === 0 && !diskLoading
        ? "bg-emerald-400"
        : "bg-white/30"
      : errorCount > 0
        ? "bg-danger-line"
        : "bg-warn-line";

  return (
    <div className={`shrink-0 ${className}`}>
      <div className="rounded-xl border border-[color:var(--seam)] bg-white/[0.02]">
        <div className="flex items-center gap-1 px-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="interactive-press flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg pl-2 pr-1 text-left"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} aria-hidden="true" />
            <span className="truncate text-[0.8125rem] font-semibold text-white/85">
              {tt("play.console.analyzer.title")}
            </span>
            {diskLoading ? (
              <span className="truncate text-[0.75rem] text-white/40">
                {tt("play.console.analyzer.readingDisk")}
              </span>
            ) : findings.length > 0 ? (
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-bold leading-none tabular-nums ${
                  errorCount > 0
                    ? "bg-danger/20 text-danger-fg/90"
                    : "bg-warn/20 text-warn-fg/90"
                }`}
              >
                {findings.length}
              </span>
            ) : (
              <span className="truncate text-[0.75rem] text-emerald-300/70">
                {tt("play.console.analyzer.okBadge")}
              </span>
            )}
            <span className="sr-only">
              {open ? tt("play.console.analyzer.hide") : tt("play.console.analyzer.show")}
            </span>
          </button>
          {canReadDisk ? (
            <button
              type="button"
              onClick={() => setReloadTick((n) => n + 1)}
              disabled={diskLoading}
              className="icon-btn h-7 w-7 disabled:opacity-40"
              title={tt("play.console.analyzer.refresh")}
              aria-label={tt("play.console.analyzer.refresh")}
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-3.5 w-3.5 ${diskLoading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="icon-btn h-7 w-7"
            aria-label={open ? tt("play.console.analyzer.hide") : tt("play.console.analyzer.show")}
            tabIndex={-1}
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        {open ? (
          <div className="border-t border-[color:var(--seam)] px-2 pb-2 pt-2">
            {sourceSummary.length > 0 ? (
              <p className="mb-2 px-1 text-[0.75rem] text-white/40">
                {tt("play.console.analyzer.sourcesLabel")}: {sourceSummary.join(", ")}
                {skippedStale > 0 ? (
                  <span className="block">
                    {tt("play.console.analyzer.staleSkipped", { count: skippedStale })}
                  </span>
                ) : null}
                {diskError ? (
                  <span className="block text-warn-fg/70">
                    {tt("play.console.analyzer.diskReadFailed")}
                  </span>
                ) : null}
              </p>
            ) : null}

            {findings.length > 0 ? (
              <div
                className={`custom-scrollbar flex flex-col gap-1.5 overflow-y-auto ${
                  compact ? "max-h-48" : "max-h-56"
                }`}
              >
                {findings.map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    tt={tt}
                    actions={fixesByFinding.get(finding.id)}
                    fixStates={fixStates}
                    fixesDisabled={fixesDisabled}
                    onApplyFix={
                      fixProfileId ? (action) => handleApplyFix(finding.id, action) : undefined
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="px-1 text-[0.8125rem] leading-snug text-white/45">
                {tt("play.console.analyzer.noIssues")}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
