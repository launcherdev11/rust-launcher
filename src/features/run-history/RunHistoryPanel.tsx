import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AssetIcon } from "../../components/asset_icon";
import { LogAnalyzerPanel } from "../../components/LogAnalyzerPanel";
import { InputClearButton } from "../../components/ui";
import { localeTag, type Language } from "../../i18n";
import { copyTextToClipboard } from "../../lib/clipboard";
import { CONSOLE_LEVEL_TEXT_CLASS, classifyConsoleLines } from "../../lib/consoleLineLevel";
import { subscribeTauriEvent } from "../../lib/tauriEvents";
import {
  buildGameRunReport,
  deleteGameRun,
  listGameRuns,
  readGameRunLog,
  searchGameRuns,
  type GameRun,
  type RunLogLine,
  type RunOutcome,
  type RunSearchHit,
} from "./api";

type Tt = (key: string, vars?: Record<string, string | number>) => string;
type Notify = (kind: "info" | "success" | "error" | "warning", message: string) => void;

const LOG_WINDOW = 4000;

const OUTCOME_CLASS: Record<RunOutcome, string> = {
  ok: "bg-emerald-500/15 text-emerald-200",
  crashed: "bg-red-500/20 text-red-200",
  stopped: "bg-white/10 text-white/70",
  running: "bg-accent-from/20 text-white",
  interrupted: "bg-amber-500/15 text-amber-100",
};

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function RunRow({
  run,
  active,
  language,
  tt,
  onSelect,
}: {
  run: GameRun;
  active: boolean;
  language: Language;
  tt: Tt;
  onSelect: () => void;
}) {
  const started = new Date(run.startedAtMs);
  const duration =
    run.endedAtMs != null ? formatDuration(run.endedAtMs - run.startedAtMs) : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`interactive-press flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-colors ${
        active ? "seg-on" : "hover:bg-white/[0.06]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-white/90">
          {started.toLocaleString(localeTag(language), {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold ${OUTCOME_CLASS[run.outcome]}`}>
          {tt(`runHistory.outcome.${run.outcome}`)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-white/50">
        <span className="truncate">{run.versionId}</span>
        {duration ? <span>· {duration}</span> : null}
        {run.exitCode != null && run.exitCode !== 0 ? (
          <span>· {tt("runHistory.exitCode", { code: run.exitCode })}</span>
        ) : null}
        {run.errorLines > 0 ? (
          <span className="text-red-200/70">· {tt("runHistory.errors", { count: run.errorLines })}</span>
        ) : null}
      </div>
    </button>
  );
}

function RunLogView({
  lines,
  focusLine,
  tt,
}: {
  lines: RunLogLine[];
  focusLine: number | null;
  tt: Tt;
}) {
  const [windowStart, setWindowStart] = useState(() => Math.max(0, lines.length - LOG_WINDOW));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setWindowStart(Math.max(0, lines.length - LOG_WINDOW));
  }, [lines]);

  useEffect(() => {
    if (focusLine == null) return;
    const idx = focusLine - 1;
    if (idx < windowStart) setWindowStart(Math.max(0, idx - 200));
  }, [focusLine, windowStart]);

  const shown = useMemo(() => lines.slice(windowStart), [lines, windowStart]);
  const levels = useMemo(
    () => classifyConsoleLines(shown.map((l) => ({ line: l.line, source: l.stderr ? "stderr" as const : "stdout" as const }))),
    [shown],
  );

  useLayoutEffect(() => {
    if (focusLine != null && focusRef.current) {
      focusRef.current.scrollIntoView({ block: "center" });
      return;
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, focusLine]);

  if (lines.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 px-3 py-8 text-sm text-white/45">
        {tt("runHistory.emptyLog")}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="custom-scrollbar min-h-[12rem] flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-[var(--ink-0)] px-3 py-2 font-mono text-[0.75rem] leading-[1.55]"
    >
      {windowStart > 0 ? (
        <button
          type="button"
          onClick={() => setWindowStart((s) => Math.max(0, s - LOG_WINDOW))}
          className="btn btn-sm btn-ghost mb-2 font-sans"
        >
          {tt("runHistory.showEarlier", { count: Math.min(LOG_WINDOW, windowStart) })}
        </button>
      ) : null}
      {shown.map((l, i) => {
        const lineNo = windowStart + i + 1;
        const focused = lineNo === focusLine;
        return (
          <div
            key={lineNo}
            ref={focused ? focusRef : undefined}
            className={`whitespace-pre-wrap break-all ${CONSOLE_LEVEL_TEXT_CLASS[levels[i] ?? "info"]} ${
              focused ? "rounded bg-accent-from/25" : ""
            }`}
          >
            {l.line}
          </div>
        );
      })}
    </div>
  );
}

