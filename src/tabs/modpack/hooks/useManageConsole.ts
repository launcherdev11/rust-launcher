import type { Language } from "../../../i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useConsoleFilters, useVisibleConsoleLines } from "../../../components/ConsoleLogView";
import {
  type GameConsoleLine,
  type GameConsoleSession,
  type GameStatus,
  type ViewId,
} from "../types";
import { localeTag, t } from "../../../i18n";

type ManageConsoleDeps = {
  activeView: ViewId;
  onManageConsoleExpandedChange: ((expanded: boolean) => void) | undefined;
  consoleHistorySessions: GameConsoleSession[];
  consoleLines: GameConsoleLine[];
  gameStatus: GameStatus;
  language: Language;
};

export function useManageConsole(deps: ManageConsoleDeps) {
  const {
    activeView,
    onManageConsoleExpandedChange,
    consoleHistorySessions,
    consoleLines,
    gameStatus,
    language,
  } = deps;

  const [manageConsoleExpanded, setManageConsoleExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("modpack_manage_console_expanded") !== "0";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const isActive = activeView === "manage" && manageConsoleExpanded;
    onManageConsoleExpandedChange?.(isActive);
    return () => {
      onManageConsoleExpandedChange?.(false);
    };
  }, [activeView, manageConsoleExpanded, onManageConsoleExpandedChange]);

  const [selectedLogSessionId, setSelectedLogSessionId] = useState<"live" | string>(
    "live",
  );

  const [isCopyingConsole, setIsCopyingConsole] = useState(false);
  const [isConsoleCopied, setIsConsoleCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "modpack_manage_console_expanded",
        manageConsoleExpanded ? "1" : "0",
      );
    } catch {
    }
  }, [manageConsoleExpanded]);

  useEffect(() => {
    if (selectedLogSessionId === "live") return;
    const exists = consoleHistorySessions.some((s) => s.id === selectedLogSessionId);
    if (!exists) setSelectedLogSessionId("live");
  }, [consoleHistorySessions, selectedLogSessionId]);

  const displayedConsoleLines = useMemo(() => {
    if (selectedLogSessionId === "live") return consoleLines;
    return consoleHistorySessions.find((s) => s.id === selectedLogSessionId)?.lines ?? [];
  }, [selectedLogSessionId, consoleLines, consoleHistorySessions]);

  const { filters: consoleFilters, toggleFilter: toggleConsoleFilter } = useConsoleFilters();

  const { visible: visibleConsoleLines, counts: consoleFilterCounts } = useVisibleConsoleLines(
    displayedConsoleLines,
    consoleFilters,
  );

  const consoleTextForCopy = useMemo(
    () => visibleConsoleLines.map((v) => v.entry.line).join("\n"),
    [visibleConsoleLines],
  );

  const manageConsoleStatusDotClass = useMemo(() => {
    if (selectedLogSessionId !== "live") return "bg-gray-500";
    if (gameStatus === "running") return "bg-emerald-400";
    if (gameStatus === "crashed") return "bg-red-500";
    if (gameStatus === "stopped") return "bg-sky-400";
    return "bg-gray-500";
  }, [selectedLogSessionId, gameStatus]);

  const handleCopyManageConsole = useCallback(async () => {
    if (isCopyingConsole) return;
    setIsCopyingConsole(true);
    let ok = false;
    try {
      await navigator.clipboard.writeText(consoleTextForCopy);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = consoleTextForCopy;
        ta.style.position = "fixed";
        ta.style.left = "-10000px";
        ta.style.top = "-10000px";
        ta.setAttribute("readonly", "true");
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
      }
    } finally {
      setIsCopyingConsole(false);
    }
    if (ok) {
      setIsConsoleCopied(true);
      window.setTimeout(() => setIsConsoleCopied(false), 1200);
    }
  }, [consoleTextForCopy, isCopyingConsole]);

  function formatLogSessionOptionLabel(session: GameConsoleSession): string {
    const d = new Date(session.endedAt ?? session.startedAt);
    const ds = d.toLocaleString(localeTag(language));
    return t(language, "common.format.archiveLabel", { date: ds });
  }

  return {
    manageConsoleExpanded,
    setManageConsoleExpanded,
    selectedLogSessionId,
    setSelectedLogSessionId,
    isCopyingConsole,
    isConsoleCopied,
    displayedConsoleLines,
    consoleFilters,
    toggleConsoleFilter,
    visibleConsoleLines,
    consoleFilterCounts,
    manageConsoleStatusDotClass,
    handleCopyManageConsole,
    formatLogSessionOptionLabel,
  };
}
