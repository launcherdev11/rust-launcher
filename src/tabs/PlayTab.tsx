import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CursorHint, useCursorHint } from "../components/CursorHint";
import { GameConsolePanel } from "../components/GameConsolePanel";
import { LoaderIcon } from "../components/loader_icon";
import { ProfileInstanceIcon, ProfileCardIconBackdrop } from "../components/profile_instance_icon";
import { InputClearButton, Spinner } from "../components/ui";
import { formatPlaytimeShort, useT, type Language } from "../i18n";
import { useProfileIconSrc } from "../hooks/useProfileIconSrc";
import { copyTextToClipboard } from "../lib/clipboard";

export type PlayHomeProfile = {
  id: string;
  name: string;
  game_version: string;
  loader: string;
  play_time_seconds: number;
  last_played_at?: number | null;
  mods_count: number;
};

type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";

type VersionSummary = {
  id: string;
  version_type: string;
  url: string;
  release_time: string;
};

type ForgeVersionSummary = {
  id: string;
  mc_version: string;
  forge_build: string;
  installer_url: string;
};

type NeoForgeVersionSummary = {
  id: string;
  mc_version: string;
  neoforge_build: string;
  installer_url: string;
};

type VersionItem = VersionSummary | ForgeVersionSummary | NeoForgeVersionSummary;

function isForgeVersion(v: VersionItem): v is ForgeVersionSummary {
  return "forge_build" in v && "installer_url" in v;
}

function isNeoForgeVersion(v: VersionItem): v is NeoForgeVersionSummary {
  return "neoforge_build" in v && "installer_url" in v;
}

type DownloadProgressPayload = {
  version_id: string;
  downloaded: number;
  total: number;
  percent: number;
};

type GameStatus = "idle" | "running" | "stopped" | "crashed";

import type { PlayConsoleHotkeyActions } from "../hooks/useHotkeys";
import type { LaunchStage } from "../hooks/useLaunchStage";

type PlayTabProps = {
  gameStatus: GameStatus;
  playConsoleLines: { id: number; line: string; source: "stdout" | "stderr" }[];
  isConsoleVisible: boolean;
  onToggleConsole: () => void;
  onClearConsole: () => void;
  onRegisterConsoleHotkeys?: (actions: PlayConsoleHotkeyActions | null) => void;
  isConsoleDetached?: boolean;
  onToggleConsoleDetached?: () => void | Promise<void>;
  showConsoleOnLaunch: boolean;
  versions: VersionItem[];
  selectedVersion: VersionItem | null;
  setSelectedVersion: (v: VersionItem) => void;
  versionsLoading: boolean;
  isVersionDropdownOpen: boolean;
  setIsVersionDropdownOpen: (v: boolean) => void;
  installPaused: boolean;
  isInstalling: boolean;
  handleResumeInstall: () => void;
  handlePauseInstall: () => void;
  handleCancelInstall: () => void;
  handlePrimaryClick: () => void;
  isLaunching?: boolean;
  launchStage?: LaunchStage | null;
  primaryColorClasses: string;
  primaryLabel: string;
  progress: DownloadProgressPayload | null;
  loader: LoaderId;
  setLoader: (l: LoaderId) => void;
  isLoaderDropdownOpen: boolean;
  setIsLoaderDropdownOpen: (v: boolean) => void;
  handleOpenGameFolder: (subdir?: "mods" | "logs") => void;
  language: Language;
  installedVersionIds: Set<string>;
  showSnapshots: boolean;
  fillPane?: boolean;
  profiles?: PlayHomeProfile[];
  selectedProfileId?: string | null;
  onSelectProfile?: (profileId: string) => void;
  onPlayProfile?: (profileId: string) => void;
  onOpenModpacks?: () => void;
  onOpenModpackView?: (view: "create" | "import") => void;
  onOpenProfile?: (profileId: string) => void;
  onOpenProfileSettings?: () => void;
};

const loaderLabels: Record<LoaderId, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  quilt: "Quilt",
  neoforge: "NeoForge",
};