export function RunHistoryPanel({
  profileId,
  language,
  tt,
  showNotification,
}: {
  profileId: string;
  language: Language;
  tt: Tt;
  showNotification: Notify;
}) {
  const [runs, setRuns] = useState<GameRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<RunLogLine[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RunSearchHit[] | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listGameRuns(profileId)
      .then((list) => {
        if (cancelled) return;
        setRuns(list);
        setSelectedId((prev) => (prev && list.some((r) => r.id === prev) ? prev : list[0]?.id ?? null));
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, refreshTick]);

  useEffect(
    () => subscribeTauriEvent("game-process-exited", () => {
      window.setTimeout(() => setRefreshTick((n) => n + 1), 800);
    }),
    [],
  );

  useEffect(() => {
    if (!selectedId) {
      setLines([]);
      return;
    }
    let cancelled = false;
    setLogLoading(true);
    readGameRunLog(profileId, selectedId)
      .then((l) => {
        if (!cancelled) setLines(l);
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      })
      .finally(() => {
        if (!cancelled) setLogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, selectedId, refreshTick]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchGameRuns(profileId, q)
        .then((h) => {
          if (!cancelled) setHits(h);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [profileId, query]);

  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const analyzerLines = useMemo(() => lines.map((l) => l.line), [lines]);
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);

  const handleCopyReport = useCallback(async () => {
    if (!selected) return;
    setReportBusy(true);
    try {
      const text = await buildGameRunReport(profileId, selected.id);
      const ok = await copyTextToClipboard(text);
      showNotification(ok ? "success" : "error", tt(ok ? "runHistory.reportCopied" : "runHistory.reportFailed"));
    } catch {
      showNotification("error", tt("runHistory.reportFailed"));
    } finally {
      setReportBusy(false);
    }
  }, [profileId, selected, showNotification, tt]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    try {
      await deleteGameRun(profileId, selected.id);
      setSelectedId(null);
      setRefreshTick((n) => n + 1);
    } catch {
      showNotification("error", tt("runHistory.deleteFailed"));
    }
  }, [profileId, selected, showNotification, tt]);

  return (
    <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-white">{tt("runHistory.title")}</div>
          <div className="mt-1 text-sm text-white/55">{tt("runHistory.hint")}</div>
        </div>
        <div className="relative w-full sm:w-64">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tt("runHistory.searchPlaceholder")}
            className="glass-control h-9 w-full px-3 pr-8 text-sm text-white outline-none placeholder:text-white/40"
          />
          <InputClearButton
            value={query}
            onClear={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            aria-label={tt("common.clear")}
          />
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-white/60">{tt("runHistory.loading")}</div>
      ) : runs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-black/30 px-6 py-12 text-center">
          <AssetIcon name="clock" className="h-7 w-7 text-white/50" />
          <div className="text-sm text-white/60">{tt("runHistory.empty")}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <div className="custom-scrollbar flex max-h-64 shrink-0 flex-col gap-1 overflow-y-auto lg:max-h-none lg:w-64">
            {hits ? (
              hits.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-white/50">{tt("runHistory.noHits")}</div>
              ) : (
                hits.map((h) => {
                  const run = runsById.get(h.runId);
                  return (
                    <button
                      key={`${h.runId}:${h.lineNo}`}
                      type="button"
                      onClick={() => {
                        setSelectedId(h.runId);
                        setFocusLine(h.lineNo);
                      }}
                      className={`interactive-press rounded-xl px-3 py-2 text-left hover:bg-white/[0.06] ${
                        selectedId === h.runId && focusLine === h.lineNo ? "seg-on" : ""
                      }`}
                    >
                      <div className="text-[0.75rem] text-white/45">
                        {run
                          ? new Date(run.startedAtMs).toLocaleString(localeTag(language))
                          : h.runId}
                        {` · #${h.lineNo}`}
                      </div>
                      <div className="mt-0.5 line-clamp-2 break-all font-mono text-[0.75rem] text-white/80">
                        {h.line}
                      </div>
                    </button>
                  );
                })
              )
            ) : (
              runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  active={run.id === selectedId}
                  language={language}
                  tt={tt}
                  onSelect={() => {
                    setSelectedId(run.id);
                    setFocusLine(null);
                  }}
                />
              ))
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 text-[0.8125rem] text-white/60">
                    {tt("runHistory.summary", {
                      lines: selected.lineCount,
                      memory: selected.ramMb ? `${selected.ramMb} MB` : "—",
                    })}
                    {selected.truncated ? ` · ${tt("runHistory.truncated")}` : ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyReport()}
                    disabled={reportBusy}
                    className="btn btn-sm btn-soft"
                    title={tt("runHistory.reportHint")}
                  >
                    <AssetIcon name="copy" className="h-3.5 w-3.5" />
                    {tt("runHistory.copyReport")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={selected.outcome === "running"}
                    className="icon-btn hover:!bg-red-500/15 hover:!text-red-200 disabled:opacity-40"
                    title={tt("runHistory.delete")}
                    aria-label={tt("runHistory.delete")}
                  >
                    <AssetIcon name="delete" />
                  </button>
                </div>
                <LogAnalyzerPanel
                  lines={analyzerLines}
                  language={language}
                  profileId={profileId}
                  includeDiskLogs={false}
                  compact
                />
                {logLoading ? (
                  <div className="py-8 text-center text-sm text-white/55">{tt("runHistory.loadingLog")}</div>
                ) : (
                  <RunLogView lines={lines} focusLine={focusLine} tt={tt} />
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
