import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useT, t } from "../i18n";
import type { DownloadJobKind } from "../hooks/useDownloadJobs";

type ModrinthContentType = "mod" | "resourcepack" | "shader" | "modpack";
type Language = "ru" | "en";

type ModrinthProjectType = "mod" | "modpack" | "resourcepack" | "shader";

type ModrinthProject = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  author: string;
  project_type: ModrinthProjectType;
};

type ModrinthSearchResponse = {
  hits: ModrinthProject[];
  limit: number;
  offset: number;
  total_hits: number;
};

type ModrinthFile = {
  url: string;
  filename: string;
  primary?: boolean;
};

type ModrinthVersion = {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthFile[];
  date_published: string;
};

type ModrinthGameVersionTag = {
  version: string;
};

type ContentProvider = "modrinth" | "curseforge";

type CurseforgeModHit = {
  id: number;
  slug: string;
  name: string;
  summary: string;
  downloadCount: number;
  thumbnailUrl: string | null;
  author: string;
  classId: number;
};

type CurseforgeFileHit = {
  id: number;
  displayName: string;
  fileName: string;
  downloadUrl: string | null;
  gameVersions: string[];
  loaders: string[];
  fileDate: string;
};

type CatalogProject = {
  key: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  author: string;
  project_type: string;
};

type CatalogVersion = {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  file_url: string;
  filename: string;
};

type NotificationKind = "info" | "success" | "error" | "warning";

type MrpackImportProgressPayload = {
  phase: string;
  current?: number;
  total?: number;
  message?: string | null;
};

type ModsTabProps = {
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean }) => void;
  language: Language;
  activeProfileId?: string | null;
  activeProfileGameVersion?: string | null;
  activeProfileLoader?: string | null;
  onOpenModpacksTab?: () => void;
  onSelectedModTitleChange?: (title: string | null) => void;
  fillPane?: boolean;
  registerDownloadJob?: (params: {
    id: string;
    label: string;
    kind: DownloadJobKind;
    percent?: number | null;
  }) => void;
  updateDownloadJob?: (id: string, percent: number | null) => void;
  finishDownloadJob?: (id: string) => void;
  makeDownloadJobId?: (prefix: string) => string;
};

function DownloadStatIcon() {
  return (
    <img
      src="/launcher-assets/download.png"
      alt=""
      className="h-3 w-3 shrink-0 object-contain"
      aria-hidden="true"
    />
  );
}

function invokeErrorMessage(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim().length > 0) return e;
  if (e instanceof Error && e.message.trim().length > 0) return e.message;
  return fallback;
}

function isDownloadCancelledMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return msg.includes("отменена") || lower.includes("cancelled") || lower.includes("canceled");
}

function HeartStatIcon() {
  return (
    <img
      src="/launcher-assets/favorite.png"
      alt=""
      className="h-4 w-4 shrink-0 object-contain"
      aria-hidden="true"
    />
  );
}

