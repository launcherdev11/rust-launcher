import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";

type GameProcessStats = {
  pid: number;
  memoryBytes: number;
  cpuPercent: number;
  maxHeapBytes: number | null;
  systemTotalBytes: number;
  systemAvailableBytes: number;
};

type Sample = { at: number; memoryBytes: number; cpuPercent: number };

type Tt = (key: string, vars?: Record<string, string | number>) => string;

const POLL_MS = 2000;
const HISTORY_SIZE = 60;
const LOW_SYSTEM_MEMORY_RATIO = 0.08;
const POPOVER_WIDTH = 320;

function formatGb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function useGameProcessStats(active: boolean) {
  const [stats, setStats] = useState<GameProcessStats | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);

  useEffect(() => {
    if (!active) {
      setStats(null);
      setHistory([]);
      return;
    }
    let cancelled = false;
    const poll = () => {
      if (document.visibilityState === "hidden") return;
      invoke<GameProcessStats | null>("get_game_process_stats")
        .then((next) => {
          if (cancelled) return;
          setStats(next);
          if (!next) return;
          setHistory((prev) => {
            const sample = { at: Date.now(), memoryBytes: next.memoryBytes, cpuPercent: next.cpuPercent };
            return [...prev.slice(-(HISTORY_SIZE - 1)), sample];
          });
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active]);

  return { stats, history };
}

function Sparkline({
  values,
  max,
  label,
  format,
  ageLabel,
}: {
  values: number[];
  max: number;
  label: string;
  format: (v: number) => string;
  ageLabel: (index: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 100;
  const height = 36;
  const n = values.length;
  const x = (i: number) => ((HISTORY_SIZE - n + i) / (HISTORY_SIZE - 1)) * width;
  const y = (v: number) => height - 2 - (Math.min(v, max) / max) * (height - 4);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = n > 1 ? `${line} L${x(n - 1).toFixed(2)},${height} L${x(0).toFixed(2)},${height} Z` : "";

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };

  const hoverLeft = hover != null ? (x(hover) / width) * 100 : 0;

  return (
    <div
      className="relative h-9 w-full cursor-crosshair"
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={label}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} stroke="rgba(255,255,255,0.08)" vectorEffect="non-scaling-stroke" />
        {area ? <path d={area} fill="var(--accent-soft)" /> : null}
        {n > 1 ? (
          <path
            d={line}
            fill="none"
            stroke="var(--accent-hi)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {hover != null ? (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1="0"
            y2={height}
            stroke="rgba(255,255,255,0.3)"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {hover != null ? (
        <>
          <span
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-900 bg-accent-hi"
            style={{ left: `${hoverLeft}%`, top: `${(y(values[hover]) / height) * 100}%` }}
          />
          <span
            className={`pointer-events-none absolute -top-7 whitespace-nowrap rounded-md border border-white/10 bg-ink-900/95 px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-white/85 ${
              hoverLeft > 60 ? "-translate-x-full" : ""
            }`}
            style={{ left: `${hoverLeft}%` }}
          >
            {format(values[hover])} · {ageLabel(hover)}
          </span>
        </>
      ) : null}
    </div>
  );
}

function MeterBar({ ratio, warn }: { ratio: number; warn: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${warn ? "bg-amber-400/80" : "progress-fill"}`}
        style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }}
      />
    </div>
  );
}

function ResourcePopover({
  anchor,
  stats,
  history,
  lowMemory,
  tt,
  onClose,
  onOpenSettings,
}: {
  anchor: HTMLElement;
  stats: GameProcessStats;
  history: Sample[];
  lowMemory: boolean;
  tt: Tt;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, rect.left + rect.width / 2 - POPOVER_WIDTH / 2),
        window.innerWidth - POPOVER_WIDTH - 8,
      );
      setPos({ top: rect.bottom + 8, left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  const memoryValues = history.map((s) => s.memoryBytes);
  const cpuValues = history.map((s) => s.cpuPercent);
  const memoryScale = Math.max(stats.maxHeapBytes ?? 0, ...memoryValues, 1) * 1.1;
  const systemUsed = stats.systemTotalBytes - stats.systemAvailableBytes;
  const ageLabel = (index: number) => {
    const seconds = Math.round((Date.now() - history[index].at) / 1000);
    return seconds < 2 ? tt("gameMonitor.now") : tt("gameMonitor.secondsAgo", { seconds });
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={tt("gameMonitor.title")}
      className="glass-popover fixed z-[380] flex flex-col gap-4 p-4 text-white"
      style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
      data-no-drag
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{tt("gameMonitor.title")}</span>
        <span className="text-[0.6875rem] tabular-nums text-white/40">PID {stats.pid}</span>
      </div>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.75rem] text-white/55">{tt("gameMonitor.memoryLabel")}</span>
          <span className="text-sm font-semibold tabular-nums">
            {tt("gameMonitor.gb", { value: formatGb(stats.memoryBytes) })}
          </span>
        </div>
        <Sparkline
          values={memoryValues}
          max={memoryScale}
          label={tt("gameMonitor.memoryLabel")}
          format={(v) => tt("gameMonitor.gb", { value: formatGb(v) })}
          ageLabel={ageLabel}
        />
        {stats.maxHeapBytes ? (
          <span className="text-[0.6875rem] leading-snug text-white/45">
            {tt("gameMonitor.heapHint", { max: formatGb(stats.maxHeapBytes) })}
          </span>
        ) : null}
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.75rem] text-white/55">{tt("gameMonitor.cpuLabel")}</span>
          <span className="text-sm font-semibold tabular-nums">{Math.round(stats.cpuPercent)}%</span>
        </div>
        <Sparkline
          values={cpuValues}
          max={100}
          label={tt("gameMonitor.cpuLabel")}
          format={(v) => `${Math.round(v)}%`}
          ageLabel={ageLabel}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.75rem] text-white/55">{tt("gameMonitor.systemLabel")}</span>
          <span className="text-[0.75rem] tabular-nums text-white/75">
            {tt("gameMonitor.systemUsed", {
              used: formatGb(systemUsed),
              total: formatGb(stats.systemTotalBytes),
            })}
          </span>
        </div>
        <MeterBar ratio={stats.systemTotalBytes > 0 ? systemUsed / stats.systemTotalBytes : 0} warn={lowMemory} />
        {lowMemory ? (
          <span className="flex items-start gap-1.5 text-[0.75rem] leading-snug text-amber-200">
            <img src="/launcher-assets/warn.png" alt="" className="mt-0.5 h-3.5 w-3.5 shrink-0 object-contain" />
            {tt("gameMonitor.lowMemory")}
          </span>
        ) : null}
      </section>

      {onOpenSettings ? (
        <button
          type="button"
          className="btn btn-soft btn-sm self-start"
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
        >
          {tt("gameMonitor.openSettings")}
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

export function GameResourceChip({
  active,
  tt,
  onOpenSettings,
}: {
  active: boolean;
  tt: Tt;
  onOpenSettings?: () => void;
}) {
  const { stats, history } = useGameProcessStats(active);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!stats) setOpen(false);
  }, [stats]);

  if (!stats) return null;

  const lowMemory =
    stats.systemTotalBytes > 0 && stats.systemAvailableBytes / stats.systemTotalBytes < LOW_SYSTEM_MEMORY_RATIO;
  const cpu = Math.round(stats.cpuPercent);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={tt("gameMonitor.openDetails")}
        className={`interactive-press flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums transition-colors ${
          lowMemory
            ? "bg-amber-400/15 text-amber-200 hover:bg-amber-400/25"
            : open
              ? "bg-white/[0.14] text-white/85"
              : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white/80"
        }`}
      >
        <img src="/launcher-assets/storage.svg" alt="" className="h-3 w-3 object-contain opacity-70" aria-hidden />
        {tt("gameMonitor.chip", { used: formatGb(stats.memoryBytes), cpu })}
      </button>
      {open && buttonRef.current ? (
        <ResourcePopover
          anchor={buttonRef.current}
          stats={stats}
          history={history}
          lowMemory={lowMemory}
          tt={tt}
          onClose={close}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
    </>
  );
}
