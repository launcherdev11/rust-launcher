import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HOTKEY_REFRESH_EVENT } from "../../hooks/useHotkeys";
import { invoke } from "@tauri-apps/api/core";
import { subscribeTauriEvent } from "../../lib/tauriEvents";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT, t } from "../../i18n";
import {
  fetchCurseforgeCategories,
  fetchCurseforgeVersions,
  fetchGameVersions,
  fetchModrinthCategories,
  fetchModrinthVersions,
  searchCurseforgeCatalog,
  searchModrinthCatalog,
} from "./catalogApi";
import { CursorHint, useCursorHint } from "../../components/CursorHint";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogGrid } from "./CatalogGrid";
import { CatalogToolbar } from "./CatalogToolbar";
import {
  clearRecent,
  loadRecent,
  loadStoredSort,
  pushRecent,
  saveStoredSort,
} from "./filtersStorage";
import { fetchProjectDetail } from "./projectDetailApi";
import { ProjectDetailPage } from "./ProjectDetailPage";
import {
  CATALOG_PAGE_SIZE,
  curseforgeProjectUrl,
  invokeErrorMessage,
  mapContentTypeToCategory,
  modrinthProjectUrl,
  type CatalogCategory,
  type CatalogProject,
  type CatalogSort,
  type CatalogSourceTab,
  type CatalogVersion,
  type ContentProvider,
  type CurseforgeFileHit,
  type CurseforgeModHit,
  type LoaderFilter,
  type ModrinthContentType,
  type ModrinthProject,
  type ModrinthVersion,
  type ModsTabProps,
  type MrpackImportProgressPayload,
  type ProjectDetail,
  type SavedCatalogItem,
  type SideSupport,
} from "./types";
import {
  cancelModpackImport,
  downloadCatalogVersion,
  resolveLatestCompatibleVersion,
} from "./versionActions";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function readInitialSort(): CatalogSort {
  const saved = loadStoredSort();
  if (
    saved === "relevance" ||
    saved === "downloads" ||
    saved === "updated" ||
    saved === "newest" ||
    saved === "popularity"
  ) {
    return saved;
  }
  return "downloads";
}

