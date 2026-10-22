import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useT, type Language } from "../i18n";
import {
  analyzeGameLogs,
  type LogAnalyzerFinding,
  type LogAnalyzerInputSource,
  type LogAnalyzerSeverity,
} from "../lib/logAnalyzer";
import { INSTALL_CONSOLE_PROFILE_ID } from "../lib/gameConsoleWindow";

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
};

type LogAnalyzerPanelProps = {
  lines: string[];
  language: Language;
  profileId?: string | null;
  gameStatus?: string;
  className?: string;
  compact?: boolean;
};

function severityBar(severity: LogAnalyzerSeverity): string {
  switch (severity) {
    case "error":
      return "bg-red-400/80";
    case "warning":
      return "bg-amber-400/80";
    default:
      return "bg-sky-400/80";
  }
}

function FindingCard({
  finding,
  tt,
}: {
  finding: LogAnalyzerFinding;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  compact?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-white/[0.04] py-2 pl-3.5 pr-2.5">
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${severityBar(finding.severity)}`}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.8125rem] font-semibold leading-snug text-white/90">
          {tt(finding.titleKey)}
        </p>
        {finding.matchCount > 1 ? (
          <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-white/60">
            ×{finding.matchCount}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[0.8125rem] leading-snug text-white/60">
        {tt(finding.fixKey)}
      </p>
      {finding.detail ? (
        <p
          className="mt-1.5 line-clamp-2 rounded-md bg-[var(--ink-0)] px-2 py-1 font-mono text-[0.75rem] leading-snug text-white/55"
          title={finding.detail}
        >
          {finding.detail}
        </p>
      ) : finding.sample ? (
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
    </div>
  );
}

function toInputSources(disk: DiskLogSourceDto[]): LogAnalyzerInputSource[] {
  return disk.map((s) => ({
    id: s.kind === "latest" ? "latest" : `crash:${s.name}`,
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
}: LogAnalyzerPanelProps) {
  const tt = useT(language);
  const [open, setOpen] = useState(false);
  const [diskSources, setDiskSources] = useState<DiskLogSourceDto[]>([]);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskError, setDiskError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const canReadDisk =
    !!profileId &&
    profileId !== INSTALL_CONSOLE_PROFILE_ID &&
    !profileId.startsWith("__");

  useEffect(() => {
    if (!canReadDisk || !profileId) {
      setDiskSources([]);
      setDiskError(false);
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
      } catch {
        if (!cancelled) {
          setDiskSources([]);
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

  const findings = useMemo(
    () => analyzeGameLogs(lines, inputSources),
    [lines, inputSources],
  );

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
        ? "bg-red-400"
        : "bg-amber-400";

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
                    ? "bg-red-500/20 text-red-200/90"
                    : "bg-amber-500/20 text-amber-100/90"
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
                {diskError ? (
                  <span className="block text-amber-200/70">
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
                  <FindingCard key={finding.id} finding={finding} tt={tt} />
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
