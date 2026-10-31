import { useEffect, useRef, useState } from "react";
import { ProfileInstanceIcon } from "./profile_instance_icon";
import { GameResourceChip } from "./GameResourceChip";
import type { Language } from "../i18n";
import { useT } from "../i18n";

function formatSessionElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

type SelectedProfileTitleBarProps = {
  profile: {
    id: string;
    name: string;
    icon_path?: string | null;
  };
  language: Language;
  gameStatus: "idle" | "running" | "stopped" | "crashed";
  isLaunching?: boolean;
  isStopping?: boolean;
  onPlay: () => void;
  onStop: () => void;
  onSettings: () => void;
  onOpenProfile?: () => void;
};

const ICON_BTN_CLASS =
  "interactive-press flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

export function SelectedProfileTitleBar({
  profile,
  language,
  gameStatus,
  isLaunching = false,
  isStopping = false,
  onPlay,
  onStop,
  onSettings,
  onOpenProfile,
}: SelectedProfileTitleBarProps) {
  const tt = useT(language);
  const isRunning = gameStatus === "running" || isStopping;
  const sessionStartRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      sessionStartRef.current = null;
      setElapsedSeconds(0);
      return;
    }

    if (sessionStartRef.current === null) {
      sessionStartRef.current = Date.now();
    }

    const tick = () => {
      if (sessionStartRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - sessionStartRef.current) / 1000));
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  return (
    <div
      className="pointer-events-auto glass-toolbar flex h-8 min-w-[15rem] max-w-[min(30rem,calc(100vw-34rem))] items-center gap-2 rounded-lg pl-1 pr-1"
      data-no-drag
    >
      <button
        type="button"
        onClick={onOpenProfile}
        className="interactive-press flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md pl-0.5 pr-1.5 hover:bg-white/[0.06]"
        title={profile.name}
      >
        <ProfileInstanceIcon
          key={`${profile.id}:${profile.icon_path ?? ""}`}
          profile={{ id: profile.id, name: profile.name }}
          className="h-5 w-5 shrink-0 rounded"
          initialClassName="text-[0.6875rem]"
          imageFit="contain"
        />
        <span className="truncate text-[0.8125rem] font-semibold text-white/90">{profile.name}</span>
      </button>

      {isRunning ? (
        <span
          className="flex shrink-0 items-center gap-1.5 text-[0.75rem] font-medium tabular-nums text-emerald-300/90"
          title={tt("modpacks.list.playtimeLabel")}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
          {formatSessionElapsed(elapsedSeconds)}
        </span>
      ) : null}
      <GameResourceChip active={gameStatus === "running"} tt={tt} onOpenSettings={onSettings} />

      <div className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-1">
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            disabled={isStopping}
            className={ICON_BTN_CLASS}
            title={tt("app.playAction.stop")}
          >
            <img src="/launcher-assets/stop.png" alt="" className="h-3.5 w-3.5 object-contain" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onPlay}
            disabled={isLaunching}
            className={ICON_BTN_CLASS}
            title={tt("app.playAction.play")}
          >
            <img src="/launcher-assets/play.svg" alt="" className="h-3.5 w-3.5 object-contain" />
          </button>
        )}
        <button
          type="button"
          onClick={onSettings}
          className={ICON_BTN_CLASS}
          title={tt("modpacks.manage.profileSettings")}
        >
          <img src="/launcher-assets/settings.svg" alt="" className="h-3.5 w-3.5 object-contain" />
        </button>
      </div>
    </div>
  );
}
