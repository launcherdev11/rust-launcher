import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";

type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";
type Language = "ru" | "en";

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

type LauncherBannerData = {
  imageUrl: string;
  title?: string;
  subtitle?: string;
  link?: string;
};

type LauncherBannerResponse =
  | LauncherBannerData
  | LauncherBannerData[]
  | { banners: LauncherBannerData[] };

const BANNER_BASE_URL =
  "https://raw.githubusercontent.com/16steyy/16Launcher-News/main/";

function resolveBannerImageUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${BANNER_BASE_URL}${url.replace(/^\.?\//, "")}`;
}

type GameStatus = "idle" | "running" | "stopped" | "crashed";

type PlayTabProps = {
  gameStatus: GameStatus;
  consoleLines: { id: number; line: string; source: "stdout" | "stderr" }[];
  isConsoleVisible: boolean;
  onToggleConsole: () => void;
  onClearConsole: () => void;
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
  primaryColorClasses: string;
  primaryLabel: string;
  progress: DownloadProgressPayload | null;
  loader: LoaderId;
  setLoader: (l: LoaderId) => void;
  isLoaderDropdownOpen: boolean;
  setIsLoaderDropdownOpen: (v: boolean) => void;
  handleOpenGameFolder: () => void;
  language: Language;
  activeProfileName: string | null;
  installedVersionIds: Set<string>;
  showSnapshots: boolean;
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
  consoleLines,
  isConsoleVisible,
  onToggleConsole,
  onClearConsole,
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
  primaryColorClasses,
  primaryLabel,
  progress,
  loader,
  setLoader,
  isLoaderDropdownOpen,
  setIsLoaderDropdownOpen,
  handleOpenGameFolder,
  language,
  activeProfileName,
  installedVersionIds,
  showSnapshots,
}: PlayTabProps) {
  const tt = useT(language);
  const [banners, setBanners] = useState<LauncherBannerData[]>([]);
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const [bannerLoading, setBannerLoading] = useState(true);
  const [bannerError, setBannerError] = useState(false);

  const [isConsoleDetached, setIsConsoleDetached] = useState(false);
  const [consolePos, setConsolePos] = useState({ x: 24, y: 110 });
  const consoleWindowRef = useRef<HTMLDivElement | null>(null);

  const [isDraggingConsole, setIsDraggingConsole] = useState(false);
  const consoleDragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const [isCopyingConsole, setIsCopyingConsole] = useState(false);
  const [isConsoleCopied, setIsConsoleCopied] = useState(false);

  const consoleText = useMemo(
    () => consoleLines.map((e) => e.line).join("\n"),
    [consoleLines],
  );

  const handleCopyConsole = useCallback(async () => {
    if (isCopyingConsole) return;
    setIsCopyingConsole(true);
    let ok = false;
    try {
      await navigator.clipboard.writeText(consoleText);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = consoleText;
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
        // ignore
      }
    } finally {
      setIsCopyingConsole(false);
    }

    if (ok) {
      setIsConsoleCopied(true);
      window.setTimeout(() => setIsConsoleCopied(false), 1200);
    }
  }, [consoleText, isCopyingConsole]);

  const handleToggleConsoleDetached = useCallback(() => {
    if (!isConsoleDetached) {
      const rect = consoleWindowRef.current?.getBoundingClientRect();
      if (rect) {
        setConsolePos({ x: Math.round(rect.left), y: Math.round(rect.top) });
      }
    }
    setIsConsoleDetached((prev) => !prev);
  }, [isConsoleDetached]);

  const handleConsoleHeaderPointerDown = useCallback(
    (e: import("react").PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (!isConsoleDetached) return;

      consoleDragStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        startX: consolePos.x,
        startY: consolePos.y,
      };
      setIsDraggingConsole(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    },
    [consolePos.x, consolePos.y, isConsoleDetached],
  );

  useEffect(() => {
    if (!isDraggingConsole) return;

    const onMove = (e: PointerEvent) => {
      const drag = consoleDragStartRef.current;
      if (!drag) return;

      const panel = consoleWindowRef.current;
      const panelWidth = panel?.offsetWidth ?? 720;
      const panelHeight = panel?.offsetHeight ?? 320;

      const dx = e.clientX - drag.pointerX;
      const dy = e.clientY - drag.pointerY;

      const nextX = drag.startX + dx;
      const nextY = drag.startY + dy;

      const maxX = window.innerWidth - panelWidth - 8;
      const maxY = window.innerHeight - panelHeight - 8;

      setConsolePos({
        x: Math.max(8, Math.min(nextX, maxX)),
        y: Math.max(8, Math.min(nextY, maxY)),
      });
    };

    const onUp = () => {
      consoleDragStartRef.current = null;
      setIsDraggingConsole(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDraggingConsole]);

  const currentBanner =
    banners.length > 0 &&
    activeBannerIndex >= 0 &&
    activeBannerIndex < banners.length
      ? banners[activeBannerIndex]
      : null;

  useEffect(() => {
    const controller = new AbortController();

    async function fetchBanner() {
      try {
        setBannerError(false);

        const urls = [
          "https://raw.githubusercontent.com/16steyy/16Launcher-News/main/banner.json",
          "https://cdn.jsdelivr.net/gh/16steyy/16Launcher-News@main/banner.json",
        ];

        let lastError: unknown = null;

        for (const url of urls) {
          try {
            const response = await fetch(url, {
              signal: controller.signal,
              cache: "no-store",
            });

            if (!response.ok) {
              throw new Error(`Failed to load banner: ${response.status}`);
            }

            const raw = (await response.json()) as LauncherBannerResponse;

            let parsed: LauncherBannerData[] = [];

            if (Array.isArray(raw)) {
              parsed = raw;
            } else if (raw && "banners" in raw && Array.isArray((raw as any).banners)) {
              parsed = (raw as { banners: LauncherBannerData[] }).banners;
            } else if (raw && typeof raw === "object" && "imageUrl" in raw) {
              parsed = [raw as LauncherBannerData];
            }

            parsed = parsed.filter(
              (b) => typeof b.imageUrl === "string" && b.imageUrl.trim().length > 0,
            );

            if (parsed.length > 0) {
              setBanners(parsed);
              setActiveBannerIndex(0);
              return;
            }

            throw new Error("Invalid banner format");
          } catch (err) {
            if (controller.signal.aborted) return;
            lastError = err;
          }
        }

        throw lastError ?? new Error("Failed to load banner from all sources");
      } catch (error) {
        console.error(error);
        setBannerError(true);
      } finally {
        setBannerLoading(false);
      }
    }

    fetchBanner();

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
    if (/^\d{2}w\d{2}[a-z]$/i.test(v)) return true; // 24w14a
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

  const statusDotClass =
    gameStatus === "running"
      ? "bg-emerald-400"
      : gameStatus === "crashed"
        ? "bg-red-500"
        : gameStatus === "stopped"
          ? "bg-sky-400"
          : "bg-gray-500";

  return (
    <>
      <div className="glass-panel relative flex h-[260px] w-full max-w-1xl overflow-hidden rounded-3xl">
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
              {currentBanner.link && (
                <div className="mt-4">
                  <a
                    href={currentBanner.link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20"
                  >
                    {tt("play.banner.learnMore")}
                    <span className="ml-1 text-[10px]">↗</span>
                  </a>
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

      <div className="pointer-events-none relative mt-auto mb-10 flex w-full max-w-[95vw] justify-center px-2">
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
                  className={`interactive-press rounded-full px-12 py-3 text-sm font-semibold tracking-wide text-white shadow-soft transition-colors sm:px-16 ${primaryColorClasses}`}
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

      {activeProfileName && (
        <div className="mt-2 flex w-full max-w-[95vw] justify-center px-2">
          <div className="rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/85 shadow-soft backdrop-blur-md">
            {tt("play.profile.selected", { name: activeProfileName })}
          </div>
        </div>
      )}

      {showConsoleOnLaunch && (
        <>
          {!isConsoleDetached ? (
            <div className="mt-4 flex w-full max-w-[95vw] justify-center px-2">
              <div
                ref={consoleWindowRef}
                className="glass-panel pointer-events-auto w-full max-w-3xl rounded-2xl border border-white/12 bg-black/65 px-4 py-3 shadow-soft backdrop-blur-xl"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
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
                      data-no-console-drag
                      className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20"
                    >
                      {tt("play.console.clear")}
                    </button>
                    <button
                      type="button"
                      onClick={onToggleConsole}
                      data-no-console-drag
                      className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20"
                    >
                      {isConsoleVisible
                        ? tt("play.console.hide")
                        : tt("play.console.show")}
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyConsole}
                      data-no-console-drag
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
                      onClick={handleToggleConsoleDetached}
                      data-no-console-drag
                      className="interactive-press inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
                      title={tt("play.console.detach")}
                      aria-label={tt("play.console.detach")}
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
                      <div className="mt-2 h-44 w-full overflow-y-auto rounded-xl bg-black/80 px-3 py-2 text-[11px] font-mono text-white/80">
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
                      <div className="mt-2 flex h-24 w-full items-center justify-center rounded-xl bg-black/70 px-3 py-2 text-[11px] text-white/60">
                        {tt("play.console.empty")}
                      </div>
                    )}

                    <p className="mt-2 text-[10px] text-white/40">
                      {tt("play.console.hint")}
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div
              ref={consoleWindowRef}
              className="pointer-events-auto fixed z-50 w-[min(90vw,48rem)] rounded-2xl border border-white/12 bg-black/65 px-4 py-3 shadow-soft backdrop-blur-xl"
              style={{
                left: consolePos.x,
                top: consolePos.y,
              }}
            >
              <div
                className="mb-2 flex items-center justify-between gap-2 select-none touch-none"
                style={{ cursor: isDraggingConsole ? "grabbing" : "grab" }}
                onPointerDown={handleConsoleHeaderPointerDown}
              >
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
                    data-no-console-drag
                    className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20"
                  >
                    {tt("play.console.clear")}
                  </button>
                  <button
                    type="button"
                    onClick={onToggleConsole}
                    data-no-console-drag
                    className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20"
                  >
                    {isConsoleVisible
                      ? tt("play.console.hide")
                      : tt("play.console.show")}
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyConsole}
                    data-no-console-drag
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
                    onClick={handleToggleConsoleDetached}
                    data-no-console-drag
                    className="interactive-press inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
                    title={tt("play.console.attach")}
                    aria-label={tt("play.console.attach")}
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
                    <div className="mt-2 h-44 w-full overflow-y-auto rounded-xl bg-black/80 px-3 py-2 text-[11px] font-mono text-white/80">
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
                    <div className="mt-2 flex h-24 w-full items-center justify-center rounded-xl bg-black/70 px-3 py-2 text-[11px] text-white/60">
                      {tt("play.console.empty")}
                    </div>
                  )}

                  <p className="mt-2 text-[10px] text-white/40">
                    {tt("play.console.hint")}
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

