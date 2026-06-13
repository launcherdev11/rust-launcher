import { ProfileInstanceIcon } from "./profile_instance_icon";
import type { Language } from "../i18n";
import { useT } from "../i18n";

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
  "interactive-press flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 text-white/85 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50";

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

  return (
    <div
      className="pointer-events-auto flex max-w-[min(320px,calc(100vw-22rem))] items-center gap-2 rounded-lg border border-white/12 bg-black/30 px-1.5 py-0.5 shadow-soft backdrop-blur-md"
      data-no-drag
    >
      <button
        type="button"
        onClick={onOpenProfile}
        className="interactive-press flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-white/10"
        title={profile.name}
      >
        <ProfileInstanceIcon
          key={`${profile.id}:${profile.icon_path ?? ""}`}
          profile={{ id: profile.id, name: profile.name }}
          className="h-6 w-6 shrink-0 rounded-md"
          initialClassName="text-[9px]"
          imageFit="contain"
        />
        <span className="truncate text-[11px] font-semibold text-white/90">{profile.name}</span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-1">
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
            <img src="/launcher-assets/play.png" alt="" className="h-3.5 w-3.5 object-contain" />
          </button>
        )}
        <button
          type="button"
          onClick={onSettings}
          className={ICON_BTN_CLASS}
          title={tt("modpacks.manage.profileSettings")}
        >
          <img src="/launcher-assets/settings.png" alt="" className="h-3.5 w-3.5 object-contain" />
        </button>
      </div>
    </div>
  );
}
