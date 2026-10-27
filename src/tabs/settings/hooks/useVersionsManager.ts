import type { NotificationKind } from "../../../app/notifications";
import type { Language } from "../../../i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type LoaderVersionOption,
  type VersionDeleteScope,
  type VersionInstallDetails,
  type VersionIntegrityCheckResult,
  type VersionListItem,
} from "../types";
import {
  type DownloadProgressPayload,
  type ForgeVersionSummary,
  type LoaderId,
  type NeoForgeVersionSummary,
  type Settings,
  type SettingsTabId,
  type VersionSummary,
} from "../../../app/types";
import { invoke } from "@tauri-apps/api/core";
import { confirmDialog } from "../../../lib/confirmDialog";
import { subscribeTauriEvent } from "../../../lib/tauriEvents";
import { isVersionInstallConsoleLine } from "../../../lib/gameConsoleFilter";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { gameVersionFromListItem } from "../versionUtils";

type VersionsManagerDeps = {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  settings: Settings | null;
  settingsTab: SettingsTabId;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  language: Language;
};

export function useVersionsManager(deps: VersionsManagerDeps) {
  const {
    tt,
    settings,
    settingsTab,
    showNotification,
    language,
  } = deps;

  const [availableVersions, setAvailableVersions] = useState<VersionListItem[] | null>(null);
  const [installedVersions, setInstalledVersions] = useState<string[]>([]);
  const [installedFabricGameVersions, setInstalledFabricGameVersions] = useState<string[]>([]);
  const [installedQuiltGameVersions, setInstalledQuiltGameVersions] = useState<string[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [installingVersionId, setInstallingVersionId] = useState<string | null>(null);
  const [checkingVersionId, setCheckingVersionId] = useState<string | null>(null);
  const [versionsLoader, setVersionsLoader] = useState<LoaderId>("vanilla");
  const [isVersionFilterDropdownOpen, setIsVersionFilterDropdownOpen] = useState(false);
  const [versionFilterQuery, setVersionFilterQuery] = useState("");
  const [selectedVersionFilterId, setSelectedVersionFilterId] = useState<string | null>(null);

  const [repairPrompt, setRepairPrompt] = useState<{
    version: VersionListItem;
    result: VersionIntegrityCheckResult;
  } | null>(null);

  const [reinstallDialog, setReinstallDialog] = useState<{
    version: VersionListItem;
    gameVersion: string;
    selectedLoaderVersion: string;
  } | null>(null);

  const [deleteDialog, setDeleteDialog] = useState<{
    version: VersionListItem;
    details: VersionInstallDetails;
  } | null>(null);

  const [simpleDeleteDialog, setSimpleDeleteDialog] = useState<{
    version: VersionListItem;
    scope: VersionDeleteScope;
    targetLabel: string;
  } | null>(null);

  const [reinstallLoaderOptions, setReinstallLoaderOptions] = useState<LoaderVersionOption[]>([]);
  const [reinstallLoaderLoading, setReinstallLoaderLoading] = useState(false);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);

  const [skipRepairPrompt, setSkipRepairPrompt] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("skip_version_repair_prompt") === "1";
    } catch {
      return false;
    }
  });

  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgressPayload>>(
    {},
  );

  const [installLogLines, setInstallLogLines] = useState<
    { line: string; source: "stdout" | "stderr" }[]
  >([]);

  const installLogEndRef = useRef<HTMLDivElement | null>(null);
  const versionsFilterDropdownRef = useRef<HTMLDivElement | null>(null);
  const versionFilterInputRef = useRef<HTMLInputElement | null>(null);
  const versionFilterListRef = useRef<HTMLDivElement | null>(null);
  const selectedVersionFilterButtonRef = useRef<HTMLButtonElement | null>(null);

  const versionFilterOptions = useMemo(() => {
    if (!availableVersions) return [];
    const q = versionFilterQuery.trim().toLowerCase();
    if (!q) return availableVersions;
    return availableVersions.filter((v) => v.id.toLowerCase().includes(q));
  }, [availableVersions, versionFilterQuery]);

  const selectedVersionFilterLabel = useMemo(() => {
    if (!selectedVersionFilterId) return tt("settings.versions.versionFilter.all");
    return selectedVersionFilterId;
  }, [selectedVersionFilterId, tt]);

  const filteredAvailableVersions = useMemo(() => {
    if (!availableVersions) return [];
    if (!selectedVersionFilterId) return availableVersions;
    return availableVersions.filter((v) => v.id === selectedVersionFilterId);
  }, [availableVersions, selectedVersionFilterId]);

  const loadInstalledVersions = async () => {
    const ids = await invoke<string[]>("list_installed_versions");
    setInstalledVersions(ids);
    try {
      const fabric = await invoke<string[]>("list_installed_fabric_game_versions");
      setInstalledFabricGameVersions(fabric ?? []);
    } catch {
      setInstalledFabricGameVersions([]);
    }
    try {
      const quilt = await invoke<string[]>("list_installed_quilt_game_versions");
      setInstalledQuiltGameVersions(quilt ?? []);
    } catch {
      setInstalledQuiltGameVersions([]);
    }
  };

  const loadAvailableByLoader = async (loader: LoaderId): Promise<VersionListItem[]> => {
    if (loader === "forge") {
      const result = await invoke<ForgeVersionSummary[]>("fetch_forge_versions");
      return result.map((v) => ({
        id: v.id,
        version_type: "forge",
        release_time: "",
        installer_url: v.installer_url,
        loader: "forge",
      }));
    }
    if (loader === "neoforge") {
      const result = await invoke<NeoForgeVersionSummary[]>("fetch_neoforge_versions");
      return result.map((v) => ({
        id: v.id,
        version_type: "neoforge",
        release_time: "",
        installer_url: v.installer_url,
        loader: "neoforge",
      }));
    }

    const filtered = await invoke<VersionSummary[]>("fetch_versions_for_loader", {
      loader,
      showSnapshots: settings?.show_snapshots ?? false,
      showAlpha: settings?.show_alpha_versions ?? false,
    });
    return filtered.map((v) => ({ ...v, loader }));
  };

  useEffect(() => {
    let isMounted = true;
    const refreshAvailable = async () => {
      if (settingsTab !== "versions") return;
      setIsLoadingVersions(true);
      try {
        const [available] = await Promise.all([
          loadAvailableByLoader(versionsLoader),
          loadInstalledVersions(),
        ]);
        if (!isMounted) return;
        setAvailableVersions(available);
      } catch (e) {
        console.error("Failed to load versions list:", e);
        if (isMounted) {
          showNotification("error", tt("settings.versions.loadFailed"));
        }
      } finally {
        if (isMounted) {
          setIsLoadingVersions(false);
        }
      }
    };
    void refreshAvailable();
    return () => {
      isMounted = false;
    };
  }, [settingsTab, settings?.show_snapshots, settings?.show_alpha_versions, versionsLoader, language]);

  useEffect(() => {
    setSelectedVersionFilterId(null);
    setVersionFilterQuery("");
    setIsVersionFilterDropdownOpen(false);
  }, [versionsLoader]);

  useEffect(() => {
    if (!isVersionFilterDropdownOpen) return;
    requestAnimationFrame(() => {
      try {
        versionFilterInputRef.current?.focus({ preventScroll: true });
      } catch {
        versionFilterInputRef.current?.focus();
      }
      const container = versionFilterListRef.current;
      const selectedButton = selectedVersionFilterButtonRef.current;
      if (!container || !selectedButton) return;
      const cRect = container.getBoundingClientRect();
      const iRect = selectedButton.getBoundingClientRect();
      const centerOffset = (iRect.top - cRect.top) - (cRect.height / 2 - iRect.height / 2);
      container.scrollTop = Math.max(0, Math.min(container.scrollHeight, container.scrollTop + centerOffset));
    });
  }, [isVersionFilterDropdownOpen, versionFilterOptions.length]);

  useEffect(() => {
    return subscribeTauriEvent<DownloadProgressPayload>("download-progress", (event) => {
      const payload = event.payload;
      setDownloadProgress((prev) => ({
        ...prev,
        [payload.version_id]: payload,
      }));
    });
  }, []);

  useEffect(() => {
    if (!installingVersionId) {
      setInstallLogLines([]);
      return;
    }

    return subscribeTauriEvent<{ line: string; source?: string }>("game-console-line", (event) => {
      const payload = event.payload;
      const text =
        typeof payload === "string"
          ? payload
          : typeof payload.line === "string"
            ? payload.line
            : "";
      if (!text || !isVersionInstallConsoleLine(text)) return;
      const source: "stdout" | "stderr" =
        typeof payload === "string"
          ? "stdout"
          : payload.source === "stderr"
            ? "stderr"
            : "stdout";
      setInstallLogLines((prev) => [...prev.slice(-199), { line: text, source }]);
    });
  }, [installingVersionId]);

  useEffect(() => {
    if (!installingVersionId) return;
    installLogEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [installLogLines, installingVersionId]);

  const handleImportCustomVersion = async () => {
    try {
      const jsonPath = await openFile({
        multiple: false,
        filters: [{ name: "Minecraft version JSON", extensions: ["json"] }],
      });
      if (!jsonPath || typeof jsonPath !== "string") return;

      const wantJar = await confirmDialog({
        message: tt("settings.versions.custom.importJarPrompt"),
        tone: "default",
        confirmLabel: tt("common.yes"),
        cancelLabel: tt("common.no"),
      });
      let jarPath: string | null = null;
      if (wantJar) {
        const picked = await openFile({
          multiple: false,
          filters: [{ name: "Minecraft client JAR", extensions: ["jar"] }],
        });
        if (picked && typeof picked === "string") {
          jarPath = picked;
        }
      }

      const versionId = await invoke<string>("import_custom_version", {
        jsonPath,
        jarPath,
      });
      showNotification(
        "success",
        tt("settings.versions.custom.importSuccess", { version: versionId }),
        { sound: true },
      );
      const [available] = await Promise.all([
        loadAvailableByLoader(versionsLoader),
        loadInstalledVersions(),
      ]);
      setAvailableVersions(available);
    } catch (e) {
      console.error("Failed to import custom version:", e);
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("settings.versions.custom.importFailed", { msg }));
    }
  };

  const loadReinstallLoaderOptions = useCallback(
    async (version: VersionListItem, gameVersion: string) => {
      if (version.loader === "vanilla") {
        setReinstallLoaderOptions([]);
        return;
      }
      setReinstallLoaderLoading(true);
      try {
        let options: LoaderVersionOption[] = [];
        if (version.loader === "fabric") {
          options = await invoke<LoaderVersionOption[]>("fetch_fabric_loaders", {
            gameVersion,
          });
        } else if (version.loader === "quilt") {
          options = await invoke<LoaderVersionOption[]>("fetch_quilt_loaders", {
            gameVersion,
          });
        } else if (version.loader === "forge") {
          options = await invoke<LoaderVersionOption[]>("fetch_forge_builds_for_game", {
            gameVersion,
          });
        } else if (version.loader === "neoforge") {
          options = await invoke<LoaderVersionOption[]>("fetch_neoforge_builds_for_game", {
            gameVersion,
          });
        }
        setReinstallLoaderOptions(options);
      } catch (e) {
        console.error("Failed to load loader versions:", e);
        setReinstallLoaderOptions([]);
      } finally {
        setReinstallLoaderLoading(false);
      }
    },
    [],
  );

  const handleInstallVersion = async (
    version: VersionListItem,
    options?: { silentSuccess?: boolean; loaderVersion?: string },
  ) => {
    try {
      setInstallingVersionId(version.id);
      setInstallLogLines([]);
      const pickedLoader = options?.loaderVersion?.trim() || null;
      if (version.loader === "forge") {
        const gameVersion = gameVersionFromListItem(version);
        let versionId = version.id;
        let installerUrl = version.installer_url;
        if (pickedLoader) {
          const builds = await invoke<ForgeVersionSummary[]>("fetch_forge_versions");
          const match = builds.find(
            (v) => v.mc_version === gameVersion && v.forge_build === pickedLoader,
          );
          versionId = match?.id ?? `${gameVersion}-forge-${pickedLoader}`;
          installerUrl =
            match?.installer_url ??
            `https://forgemvn.lumintomc.ru/net/minecraftforge/forge/${gameVersion}-${pickedLoader}/forge-${gameVersion}-${pickedLoader}-installer.jar`;
        }
        if (!installerUrl) throw new Error("Missing Forge installer URL");
        await invoke("install_forge", {
          versionId,
          installerUrl,
        });
      } else if (version.loader === "neoforge") {
        const gameVersion = gameVersionFromListItem(version);
        const versionId = pickedLoader
          ? `${gameVersion}-neoforge-${pickedLoader}`
          : version.id;
        await invoke("install_neoforge", {
          versionId,
        });
      } else if (version.loader === "fabric") {
        let loaderVersion = pickedLoader;
        if (!loaderVersion) {
          const loaders = await invoke<LoaderVersionOption[]>("fetch_fabric_loaders", {
            gameVersion: version.id,
          });
          loaderVersion = loaders[0]?.version;
        }
        if (!loaderVersion) throw new Error("No suitable Fabric loader");
        await invoke("install_fabric", {
          gameVersion: version.id,
          loaderVersion,
        });
      } else if (version.loader === "quilt") {
        await invoke("install_quilt", {
          gameVersion: version.id,
          loaderVersion: pickedLoader,
        });
      } else if (version.version_type === "custom" || !version.url) {
        await invoke("install_local_version", { versionId: version.id });
      } else {
        await invoke("install_version", {
          versionId: version.id,
          versionUrl: version.url,
        });
      }
      if (!options?.silentSuccess) {
        showNotification(
          "success",
          tt("settings.versions.installSuccess", { version: version.id }),
          { sound: true },
        );
      }
      await loadInstalledVersions();
    } catch (e) {
      console.error("Failed to install version:", e);
      showNotification(
        "error",
        tt("settings.versions.installFailed", { version: version.id }),
      );
    } finally {
      setInstallingVersionId(null);
    }
  };

  const handleCheckVersionFiles = async (version: VersionListItem) => {
    try {
      setCheckingVersionId(version.id);
      const result = await invoke<VersionIntegrityCheckResult>("check_version_files_integrity", {
        versionId: version.id,
        versionUrl: version.url || null,
      });
      if (result.is_ok) {
        showNotification(
          "success",
          tt("settings.versions.verify.ok", { version: version.id }),
          { sound: true },
        );
        return;
      }

      if (skipRepairPrompt) {
        await handleInstallVersion(version, { silentSuccess: true });
        showNotification(
          "warning",
          tt("settings.versions.verify.rewritten", { version: version.id }),
          { sound: true },
        );
        return;
      }

      setRepairPrompt({ version, result });
    } catch (e) {
      console.error("Failed to verify version files:", e);
      showNotification(
        "error",
        tt("settings.versions.verify.failed", { version: version.id }),
      );
    } finally {
      setCheckingVersionId(null);
    }
  };

  const openReinstallDialog = async (version: VersionListItem) => {
    if (version.loader === "vanilla") {
      void handleInstallVersion(version);
      return;
    }
    const gameVersion = gameVersionFromListItem(version);
    let selectedLoaderVersion = "";
    try {
      const details = await invoke<VersionInstallDetails>("get_version_install_details", {
        loader: version.loader,
        itemId: version.id,
      });
      selectedLoaderVersion = details.loaderVersions[0] ?? "";
    } catch {
    }
    setReinstallDialog({ version, gameVersion, selectedLoaderVersion });
    void loadReinstallLoaderOptions(version, gameVersion);
  };

  useEffect(() => {
    if (!reinstallDialog || reinstallLoaderLoading || reinstallLoaderOptions.length === 0) {
      return;
    }
    if (reinstallDialog.selectedLoaderVersion) return;
    const first = reinstallLoaderOptions[0]?.version;
    if (!first) return;
    setReinstallDialog((prev) => (prev ? { ...prev, selectedLoaderVersion: first } : null));
  }, [reinstallDialog, reinstallLoaderLoading, reinstallLoaderOptions]);

  const confirmReinstall = async () => {
    if (!reinstallDialog) return;
    const { version, selectedLoaderVersion } = reinstallDialog;
    const loaderVersion = selectedLoaderVersion.trim();
    if (!loaderVersion) {
      showNotification("error", tt("settings.versions.manage.loaderRequired"));
      return;
    }
    setReinstallDialog(null);
    try {
      if (version.loader !== "vanilla") {
        const details = await invoke<VersionInstallDetails>("get_version_install_details", {
          loader: version.loader,
          itemId: version.id,
        });
        const changingLoader =
          details.hasLoader &&
          details.loaderVersions.length > 0 &&
          !details.loaderVersions.includes(loaderVersion);
        if (changingLoader) {
          await invoke("delete_minecraft_installation", {
            loader: version.loader,
            itemId: version.id,
            scope: "loader" as VersionDeleteScope,
          });
        }
      }
      await handleInstallVersion(version, { loaderVersion });
    } catch (e) {
      console.error("Failed to reinstall version:", e);
    }
  };

  const performDelete = async (
    version: VersionListItem,
    scope: VersionDeleteScope,
    targetLabel: string,
  ) => {
    try {
      setDeletingVersionId(version.id);
      await invoke("delete_minecraft_installation", {
        loader: version.loader,
        itemId: version.id,
        scope,
      });
      showNotification(
        "success",
        tt("settings.versions.delete.success", { target: targetLabel }),
        { sound: true },
      );
      await loadInstalledVersions();
      const available = await loadAvailableByLoader(versionsLoader);
      setAvailableVersions(available);
    } catch (e) {
      console.error("Failed to delete version:", e);
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("settings.versions.delete.failed", { msg }));
    } finally {
      setDeletingVersionId(null);
    }
  };

  const openDeleteFlow = async (version: VersionListItem) => {
    try {
      const details = await invoke<VersionInstallDetails>("get_version_install_details", {
        loader: version.loader,
        itemId: version.id,
      });
      if (!details.hasGameFiles && !details.hasLoader) {
        showNotification(
          "warning",
          tt("settings.versions.delete.simplePrompt", { version: version.id }),
        );
        return;
      }
      const needsChoice =
        version.loader !== "vanilla" && details.hasGameFiles && details.hasLoader;
      if (!needsChoice) {
        const scope: VersionDeleteScope = !details.hasGameFiles
          ? "loader"
          : details.hasLoader
            ? "all"
            : "game";
        setSimpleDeleteDialog({ version, scope, targetLabel: version.id });
        return;
      }
      setDeleteDialog({ version, details });
    } catch (e) {
      console.error("Failed to prepare delete:", e);
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("settings.versions.delete.failed", { msg }));
    }
  };

  const isVersionInstalled = (version: VersionListItem): boolean => {
    if (version.loader === "fabric") {
      return installedFabricGameVersions.includes(version.id);
    }
    if (version.loader === "quilt") {
      return installedQuiltGameVersions.includes(version.id);
    }
    return installedVersions.includes(version.id);
  };

  const handleSkipRepairPromptToggle = (value: boolean) => {
    setSkipRepairPrompt(value);
    try {
      window.localStorage.setItem("skip_version_repair_prompt", value ? "1" : "0");
    } catch {
    }
  };

  const refreshVersionsList = async () => {
    try {
      setIsLoadingVersions(true);
      const [available] = await Promise.all([
        loadAvailableByLoader(versionsLoader),
        loadInstalledVersions(),
      ]);
      setAvailableVersions(available);
    } catch (e) {
      console.error("Failed to refresh versions list:", e);
      showNotification("error", tt("settings.versions.refreshFailed"));
    } finally {
      setIsLoadingVersions(false);
    }
  };

  return {
    availableVersions,
    isLoadingVersions,
    installingVersionId,
    checkingVersionId,
    versionsLoader,
    setVersionsLoader,
    isVersionFilterDropdownOpen,
    setIsVersionFilterDropdownOpen,
    versionFilterQuery,
    setVersionFilterQuery,
    selectedVersionFilterId,
    setSelectedVersionFilterId,
    repairPrompt,
    setRepairPrompt,
    reinstallDialog,
    setReinstallDialog,
    deleteDialog,
    setDeleteDialog,
    simpleDeleteDialog,
    setSimpleDeleteDialog,
    reinstallLoaderOptions,
    reinstallLoaderLoading,
    deletingVersionId,
    skipRepairPrompt,
    downloadProgress,
    installLogLines,
    installLogEndRef,
    versionsFilterDropdownRef,
    versionFilterInputRef,
    versionFilterListRef,
    selectedVersionFilterButtonRef,
    versionFilterOptions,
    selectedVersionFilterLabel,
    filteredAvailableVersions,
    handleImportCustomVersion,
    handleInstallVersion,
    handleCheckVersionFiles,
    openReinstallDialog,
    confirmReinstall,
    performDelete,
    openDeleteFlow,
    isVersionInstalled,
    handleSkipRepairPromptToggle,
    refreshVersionsList,
  };
}