export function PlayTab({
  gameStatus,
  playConsoleLines,
  isConsoleVisible,
  onToggleConsole,
  onClearConsole,
  onRegisterConsoleHotkeys,
  isConsoleDetached = false,
  onToggleConsoleDetached,
  showConsoleOnLaunch,
  versions,
  selectedVersion,
  setSelectedVersion,
  versionsLoading,
  isVersionDropdownOpen,
  setIsVersionDropdownOpen,
  installPaused,
  isInstalling,
  handleResumeInstall,
  handlePauseInstall,
  handleCancelInstall,
  handlePrimaryClick,
  isLaunching = false,
  launchStage = null,
  primaryColorClasses,
  primaryLabel,
  progress,
  loader,
  setLoader,
  isLoaderDropdownOpen,
  setIsLoaderDropdownOpen,
  handleOpenGameFolder,
  language,
  installedVersionIds,
  showSnapshots,
  fillPane = false,
  profiles = [],
  selectedProfileId = null,
  onSelectProfile,
  onPlayProfile,
  onOpenModpacks,
  onOpenModpackView,
  onOpenProfile,
  onOpenProfileSettings,
}: PlayTabProps) {
  const tt = useT(language);

  const recentProfiles = useMemo(() => {
    return [...profiles]
      .sort((a, b) => {
        const aT = a.last_played_at ?? 0;
        const bT = b.last_played_at ?? 0;
        if (bT !== aT) return bT - aT;
        return (b.play_time_seconds ?? 0) - (a.play_time_seconds ?? 0);
      })
      .slice(0, 4);
  }, [profiles]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const showModsButton = (selectedProfile?.loader ?? loader).toLowerCase() !== "vanilla";
  const dockIconSrc = useProfileIconSrc(selectedProfile?.id ?? "");
  const lockedHint = useCursorHint();

  const consoleLinesRef = useRef(playConsoleLines);
  consoleLinesRef.current = playConsoleLines;

  const handleCopyConsole = useCallback(async () => {
    await copyTextToClipboard(consoleLinesRef.current.map((e) => e.line).join("\n"));
  }, []);

  const handleToggleConsoleDetached = useCallback(() => {
    void onToggleConsoleDetached?.();
  }, [onToggleConsoleDetached]);

  useEffect(() => {
    if (!onRegisterConsoleHotkeys) return;
    onRegisterConsoleHotkeys({
      copyConsole: handleCopyConsole,
      toggleConsoleDetached: handleToggleConsoleDetached,
    });
    return () => onRegisterConsoleHotkeys(null);
  }, [
    handleCopyConsole,
    handleToggleConsoleDetached,
    onRegisterConsoleHotkeys,
  ]);

  const versionDisplayName = (v: VersionItem): string => {
    if (isForgeVersion(v)) return `${v.mc_version} (Forge ${v.forge_build})`;
    if (isNeoForgeVersion(v)) return `${v.mc_version} (NeoForge ${v.neoforge_build})`;
    return v.id;
  };

  const [versionQuery, setVersionQuery] = useState("");
  const versionListRef = useRef<HTMLDivElement | null>(null);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const versionInputRef = useRef<HTMLInputElement | null>(null);

  const looksLikeSnapshot = (s: string): boolean => {
    const v = s.trim();
    if (!v) return false;
    if (/^\d{2}w\d{2}[a-z]$/i.test(v)) return true;
    if (/^\d+\.\d+(\.\d+)?-pre\d+$/i.test(v)) return true;
    if (/^\d+\.\d+(\.\d+)?-rc\d+$/i.test(v)) return true;
    if (/^\d+\.\d+(\.\d+)?-snapshot$/i.test(v)) return true;
    return false;
  };

  const snapshotHintVisible = useMemo(() => {
    if (showSnapshots) return false;
    if (!versionQuery.trim()) return false;
    return looksLikeSnapshot(versionQuery);
  }, [showSnapshots, versionQuery]);

  const filteredVersions = useMemo(() => {
    const q = versionQuery.trim().toLowerCase();
    if (!q) return versions;
    return versions.filter((v) => versionDisplayName(v).toLowerCase().includes(q) || v.id.toLowerCase().includes(q));
  }, [versionQuery, versions]);

  useEffect(() => {
    if (!isVersionDropdownOpen) return;
    setVersionQuery("");
  }, [isVersionDropdownOpen]);

  useEffect(() => {
    if (!isVersionDropdownOpen) return;
    requestAnimationFrame(() => {
      try {
        versionInputRef.current?.focus({ preventScroll: true });
      } catch {
        versionInputRef.current?.focus();
      }

      const container = versionListRef.current;
      const item = selectedButtonRef.current;
      if (!container || !item) return;

      const cRect = container.getBoundingClientRect();
      const iRect = item.getBoundingClientRect();
      const centerOffset =
        (iRect.top - cRect.top) - (cRect.height / 2 - iRect.height / 2);
      container.scrollTop = Math.max(
        0,
        Math.min(container.scrollHeight, container.scrollTop + centerOffset),
      );
    });
  }, [isVersionDropdownOpen, filteredVersions.length]);

  const controlsClass = fillPane
    ? "relative mt-2 w-full shrink-0"
    : "relative mt-auto w-full shrink-0 pt-3";

  const homeEmpty = (
    <div
      data-tour-id="tour-profiles"
      className={`glass-panel flex w-full flex-col items-center justify-center gap-4 px-6 py-10 text-center ${
        fillPane ? "min-h-0 flex-1" : "min-h-[16rem]"
      }`}
    >
      <img
        src="/launcher-assets/modpack_icon.svg"
        alt=""
        className="h-12 w-12 object-contain opacity-60"
      />
      <div className="flex max-w-md flex-col gap-1.5">
        <h3 className="text-lg font-semibold tracking-tight text-white">
          {tt("play.home.emptyTitle")}
        </h3>
        <p className="text-sm text-white/55">{tt("play.home.emptyHint")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => onOpenModpackView?.("create")}
          className="btn btn-lg btn-accent"
        >
          {tt("play.home.emptyCreate")}
        </button>
        <button
          type="button"
          onClick={() => onOpenModpackView?.("import")}
          className="btn btn-lg btn-soft"
        >
          {tt("play.home.emptyImport")}
        </button>
      </div>
    </div>
  );

  const homeCards = (
    <div
      data-tour-id="tour-profiles"
      className={
        fillPane
          ? "flex min-h-0 w-full flex-1 flex-col gap-2"
          : "flex min-h-0 w-full flex-col gap-2"
      }
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold tracking-tight text-white/80">
          {tt("play.home.recentTitle")}
        </h3>
        {onOpenModpacks && (
          <button
            type="button"
            onClick={onOpenModpacks}
            className="text-[0.8125rem] font-medium text-white/55 transition-colors hover:text-white/90"
          >
            {tt("play.home.seeAll")}
          </button>
        )}
      </div>

      <div
        className={
          fillPane
            ? "grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2"
            : "custom-scrollbar grid min-h-0 grid-cols-2 gap-2 overflow-y-auto sm:gap-3"
        }
      >
        {Array.from({ length: 4 }, (_, index) => {
          const profile = recentProfiles[index];
          if (!profile) {
            const isFirstEmpty = index === recentProfiles.length;
            return (
              <button
                key={`empty-${index}`}
                type="button"
                onClick={onOpenModpacks}
                className={`home-card home-card-empty group min-h-[5.5rem] sm:min-h-[6.5rem] ${
                  fillPane ? "min-h-0" : ""
                } ${onOpenModpacks ? "" : "cursor-default"}`}
              >
                {isFirstEmpty ? (
                  <>
                    <img
                      src="/launcher-assets/modpack_icon.svg"
                      alt=""
                      className="h-7 w-7 object-contain opacity-50 transition-opacity group-hover:opacity-80"
                    />
                    <span className="text-[0.8125rem] font-medium text-white/45 group-hover:text-white/70">
                      {profiles.length === 0
                        ? tt("play.home.emptyCreate")
                        : tt("play.home.emptySlot")}
                    </span>
                  </>
                ) : (
                  <span className="h-7 w-7 rounded-lg bg-white/5 opacity-40" />
                )}
              </button>
            );
          }

          const isSelected = selectedProfileId === profile.id;
          return (
            <div
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectProfile?.(profile.id)}
              onDoubleClick={() => onOpenProfile?.(profile.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectProfile?.(profile.id);
                }
              }}
              className={`home-card group min-h-[5.5rem] sm:min-h-[6.5rem] ${
                fillPane ? "min-h-0" : ""
              } ${isSelected ? "home-card-selected" : ""}`}
            >
              <ProfileCardIconBackdrop profileId={profile.id} />
              <ProfileInstanceIcon
                profile={profile}
                className="relative z-[1] h-12 w-12 shrink-0 self-center rounded-xl sm:h-14 sm:w-14"
              />
              <div className="relative z-[1] min-w-0 flex-1 self-center">
                <div className="truncate text-sm font-semibold text-white">
                  {profile.name}
                </div>
                <div className="mt-0.5 truncate text-[0.8125rem] text-white/60">
                  {profile.game_version} · {profile.loader}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[0.75rem] text-white/45">
                  <span className="inline-flex items-center gap-1">
                    <img
                      src="/launcher-assets/clock.png"
                      alt=""
                      className="h-3 w-3 object-contain opacity-70"
                    />
                    {formatPlaytimeShort(language, profile.play_time_seconds)}
                  </span>
                  <span>
                    {tt("play.home.modsCount", { count: profile.mods_count })}
                  </span>
                </div>
              </div>
              {onPlayProfile && (
                <button
                  type="button"
                  title={tt("play.home.playTitle")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayProfile(profile.id);
                  }}
                  className={`interactive-press absolute right-2 top-2 z-[2] inline-flex h-8 w-8 items-center justify-center rounded-lg text-white opacity-0 shadow-soft transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${primaryColorClasses}`}
                >
                  <img
                    src="/launcher-assets/play.svg"
                    alt=""
                    className="h-4 w-4 object-contain"
                  />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const shell = (
    <>
      {profiles.length === 0 && onOpenModpackView ? homeEmpty : homeCards}

      <div className={controlsClass}>
        <div className="dock" data-tour-id="tour-launch-controls">
          <div className="dock-backdrop" aria-hidden="true">
            {selectedProfile && dockIconSrc ? (
              <img key={selectedProfile.id} src={dockIconSrc} alt="" />
            ) : null}
            {!selectedProfile && selectedVersion ? (
              <span key={selectedVersion.id} className="dock-version-ghost">
                {versionDisplayName(selectedVersion)}
              </span>
            ) : null}
          </div>

          <div className="dock-body">
            {selectedProfile ? (
              <ProfileInstanceIcon
                profile={selectedProfile}
                className="h-14 w-14 shrink-0 rounded-2xl"
              />
            ) : (
              <div className="dock-icon-empty" aria-hidden="true" />
            )}

            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold tracking-tight text-white">
                {selectedProfile?.name ?? tt("play.dock.noBuild")}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <div className="relative">
                  <button
                    type="button"
                    title={tt("play.loader.label")}
                    onClick={(e) => {
                      if (selectedProfile) lockedHint.show(e);
                      else setIsLoaderDropdownOpen(!isLoaderDropdownOpen);
                    }}
                    className="dock-chip"
                  >
                    <LoaderIcon loader={loader} />
                    {loaderLabels[loader]}
                    <span className="text-[0.75rem] text-white/50">▾</span>
                  </button>

                  {isLoaderDropdownOpen && (
                    <div className="menu-pop-in origin-bottom-left absolute left-0 bottom-full mb-2 z-30 max-h-[min(50vh,240px)] min-w-[9rem] overflow-y-auto glass-popover p-1 text-xs">
                      {(["vanilla", "fabric", "forge", "quilt", "neoforge"] as LoaderId[]).map((id) => {
                        const isActive = loader === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setLoader(id);
                              setIsLoaderDropdownOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left transition-colors ${
                              isActive
                                ? "seg-on"
                                : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            <LoaderIcon loader={id} reserveSpace />
                            <span>{loaderLabels[id]}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    title={tt("play.version.label")}
                    disabled={versions.length === 0 || versionsLoading}
                    onClick={(e) => {
                      if (selectedProfile) lockedHint.show(e);
                      else setIsVersionDropdownOpen(!isVersionDropdownOpen);
                    }}
                    className="dock-chip"
                  >
                    <span className="min-w-0 truncate">
                      {selectedVersion
                        ? versionDisplayName(selectedVersion)
                        : versionsLoading
                          ? tt("play.version.loading")
                          : tt("play.version.select")}
                    </span>
                    <span className="shrink-0 text-[0.75rem] text-white/50">▾</span>
                  </button>

                  {isVersionDropdownOpen && versions.length > 0 && (
                    <div className="menu-pop-in origin-bottom-left absolute left-0 bottom-full mb-2 z-30 w-64 glass-popover p-1 text-xs">
                      <div className="px-2 pt-2 pb-1">
                        <div className="relative">
                          <input
                            ref={versionInputRef}
                            type="text"
                            value={versionQuery}
                            onChange={(e) => setVersionQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setIsVersionDropdownOpen(false);
                                return;
                              }
                              if (e.key === "Enter") {
                                const q = versionQuery.trim().toLowerCase();
                                if (!q) return;
                                const exact =
                                  versions.find((v) => v.id.toLowerCase() === q) ??
                                  versions.find(
                                    (v) => versionDisplayName(v).toLowerCase() === q,
                                  );
                                const first = filteredVersions[0];
                                const chosen = exact ?? first;
                                if (chosen) {
                                  setSelectedVersion(chosen);
                                  setIsVersionDropdownOpen(false);
                                }
                              }
                            }}
                            placeholder={tt("play.version.searchPlaceholder")}
                            className={`glass-control h-8 w-full rounded-xl border px-3 text-xs text-white/90 placeholder:text-white/35 outline-none ${
                              versionQuery ? "pr-8" : ""
                            }`}
                          />
                          <InputClearButton
                            value={versionQuery}
                            onClear={() => setVersionQuery("")}
                            className="absolute right-1 top-1/2 -translate-y-1/2"
                            aria-label={tt("common.clear")}
                          />
                        </div>
                        {snapshotHintVisible && (
                          <div className="mt-1 rounded-xl border border-warn-line/25 bg-warn/10 px-3 py-2 text-[0.8125rem] text-warn-fg">
                            {tt("play.version.snapshotHint")}
                          </div>
                        )}
                      </div>

                      <div
                        ref={versionListRef}
                        className="max-h-[min(70vh,320px)] overflow-y-auto px-1 pb-1"
                      >
                        {filteredVersions.length === 0 ? (
                          <div className="px-3 py-2 text-[0.8125rem] text-white/50">
                            {tt("play.version.nothingFound")}
                          </div>
                        ) : (
                          filteredVersions.map((v) => {
                            const selected = !!selectedVersion && selectedVersion.id === v.id;
                            const installed = installedVersionIds.has(v.id);
                            return (
                              <button
                                key={v.id}
                                ref={(el) => {
                                  if (selected) selectedButtonRef.current = el;
                                }}
                                type="button"
                                onClick={() => {
                                  setSelectedVersion(v);
                                  setIsVersionDropdownOpen(false);
                                }}
                                className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                                  selected
                                    ? "seg-on"
                                    : installed
                                      ? "bg-accent-from/20 text-white/90 hover:bg-accent-from/30"
                                      : "text-white/80 hover:bg-white/10"
                                }`}
                              >
                                <span className="min-w-0 truncate">{versionDisplayName(v)}</span>
                                <span className="ml-2 shrink-0 flex items-center gap-2">
                                  {!isForgeVersion(v) && !isNeoForgeVersion(v) && (
                                    <span className="text-[0.75rem] text-gray-400">
                                      {(v as VersionSummary).version_type}
                                    </span>
                                  )}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="dock-actions">
              {isLaunching ? (
                <p role="status" aria-live="polite" className="dock-stage">
                  {launchStage ? tt(`app.launchStage.${launchStage}`) : tt("app.playAction.launching")}
                </p>
              ) : null}
              {showModsButton ? (
                <button
                  type="button"
                  onClick={() => handleOpenGameFolder("mods")}
                  title={tt("play.dock.modsTitle")}
                  className="dock-btn"
                >
                  {tt("play.dock.mods")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => handleOpenGameFolder("logs")}
                title={tt("play.dock.logsTitle")}
                className="dock-btn"
              >
                {tt("play.dock.logs")}
              </button>
              <button
                type="button"
                onClick={() => handleOpenGameFolder()}
                title={tt("play.gameFolder.openTitle")}
                className="dock-btn"
              >
                {tt("play.dock.folder")}
              </button>
              {onOpenProfileSettings && selectedProfile ? (
                <button type="button" onClick={onOpenProfileSettings} className="dock-btn">
                  {tt("play.dock.settings")}
                </button>
              ) : null}

              {isInstalling || installPaused ? (
                <>
                  <button
                    type="button"
                    onClick={installPaused ? handleResumeInstall : handlePauseInstall}
                    className="play-btn accent-bg min-w-0 px-5"
                  >
                    {installPaused ? tt("play.install.resume") : tt("play.install.pause")}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelInstall}
                    className="play-btn min-w-0 bg-danger-strong px-5"
                  >
                    {tt("play.install.cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handlePrimaryClick}
                  disabled={isLaunching}
                  aria-busy={isLaunching || undefined}
                  className={`play-btn ${primaryColorClasses} ${
                    isLaunching ? "cursor-not-allowed" : "interactive-press"
                  }`}
                >
                  {isLaunching ? <Spinner className="h-4 w-4" /> : null}
                  {primaryLabel}
                </button>
              )}
            </div>
          </div>

          {isLaunching && !isInstalling && !installPaused ? (
            <div className="dock-progress" role="progressbar" aria-busy="true">
              <span className="dock-progress-indeterminate" />
            </div>
          ) : null}

          {isInstalling || installPaused ? (
            <div
              className="dock-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress?.percent ?? 0)}
              title={
                progress && progress.total > 0
                  ? `${Math.round(progress.percent)}%`
                  : tt("play.install.preparing")
              }
            >
              <span
                className="dock-progress-fill"
                style={{
                  transform: `translateX(${Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0))) - 100}%)`,
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {(showConsoleOnLaunch || isInstalling || installPaused) && !isConsoleDetached && (
          <motion.div
            key="play-console"
            className="mt-3 w-full shrink-0"
            initial={{ opacity: 0, y: 14, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99, transition: { duration: 0.16, ease: "easeIn" } }}
            transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
          >
            <GameConsolePanel
              embedded
              className="pointer-events-auto"
              consoleLines={playConsoleLines}
              isConsoleVisible={isConsoleVisible || isInstalling || installPaused}
              gameStatus={gameStatus}
              language={language}
              profileId={selectedProfileId}
              isDetached={false}
              onClearConsole={onClearConsole}
              onToggleConsole={onToggleConsole}
              onToggleDetached={handleToggleConsoleDetached}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <CursorHint
        hint={selectedProfile ? lockedHint.hint : null}
        onClose={lockedHint.hide}
        title={tt("play.version.lockedHintTitle")}
        action={
          onOpenProfileSettings
            ? { label: tt("play.version.lockedHintAction"), onClick: onOpenProfileSettings }
            : undefined
        }
      >
        {tt("play.version.lockedHintBody", {
          version: selectedProfile?.game_version || "—",
          loader: selectedProfile?.loader || "—",
        })}
      </CursorHint>
    </>
  );

  if (fillPane) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-none flex-col">{shell}</div>
    );
  }
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      {shell}
    </div>
  );
}

