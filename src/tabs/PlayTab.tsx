import { useEffect, useState } from "react";

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

type VersionItem = VersionSummary | ForgeVersionSummary;

function isForgeVersion(v: VersionItem): v is ForgeVersionSummary {
  return "forge_build" in v && "installer_url" in v;
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

type PlayTabProps = {
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
};

const loaderLabels: Record<LoaderId, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  quilt: "Quilt",
  neoforge: "NeoForge",
};

export function PlayTab({
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
}: PlayTabProps) {
  const [banners, setBanners] = useState<LauncherBannerData[]>([]);
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const [bannerLoading, setBannerLoading] = useState(true);
  const [bannerError, setBannerError] = useState(false);

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
          // Прямой raw GitHub — всегда свежий banner.json
          "https://raw.githubusercontent.com/16steyy/16Launcher-News/main/banner.json",
          // CDN как запасной вариант
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
            // если запрос отменили при размонтировании — выходим
            if (controller.signal.aborted) return;
            lastError = err;
          }
        }

        // если ни один из URL не сработал
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
    return v.id;
  };

  return (
    <>
      <div className="glass-panel relative flex h-[260px] w-full max-w-1xl overflow-hidden rounded-3xl">
        {bannerLoading ? (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm font-medium tracking-wide text-white/70">
              {language === "ru"
                ? "Загрузка новостей лаунчера..."
                : "Loading launcher news..."}
            </span>
          </div>
        ) : bannerError ? (
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center">
            <span className="text-sm font-medium tracking-wide text-red-300">
              {language === "ru"
                ? "Не удалось загрузить баннер лаунчера."
                : "Failed to load launcher banner."}
            </span>
            <span className="mt-1 text-xs text-white/60">
              {language === "ru"
                ? "Проверь подключение к интернету или доступ к GitHub."
                : "Check your internet connection or access to GitHub."}
            </span>
          </div>
        ) : currentBanner ? (
          <>
            <img
              src={resolveBannerImageUrl(currentBanner.imageUrl)}
              alt={
                currentBanner.title ??
                (language === "ru" ? "Баннер лаунчера" : "Launcher banner")
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
                    {language === "ru" ? "Подробнее" : "Learn more"}
                    <span className="ml-1 text-[10px]">↗</span>
                  </a>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm font-medium tracking-wide text-white/70">
              {language === "ru"
                ? "Новости лаунчера и баннер игры"
                : "Launcher news and game banner"}
            </span>
          </div>
        )}
      </div>

      <div className="pointer-events-none relative mt-auto mb-10 flex w-full max-w-[95vw] justify-center px-2">
        <div className="pointer-events-auto relative w-full max-w-2xl">
          <div className="glass-chip flex flex-wrap items-center justify-center gap-4 px-6 py-4 sm:gap-6 sm:px-8">
            <div className="relative flex flex-col text-left">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-400">
                {language === "ru" ? "Версия" : "Version"}
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
                      ? language === "ru"
                        ? "Загрузка..."
                        : "Loading..."
                      : language === "ru"
                        ? "Выберите версию"
                        : "Select version"}
                </span>
                <span className="shrink-0 text-xs text-gray-400">▾</span>
              </button>

              {isVersionDropdownOpen && versions.length > 0 && (
                <div className="absolute left-0 bottom-full mb-2 z-30 max-h-[min(70vh,320px)] w-56 overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSelectedVersion(v);
                        setIsVersionDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                        selectedVersion && selectedVersion.id === v.id
                          ? "bg-white/90 text-black"
                          : "text-white/80 hover:bg-white/10"
                      }`}
                    >
                      <span>{versionDisplayName(v)}</span>
                      {!isForgeVersion(v) && (
                        <span className="ml-2 text-[10px] uppercase text-gray-400">
                          {(v as VersionSummary).version_type}
                        </span>
                      )}
                    </button>
                  ))}
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
                      className="interactive-press rounded-xl bg-accentBlue px-6 py-2 text-sm font-semibold text-white shadow-soft hover:bg-sky-500"
                    >
                      {installPaused
                        ? language === "ru"
                          ? "Продолжить"
                          : "Resume"
                        : language === "ru"
                          ? "Пауза"
                          : "Pause"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelInstall}
                      className="interactive-press rounded-xl bg-red-600 px-6 py-2 text-sm font-semibold text-white shadow-soft hover:bg-red-500"
                    >
                      {language === "ru" ? "Отменить" : "Cancel"}
                    </button>
                  </div>
                  <div className="mt-1 w-full max-w-md">
                    <div className="h-3 w-full overflow-hidden rounded-full bg-black/40">
                      <div
                        className="h-full rounded-full bg-accentGreen transition-[width] duration-200"
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
                        : language === "ru"
                          ? "Подготовка файлов..."
                          : "Preparing files..."}
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
                {language === "ru" ? "Загрузчик" : "Loader"}
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
                  {(["vanilla", "fabric", "forge", "quilt"] as LoaderId[]).map((id) => {
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
            title={language === "ru" ? "Открыть папку игры" : "Open game folder"}
            className="interactive-press pointer-events-auto absolute -right-14 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-gray-200 shadow-soft hover:border-white/40 hover:bg-black/80 hover:text-white"
          >
            <img
              src="/launcher-assets/folder.png"
              alt={language === "ru" ? "Папка игры" : "Game folder"}
              className="h-6 w-6 object-contain"
            />
          </button>
        </div>
      </div>
    </>
  );
}

