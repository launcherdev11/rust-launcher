import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CONSOLE_LEVEL_TEXT_CLASS,
  classifyConsoleLines,
  consoleLevelPassesFilters,
  hasActiveConsoleFilter,
  loadConsoleFilters,
  saveConsoleFilters,
  type ConsoleFilterKey,
  type ConsoleFilters,
  type ConsoleLineLevel,
} from "../lib/consoleLineLevel";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type ConsoleEntry = { id?: number; line: string; source?: "stdout" | "stderr" };

export type VisibleConsoleLine<T extends ConsoleEntry> = {
  entry: T;
  index: number;
  level: ConsoleLineLevel;
};

export function useConsoleFilters() {
  const [filters, setFilters] = useState<ConsoleFilters>(() => loadConsoleFilters());

  const toggleFilter = useCallback((key: ConsoleFilterKey) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveConsoleFilters(next);
      return next;
    });
  }, []);

  return { filters, toggleFilter };
}

export function useVisibleConsoleLines<T extends ConsoleEntry>(lines: T[], filters: ConsoleFilters) {
  const levels = useMemo(() => classifyConsoleLines(lines), [lines]);

  const counts = useMemo(() => {
    const out: Record<ConsoleFilterKey, number> = { warn: 0, error: 0, crash: 0 };
    for (const level of levels) {
      if (level === "warn" || level === "error" || level === "crash") out[level] += 1;
    }
    return out;
  }, [levels]);

  const visible = useMemo(() => {
    const out: VisibleConsoleLine<T>[] = [];
    lines.forEach((entry, index) => {
      const level = levels[index] ?? "info";
      if (consoleLevelPassesFilters(level, filters)) out.push({ entry, index, level });
    });
    return out;
  }, [lines, levels, filters]);

  return { visible, counts };
}

const FILTER_ORDER: { key: ConsoleFilterKey; labelKey: string; dot: string }[] = [
  { key: "warn", labelKey: "play.console.filters.warnings", dot: "bg-yellow-200" },
  { key: "error", labelKey: "play.console.filters.errors", dot: "bg-red-400" },
  { key: "crash", labelKey: "play.console.filters.crash", dot: "bg-orange-400" },
];

export function ConsoleFilterBar({
  tt,
  filters,
  counts,
  onToggle,
  className = "",
}: {
  tt: Tt;
  filters: ConsoleFilters;
  counts: Record<ConsoleFilterKey, number>;
  onToggle: (key: ConsoleFilterKey) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={tt("play.console.filters.label")}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-white/70 ${className}`}
    >
      {FILTER_ORDER.map(({ key, labelKey, dot }) => (
        <label key={key} className="inline-flex cursor-pointer select-none items-center gap-1.5 hover:text-white">
          <input
            type="checkbox"
            checked={filters[key]}
            onChange={() => onToggle(key)}
            className="accent-checkbox"
          />
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
          <span>{tt(labelKey)}</span>
          <span className="tabular-nums text-white/40">{counts[key]}</span>
        </label>
      ))}
    </div>
  );
}

const ConsoleRow = memo(function ConsoleRow({ line, level }: { line: string; level: ConsoleLineLevel }) {
  return (
    <div className={`console-row whitespace-pre-wrap break-all ${CONSOLE_LEVEL_TEXT_CLASS[level]}`}>
      {line}
    </div>
  );
});

export function ConsoleLines<T extends ConsoleEntry>({
  tt,
  visible,
  filters,
  keyPrefix = "",
  className = "",
}: {
  tt: Tt;
  visible: VisibleConsoleLine<T>[];
  filters: ConsoleFilters;
  keyPrefix?: string;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);

  const lastFiltersRef = useRef(filters);

  useLayoutEffect(() => {
    if (lastFiltersRef.current !== filters) {
      lastFiltersRef.current = filters;
      stickToBottomRef.current = true;
    }
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [visible, filters]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={`custom-scrollbar overflow-y-auto font-mono ${className}`}
    >
      {visible.length === 0 && hasActiveConsoleFilter(filters) ? (
        <div className="py-2 font-sans text-white/45">{tt("play.console.filters.nothing")}</div>
      ) : (
        visible.map(({ entry, index, level }) => (
          <ConsoleRow key={`${keyPrefix}${entry.id ?? `i${index}`}`} line={entry.line} level={level} />
        ))
      )}
    </div>
  );
}
