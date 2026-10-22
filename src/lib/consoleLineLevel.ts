export type ConsoleLineLevel = "crash" | "error" | "warn" | "launcher" | "info" | "debug";

export type ConsoleFilterKey = "warn" | "error" | "crash";

export type ConsoleFilters = Record<ConsoleFilterKey, boolean>;

export const EMPTY_CONSOLE_FILTERS: ConsoleFilters = { warn: false, error: false, crash: false };

// "[main/INFO]:", "[Render thread/WARN]", "[main/ERROR] [mixin/]:" (Forge puts the logger after the level).
const THREAD_LEVEL = /\[[^\][]*\/(FATAL|SEVERE|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\]/i;
// "[12:00:00 WARN]:", "[12:00:00] [WARN]"
const PLAIN_LEVEL = /^\[[\d:.\s]*\b(FATAL|SEVERE|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\]/i;

const LOG_HEADER = /^\[(\d{1,2}:\d{2}:\d{2}|\d{2}[A-Za-z]{3}\d{4})/;

const LAUNCHER_PREFIX = /^\[(Launch|Launcher|ElyAuth|Java|Forge|NeoForge|Fabric|Quilt|Vanilla|Install)\]/;

const CRASH_START = /---- Minecraft Crash Report ----|# A fatal error has been detected by the Java Runtime/i;
const CRASH_LINE = /#@!@#|Game crashed!|Crash report saved to|Saving crash report to|This crash report has been saved to/i;

const STACK_TRACE = /^\s+at\s|^\s*Caused by:|^\s*Suppressed:|^\s*\.\.\.\s*\d+\s+more|^\s*(Exception in thread|[\w$.]+(Exception|Error|Throwable)(:|$))/;

// \b only knows ASCII letters, so the Russian words get their own boundary check.
const ERROR_TEXT =
  /\b(error|exception|fatal|failed|failure|cannot|can't|unable to)\b|(^|[^а-яё])(ошибк|не удалось)|java\.lang\.\w+(Error|Exception)|OutOfMemoryError/i;
const WARN_TEXT = /\b(warn|warning)\b|(^|[^а-яё])предупрежд/i;

function levelFromHeader(line: string): ConsoleLineLevel | null {
  const match = line.match(THREAD_LEVEL) ?? line.match(PLAIN_LEVEL);
  if (!match) return null;
  switch (match[1].toUpperCase()) {
    case "FATAL":
    case "SEVERE":
    case "ERROR":
      return "error";
    case "WARN":
    case "WARNING":
      return "warn";
    case "DEBUG":
    case "TRACE":
      return "debug";
    default:
      return "info";
  }
}

/**
 * Levels for a whole console buffer. Stack traces and crash-report bodies have no log header of
 * their own, so they take the level of the line that started them.
 */
export function classifyConsoleLines(
  entries: ReadonlyArray<{ line: string; source?: "stdout" | "stderr" }>,
): ConsoleLineLevel[] {
  const levels: ConsoleLineLevel[] = new Array(entries.length);
  let inCrash = false;
  let prev = "info" as ConsoleLineLevel;

  for (let i = 0; i < entries.length; i += 1) {
    const line = entries[i].line.trimEnd();
    const hasHeader = LOG_HEADER.test(line) || LAUNCHER_PREFIX.test(line);
    let level: ConsoleLineLevel;

    if (CRASH_START.test(line)) {
      inCrash = true;
      level = "crash";
    } else if (CRASH_LINE.test(line)) {
      inCrash = false;
      level = "crash";
    } else if (inCrash && !hasHeader) {
      level = "crash";
    } else {
      inCrash = false;
      const fromHeader = levelFromHeader(line);
      if (fromHeader) {
        level = fromHeader;
      } else if (LAUNCHER_PREFIX.test(line)) {
        level = ERROR_TEXT.test(line) ? "error" : WARN_TEXT.test(line) ? "warn" : "launcher";
      } else if (!hasHeader && (STACK_TRACE.test(line) || /^\s/.test(line))) {
        level = prev === "error" || prev === "warn" || prev === "crash" ? prev : STACK_TRACE.test(line) ? "error" : "info";
      } else if (ERROR_TEXT.test(line)) {
        level = "error";
      } else if (WARN_TEXT.test(line)) {
        level = "warn";
      } else {
        level = "info";
      }
    }

    levels[i] = level;
    if (line) prev = level;
  }

  return levels;
}

export function hasActiveConsoleFilter(filters: ConsoleFilters): boolean {
  return filters.warn || filters.error || filters.crash;
}

export function consoleLevelPassesFilters(level: ConsoleLineLevel, filters: ConsoleFilters): boolean {
  if (!hasActiveConsoleFilter(filters)) return true;
  return (
    (filters.warn && level === "warn") ||
    (filters.error && level === "error") ||
    (filters.crash && level === "crash")
  );
}

export const CONSOLE_LEVEL_TEXT_CLASS: Record<ConsoleLineLevel, string> = {
  crash: "text-orange-400",
  error: "text-red-400",
  warn: "text-yellow-200/90",
  launcher: "text-sky-300/90",
  info: "text-white/75",
  debug: "text-white/40",
};

const FILTERS_STORAGE_KEY = "game_console_filters";

export function loadConsoleFilters(): ConsoleFilters {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return EMPTY_CONSOLE_FILTERS;
    const parsed = JSON.parse(raw) as Partial<ConsoleFilters>;
    return {
      warn: parsed.warn === true,
      error: parsed.error === true,
      crash: parsed.crash === true,
    };
  } catch {
    return EMPTY_CONSOLE_FILTERS;
  }
}

export function saveConsoleFilters(filters: ConsoleFilters): void {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    //ignore
  }
}
