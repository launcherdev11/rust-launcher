import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import { useT, type Language } from "../i18n";
import { copyTextToClipboard } from "../lib/clipboard";
import type { GameConsoleLine, GameStatus } from "../lib/gameConsoleWindow";
import { AssetIcon } from "./asset_icon";
import {
  ConsoleFilterBar,
  ConsoleLines,
  useConsoleFilters,
  useVisibleConsoleLines,
} from "./ConsoleLogView";
import { LogAnalyzerPanel } from "./LogAnalyzerPanel";

const BODY_TRANSITION: Transition = {
  height: { type: "spring", stiffness: 380, damping: 38, mass: 0.8 },
  opacity: { duration: 0.18, ease: "easeOut" },
  y: { duration: 0.22, ease: [0.2, 0.9, 0.25, 1] },
};

type GameConsolePanelProps = {
  consoleLines: GameConsoleLine[];
  isConsoleVisible: boolean;
  gameStatus: GameStatus;
  language: Language;
  isDetached: boolean;
  onClearConsole: () => void;
  onToggleConsole: () => void;
  onToggleDetached: () => void;
  profileId?: string | null;
  showHint?: boolean;
  embedded?: boolean;
  className?: string;
};

export function GameConsolePanel({
  consoleLines,
  isConsoleVisible,
  gameStatus,
  language,
  isDetached,
  onClearConsole,
  onToggleConsole,
  onToggleDetached,
  profileId = null,
  showHint = true,
  embedded = false,
  className = "",
}: GameConsolePanelProps) {
  const tt = useT(language);
  const [isCopyingConsole, setIsCopyingConsole] = useState(false);
  const [isConsoleCopied, setIsConsoleCopied] = useState(false);
  const { filters, toggleFilter } = useConsoleFilters();
  const { visible, counts } = useVisibleConsoleLines(consoleLines, filters);

  const analyzerLines = useMemo(() => consoleLines.map((e) => e.line), [consoleLines]);

  const handleCopyConsole = useCallback(async () => {
    if (isCopyingConsole) return;
    setIsCopyingConsole(true);
    const ok = await copyTextToClipboard(visible.map((v) => v.entry.line).join("\n"));
    setIsCopyingConsole(false);
    if (ok) {
      setIsConsoleCopied(true);
      window.setTimeout(() => setIsConsoleCopied(false), 1200);
    }
  }, [visible, isCopyingConsole]);

  const statusDotClass =
    gameStatus === "running"
      ? "bg-emerald-400"
      : gameStatus === "crashed"
        ? "bg-red-500"
        : gameStatus === "stopped"
          ? "bg-sky-400"
          : "bg-gray-500";

  const logBoxClass = embedded ? "h-52 shrink-0" : "min-h-0 flex-1";
  return (
    <div className={`glass-panel flex min-h-0 w-full flex-col px-4 py-3 ${className}`}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleConsole}
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={isConsoleVisible}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass}`} />
          <span className="truncate text-[0.8125rem] font-semibold text-white/80">
            {tt("play.console.title")}
          </span>
          {!isConsoleVisible && consoleLines.length > 0 && (
            <span className="tabular-nums text-[0.75rem] text-white/40">{consoleLines.length}</span>
          )}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClearConsole}
            className="icon-btn h-7 w-7"
            title={tt("play.console.clear")}
            aria-label={tt("play.console.clear")}
          >
            <AssetIcon name="delete" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopyConsole}
            disabled={isCopyingConsole}
            className="icon-btn h-7 w-7 disabled:opacity-50"
            title={isConsoleCopied ? tt("app.toast.copied") : tt("app.toast.copy")}
            aria-label={tt("app.toast.copy")}
          >
            <AssetIcon name="copy" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleDetached}
            className="icon-btn h-7 w-7"
            title={isDetached ? tt("play.console.attach") : tt("play.console.detach")}
            aria-label={isDetached ? tt("play.console.attach") : tt("play.console.detach")}
          >
            <img src="/launcher-assets/move.png" alt="" className="h-3.5 w-3.5 object-contain opacity-80" />
          </button>
          <button
            type="button"
            onClick={onToggleConsole}
            className="icon-btn h-7 w-7"
            title={isConsoleVisible ? tt("play.console.hide") : tt("play.console.show")}
            aria-label={isConsoleVisible ? tt("play.console.hide") : tt("play.console.show")}
            aria-expanded={isConsoleVisible}
          >
            <AssetIcon
              name="arrow_down"
              className={`h-3.5 w-3.5 transition-transform duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1)] ${isConsoleVisible ? "" : "rotate-180"}`}
            />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isConsoleVisible && (
          <motion.div
            key="console-body"
            className={embedded ? "flex flex-col overflow-hidden" : "flex min-h-0 flex-1 flex-col"}
            initial={embedded ? { height: 0, opacity: 0 } : { opacity: 0, y: 8 }}
            animate={embedded ? { height: "auto", opacity: 1 } : { opacity: 1, y: 0 }}
            exit={embedded ? { height: 0, opacity: 0 } : { opacity: 0, y: 8 }}
            transition={BODY_TRANSITION}
          >
            <ConsoleFilterBar
              tt={tt}
              filters={filters}
              counts={counts}
              onToggle={toggleFilter}
              className="mt-2 shrink-0"
            />
            <LogAnalyzerPanel
              lines={analyzerLines}
              language={language}
              profileId={profileId}
              gameStatus={gameStatus}
              compact={embedded}
              className="mt-2"
            />
            {consoleLines.length > 0 ? (
              <ConsoleLines
                tt={tt}
                visible={visible}
                filters={filters}
                className={`mt-2 rounded-xl border border-white/[0.06] bg-[var(--ink-0)] px-3 py-2 text-[0.75rem] leading-[1.55] ${logBoxClass}`}
              />
            ) : (
              <div
                className={`mt-2 flex w-full items-center justify-center rounded-xl border border-dashed border-white/10 px-3 py-2 text-[0.8125rem] text-white/45 ${logBoxClass}`}
              >
                {tt("play.console.empty")}
              </div>
            )}

            {showHint && (
              <p className="mt-2 shrink-0 text-[0.75rem] text-white/40">
                {tt("play.console.hint")}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
