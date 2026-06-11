import { useCallback, useMemo, useState } from "react";
import { useT, type Language } from "../i18n";
import { copyTextToClipboard } from "../lib/clipboard";
import type { GameConsoleLine, GameStatus } from "../lib/gameConsoleWindow";

type GameConsolePanelProps = {
  consoleLines: GameConsoleLine[];
  isConsoleVisible: boolean;
  gameStatus: GameStatus;
  language: Language;
  isDetached: boolean;
  onClearConsole: () => void;
  onToggleConsole: () => void;
  onToggleDetached: () => void;
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
  showHint = true,
  embedded = false,
  className = "",
}: GameConsolePanelProps) {
  const tt = useT(language);
  const [isCopyingConsole, setIsCopyingConsole] = useState(false);
  const [isConsoleCopied, setIsConsoleCopied] = useState(false);

  const consoleText = useMemo(
    () => consoleLines.map((e) => e.line).join("\n"),
    [consoleLines],
  );

  const handleCopyConsole = useCallback(async () => {
    if (isCopyingConsole) return;
    setIsCopyingConsole(true);
    const ok = await copyTextToClipboard(consoleText);
    setIsCopyingConsole(false);
    if (ok) {
      setIsConsoleCopied(true);
      window.setTimeout(() => setIsConsoleCopied(false), 1200);
    }
  }, [consoleText, isCopyingConsole]);

  const statusDotClass =
    gameStatus === "running"
      ? "bg-emerald-400"
      : gameStatus === "crashed"
        ? "bg-red-500"
        : gameStatus === "stopped"
          ? "bg-sky-400"
          : "bg-gray-500";

  return (
    <div
      className={`flex min-h-0 w-full flex-col rounded-2xl border border-white/12 bg-black/65 px-4 py-3 shadow-soft backdrop-blur-xl ${className}`}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${statusDotClass} animate-pulse`}
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
            {tt("play.console.title")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClearConsole}
            className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20"
          >
            {tt("play.console.clear")}
          </button>
          <button
            type="button"
            onClick={onToggleConsole}
            className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20"
          >
            {isConsoleVisible
              ? tt("play.console.hide")
              : tt("play.console.show")}
          </button>

          <button
            type="button"
            onClick={handleCopyConsole}
            disabled={isCopyingConsole}
            className="interactive-press inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-50"
            title={
              isConsoleCopied ? tt("app.toast.copied") : tt("app.toast.copy")
            }
            aria-label={tt("app.toast.copy")}
          >
            <img
              src="/launcher-assets/copy.png"
              alt=""
              className="h-4 w-4 object-contain"
            />
          </button>

          <button
            type="button"
            onClick={onToggleDetached}
            className="interactive-press inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
            title={
              isDetached
                ? tt("play.console.attach")
                : tt("play.console.detach")
            }
            aria-label={
              isDetached
                ? tt("play.console.attach")
                : tt("play.console.detach")
            }
          >
            <img
              src="/launcher-assets/move.png"
              alt=""
              className="h-4 w-4 object-contain"
            />
          </button>
        </div>
      </div>

      {isConsoleVisible && (
        <>
          {consoleLines.length > 0 ? (
            <div
              className={`overflow-y-auto rounded-xl bg-black/80 px-3 py-2 text-[11px] font-mono text-white/80 ${
                embedded ? "mt-2 h-44 w-full" : "min-h-0 flex-1"
              }`}
            >
              {consoleLines.map((entry) => (
                <div
                  key={entry.id}
                  className={`whitespace-pre break-all ${
                    entry.source === "stderr"
                      ? "text-red-300"
                      : "text-emerald-200"
                  }`}
                >
                  {entry.line}
                </div>
              ))}
            </div>
          ) : (
            <div
              className={`flex h-24 w-full items-center justify-center rounded-xl bg-black/70 px-3 py-2 text-[11px] text-white/60 ${
                embedded ? "mt-2" : ""
              }`}
            >
              {tt("play.console.empty")}
            </div>
          )}

          {showHint && (
            <p className="mt-2 shrink-0 text-[10px] text-white/40">
              {tt("play.console.hint")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
