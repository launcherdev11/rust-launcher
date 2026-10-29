import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SelectedProfileTitleBar } from "../../components/selected_profile_title_bar";
import type { Language } from "../../i18n";
import { CloseIcon, MaximizeIcon, MinimizeIcon } from "../icons";
import type { GameStatus, InstanceProfileSummary, Tt } from "../types";
import { TitleBarSocials } from "./TitleBarSocials";

type Props = {
  tt: Tt;
  language: Language;
  launcherVersion: string | null;
  launcherVersionBadgeKind: "latest" | "outdated" | "unknown";
  updateVersion: string | null;
  onOpenHelp: () => void;
  activeInstanceProfile: InstanceProfileSummary | null;
  activeProfileIconPath: string | null;
  gameStatus: GameStatus;
  isLaunching: boolean;
  isStopping: boolean;
  onProfilePlay: () => void;
  onProfileStop: () => void;
  onProfileSettings: () => void;
  onProfileOpen: (profileId: string) => void;
  children: ReactNode;
};

export function TitleBar({
  tt,
  language,
  launcherVersion,
  launcherVersionBadgeKind,
  updateVersion,
  onOpenHelp,
  activeInstanceProfile,
  activeProfileIconPath,
  gameStatus,
  isLaunching,
  isStopping,
  onProfilePlay,
  onProfileStop,
  onProfileSettings,
  onProfileOpen,
  children,
}: Props) {
  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleToggleMaximize = () => {
    getCurrentWindow().toggleMaximize();
  };

  const handleTitleBarMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  return (
    <div
      className="relative flex h-11 items-center justify-between gap-3 px-3 select-none"
      onMouseDown={handleTitleBarMouseDown}
    >
      <div className="flex min-w-0 items-center gap-2 pl-1 select-none">
        <span className="text-[0.8125rem] font-semibold tracking-[-0.01em] text-white/60">
          16Launcher
        </span>
        {launcherVersion ? (
          <span
            className="flex items-center gap-1.5 text-[0.75rem] font-medium tabular-nums text-white/35"
            title={
              launcherVersionBadgeKind === "latest"
                ? tt("app.versionBadge.latest")
                : launcherVersionBadgeKind === "outdated"
                  ? updateVersion
                    ? tt("app.versionBadge.outdatedWithVersion", { version: updateVersion })
                    : tt("app.versionBadge.outdated")
                  : tt("app.versionBadge.unknown")
            }
          >
            {launcherVersion}
            {launcherVersionBadgeKind === "latest" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" aria-hidden="true" />
            ) : null}
          </span>
        ) : null}
        {launcherVersion && launcherVersionBadgeKind === "outdated" ? (
          <span
            className="rounded-md border border-warn-line/25 bg-warn/10 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-warn-fg"
            title={
              updateVersion
                ? tt("app.versionBadge.outdatedWithVersion", { version: updateVersion })
                : tt("app.versionBadge.outdated")
            }
          >
            {tt("app.versionBadge.updateChip")}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onOpenHelp}
          className="icon-btn ml-0.5 h-7 w-7"
          title={tt("app.help.title")}
          data-no-drag
        >
          <img src="/launcher-assets/help.png" alt="" className="h-3.5 w-3.5 object-contain opacity-70" />
        </button>
        <TitleBarSocials />
      </div>
      {activeInstanceProfile ? (
        <div className="pointer-events-none absolute inset-x-0 flex justify-center px-20">
          <SelectedProfileTitleBar
            profile={{
              id: activeInstanceProfile.id,
              name: activeInstanceProfile.name,
              icon_path: activeProfileIconPath,
            }}
            language={language}
            gameStatus={gameStatus}
            isLaunching={isLaunching}
            isStopping={isStopping}
            onPlay={onProfilePlay}
            onStop={onProfileStop}
            onSettings={onProfileSettings}
            onOpenProfile={() => onProfileOpen(activeInstanceProfile.id)}
          />
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        {children}
        <div className="ml-1.5 flex items-center gap-0.5 border-l border-white/10 pl-2">
          <button
            type="button"
            onClick={handleMinimize}
            className="icon-btn h-8 w-8"
            aria-label={tt("app.window.minimize")}
            data-no-drag
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            className="icon-btn h-8 w-8"
            aria-label={tt("app.window.maximize")}
            data-no-drag
          >
            <MaximizeIcon />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="icon-btn h-8 w-8 hover:!bg-danger-strong/90 hover:!text-white"
            aria-label={tt("app.window.close")}
            data-no-drag
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