export function ModsTab({
  showNotification,
  language,
  activeProfileId,
  activeProfileGameVersion,
  activeProfileLoader,
  onOpenModpacksTab,
  onSelectedModTitleChange,
  fillPane: _fillPane = false,
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
  const [contentType, setContentType] = useState<ModrinthContentType>("mod");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [gameVersion, setGameVersion] = useState("");
  const [gameVersions, setGameVersions] = useState<string[]>([]);
  const [loader, setLoader] = useState<LoaderFilter>("any");
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false);
  const [isLoaderDropdownOpen, setIsLoaderDropdownOpen] = useState(false);
  const [sort, setSort] = useState<CatalogSort>(readInitialSort);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [clientSide, setClientSide] = useState<SideSupport>("any");
  const [serverSide, setServerSide] = useState<SideSupport>("any");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [sourceTab, setSourceTab] = useState<CatalogSourceTab>("catalog");

  const [modrinthProjects, setModrinthProjects] = useState<ModrinthProject[]>(
    [],
  );
  const [curseforgeProjects, setCurseforgeProjects] = useState<
    CurseforgeModHit[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [totalHits, setTotalHits] = useState(0);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const [modrinthVersions, setModrinthVersions] = useState<ModrinthVersion[]>(
    [],
  );
  const [curseforgeVersions, setCurseforgeVersions] = useState<
    CurseforgeFileHit[]
  >([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const [layout, setLayout] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    try {
      const saved = window.localStorage.getItem("mods_layout");
      return saved === "grid" || saved === "list" ? saved : "list";
    } catch {
      return "list";
    }
  });

  const [modpackImportBusy, setModpackImportBusy] = useState(false);
  const [modpackImportProgress, setModpackImportProgress] =
    useState<MrpackImportProgressPayload | null>(null);
  const [installingKeys, setInstallingKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [batchSelectedKeys, setBatchSelectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [batchInstalling, setBatchInstalling] = useState(false);

  const [installedFilenames, setInstalledFilenames] = useState<Set<string>>(
    new Set(),
  );
  const [installedProjectKeys, setInstalledProjectKeys] = useState<Set<string>>(
    new Set(),
  );
  const projectFilenamesCacheRef = useRef<Map<string, Set<string>>>(new Map());
  const [versionLoaderLocked, setVersionLoaderLocked] = useState(
    !!activeProfileId,
  );
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const lockedHint = useCursorHint();

  const [recent, setRecent] = useState<SavedCatalogItem[]>(() => loadRecent());

  const contentTypeTabRefs = useRef<
    Partial<Record<ModrinthContentType, HTMLButtonElement | null>>
  >({});
  const contentTypeTabsRef = useRef<HTMLDivElement | null>(null);
  const [contentTypeIndicator, setContentTypeIndicator] = useState({
    left: 0,
    width: 0,
  });

  const modpackDownloadJobIdRef = useRef<string | null>(null);
  const modpackImportStopReasonRef = useRef<"cancel" | null>(null);

  useEffect(() => {
    if (!onSelectedModTitleChange) return;
    onSelectedModTitleChange(showDetail ? detail?.title ?? null : null);
  }, [showDetail, detail?.title, onSelectedModTitleChange]);

  useEffect(() => {
    if (!activeProfileId || contentType === "modpack") {
      setInstalledFilenames(new Set());
      setVersionLoaderLocked(false);
      return;
    }
    setVersionLoaderLocked(true);
    invoke<{ name: string; enabled: boolean }[]>("list_profile_items", {
      id: activeProfileId,
      category: mapContentTypeToCategory(contentType),
    })
      .then((entries) =>
        setInstalledFilenames(new Set((entries ?? []).map((e) => e.name))),
      )
      .catch(() => setInstalledFilenames(new Set()));
  }, [activeProfileId, contentType]);

  const installedFilenamesKey = useMemo(
    () => [...installedFilenames].sort().join("\0"),
    [installedFilenames],
  );

  const catalogProjectKeys = useMemo(
    () =>
      contentProvider === "modrinth"
        ? modrinthProjects.map((p) => p.project_id)
        : curseforgeProjects.map((p) => String(p.id)),
    [contentProvider, modrinthProjects, curseforgeProjects],
  );

  useEffect(() => {
    if (
      !activeProfileId ||
      installedFilenames.size === 0 ||
      contentType === "modpack" ||
      catalogProjectKeys.length === 0
    ) {
      setInstalledProjectKeys(new Set());
      return;
    }

    const cache = projectFilenamesCacheRef.current;
    const installedFromCache = new Set<string>();
    const missingKeys: string[] = [];

    for (const key of catalogProjectKeys) {
      const filenames = cache.get(key);
      if (filenames) {
        for (const name of filenames) {
          if (installedFilenames.has(name)) {
            installedFromCache.add(key);
            break;
          }
        }
      } else {
        missingKeys.push(key);
      }
    }

    setInstalledProjectKeys(installedFromCache);
    if (missingKeys.length === 0) return;

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const installed = new Set(installedFromCache);
      await Promise.all(
        missingKeys.map(async (key) => {
          try {
            let filenames: Set<string>;
            if (contentProvider === "modrinth") {
              const res = await fetch(
                `https://api.modrinth.com/v2/project/${key}/version`,
                { signal: controller.signal },
              );
              if (!res.ok) return;
              const versions: ModrinthVersion[] = await res.json();
              filenames = new Set(
                versions.flatMap((v) => v.files.map((f) => f.filename)),
              );
            } else {
              const data = await invoke<CurseforgeFileHit[]>(
                "curseforge_get_mod_files",
                {
                  modId: Number(key),
                  gameVersion: gameVersion ?? "",
                  loader: loader ?? "",
                },
              );
              filenames = new Set(data.map((f) => f.fileName));
            }
            cache.set(key, filenames);
            for (const name of filenames) {
              if (installedFilenames.has(name)) {
                installed.add(key);
                break;
              }
            }
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return;
          }
        }),
      );
      if (!cancelled) setInstalledProjectKeys(installed);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    activeProfileId,
    catalogProjectKeys,
    contentProvider,
    installedFilenames,
    installedFilenamesKey,
    contentType,
    gameVersion,
    loader,
  ]);

  useLayoutEffect(() => {
    if (activeProfileGameVersion) {
      setGameVersion((prev) =>
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
      setLoader(normalized);
    } else if (normalized === "vanilla") {
      setLoader("any");
    }
  }, [activeProfileLoader]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const versions = await fetchGameVersions(
          contentProvider,
          controller.signal,
        );
        if (versions.length > 0) {
          setGameVersions(versions);
          setGameVersion((current) =>
            !current || versions.includes(current) ? current : "",
          );
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error(e);
      }
    })();
    return () => controller.abort();
  }, [contentProvider]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const cats =
          contentProvider === "modrinth"
            ? await fetchModrinthCategories(contentType, controller.signal)
            : await fetchCurseforgeCategories(contentType);
        setCategories(cats);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error(e);
        setCategories([]);
      }
    })();
    return () => controller.abort();
  }, [contentProvider, contentType]);

  useEffect(() => {
    if (sourceTab !== "catalog") return;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = {
          provider: contentProvider,
          contentType,
          query: debouncedSearch,
          gameVersion,
          loader,
          page,
          sort,
          categoryIds: selectedCategories,
          clientSide,
          serverSide,
          signal: controller.signal,
        };
        if (contentProvider === "modrinth") {
          const result = await searchModrinthCatalog(params);
          setModrinthProjects(result.hits as ModrinthProject[]);
          setTotalHits(result.total);
        } else {
          const result = await searchCurseforgeCatalog(params);
          setCurseforgeProjects(result.hits as CurseforgeModHit[]);
          setTotalHits(result.total);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error(e);
        const uiMessage =
          contentProvider === "curseforge"
            ? invokeErrorMessage(e, t(language, "mods.downloadFailedCurseforge"))
            : tt("mods.downloadFailed");
        setError(uiMessage);
        showNotification("error", uiMessage);
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [
    sourceTab,
    contentProvider,
    contentType,
    debouncedSearch,
    gameVersion,
    loader,
    page,
    sort,
    selectedCategories,
    clientSide,
    serverSide,
    language,
    showNotification,
    tt,
    refreshNonce,
  ]);

  useEffect(() => {
    const onRefresh = () => setRefreshNonce((n) => n + 1);
    window.addEventListener(HOTKEY_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(HOTKEY_REFRESH_EVENT, onRefresh);
  }, []);

  useEffect(() => {
    setPage(0);
  }, [
    contentType,
    gameVersion,
    loader,
    contentProvider,
    sort,
    selectedCategories,
    clientSide,
    serverSide,
    debouncedSearch,
    sourceTab,
  ]);

  useEffect(() => {
    setSelectedCategories([]);
    setClientSide("any");
    setServerSide("any");
    setInstalledOnly(false);
  }, [contentType, contentProvider]);

  useLayoutEffect(() => {
    let raf = 0;
    let cancelled = false;
    const updateIndicator = () => {
      if (cancelled) return;
      const btnEl = contentTypeTabRefs.current[contentType];
      const containerEl = contentTypeTabsRef.current;
      if (!btnEl || !containerEl) return;
      const btnRect = btnEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      setContentTypeIndicator({
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
    const containerEl = contentTypeTabsRef.current;
    let resizeObserver: ResizeObserver | undefined;
    if (containerEl && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(containerEl);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [contentType, contentProvider, sourceTab]);

  useEffect(() => {
    const onProgress = (payload: MrpackImportProgressPayload) => {
      setModpackImportProgress(payload);
      const jobId = modpackDownloadJobIdRef.current;
      if (!jobId || !updateDownloadJob) return;
      if (
        (payload.phase === "files" || payload.phase === "mods") &&
        payload.current != null &&
        payload.total != null &&
        payload.total > 0
      ) {
        updateDownloadJob(jobId, (payload.current / payload.total) * 100);
      }
    };
    const unlistenMrpack = subscribeTauriEvent<MrpackImportProgressPayload>(
      "mrpack-import-progress",
      (event) => onProgress(event.payload),
    );
    const unlistenCf = subscribeTauriEvent<MrpackImportProgressPayload>(
      "curseforge-install-progress",
      (event) => onProgress(event.payload),
    );
    return () => {
      unlistenMrpack();
      unlistenCf();
    };
  }, [updateDownloadJob]);

  const filteredModrinthVersions = modrinthVersions.filter((v) => {
    if (gameVersion && !v.game_versions.includes(gameVersion)) return false;
    if (
      contentType === "mod" &&
      loader !== "any" &&
      !v.loaders.includes(loader)
    ) {
      return false;
    }
    return true;
  });

  const filteredCurseforgeVersions = curseforgeVersions.filter((f) => {
    if (
      gameVersion &&
      f.gameVersions.length > 0 &&
      !f.gameVersions.includes(gameVersion)
    ) {
      return false;
    }
    if (
      contentType === "mod" &&
      loader !== "any" &&
      f.loaders.length > 0 &&
      !f.loaders.includes(loader)
    ) {
      return false;
    }
    return true;
  });

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

  const catalogProjects: CatalogProject[] = useMemo(() => {
    if (sourceTab === "recent") {
      const list = recent.filter(
        (item) =>
          item.provider === contentProvider &&
          item.contentType === contentType,
      );
      return list.map((item) => ({
        key: item.id,
        slug: item.slug,
        title: item.title,
        description: "",
        icon_url: item.iconUrl,
        downloads: 0,
        follows: 0,
        author: "",
        project_type: item.contentType,
      }));
    }

    const mapped =
      contentProvider === "modrinth"
        ? modrinthProjects.map((p) => ({
            key: p.project_id,
            slug: p.slug,
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
            slug: p.slug,
            title: p.name,
            description: p.summary,
            icon_url: p.thumbnailUrl,
            downloads: p.downloadCount,
            follows: 0,
            author: p.author,
            project_type: contentType,
          }));

    if (installedOnly) {
      return mapped.filter((p) => installedProjectKeys.has(p.key));
    }
    return mapped;
  }, [
    sourceTab,
    recent,
    contentProvider,
    contentType,
    modrinthProjects,
    curseforgeProjects,
    installedOnly,
    installedProjectKeys,
  ]);

  const loadVersionsForProject = useCallback(
    async (key: string) => {
      setVersionsLoading(true);
      try {
        if (contentProvider === "modrinth") {
          const data = await fetchModrinthVersions(
            key,
            gameVersion,
            contentType,
            loader,
          );
          setModrinthVersions(data);
          const filenames = new Set(
            data.flatMap((v) => v.files.map((f) => f.filename)),
          );
          if (filenames.size > 0) {
            projectFilenamesCacheRef.current.set(key, filenames);
          }
        } else {
          const data = await fetchCurseforgeVersions(
            Number(key),
            gameVersion,
            loader,
          );
          setCurseforgeVersions(data);
          const filenames = new Set(data.map((f) => f.fileName));
          if (filenames.size > 0) {
            projectFilenamesCacheRef.current.set(key, filenames);
          }
        }
      } catch (e) {
        console.error(e);
        showNotification(
          "error",
          contentProvider === "curseforge"
            ? invokeErrorMessage(e, t(language, "mods.downloadFailedCurseforge"))
            : tt("mods.downloadFailed"),
        );
      } finally {
        setVersionsLoading(false);
      }
    },
    [contentProvider, contentType, gameVersion, language, loader, showNotification, tt],
  );

  const openProject = useCallback(
    async (key: string) => {
      const fromCatalog = catalogProjects.find((p) => p.key === key);
      const slug = fromCatalog?.slug || key;
      setSelectedKey(key);
      setSelectedSlug(slug);
      setShowDetail(true);
      setDetailLoading(true);
      setDetailError(null);
      setModrinthVersions([]);
      setCurseforgeVersions([]);

      try {
        const full = await fetchProjectDetail(
          contentProvider,
          key,
          contentType,
          {
            slug,
            title: fromCatalog?.title,
            description: fromCatalog?.description,
            icon_url: fromCatalog?.icon_url,
            author: fromCatalog?.author,
            downloads: fromCatalog?.downloads,
            follows: fromCatalog?.follows,
          },
        );
        if (fromCatalog?.author) full.author = fromCatalog.author;
        setDetail(full);
        setRecent(
          pushRecent({
            provider: contentProvider,
            id: key,
            slug: full.slug,
            title: full.title,
            iconUrl: full.icon_url,
            contentType,
            savedAt: Date.now(),
          }),
        );
      } catch (e) {
        console.error(e);
        setDetailError(tt("mods.detail.loadFailed"));
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }

      void loadVersionsForProject(key);
    },
    [
      catalogProjects,
      contentProvider,
      contentType,
      loadVersionsForProject,
      tt,
    ],
  );

  useEffect(() => {
    if (!showDetail || !selectedKey) return;
    void loadVersionsForProject(selectedKey);
  }, [gameVersion, loader, contentType, showDetail, selectedKey, loadVersionsForProject]);

  const setContentProviderPersisted = (provider: ContentProvider) => {
    setContentProvider(provider);
    setPage(0);
    setShowDetail(false);
    setSelectedKey(null);
    try {
      window.localStorage.setItem("mods_content_provider", provider);
    } catch {
    }
  };

  const handleSortChange = (next: CatalogSort) => {
    setSort(next);
    saveStoredSort(next);
  };

  const handleToggleCategory = (id: string) => {
    setSelectedCategories((prev) => {
      if (contentProvider === "curseforge") {
        return prev.includes(id) ? [] : [id];
      }
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  const markInstalled = useCallback(
    (filenames: string[], projectKey: string | null) => {
      setInstalledFilenames((prev) => {
        const next = new Set(prev);
        for (const name of filenames) next.add(name);
        return next;
      });
      if (projectKey) {
        setInstalledProjectKeys((prev) => new Set([...prev, projectKey]));
      }
    },
    [],
  );

  const buildDownloadDeps = useCallback(
    (projectKey: string | null) => {
      const projectDetail = detail && detail.key === projectKey ? detail : null;
      const fromCatalog = projectKey
        ? catalogProjects.find((p) => p.key === projectKey)
        : undefined;
      return {
        contentProvider,
        contentType,
        projectKey,
        gameVersion,
        loader,
        activeProfileId,
        projectTitle: projectDetail?.title ?? fromCatalog?.title ?? null,
        projectIconUrl: projectDetail?.icon_url || fromCatalog?.icon_url || null,
        tt,
        showNotification,
        registerDownloadJob,
        finishDownloadJob,
        makeDownloadJobId,
        onOpenModpacksTab,
        modpackDownloadJobIdRef,
        modpackImportStopReasonRef,
        setModpackImportBusy,
        setModpackImportProgress,
        onInstalled: markInstalled,
      };
    },
    [
      activeProfileId,
      catalogProjects,
      contentProvider,
      contentType,
      detail,
      finishDownloadJob,
      gameVersion,
      loader,
      makeDownloadJobId,
      markInstalled,
      onOpenModpacksTab,
      registerDownloadJob,
      showNotification,
      tt,
    ],
  );

  const handleCancelModpackImport = useCallback(async () => {
    await cancelModpackImport({
      busy: modpackImportBusy,
      finishDownloadJob,
      modpackDownloadJobIdRef,
      modpackImportStopReasonRef,
    });
  }, [modpackImportBusy, finishDownloadJob]);

  const addInstallingKey = useCallback((key: string) => {
    setInstallingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const removeInstallingKey = useCallback((key: string) => {
    setInstallingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const handleCatalogVersionDownload = useCallback(
    async (v: CatalogVersion, projectKeyOverride?: string | null) => {
      const projectKey =
        projectKeyOverride !== undefined ? projectKeyOverride : selectedKey;
      if (projectKey) addInstallingKey(projectKey);
      try {
        await downloadCatalogVersion(
          v,
          buildDownloadDeps(projectKey),
        );
      } finally {
        if (projectKey) removeInstallingKey(projectKey);
      }
    },
    [addInstallingKey, buildDownloadDeps, removeInstallingKey, selectedKey],
  );

  const handleQuickInstall = useCallback(
    async (key?: string) => {
      const targetKey = key ?? selectedKey;
      if (!targetKey || installingKeys.has(targetKey)) return;

      addInstallingKey(targetKey);
      try {
        const latest = await resolveLatestCompatibleVersion({
          projectKey: targetKey,
          contentProvider,
          contentType,
          gameVersion,
          loader,
          fallbackVersions:
            targetKey === selectedKey ? catalogVersions : undefined,
        });
        if (!latest) {
          showNotification("warning", tt("mods.noAvailableVersions"));
          return;
        }
        await downloadCatalogVersion(
          latest,
          buildDownloadDeps(targetKey),
        );
      } catch (e) {
        console.error(e);
        showNotification("error", tt("mods.noAvailableVersions"));
      } finally {
        removeInstallingKey(targetKey);
      }
    },
    [
      addInstallingKey,
      buildDownloadDeps,
      catalogVersions,
      contentProvider,
      contentType,
      gameVersion,
      installingKeys,
      loader,
      removeInstallingKey,
      selectedKey,
      showNotification,
      tt,
    ],
  );

  const toggleBatchSelect = useCallback((key: string) => {
    setBatchSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearBatchSelection = useCallback(() => {
    setBatchSelectedKeys(new Set());
  }, []);

  const handleBatchInstall = useCallback(async () => {
    if (batchSelectedKeys.size === 0 || batchInstalling) return;
    if (contentType === "modpack") {
      showNotification("warning", tt("mods.batch.modpackHint"));
      return;
    }

    const keys = Array.from(batchSelectedKeys).filter(
      (key) => !installedProjectKeys.has(key) && !installingKeys.has(key),
    );
    if (keys.length === 0) {
      clearBatchSelection();
      return;
    }

    setBatchInstalling(true);
    keys.forEach((key) => addInstallingKey(key));

    const BATCH_CONCURRENCY = 8;
    let ok = 0;
    let failed = 0;

    try {
      let next = 0;
      const worker = async () => {
        while (next < keys.length) {
          const targetKey = keys[next++];
          try {
            const latest = await resolveLatestCompatibleVersion({
              projectKey: targetKey,
              contentProvider,
              contentType,
              gameVersion,
              loader,
            });
            if (!latest) {
              throw new Error("no version");
            }
            await downloadCatalogVersion(
              latest,
              buildDownloadDeps(targetKey),
            );
            ok += 1;
          } catch {
            failed += 1;
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(BATCH_CONCURRENCY, keys.length) },
          worker,
        ),
      );

      if (ok > 0 && failed === 0) {
        showNotification(
          "success",
          tt("mods.batch.success", { count: ok }),
        );
      } else if (ok > 0) {
        showNotification(
          "warning",
          tt("mods.batch.partial", { ok, failed }),
        );
      } else {
        showNotification("error", tt("mods.batch.failed"));
      }
      clearBatchSelection();
    } finally {
      keys.forEach((key) => removeInstallingKey(key));
      setBatchInstalling(false);
    }
  }, [
    addInstallingKey,
    batchInstalling,
    batchSelectedKeys,
    buildDownloadDeps,
    clearBatchSelection,
    contentProvider,
    contentType,
    gameVersion,
    installedProjectKeys,
    installingKeys,
    loader,
    removeInstallingKey,
    showNotification,
    tt,
  ]);

  useEffect(() => {
    setBatchSelectedKeys(new Set());
  }, [contentProvider, contentType, sourceTab, page]);

  const externalUrl = useMemo(() => {
    if (!detail && !selectedKey) return null;
    const slug = detail?.slug || selectedSlug;
    if (contentProvider === "modrinth") {
      return modrinthProjectUrl(detail?.project_type || contentType, slug);
    }
    return curseforgeProjectUrl(slug, contentType);
  }, [contentProvider, contentType, detail, selectedKey, selectedSlug]);

  const emptyMessage =
    sourceTab === "recent"
      ? tt("mods.recent.empty")
      : contentProvider === "curseforge"
        ? tt("mods.nothingFoundCurseforge")
        : tt("mods.nothingFoundModrinth");

  return (
    <div className="flex h-full w-full min-h-0 max-w-none flex-col self-stretch">
      {showUnlockConfirm && (
        <div
          className="glass-overlay fixed inset-0 z-[200] flex items-center justify-center"
          onClick={() => setShowUnlockConfirm(false)}
        >
          <div
            className="glass-modal max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-sm font-semibold text-white">{tt("mods.unlockTitle")}</p>
            <p className="mb-4 text-sm text-white/80">{tt("mods.unlockConfirm")}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowUnlockConfirm(false)}
                className="interactive-press rounded-xl bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setVersionLoaderLocked(false);
                  setShowUnlockConfirm(false);
                }}
                className="interactive-press rounded-xl bg-warn px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-warn-line"
              >
                {tt("common.change")}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeProfileId && contentType !== "modpack" && !versionLoaderLocked && (
        <div className="relative z-10 mb-3">
          <div className="locked-hint w-full justify-between border-sky-300/25 bg-gradient-to-br from-sky-400/15 to-sky-400/5 text-sky-100">
            <span className="truncate">{tt("mods.unlockedBanner")}</span>
            <button
              type="button"
              onClick={() => setVersionLoaderLocked(true)}
              className="interactive-press shrink-0 rounded-lg bg-sky-400/20 px-3 py-1 text-[0.8125rem] font-semibold text-sky-50 hover:bg-sky-400/30"
            >
              {tt("mods.relock")}
            </button>
          </div>
        </div>
      )}

      <CursorHint
        hint={versionLoaderLocked ? lockedHint.hint : null}
        onClose={lockedHint.hide}
        title={tt("mods.lockedHintTitle")}
        action={{ label: tt("common.change"), onClick: () => setShowUnlockConfirm(true) }}
      >
        {tt("mods.lockedHintBody", {
          version: activeProfileGameVersion || gameVersion || "—",
          loader: activeProfileLoader || (loader === "any" ? "—" : loader),
        })}
      </CursorHint>

      <CatalogToolbar
        tt={tt}
        contentProvider={contentProvider}
        onProviderChange={setContentProviderPersisted}
        contentType={contentType}
        onContentTypeChange={(kind) => {
          setContentType(kind);
          setShowDetail(false);
          setSelectedKey(null);
        }}
        contentTypeIndicator={contentTypeIndicator}
        contentTypeTabRefs={contentTypeTabRefs}
        contentTypeTabsRef={contentTypeTabsRef}
        sourceTab={sourceTab}
        onSourceTabChange={(tab) => {
          setSourceTab(tab);
          setShowDetail(false);
          setSelectedKey(null);
        }}
        onClearRecent={() => setRecent(clearRecent())}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
        gameVersion={gameVersion}
        gameVersions={gameVersions}
        loader={loader}
        versionLoaderLocked={versionLoaderLocked}
        isVersionDropdownOpen={isVersionDropdownOpen}
        isLoaderDropdownOpen={isLoaderDropdownOpen}
        setIsVersionDropdownOpen={setIsVersionDropdownOpen}
        setIsLoaderDropdownOpen={setIsLoaderDropdownOpen}
        onGameVersionChange={setGameVersion}
        onLoaderChange={setLoader}
        onRequestUnlock={() => setShowUnlockConfirm(true)}
        onLockedClick={lockedHint.show}
        activeProfileId={activeProfileId}
        layout={layout}
        onLayoutChange={(next) => {
          setLayout(next);
          try {
            window.localStorage.setItem("mods_layout", next);
          } catch {
          }
        }}
      />

      <div className="relative z-10 flex min-h-0 flex-1 gap-3 pb-4">
        {!showDetail && sourceTab === "catalog" && (
          <CatalogFilters
            tt={tt}
            provider={contentProvider}
            sort={sort}
            onSortChange={handleSortChange}
            categories={categories}
            selectedCategories={selectedCategories}
            onToggleCategory={handleToggleCategory}
            clientSide={clientSide}
            serverSide={serverSide}
            onClientSideChange={setClientSide}
            onServerSideChange={setServerSide}
            installedOnly={installedOnly}
            onInstalledOnlyChange={setInstalledOnly}
            canFilterInstalled={
              !!activeProfileId && contentType !== "modpack"
            }
            onReset={() => {
              setSort("downloads");
              saveStoredSort("downloads");
              setSelectedCategories([]);
              setClientSide("any");
              setServerSide("any");
              setInstalledOnly(false);
            }}
          />
        )}

        {showDetail ? (
          <ProjectDetailPage
            key={selectedKey ?? "detail"}
            tt={tt}
            provider={contentProvider}
            detail={detail}
            loading={detailLoading}
            error={detailError}
            isInstalled={
              !!selectedKey && installedProjectKeys.has(selectedKey)
            }
            versions={catalogVersions}
            versionsLoading={versionsLoading}
            gameVersion={gameVersion}
            modpackImportBusy={modpackImportBusy}
            modpackImportProgress={modpackImportProgress}
            contentTypeIsModpack={contentType === "modpack"}
            installedFilenames={installedFilenames}
            onBack={() => {
              setShowDetail(false);
              setSelectedKey(null);
              setDetail(null);
            }}
            onOpenExternal={() => {
              if (externalUrl) void openUrl(externalUrl);
            }}
            onQuickInstall={() => void handleQuickInstall()}
            onDownloadVersion={(v) => void handleCatalogVersionDownload(v)}
            onCancelModpackImport={() => void handleCancelModpackImport()}
            canQuickInstall={contentType !== "modpack" || contentProvider === "modrinth"}
            installBusy={Boolean(selectedKey && installingKeys.has(selectedKey))}
          />
        ) : (
          <CatalogGrid
            tt={tt}
            projects={catalogProjects}
            layout={layout}
            loading={sourceTab === "catalog" ? loading : false}
            error={sourceTab === "catalog" ? error : null}
            provider={contentProvider}
            selectedKey={selectedKey}
            installedKeys={installedProjectKeys}
            installingKeys={installingKeys}
            batchSelectedKeys={batchSelectedKeys}
            batchInstalling={batchInstalling}
            allowBatchSelect={contentType !== "modpack"}
            contentTypeIsModpack={contentType === "modpack"}
            activeProfileId={activeProfileId}
            onSelect={(key) => void openProject(key)}
            onQuickInstall={(key) => void handleQuickInstall(key)}
            onToggleBatchSelect={toggleBatchSelect}
            onSetBatchSelection={setBatchSelectedKeys}
            onClearBatchSelection={clearBatchSelection}
            onBatchInstall={() => void handleBatchInstall()}
            page={sourceTab === "catalog" ? page : 0}
            totalHits={
              sourceTab === "catalog"
                ? installedOnly
                  ? catalogProjects.length
                  : totalHits
                : catalogProjects.length
            }
            pageSize={CATALOG_PAGE_SIZE}
            onPageChange={setPage}
            emptyMessage={emptyMessage}
            onRetry={() => setRefreshNonce((n) => n + 1)}
          />
        )}
      </div>
    </div>
  );
}