export function ModsTab({
  showNotification,
  language,
  activeProfileId,
  activeProfileGameVersion,
  activeProfileLoader,
  onOpenModpacksTab,
  onSelectedModTitleChange,
  fillPane = false,
  registerDownloadJob,
  updateDownloadJob,
  finishDownloadJob,
  makeDownloadJobId,
}: ModsTabProps) {
  const tt = useT(language);
  const [contentProvider, setContentProvider] = useState<ContentProvider>(() => {
    if (typeof window === "undefined") return "modrinth";
    try {
      const saved = window.localStorage.getItem("mods_content_provider");
      return saved === "curseforge" || saved === "modrinth" ? saved : "modrinth";
    } catch {
      return "modrinth";
    }
  });
  const [modrinthContentType, setModrinthContentType] =
    useState<ModrinthContentType>("mod");
  const [modrinthSearch, setModrinthSearch] = useState("");
  const [modrinthGameVersion, setModrinthGameVersion] = useState("1.20.1");
  const [modrinthGameVersions, setModrinthGameVersions] = useState<string[]>(
    [],
  );
  const [modrinthLoader, setModrinthLoader] =
    useState<"forge" | "fabric" | "quilt" | "neoforge" | "any">("forge");
  const [isModrinthVersionDropdownOpen, setIsModrinthVersionDropdownOpen] =
    useState(false);
  const [isModrinthLoaderDropdownOpen, setIsModrinthLoaderDropdownOpen] =
    useState(false);
  const [modrinthProjects, setModrinthProjects] = useState<ModrinthProject[]>(
    [],
  );
  const [modrinthLoading, setModrinthLoading] = useState(false);
  const [modrinthError, setModrinthError] = useState<string | null>(null);
  const [modrinthSelectedProject, setModrinthSelectedProject] =
    useState<ModrinthProject | null>(null);
  const [modrinthVersions, setModrinthVersions] = useState<ModrinthVersion[]>(
    [],
  );
  const [modrinthVersionsLoading, setModrinthVersionsLoading] =
    useState(false);
  const [modsLayout, setModsLayout] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    try {
      const saved = window.localStorage.getItem("mods_layout");
      return saved === "grid" || saved === "list" ? saved : "list";
    } catch {
      return "list";
    }
  });
  const [modrinthPage, setModrinthPage] = useState(0);
  const [modrinthTotalHits, setModrinthTotalHits] = useState(0);

  const [curseforgeProjects, setCurseforgeProjects] = useState<CurseforgeModHit[]>(
    [],
  );
  const [curseforgeLoading, setCurseforgeLoading] = useState(false);
  const [curseforgeError, setCurseforgeError] = useState<string | null>(null);
  const [curseforgeSelectedProject, setCurseforgeSelectedProject] =
    useState<CurseforgeModHit | null>(null);
  const [curseforgeVersions, setCurseforgeVersions] = useState<CurseforgeFileHit[]>(
    [],
  );
  const [curseforgeVersionsLoading, setCurseforgeVersionsLoading] =
    useState(false);
  const [curseforgePage, setCurseforgePage] = useState(0);
  const [curseforgeTotalHits, setCurseforgeTotalHits] = useState(0);

  const CATALOG_PAGE_SIZE = 30;

  const [modpackImportBusy, setModpackImportBusy] = useState(false);
  const [modpackImportProgress, setModpackImportProgress] = useState<
    MrpackImportProgressPayload | null
  >(null);

  useEffect(() => {
    if (!onSelectedModTitleChange) return;
    const title =
      contentProvider === "modrinth"
        ? modrinthSelectedProject?.title ?? null
        : curseforgeSelectedProject?.name ?? null;
    onSelectedModTitleChange(title);
  }, [
    contentProvider,
    modrinthSelectedProject,
    curseforgeSelectedProject,
    onSelectedModTitleChange,
  ]);

  const modrinthTabRefs = useRef<
    Partial<Record<ModrinthContentType, HTMLButtonElement | null>>
  >({});
  const modrinthTabsContainerRef = useRef<HTMLDivElement | null>(null);
  const [modrinthIndicator, setModrinthIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const [installedFilenames, setInstalledFilenames] = useState<Set<string>>(new Set());
  const [versionLoaderLocked, setVersionLoaderLocked] = useState(!!activeProfileId);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);

  const mapContentTypeToCategory = (t: ModrinthContentType) => {
    if (t === "mod") return "mods";
    if (t === "resourcepack") return "resourcepacks";
    if (t === "shader") return "shaderpacks";
    return "";
  };

  useEffect(() => {
    if (!activeProfileId || modrinthContentType === "modpack") {
      setInstalledFilenames(new Set());
      setVersionLoaderLocked(false);
      return;
    }
    setVersionLoaderLocked(true);
    invoke<{ name: string; enabled: boolean }[]>("list_profile_items", {
      id: activeProfileId,
      category: mapContentTypeToCategory(modrinthContentType),
    })
      .then((entries) =>
        setInstalledFilenames(new Set((entries ?? []).map((e) => e.name))),
      )
      .catch(() => setInstalledFilenames(new Set()));
  }, [activeProfileId, modrinthContentType]);

  useLayoutEffect(() => {
    if (activeProfileGameVersion) {
      setModrinthGameVersion((prev) =>
        prev === activeProfileGameVersion ? prev : activeProfileGameVersion,
      );
    }
  }, [activeProfileGameVersion]);

  useEffect(() => {
    if (!activeProfileLoader) return;
    const normalized = activeProfileLoader.toLowerCase();
    if (
      normalized === "forge" ||
      normalized === "fabric" ||
      normalized === "quilt" ||
      normalized === "neoforge"
    ) {
      setModrinthLoader(
        normalized as "forge" | "fabric" | "quilt" | "neoforge" | "any",
      );
    } else if (normalized === "vanilla") {
      setModrinthLoader("any");
    }
  }, [activeProfileLoader]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        let versions: string[] = [];
        if (contentProvider === "curseforge") {
          versions = await invoke<string[]>("curseforge_list_minecraft_versions");
        } else {
          const res = await fetch("https://api.modrinth.com/v2/tag/game_version", {
            signal: controller.signal,
          });
          if (!res.ok) {
            throw new Error(`Modrinth HTTP ${res.status}`);
          }
          const data: ModrinthGameVersionTag[] = await res.json();
          versions = data
            .map((t) => t.version)
            .filter((v) => /^1\.\d+(\.\d+)?$/.test(v));
        }
        if (versions.length > 0) {
          setModrinthGameVersions(versions);
          setModrinthGameVersion((current) =>
            versions.includes(current) ? current : versions[0],
          );
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error(e);
      }
    })();
    return () => controller.abort();
  }, [contentProvider]);

  const loadModrinthVersions = useCallback(
    async (projectId: string) => {
      setModrinthVersionsLoading(true);
      setModrinthError(null);
      try {
        const params = new URLSearchParams();
        if (modrinthGameVersion) {
          params.set("game_versions", JSON.stringify([modrinthGameVersion]));
        }
        if (modrinthContentType === "mod" && modrinthLoader !== "any") {
          params.set("loaders", JSON.stringify([modrinthLoader]));
        }
        const url = `https://api.modrinth.com/v2/project/${projectId}/version${
          params.size > 0 ? `?${params.toString()}` : ""
        }`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Modrinth HTTP ${response.status}`);
        }
        const data: ModrinthVersion[] = await response.json();
        setModrinthVersions(data);
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : "";
        const uiMessage = tt("mods.downloadFailed");
        setModrinthError(uiMessage);
        showNotification("error", uiMessage + (msg ? ` (${msg})` : ""));
      } finally {
        setModrinthVersionsLoading(false);
      }
    },
    [modrinthContentType, modrinthGameVersion, modrinthLoader, showNotification],
  );

  const loadCurseforgeVersions = useCallback(
    async (modId: number) => {
      setCurseforgeVersionsLoading(true);
      setCurseforgeError(null);
      try {
        const data = await invoke<CurseforgeFileHit[]>("curseforge_get_mod_files", {
          modId,
          gameVersion: modrinthGameVersion,
          loader: modrinthLoader,
        });
        setCurseforgeVersions(data);
      } catch (e) {
        console.error(e);
        const uiMessage = invokeErrorMessage(
          e,
          t(language, "mods.downloadFailedCurseforge"),
        );
        setCurseforgeError(uiMessage);
        showNotification("error", uiMessage);
      } finally {
        setCurseforgeVersionsLoading(false);
      }
    },
    [language, modrinthGameVersion, modrinthLoader, showNotification],
  );

  useEffect(() => {
    if (contentProvider !== "modrinth") return;
    const controller = new AbortController();

    (async () => {
      setModrinthLoading(true);
      setModrinthError(null);
      try {
        const facets: string[][] = [
          [`project_type:${modrinthContentType}`],
          [`versions:${modrinthGameVersion}`],
        ];

        if (modrinthContentType === "mod" && modrinthLoader !== "any") {
          facets.push([`categories:${modrinthLoader}`]);
        }

        const params = new URLSearchParams({
          limit: String(CATALOG_PAGE_SIZE),
          index: "downloads",
          offset: String(modrinthPage * CATALOG_PAGE_SIZE),
        });
        if (modrinthSearch.trim().length > 0) {
          params.set("query", modrinthSearch.trim());
        }
        params.set("facets", JSON.stringify(facets));

        const url = `https://api.modrinth.com/v2/search?${params.toString()}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Modrinth HTTP ${response.status}`);
        }
        const data: ModrinthSearchResponse = await response.json();
        setModrinthProjects(data.hits);
        setModrinthTotalHits(data.total_hits ?? data.hits.length);

        const nextSelected =
          data.hits.find(
            (p) => p.project_id === modrinthSelectedProject?.project_id,
          ) ?? data.hits[0] ?? null;
        setModrinthSelectedProject(nextSelected);
        if (!nextSelected) {
          setModrinthVersions([]);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return;
        }
        console.error(e);
        const msg =
          e instanceof Error ? e.message : "";
        const uiMessage = tt("mods.downloadFailed");
        setModrinthError(uiMessage);
        showNotification("error", uiMessage + (msg ? ` (${msg})` : ""));
      } finally {
        setModrinthLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    contentProvider,
    modrinthContentType,
    modrinthGameVersion,
    modrinthLoader,
    modrinthSearch,
    modrinthPage,
    CATALOG_PAGE_SIZE,
    showNotification,
  ]);

  useEffect(() => {
    if (contentProvider !== "modrinth") return;
    const projectId = modrinthSelectedProject?.project_id;
    if (!projectId) {
      setModrinthVersions([]);
      return;
    }
    void loadModrinthVersions(projectId);
  }, [
    contentProvider,
    modrinthSelectedProject?.project_id,
    modrinthGameVersion,
    modrinthLoader,
    modrinthContentType,
    loadModrinthVersions,
  ]);

  useEffect(() => {
    if (contentProvider !== "curseforge") return;
    let cancelled = false;

    (async () => {
      setCurseforgeLoading(true);
      setCurseforgeError(null);
      try {
        const data = await invoke<{
          hits: CurseforgeModHit[];
          index: number;
          pageSize: number;
          totalCount: number;
        }>("curseforge_search_mods", {
          contentType: modrinthContentType,
          searchFilter: modrinthSearch,
          gameVersion: modrinthGameVersion,
          loader: modrinthLoader,
          index: curseforgePage * CATALOG_PAGE_SIZE,
          pageSize: CATALOG_PAGE_SIZE,
        });
        if (cancelled) return;
        setCurseforgeProjects(data.hits);
        setCurseforgeTotalHits(data.totalCount ?? data.hits.length);

        const nextSelected =
          data.hits.find((p) => p.id === curseforgeSelectedProject?.id) ??
          data.hits[0] ??
          null;
        setCurseforgeSelectedProject(nextSelected);
        if (!nextSelected) {
          setCurseforgeVersions([]);
        }
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        const uiMessage = invokeErrorMessage(
          e,
          t(language, "mods.downloadFailedCurseforge"),
        );
        setCurseforgeError(uiMessage);
        showNotification("error", uiMessage);
      } finally {
        if (!cancelled) setCurseforgeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    contentProvider,
    language,
    modrinthContentType,
    modrinthGameVersion,
    modrinthLoader,
    modrinthSearch,
    curseforgePage,
    CATALOG_PAGE_SIZE,
    showNotification,
  ]);

  useEffect(() => {
    if (contentProvider !== "curseforge") return;
    const modId = curseforgeSelectedProject?.id;
    if (!modId) {
      setCurseforgeVersions([]);
      return;
    }
    void loadCurseforgeVersions(modId);
  }, [
    contentProvider,
    curseforgeSelectedProject?.id,
    modrinthGameVersion,
    modrinthLoader,
    loadCurseforgeVersions,
  ]);

  useEffect(() => {
    setModrinthPage(0);
    setCurseforgePage(0);
  }, [modrinthContentType, modrinthGameVersion, modrinthLoader, contentProvider]);

  const setContentProviderPersisted = (provider: ContentProvider) => {
    setContentProvider(provider);
    setModrinthPage(0);
    setCurseforgePage(0);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("mods_content_provider", provider);
      }
    } catch {
    }
  };

  const modpackDownloadJobIdRef = useRef<string | null>(null);
  const modpackImportStopReasonRef = useRef<"cancel" | null>(null);

  const handleCancelModpackImport = useCallback(async () => {
    if (!modpackImportBusy) return;
    modpackImportStopReasonRef.current = "cancel";
    const jobId = modpackDownloadJobIdRef.current;
    if (jobId) {
      finishDownloadJob?.(jobId);
      modpackDownloadJobIdRef.current = null;
    }
    try {
      await invoke("cancel_download");
    } catch (e) {
      console.error("Не удалось отменить установку сборки:", e);
    }
  }, [modpackImportBusy, finishDownloadJob]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<MrpackImportProgressPayload>(
          "mrpack-import-progress",
          (event) => {
            const payload = event.payload;
            setModpackImportProgress(payload);
            const jobId = modpackDownloadJobIdRef.current;
            if (!jobId || !updateDownloadJob) return;
            if (
              payload.phase === "files" &&
              payload.current != null &&
              payload.total != null &&
              payload.total > 0
            ) {
              updateDownloadJob(
                jobId,
                (payload.current / payload.total) * 100,
              );
            }
          },
        );
      } catch (e) {
        console.error("Не удалось подписаться на прогресс импорта .mrpack:", e);
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [updateDownloadJob]);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;

    const updateIndicator = () => {
      if (cancelled) return;
      const btnEl = modrinthTabRefs.current[modrinthContentType];
      const containerEl = modrinthTabsContainerRef.current;
      if (!btnEl || !containerEl) return;

      const btnRect = btnEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      setModrinthIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateIndicator);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);

    const containerEl = modrinthTabsContainerRef.current;
    let resizeObserver: ResizeObserver | undefined;
    if (containerEl && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(containerEl);
    }

    if (typeof document !== "undefined" && (document as any).fonts?.ready) {
      void (document as any).fonts.ready
        .then(() => {
          if (!cancelled) scheduleUpdate();
        })
        .catch(() => {
          if (!cancelled) scheduleUpdate();
        });
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [modrinthContentType, contentProvider]);

  const filteredModrinthVersions = modrinthVersions.filter((v) => {
    if (modrinthGameVersion && !v.game_versions.includes(modrinthGameVersion)) {
      return false;
    }
    if (
      modrinthContentType === "mod" &&
      modrinthLoader !== "any" &&
      !v.loaders.includes(modrinthLoader)
    ) {
      return false;
    }
    return true;
  });

  const filteredCurseforgeVersions = curseforgeVersions.filter((f) => {
    if (
      modrinthGameVersion &&
      f.gameVersions.length > 0 &&
      !f.gameVersions.includes(modrinthGameVersion)
    ) {
      return false;
    }
    if (
      modrinthContentType === "mod" &&
      modrinthLoader !== "any" &&
      f.loaders.length > 0 &&
      !f.loaders.includes(modrinthLoader)
    ) {
      return false;
    }
    return true;
  });

  const catalogProjects: CatalogProject[] =
    contentProvider === "modrinth"
      ? modrinthProjects.map((p) => ({
          key: p.project_id,
          title: p.title,
          description: p.description,
          icon_url: p.icon_url,
          downloads: p.downloads,
          follows: p.follows,
          author: p.author,
          project_type: p.project_type,
        }))
      : curseforgeProjects.map((p) => ({
          key: String(p.id),
          title: p.name,
          description: p.summary,
          icon_url: p.thumbnailUrl,
          downloads: p.downloadCount,
          follows: 0,
          author: p.author,
          project_type: modrinthContentType,
        }));

  const catalogVersions: CatalogVersion[] =
    contentProvider === "modrinth"
      ? filteredModrinthVersions.map((v) => {
          const primaryFile = v.files.find((f) => f.primary) ?? v.files[0];
          return {
            id: v.id,
            version_number: v.version_number,
            game_versions: v.game_versions,
            loaders: v.loaders,
            file_url: primaryFile?.url ?? "",
            filename: primaryFile?.filename ?? "",
          };
        })
      : filteredCurseforgeVersions.map((f) => ({
          id: String(f.id),
          version_number: f.displayName,
          game_versions: f.gameVersions,
          loaders: f.loaders,
          file_url: f.downloadUrl ?? "",
          filename: f.fileName,
        }));

  const catalogLoading =
    contentProvider === "modrinth" ? modrinthLoading : curseforgeLoading;
  const catalogError =
    contentProvider === "modrinth" ? modrinthError : curseforgeError;
  const catalogVersionsLoading =
    contentProvider === "modrinth"
      ? modrinthVersionsLoading
      : curseforgeVersionsLoading;
  const catalogSelectedKey =
    contentProvider === "modrinth"
      ? modrinthSelectedProject?.project_id ?? null
      : curseforgeSelectedProject
        ? String(curseforgeSelectedProject.id)
        : null;
  const catalogTotalHits =
    contentProvider === "modrinth" ? modrinthTotalHits : curseforgeTotalHits;
  const catalogPage =
    contentProvider === "modrinth" ? modrinthPage : curseforgePage;
  const setCatalogPage =
    contentProvider === "modrinth" ? setModrinthPage : setCurseforgePage;

  const totalPages =
    catalogTotalHits > 0
      ? Math.max(1, Math.ceil(catalogTotalHits / CATALOG_PAGE_SIZE))
      : 1;
  const currentPage = catalogPage + 1;
  const canPrevPage = currentPage > 1;
  const canNextPage = currentPage < totalPages;
  const hasSelectedProject = catalogSelectedKey != null;

  const modpackImportPercent =
    modpackImportProgress?.total && modpackImportProgress.total > 0
      ? Math.round(
          ((modpackImportProgress.current ?? 0) / modpackImportProgress.total) *
            100,
        )
      : null;

  const modpackImportPhaseLabel = (() => {
    if (!modpackImportProgress) return "";
    const phase = modpackImportProgress.phase;
    if (phase === "start") return tt("mods.modpackImport.start");
    if (phase === "overrides") return tt("mods.modpackImport.overrides");
    if (phase === "files") return tt("mods.modpackImport.files");
    return phase;
  })();

  return (
    <div
      className={`flex h-full w-full flex-col min-h-0 ${
        fillPane ? "max-w-none" : "max-w-4xl"
      }`}
    >
      {showUnlockConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowUnlockConfirm(false)}
        >
          <div
            className="glass-panel max-w-md rounded-2xl border border-white/15 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-sm text-white/90">
              {tt("mods.unlockConfirm")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowUnlockConfirm(false)}
                className="interactive-press rounded-xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setVersionLoaderLocked(false);
                  setShowUnlockConfirm(false);
                }}
                className="interactive-press rounded-xl bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-400"
              >
                {tt("common.change")}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="relative z-[80] mb-4 mt-2 flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-white/12 bg-black/50 p-1 shadow-soft backdrop-blur-xl">
            {(["modrinth", "curseforge"] as ContentProvider[]).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => setContentProviderPersisted(provider)}
                className={`interactive-press rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  contentProvider === provider
                    ? "bg-white/90 text-black"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {provider === "modrinth"
                  ? tt("mods.provider.modrinth")
                  : tt("mods.provider.curseforge")}
              </button>
            ))}
          </div>
          <div
            ref={modrinthTabsContainerRef}
            className="relative grid h-10 min-w-0 flex-1 grid-cols-4 items-center overflow-hidden rounded-2xl border border-white/12 bg-black/50 p-1 shadow-soft backdrop-blur-xl"
          >
            <div
              className="pointer-events-none absolute top-1 bottom-1 rounded-lg bg-white/90 transition-all duration-200 ease-out"
              style={{
                left: `${modrinthIndicator.left}px`,
                width: `${modrinthIndicator.width}px`,
              }}
            />
            {(["mod", "resourcepack", "shader", "modpack"] as ModrinthContentType[]).map(
              (kind) => {
                const label =
                  kind === "mod"
                    ? tt("mods.tab.mods")
                    : kind === "resourcepack"
                      ? tt("mods.tab.resources")
                      : kind === "shader"
                        ? tt("mods.tab.shaders")
                        : tt("mods.tab.modpacks");
                const disabled = false;
                const active = modrinthContentType === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={disabled}
                    ref={(el) => {
                      modrinthTabRefs.current[kind] = el;
                    }}
                    onClick={() => {
                      setModrinthContentType(kind);
                      setModrinthPage(0);
                      setCurseforgePage(0);
                    }}
                    className={`interactive-press relative z-10 rounded-xl px-2 py-1.5 text-center text-xs font-semibold whitespace-nowrap transition-colors ${
                      active
                        ? "text-black"
                        : "text-white/70 hover:text-white"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    {label}
                  </button>
                );
              },
            )}
          </div>
          <div className="relative ml-auto flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-white/12 bg-black/40 px-3 shadow-soft backdrop-blur-xl">
          <span className="mr-1 text-[11px] uppercase tracking-[0.16em] text-gray-400">
            {tt("mods.version")}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (versionLoaderLocked) {
                  setShowUnlockConfirm(true);
                } else {
                  setIsModrinthVersionDropdownOpen((c) => !c);
                }
              }}
              disabled={versionLoaderLocked}
              className={`interactive-press inline-flex min-w-[88px] items-center gap-2 rounded-full border border-white/25 bg-black/70 px-3 py-1 text-xs font-semibold text-white shadow-soft ${
                versionLoaderLocked ? "cursor-not-allowed opacity-70" : "hover:border-white/60"
              }`}
              title={
                versionLoaderLocked
                  ? tt("mods.syncedHint")
                  : undefined
              }
            >
              <span className="truncate">{modrinthGameVersion || "—"}</span>
              {!versionLoaderLocked && <span className="text-[10px] text-gray-400">▾</span>}
            </button>
            {isModrinthVersionDropdownOpen && modrinthGameVersions.length > 0 && (
              <div className="absolute left-0 top-full z-[100] mt-1 max-h-64 w-32 overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                {modrinthGameVersions.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setModrinthGameVersion(v);
                      setIsModrinthVersionDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                      modrinthGameVersion === v
                        ? "bg-white/90 text-black"
                        : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <span>{v}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (versionLoaderLocked) {
                  setShowUnlockConfirm(true);
                } else {
                  setIsModrinthLoaderDropdownOpen((c) => !c);
                }
              }}
              disabled={versionLoaderLocked}
              className={`interactive-press inline-flex min-w-[96px] items-center gap-2 rounded-full border border-white/25 bg-black/70 px-3 py-1 text-xs font-semibold text-white shadow-soft ${
                versionLoaderLocked ? "cursor-not-allowed opacity-70" : "hover:border-white/60"
              }`}
            >
              <span>
                {modrinthLoader === "any"
                  ? tt("mods.loaderAny")
                  : modrinthLoader === "forge"
                    ? "Forge"
                    : modrinthLoader === "fabric"
                      ? "Fabric"
                      : modrinthLoader === "quilt"
                        ? "Quilt"
                        : "NeoForge"}
              </span>
              {!versionLoaderLocked && <span className="text-[10px] text-gray-400">▾</span>}
            </button>
            {versionLoaderLocked && activeProfileId && (
              <button
                type="button"
                onClick={() => setShowUnlockConfirm(true)}
                className="interactive-press ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80 hover:bg-white/20"
              >
                {tt("common.change")}
              </button>
            )}
            {isModrinthLoaderDropdownOpen && (
              <div className="absolute left-0 top-full z-[100] mt-1 max-h-64 w-36 overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                {[
                  { id: "forge", label: "Forge" },
                  { id: "fabric", label: "Fabric" },
                  { id: "quilt", label: "Quilt" },
                  { id: "neoforge", label: "NeoForge" },
                  {
                    id: "any",
                    label: tt("mods.loaderAll"),
                  },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setModrinthLoader(
                        opt.id as
                          | "forge"
                          | "fabric"
                          | "quilt"
                          | "neoforge"
                          | "any",
                      );
                      setIsModrinthLoaderDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                      modrinthLoader === opt.id
                        ? "bg-white/90 text-black"
                        : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/15 bg-black/40 px-3 shadow-soft backdrop-blur-xl">
            <img
              src="/launcher-assets/search.png"
              alt=""
              className="h-4 w-4 shrink-0 object-contain"
            />
            <input
              type="text"
              placeholder={tt("mods.searchPlaceholder")}
              value={modrinthSearch}
              onChange={(e) => {
                setModrinthSearch(e.target.value);
                setModrinthPage(0);
                setCurseforgePage(0);
              }}
              className="min-w-0 flex-1 bg-transparent text-xs text-white placeholder:text-white/40 focus:outline-none"
            />
          </div>
          <div className="flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-white/20 bg-black/40 p-1">
          <button
            type="button"
            onClick={() => {
              setModsLayout("list");
              try {
                if (typeof window !== "undefined") {
                  window.localStorage.setItem("mods_layout", "list");
                }
              } catch {
              }
            }}
            className={`interactive-press rounded-xl p-1.5 ${
              modsLayout === "list"
                ? "bg-white text-black shadow-soft"
                : "text-white/70 hover:bg-white/10"
            }`}
            title={tt("mods.layout.list")}
          >
            <img
              src={
                modsLayout === "list"
                  ? "/launcher-assets/list-black.png"
                  : "/launcher-assets/list.png"
              }
              alt=""
              className="h-4 w-4 object-contain"
            />
          </button>
          <button
            type="button"
            onClick={() => {
              setModsLayout("grid");
              try {
                if (typeof window !== "undefined") {
                  window.localStorage.setItem("mods_layout", "grid");
                }
              } catch {
              }
            }}
            className={`interactive-press rounded-xl p-1.5 ${
              modsLayout === "grid"
                ? "bg-white text-black shadow-soft"
                : "text-white/70 hover:bg-white/10"
            }`}
            title={tt("mods.layout.grid")}
          >
            <img
              src={
                modsLayout === "grid"
                  ? "/launcher-assets/grid-black.png"
                  : "/launcher-assets/grid.png"
              }
              alt=""
              className="h-4 w-4 object-contain"
            />
          </button>
        </div>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 pb-4">
        <div className="glass-panel relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex items-center justify-between text-xs text-white/60">
            <div className="flex items-center gap-2">
              <span className="ml-1.5">
                {catalogLoading ? tt("mods.loadingPopular") : ""}
              </span>
              {catalogError ? <span className="text-rose-300">{catalogError}</span> : null}
            </div>
          </div>
          <div className="custom-scrollbar -mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
            {catalogProjects.length > 0 && (
              <div
                className={
                  modsLayout === "grid"
                    ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                    : "flex flex-col gap-2"
                }
              >
                {catalogProjects.map((p) => {
                  const isActive = catalogSelectedKey === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        if (contentProvider === "modrinth") {
                          const hit = modrinthProjects.find(
                            (m) => m.project_id === p.key,
                          );
                          if (hit) {
                            setModrinthSelectedProject(hit);
                          }
                        } else {
                          const hit = curseforgeProjects.find(
                            (m) => String(m.id) === p.key,
                          );
                          if (hit) {
                            setCurseforgeSelectedProject(hit);
                          }
                        }
                      }}
                      className={`interactive-press w-full rounded-2xl border px-3 py-3 text-left transition ${
                        modsLayout === "grid"
                          ? "flex flex-col"
                          : "flex items-stretch"
                      } ${
                        isActive
                          ? "border-white/60 bg-white/12"
                          : "border-white/10 bg-black/35 hover:border-white/40 hover:bg-black/55"
                      }`}
                    >
                      <div className="mr-3 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                        {p.icon_url ? (
                          <img
                            src={p.icon_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-xs text-white/50">
                            {tt("mods.noIcon")}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">
                            {p.title}
                          </span>
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-300">
                            {p.project_type}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-white/70">
                          {p.description}
                        </p>
                        <p className="mt-1 text-[11px] text-white/50">
                          by {p.author}
                        </p>
                      </div>
                      <div className="flex flex-col items-end justify-between text-right text-[11px] text-white/70">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <DownloadStatIcon />
                            <span>
                              {p.downloads.toLocaleString("ru-RU")}
                            </span>
                          </div>
                          {contentProvider === "modrinth" && p.follows > 0 && (
                            <div className="flex items-center gap-1">
                              <HeartStatIcon />
                              <span>{p.follows.toLocaleString("ru-RU")}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {!catalogLoading && catalogProjects.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/15 bg-black/30 px-4 py-6 text-center text-xs text-white/60">
                {contentProvider === "curseforge"
                  ? tt("mods.nothingFoundCurseforge")
                  : tt("mods.nothingFoundModrinth")}
              </div>
            )}
          </div>
          {catalogTotalHits > CATALOG_PAGE_SIZE && (
            <div className="mt-2 flex items-center justify-between rounded-2xl bg-black/40 px-3 py-2 text-[11px] text-white/70">
              <span>
                {tt("mods.pageOf", { current: currentPage, total: totalPages })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canPrevPage || catalogLoading}
                  onClick={() =>
                    setCatalogPage((prev) => Math.max(0, prev - 1))
                  }
                  className="interactive-press rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {tt("mods.prev")}
                </button>
                <button
                  type="button"
                  disabled={!canNextPage || catalogLoading}
                  onClick={() => setCatalogPage((prev) => prev + 1)}
                  className="interactive-press rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {tt("mods.next")}
                </button>
              </div>
            </div>
          )}

        </div>

        <div className="glass-panel relative z-0 flex w-80 min-h-0 flex-shrink-0 flex-col">
          <div className="mb-2 text-xs text-white/60">
            {hasSelectedProject ? `` : tt("mods.selectProject")}
          </div>
          {modrinthContentType === "modpack" && modpackImportBusy && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white/80">
                      {tt("mods.modpackImport.title")}
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">
                      {modpackImportPhaseLabel}
                      {modpackImportProgress?.message
                        ? `: ${modpackImportProgress.message}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCancelModpackImport()}
                    className="interactive-press shrink-0 rounded-full bg-white/10 px-3 py-1 text-[10px] font-semibold text-white/80 hover:bg-white/20"
                  >
                    {tt("common.cancel")}
                  </button>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full accent-bg transition-[width] duration-200"
                    style={{
                      width: `${Math.max(0, Math.min(100, modpackImportPercent ?? 0))}%`,
                    }}
                  />
                </div>
                {modpackImportPercent != null && (
                  <div className="mt-1 text-[10px] text-white/50">
                    {modpackImportPercent}%
                  </div>
                )}
              </div>
            )}
          <div className="custom-scrollbar -mr-3 min-h-0 flex-1 overflow-y-auto pr-3">
            {catalogVersionsLoading && (
              <div className="py-8 text-center text-xs text-white/70">
                {tt("mods.versionsLoading")}
              </div>
            )}
            {!catalogVersionsLoading && hasSelectedProject && (
                <div>
                  {catalogVersions.map((v) => {
                    const isInstalled =
                      modrinthContentType !== "modpack" &&
                      v.filename &&
                      installedFilenames.has(v.filename);
                    const canDownload =
                      contentProvider === "curseforge"
                        ? Boolean(curseforgeSelectedProject && v.filename)
                        : Boolean(v.file_url && v.filename);
                    return (
                      <div
                        key={v.id}
                        className="first:mt-0 mt-2 flex items-center justify-between rounded-2xl bg-black/35 px-3 py-2 text-xs text-white/80"
                      >
                        <div className="mr-2 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-semibold">
                              {v.version_number}
                            </span>
                            {isInstalled && (
                              <span className="shrink-0 rounded-full bg-emerald-500/80 px-2 py-0.5 text-[10px] font-semibold text-white">
                                {tt("mods.installed")}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-white/55">
                            {modrinthGameVersion ? (
                              <span className="rounded-full bg-white/10 px-2 py-0.5">
                                MC {modrinthGameVersion}
                              </span>
                            ) : (
                              v.game_versions.length > 0 && (
                                <span>{v.game_versions.join(", ")}</span>
                              )
                            )}
                            {v.loaders.length > 0 && (
                              <span className="rounded-full bg-white/10 px-2 py-0.5">
                                {v.loaders.join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={
                            !canDownload ||
                            (modpackImportBusy &&
                              modrinthContentType === "modpack" &&
                              contentProvider === "modrinth")
                          }
                          onClick={async () => {
                            if (!canDownload) return;
                            const jobId = makeDownloadJobId?.("modpack") ?? `modpack-${Date.now()}`;
                            const jobLabel =
                              modrinthSelectedProject?.title ??
                              curseforgeSelectedProject?.name ??
                              v.filename;
                            const fileKind: DownloadJobKind =
                              modrinthContentType === "modpack" ? "modpack" : "mod";
                            registerDownloadJob?.({
                              id: jobId,
                              label: jobLabel,
                              kind: fileKind,
                            });
                            try {
                              if (
                                modrinthContentType === "modpack" &&
                                contentProvider === "modrinth"
                              ) {
                                modpackImportStopReasonRef.current = null;
                                try {
                                  await invoke("reset_download_cancel");
                                } catch (resetErr) {
                                  console.error(resetErr);
                                }
                                modpackDownloadJobIdRef.current = jobId;
                                setModpackImportBusy(true);
                                setModpackImportProgress({
                                  phase: "start",
                                  current: undefined,
                                  total: undefined,
                                  message: undefined,
                                });
                                const imported = await invoke<{
                                  id: string;
                                  name: string;
                                }>("download_modrinth_modpack_and_import", {
                                  url: v.file_url,
                                  filename: v.filename,
                                  iconUrl: modrinthSelectedProject?.icon_url ?? null,
                                });
                                await invoke("set_selected_profile", { id: imported.id });
                                onOpenModpacksTab?.();
                                showNotification(
                                  "success",
                                  tt("mods.modpackImportSuccess", {
                                    name: imported.name ?? imported.id,
                                  }),
                                );
                              } else if (contentProvider === "curseforge") {
                                const modId = curseforgeSelectedProject?.id;
                                if (!modId) return;
                                await invoke("download_curseforge_file", {
                                  modId,
                                  fileId: Number(v.id),
                                  category: modrinthContentType,
                                  filename: v.filename,
                                  profileId: activeProfileId ?? null,
                                });
                                if (activeProfileId) {
                                  setInstalledFilenames((prev) =>
                                    new Set([...prev, v.filename]),
                                  );
                                }
                                showNotification(
                                  "success",
                                  modrinthContentType === "modpack"
                                    ? tt("mods.curseforgeModpackHint")
                                    : activeProfileId
                                      ? tt("mods.saveSuccessProfile", {
                                          filename: v.filename,
                                        })
                                      : tt("mods.saveSuccessFolder", {
                                          filename: v.filename,
                                          folder:
                                            modrinthContentType === "mod"
                                              ? "mods"
                                              : modrinthContentType === "resourcepack"
                                                ? "resourcepacks"
                                                : modrinthContentType === "shader"
                                                  ? "shaderpacks"
                                                  : "modpacks",
                                        }),
                                );
                              } else if (
                                modrinthContentType === "mod" &&
                                contentProvider === "modrinth"
                              ) {
                                const downloaded = await invoke<
                                  { filename: string; skipped: boolean }[]
                                >("download_modrinth_with_dependencies", {
                                  category: modrinthContentType,
                                  versionId: v.id,
                                  gameVersion: modrinthGameVersion,
                                  loader: modrinthLoader,
                                  profileId: activeProfileId ?? null,
                                });
                                if (activeProfileId) {
                                  setInstalledFilenames((prev) => {
                                    const next = new Set(prev);
                                    for (const item of downloaded) {
                                      next.add(item.filename);
                                    }
                                    return next;
                                  });
                                }
                                const skippedCount = downloaded.filter(
                                  (item) => item.skipped,
                                ).length;
                                const downloadedCount =
                                  downloaded.length - skippedCount;
                                if (downloadedCount === 0) {
                                  showNotification(
                                    "success",
                                    tt("mods.alreadyInstalled", {
                                      filename: v.filename,
                                    }),
                                  );
                                } else if (skippedCount > 0) {
                                  showNotification(
                                    "success",
                                    tt("mods.saveSuccessWithDepsSkipped", {
                                      downloaded: downloadedCount,
                                      skipped: skippedCount,
                                    }),
                                  );
                                } else {
                                  const depCount = Math.max(
                                    0,
                                    downloadedCount - 1,
                                  );
                                  showNotification(
                                    "success",
                                    depCount > 0
                                      ? tt("mods.saveSuccessWithDeps", {
                                          filename: v.filename,
                                          count: depCount,
                                        })
                                      : activeProfileId
                                        ? tt("mods.saveSuccessProfile", {
                                            filename: v.filename,
                                          })
                                        : tt("mods.saveSuccessFolder", {
                                            filename: v.filename,
                                            folder: "mods",
                                          }),
                                  );
                                }
                              } else {
                                await invoke("download_modrinth_file", {
                                  category: modrinthContentType,
                                  url: v.file_url,
                                  filename: v.filename,
                                  profileId: activeProfileId ?? null,
                                });
                                if (activeProfileId) {
                                  setInstalledFilenames((prev) =>
                                    new Set([...prev, v.filename]),
                                  );
                                }
                                showNotification(
                                  "success",
                                  activeProfileId
                                    ? tt("mods.saveSuccessProfile", {
                                        filename: v.filename,
                                      })
                                    : tt("mods.saveSuccessFolder", {
                                        filename: v.filename,
                                        folder:
                                          modrinthContentType === "resourcepack"
                                            ? "resourcepacks"
                                            : "shaderpacks",
                                      }),
                                );
                              }
                            } catch (e) {
                              const msg = invokeErrorMessage(
                                e,
                                contentProvider === "curseforge"
                                  ? tt("mods.downloadFailedCurseforge")
                                  : tt("mods.downloadFailedModrinth"),
                              );
                              const cancelled =
                                modpackImportStopReasonRef.current === "cancel" ||
                                isDownloadCancelledMessage(msg);
                              console.error(e);
                              if (cancelled) {
                                showNotification("info", tt("mods.modpackImport.cancelled"));
                              } else {
                                showNotification("error", msg);
                              }
                            } finally {
                              modpackDownloadJobIdRef.current = null;
                              modpackImportStopReasonRef.current = null;
                              finishDownloadJob?.(jobId);
                              if (
                                modrinthContentType === "modpack" &&
                                contentProvider === "modrinth"
                              ) {
                                setModpackImportBusy(false);
                                setModpackImportProgress(null);
                              }
                            }
                          }}
                          className="interactive-press ml-2 inline-flex items-center justify-center rounded-full accent-bg px-3 py-1 text-[11px] font-semibold text-white shadow-soft hover:opacity-90 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
                        >
                          <DownloadStatIcon />
                          <span className="ml-1">{tt("mods.download")}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            {!catalogVersionsLoading &&
              hasSelectedProject &&
              catalogVersions.length === 0 && (
                <div className="py-8 text-center text-xs text-white/60">
                  {tt("mods.noAvailableVersions")}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

