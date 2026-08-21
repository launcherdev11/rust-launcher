import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameConsolePanel } from "../components/GameConsolePanel";
import { ProfileInstanceIcon } from "../components/profile_instance_icon";
import { formatPlaytimeShort, useT, type Language } from "../i18n";
import { copyTextToClipboard } from "../lib/clipboard";
import {
  bannerServerAddress,
  fetchLauncherBanners,
  isCarouselBanner,
  readCachedLauncherBanners,
  resolveBannerImageUrl,
  type LauncherBannerData,
} from "../lib/launcherBanners";

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
  primaryColorClasses: string;
  primaryLabel: string;
  progress: DownloadProgressPayload | null;
  loader: LoaderId;
  setLoader: (l: LoaderId) => void;
  isLoaderDropdownOpen: boolean;
  setIsLoaderDropdownOpen: (v: boolean) => void;
  handleOpenGameFolder: () => void;
  language: Language;
  installedVersionIds: Set<string>;
  showSnapshots: boolean;
  fillPane?: boolean;
  onPlayServer?: (serverAddress: string) => void | Promise<void>;
  profiles?: PlayHomeProfile[];
  selectedProfileId?: string | null;
  onSelectProfile?: (profileId: string) => void;
  onPlayProfile?: (profileId: string) => void;
  onOpenModpacks?: () => void;
  onOpenProfile?: (profileId: string) => void;
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
  onPlayServer,
  profiles = [],
  selectedProfileId = null,
  onSelectProfile,
  onPlayProfile,
  onOpenModpacks,
  onOpenProfile,
}: PlayTabProps) {
  const tt = useT(language);
  const [banners, setBanners] = useState<LauncherBannerData[]>([]);
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const [bannerLoading, setBannerLoading] = useState(true);
  const [bannerError, setBannerError] = useState(false);

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

  const consoleText = useMemo(
    () => playConsoleLines.map((e) => e.line).join("\n"),
    [playConsoleLines],
  );

  const handleCopyConsole = useCallback(async () => {
    await copyTextToClipboard(consoleText);
  }, [consoleText]);

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

  const currentBanner =
    banners.length > 0 &&
    activeBannerIndex >= 0 &&
    activeBannerIndex < banners.length
      ? banners[activeBannerIndex]
      : null;
  const bannerServerIp = currentBanner ? bannerServerAddress(currentBanner) : "";

  useEffect(() => {
    const cached = readCachedLauncherBanners(300_000)?.filter(isCarouselBanner);
    if (cached?.length) {
      setBanners(cached);
      setActiveBannerIndex(0);
      setBannerLoading(false);
    }

    const controller = new AbortController();

    async function fetchBanner() {
      try {
        setBannerError(false);
        const all = await fetchLauncherBanners(controller.signal);
        const parsed = all.filter(isCarouselBanner);
        setBanners(parsed);
        setActiveBannerIndex(0);
      } catch (error) {
        if (controller.signal.aborted) return;
        const aborted =
          error instanceof DOMException && error.name === "AbortError";
        if (aborted) return;
        console.error(error);
        if (!cached?.length) {
          setBannerError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setBannerLoading(false);
        }
      }
    }

    void fetchBanner();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (banners.length <= 1) return;

    const interval = setInterval(() => {
      setActiveBannerIndex((prev) => (prev + 1) % banners.length);
    }, 15000);

    return () => clearInterval(interval);
  }, [banners.length]);

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

  const bannerClass = fillPane
    ? "glass-panel relative flex min-h-[7rem] max-h-[min(220px,42%)] w-full max-w-none shrink-0 overflow-hidden rounded-3xl"
    : "glass-panel relative flex h-[260px] w-full shrink-0 overflow-hidden rounded-3xl";

  const controlsClass = fillPane
    ? "relative mt-2 flex w-full max-w-none shrink-0 justify-center px-2"
    : "pointer-events-none relative mt-auto mb-10 flex w-full max-w-[95vw] justify-center px-2";

  const homeCards = (
    <div
      className={
        fillPane
          ? "mt-2 flex min-h-0 w-full flex-1 flex-col gap-2"
          : "mt-3 flex w-full flex-col gap-2"
      }
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
          {tt("play.home.recentTitle")}
        </h3>
        {onOpenModpacks && (
          <button
            type="button"
            onClick={onOpenModpacks}
            className="text-[11px] font-medium text-white/55 transition-colors hover:text-white/90"
          >
            {tt("play.home.seeAll")}
          </button>
        )}
      </div>

      <div
        className={
          fillPane
            ? "grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2"
            : "grid grid-cols-2 gap-2 sm:gap-3"
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
                className={`glass-panel group flex min-h-[5.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 bg-black/25 px-3 py-3 text-center transition-colors hover:border-white/30 hover:bg-black/40 sm:min-h-[6.5rem] ${
                  fillPane ? "min-h-0" : ""
                } ${onOpenModpacks ? "cursor-pointer" : "cursor-default"}`}
              >
                {isFirstEmpty ? (
                  <>
                    <img
                      src="/launcher-assets/modpack_icon.png"
                      alt=""
                      className="h-7 w-7 object-contain opacity-50 transition-opacity group-hover:opacity-80"
                    />
                    <span className="text-[11px] font-medium text-white/45 group-hover:text-white/70">
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
              className={`glass-panel group relative flex min-h-[5.5rem] cursor-pointer items-stretch gap-3 overflow-hidden rounded-2xl px-3 py-3 text-left transition-colors sm:min-h-[6.5rem] sm:px-4 sm:py-3.5 ${
                fillPane ? "min-h-0" : ""
              } ${
                isSelected
                  ? "border border-emerald-400/70 bg-white/12 ring-1 ring-emerald-400/35"
                  : "border border-white/10 hover:border-white/25 hover:bg-white/8"
              }`}
            >
              <ProfileInstanceIcon
                profile={profile}
                className="h-12 w-12 shrink-0 self-center rounded-xl sm:h-14 sm:w-14"
              />
              <div className="min-w-0 flex-1 self-center">
                <div className="truncate text-sm font-semibold text-white">
                  {profile.name}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-white/60">
                  {profile.game_version} · {profile.loader}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-white/45">
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
                  className={`interactive-press absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-white opacity-0 shadow-soft transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${primaryColorClasses}`}
                >
                  <img
                    src="/launcher-assets/play.png"
                    alt=""
                    className="h-4 w-4 object-contain"
                  />
                </button>
              )}
              {isSelected && (
                <span className="absolute bottom-2 right-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                  {tt("play.home.selectedBadge")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const shell = (
    <>
      <div className={bannerClass}>
        {bannerLoading ? (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm font-medium tracking-wide text-white/70">
              {tt("play.banner.loading")}
            </span>
          </div>
        ) : bannerError ? (
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center">
            <span className="text-sm font-medium tracking-wide text-red-300">
              {tt("play.banner.loadFailedTitle")}
            </span>
            <span className="mt-1 text-xs text-white/60">
              {tt("play.banner.loadFailedHint")}
            </span>
          </div>
        ) : currentBanner ? (
          <>
            <img
              src={resolveBannerImageUrl(currentBanner.imageUrl)}
              alt={
                currentBanner.title ??
                tt("play.banner.defaultAlt")
              }
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/10" />

            <div className="relative z-10 flex w-full flex-col justify-center px-8 py-6">
              {currentBanner.title && (
                <h2 className="mb-2 text-xl font-semibold tracking-wide text-white">
                  {currentBanner.title}
                </h2>
              )}
              {currentBanner.subtitle && (
                <p className="max-w-xl text-sm text-white/80">
                  {currentBanner.subtitle}
                </p>
              )}
              {(bannerServerIp || currentBanner.link) && (
                <div className="pointer-events-auto mt-4 flex flex-wrap items-center gap-2">
                  {bannerServerIp && onPlayServer && (
                    <button
                      type="button"
                      disabled={isLaunching || isInstalling}
                      onClick={() => void onPlayServer(bannerServerIp)}
                      className={`inline-flex items-center rounded-full px-4 py-1.5 text-xs font-semibold text-white shadow-soft ${primaryColorClasses} ${
                        isLaunching || isInstalling
                          ? "cursor-not-allowed opacity-60"
                          : "interactive-press hover:opacity-90"
                      }`}
                    >
                      {tt("play.banner.play")}
                    </button>
                  )}
                  {currentBanner.link && (
                    <a
                      href={currentBanner.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20"
                    >
                      {tt("play.banner.learnMore")}
                      <span className="ml-1 text-[10px]">↗</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm font-medium tracking-wide text-white/70">
              {tt("play.banner.empty")}
            </span>
          </div>
        )}
      </div>

      {homeCards}

      <div className={controlsClass}>
        <div className="pointer-events-auto relative w-full max-w-2xl">
          <div className="glass-chip flex flex-wrap items-center justify-center gap-4 px-6 py-4 sm:gap-6 sm:px-8">
            <div className="relative flex flex-col text-left">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-400">
                {tt("play.version.label")}
              </span>
              <button
                type="button"
                disabled={versions.length === 0 || versionsLoading}
                onClick={() =>
                  setIsVersionDropdownOpen(!isVersionDropdownOpen)
                }
                className="mt-1 inline-flex max-w-[200px] items-center gap-2 truncate text-left text-sm font-semibold text-white/90 disabled:cursor-not-allowed disabled:text-white/40 sm:max-w-[240px]"
              >
                <span className="min-w-0 truncate">
                  {selectedVersion
                    ? versionDisplayName(selectedVersion)
                    : versionsLoading
                      ? tt("play.version.loading")
                      : tt("play.version.select")}
                </span>
                <span className="shrink-0 text-xs text-gray-400">▾</span>
              </button>

              {isVersionDropdownOpen && versions.length > 0 && (
                <div className="absolute left-0 bottom-full mb-2 z-30 w-64 rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                  <div className="px-2 pt-2 pb-1">
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
                      className="h-8 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-xs text-white/90 placeholder:text-white/35 outline-none focus:border-white/35"
                    />
                    {snapshotHintVisible && (
                      <div className="mt-1 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                        {tt("play.version.snapshotHint")}
                      </div>
                    )}
                  </div>

                  <div
                    ref={versionListRef}
                    className="max-h-[min(70vh,320px)] overflow-y-auto px-1 pb-1"
                  >
                    {filteredVersions.length === 0 ? (
                      <div className="px-3 py-2 text-[11px] text-white/50">
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
                                ? "bg-white/90 text-black"
                                : installed
                                  ? "bg-emerald-500/10 text-white/90 hover:bg-emerald-500/15"
                                  : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            <span className="min-w-0 truncate">{versionDisplayName(v)}</span>
                            <span className="ml-2 shrink-0 flex items-center gap-2">
                              {!isForgeVersion(v) && !isNeoForgeVersion(v) && (
                                <span className="text-[10px] uppercase text-gray-400">
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

            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              {isInstalling || installPaused ? (
                <>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={installPaused ? handleResumeInstall : handlePauseInstall}
                      className="interactive-press rounded-xl accent-bg px-6 py-2 text-sm font-semibold text-white shadow-soft hover:opacity-90"
                    >
                      {installPaused ? tt("play.install.resume") : tt("play.install.pause")}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelInstall}
                      className="interactive-press rounded-xl bg-red-600 px-6 py-2 text-sm font-semibold text-white shadow-soft hover:bg-red-500"
                    >
                      {tt("play.install.cancel")}
                    </button>
                  </div>
                  <div className="mt-1 w-full max-w-md">
                    <div className="h-3 w-full overflow-hidden rounded-full bg-black/40">
                      <div
                        className="h-full rounded-full accent-bg transition-[width] duration-200"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(
                              100,
                              Math.round(progress?.percent ?? 0),
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-center text-xs text-white/70">
                      {progress && progress.total > 0
                        ? `${Math.round(progress.percent)}%`
                        : tt("play.install.preparing")}
                    </div>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handlePrimaryClick}
                  disabled={isLaunching}
                  className={`rounded-full px-12 py-3 text-sm font-semibold tracking-wide text-white shadow-soft transition-colors sm:px-16 ${primaryColorClasses} ${isLaunching ? "" : "interactive-press"}`}
                >
                  {primaryLabel}
                </button>
              )}
            </div>

            <div className="relative flex flex-col items-end text-right">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-400">
                {tt("play.loader.label")}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setIsLoaderDropdownOpen(!isLoaderDropdownOpen)
                  }
                  className="inline-flex items-center gap-2 rounded-full bg-white/6 px-3 py-1 text-xs font-semibold text-white/90 hover:bg-white/15"
                >
                  {loaderLabels[loader]}
                  <span className="text-[10px] text-gray-400">▾</span>
                </button>
              </div>

              {isLoaderDropdownOpen && (
                <div className="absolute right-0 bottom-full mb-2 z-30 max-h-[min(50vh,240px)] overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
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
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                          isActive
                            ? "bg-white/90 text-black"
                            : "text-white/80 hover:bg-white/10"
                        }`}
                      >
                        <span>{loaderLabels[id]}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenGameFolder}
            title={tt("play.gameFolder.openTitle")}
            className="pointer-events-auto absolute -right-14 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-gray-200 shadow-soft transition-colors hover:border-white/40 hover:bg-black/80 hover:text-white"
          >
            <img
              src="/launcher-assets/folder.png"
              alt={tt("play.gameFolder.alt")}
              className="h-6 w-6 object-contain"
            />
          </button>
        </div>
      </div>

      {(showConsoleOnLaunch || isInstalling || installPaused) && !isConsoleDetached && (
        <div className="mt-4 flex w-full max-w-[95vw] justify-center px-2">
          <GameConsolePanel
            embedded
            className="glass-panel pointer-events-auto w-full max-w-3xl"
            consoleLines={playConsoleLines}
            isConsoleVisible={isConsoleVisible || isInstalling || installPaused}
            gameStatus={gameStatus}
            language={language}
            isDetached={false}
            onClearConsole={onClearConsole}
            onToggleConsole={onToggleConsole}
            onToggleDetached={handleToggleConsoleDetached}
          />
        </div>
      )}
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

