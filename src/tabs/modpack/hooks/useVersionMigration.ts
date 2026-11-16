import type { Language } from "../../../i18n";
import type { DownloadJobKind } from "../../../hooks/useDownloadJobs";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ContentTab,
  type InstanceProfile,
  type LoaderId,
  type LoaderVersionOption,
  type NotificationKind,
  type ProfileIncompatibleContent,
  type ProfileVersionChangePreview,
  type VersionSummary,
} from "../types";
import { invoke } from "@tauri-apps/api/core";
import { pickDefaultLoaderVersion } from "../helpers";
import { installGameAndLoader as installGameAndLoaderFiles } from "../../../lib/installGameAndLoader";
import { t } from "../../../i18n";

type VersionMigrationDeps = {
  selectedProfile: InstanceProfile | null;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  language: Language;
  prepareInstallConsole: ((profileId?: string | null) => void) | undefined;
  selectedProfileId: string | null;
  setSelectedLogSessionId: Dispatch<SetStateAction<string>>;
  setManageConsoleExpanded: Dispatch<SetStateAction<boolean>>;
  registerDownloadJob: ((params: { id: string; label: string; kind: DownloadJobKind; percent?: number | null; }) => void) | undefined;
  finishDownloadJob: ((id: string) => void) | undefined;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  applyContentUpdatesAfterVersionChange: (profileId: string) => Promise<{ updated: number; incompatible: ProfileIncompatibleContent[]; }>;
  setProfiles: Dispatch<SetStateAction<InstanceProfile[]>>;
  onProfilesChange: ((profiles: InstanceProfile[]) => void) | undefined;
  onProfileSelectionChange: ((profile: InstanceProfile | null) => void) | undefined;
  refreshItems: (id: string, tab: ContentTab) => Promise<void>;
  contentTab: ContentTab;
};

export function useVersionMigration(deps: VersionMigrationDeps) {
  const {
    selectedProfile,
    showNotification,
    language,
    prepareInstallConsole,
    selectedProfileId,
    setSelectedLogSessionId,
    setManageConsoleExpanded,
    registerDownloadJob,
    finishDownloadJob,
    tt,
    applyContentUpdatesAfterVersionChange,
    setProfiles,
    onProfilesChange,
    onProfileSelectionChange,
    refreshItems,
    contentTab,
  } = deps;

  const [backupBeforeVersionChange, setBackupBeforeVersionChange] = useState(true);
  const [isChangeVersionOpen, setIsChangeVersionOpen] = useState(false);
  const [migrateLoader, setMigrateLoader] = useState<LoaderId>("vanilla");
  const [migrateGameVersion, setMigrateGameVersion] = useState("");
  const [migrateLoaderVersion, setMigrateLoaderVersion] = useState("");
  const [migrateLoaderVersionOptions, setMigrateLoaderVersionOptions] = useState<LoaderVersionOption[]>([]);
  const [migrateLoaderVersionsLoading, setMigrateLoaderVersionsLoading] = useState(false);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [isMigrateVersionDropdownOpen, setIsMigrateVersionDropdownOpen] = useState(false);
  const [isMigrateLoaderVersionDropdownOpen, setIsMigrateLoaderVersionDropdownOpen] = useState(false);
  const [migrateAllVersions, setMigrateAllVersions] = useState(false);
  const [migrateVersionOptions, setMigrateVersionOptions] = useState<VersionSummary[]>([]);
  const [migrateVersionsLoading, setMigrateVersionsLoading] = useState(false);
  const migrateLoaderRequestRef = useRef(0);
  const [migratePreview, setMigratePreview] = useState<ProfileVersionChangePreview | null>(null);
  const [migratePreviewLoading, setMigratePreviewLoading] = useState(false);
  const [migratePreviewFailed, setMigratePreviewFailed] = useState(false);
  const migratePreviewRequestRef = useRef(0);

  async function ensureMigrateVersionsLoaded() {
    if (migrateVersionOptions.length > 0 || migrateVersionsLoading) return;
    setMigrateVersionsLoading(true);
    try {
      const all = await invoke<VersionSummary[]>("fetch_all_versions");
      const filtered = all.filter((v) =>
        migrateAllVersions ? true : v.version_type === "release",
      );
      setMigrateVersionOptions(filtered);
    } catch (e) {
      console.error(e);
    } finally {
      setMigrateVersionsLoading(false);
    }
  }

  const loadMigrateLoaderVersions = useCallback(async () => {
    if (!selectedProfile) return;
    const loader = migrateLoader;
    if (loader === "vanilla") {
      setMigrateLoaderVersionOptions([]);
      setMigrateLoaderVersion("");
      return;
    }
    const requestId = ++migrateLoaderRequestRef.current;
    setMigrateLoaderVersionsLoading(true);
    try {
      let options: LoaderVersionOption[] = [];
      if (loader === "fabric") {
        options = await invoke<LoaderVersionOption[]>("fetch_fabric_loaders", {
          gameVersion: migrateGameVersion,
        });
      } else if (loader === "quilt") {
        options = await invoke<LoaderVersionOption[]>("fetch_quilt_loaders", {
          gameVersion: migrateGameVersion,
        });
      } else if (loader === "forge") {
        options = await invoke<LoaderVersionOption[]>("fetch_forge_builds_for_game", {
          gameVersion: migrateGameVersion,
        });
      } else if (loader === "neoforge") {
        options = await invoke<LoaderVersionOption[]>("fetch_neoforge_builds_for_game", {
          gameVersion: migrateGameVersion,
        });
      }
      if (requestId !== migrateLoaderRequestRef.current) return;
      setMigrateLoaderVersionOptions(options);
      const versionIds = options.map((o) => o.version);
      setMigrateLoaderVersion((prev) =>
        prev && versionIds.includes(prev) ? prev : pickDefaultLoaderVersion(options),
      );
    } catch (e) {
      console.error(e);
      if (requestId !== migrateLoaderRequestRef.current) return;
      setMigrateLoaderVersionOptions([]);
      setMigrateLoaderVersion("");
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", t(language, "modpacks.toast.loadLoaderVersionsFailed", { msg }));
    } finally {
      if (requestId === migrateLoaderRequestRef.current) {
        setMigrateLoaderVersionsLoading(false);
      }
    }
  }, [selectedProfile, migrateLoader, migrateGameVersion, language, showNotification]);

  const installGameAndLoader = useCallback(
    async (
      gameVersion: string,
      loader: LoaderId,
      loaderVersion: string | null,
      versions: VersionSummary[],
    ) => {
      prepareInstallConsole?.(selectedProfileId);
      setSelectedLogSessionId("live");
      setManageConsoleExpanded(true);

      const loaderToastKey: Record<Exclude<LoaderId, "vanilla">, string> = {
        fabric: "modpacks.toast.installingFabric",
        quilt: "modpacks.toast.installingQuilt",
        forge: "modpacks.toast.installingForge",
        neoforge: "modpacks.toast.installingNeoForge",
      };
      await installGameAndLoaderFiles(gameVersion, loader, loaderVersion, {
        knownVersions: versions,
        manifestUrlError: (version) =>
          new Error(t(language, "modpacks.toast.manifestUrlFailed", { version })),
        onGameInstallStart: (version) => {
          registerDownloadJob?.({ id: `version:${version}`, label: version, kind: "version" });
          showNotification("info", t(language, "modpacks.toast.versionNotInstalled", { version }));
        },
        onGameInstallEnd: (version) => {
          finishDownloadJob?.(`version:${version}`);
          showNotification("success", t(language, "modpacks.toast.versionInstalled", { version }));
        },
        onLoaderInstallStart: (id, version) => {
          if (id !== "vanilla") showNotification("info", t(language, loaderToastKey[id], { version }));
        },
      });
    },
    [language, showNotification, registerDownloadJob, finishDownloadJob, prepareInstallConsole, selectedProfileId],
  );

  function openChangeVersionModal() {
    if (!selectedProfile) return;
    setMigrateLoader(selectedProfile.loader as LoaderId);
    setMigrateGameVersion(selectedProfile.game_version);
    setMigrateLoaderVersion(selectedProfile.loader_version ?? "");
    setMigrateLoaderVersionOptions([]);
    setMigrateVersionOptions([]);
    setMigrateAllVersions(false);
    setIsMigrateVersionDropdownOpen(false);
    setIsMigrateLoaderVersionDropdownOpen(false);
    setIsChangeVersionOpen(true);
    void ensureMigrateVersionsLoaded();
  }

  function closeChangeVersionModal() {
    if (migrateBusy) return;
    setIsChangeVersionOpen(false);
    setIsMigrateVersionDropdownOpen(false);
    setIsMigrateLoaderVersionDropdownOpen(false);
  }

  function selectMigrateLoader(next: LoaderId) {
    if (next === migrateLoader) return;
    setMigrateLoader(next);
    setMigrateLoaderVersion(
      selectedProfile && next === selectedProfile.loader
        ? selectedProfile.loader_version ?? ""
        : "",
    );
    setMigrateLoaderVersionOptions([]);
    setIsMigrateLoaderVersionDropdownOpen(false);
  }

  async function handleChangeProfileVersion() {
    if (!selectedProfile || migrateBusy) return;
    const loader = migrateLoader;
    const loaderVersion =
      loader === "vanilla" ? null : migrateLoaderVersion.trim() || null;
    if (loader !== "vanilla" && !loaderVersion) {
      showNotification("warning", tt("modpacks.changeVersion.selectLoaderVersion"));
      return;
    }
    const sameGame = migrateGameVersion === selectedProfile.game_version;
    const sameLoader =
      loader === selectedProfile.loader &&
      (selectedProfile.loader_version ?? null) === loaderVersion;
    if (sameGame && sameLoader) {
      showNotification("warning", tt("modpacks.changeVersion.sameVersion"));
      return;
    }

    setMigrateBusy(true);
    try {
      if (backupBeforeVersionChange) {
        showNotification("info", tt("modpacks.editor.backingUp"), { sound: false });
        await invoke("create_profile_backup", { profileId: selectedProfile.id });
      }
      await installGameAndLoader(
        migrateGameVersion,
        loader,
        loaderVersion,
        migrateVersionOptions,
      );
      const updated = await invoke<InstanceProfile>("change_profile_version", {
        id: selectedProfile.id,
        gameVersion: migrateGameVersion,
        loader,
        loaderVersion,
      });
      const contentResult = await applyContentUpdatesAfterVersionChange(updated.id);
      setProfiles((prev) => {
        const next = prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p));
        onProfilesChange?.(next);
        return next;
      });
      onProfileSelectionChange?.(updated);
      await refreshItems(selectedProfile.id, contentTab);
      setIsChangeVersionOpen(false);
      const incompatibleNames = contentResult.incompatible
        .map((m) => m.title || m.filename)
        .filter(Boolean);
      if (contentResult.updated > 0 && incompatibleNames.length > 0) {
        showNotification(
          "warning",
          tt("modpacks.changeVersion.successWithUpdatesAndIncompatible", {
            count: contentResult.updated,
            mods: incompatibleNames.slice(0, 8).join(", "),
            more:
              incompatibleNames.length > 8
                ? tt("modpacks.changeVersion.incompatibleMore", {
                    count: incompatibleNames.length - 8,
                  })
                : "",
          }),
        );
      } else if (contentResult.updated > 0) {
        showNotification(
          "success",
          tt("modpacks.changeVersion.successWithContentUpdates", {
            count: contentResult.updated,
          }),
        );
      } else if (incompatibleNames.length > 0) {
        showNotification(
          "warning",
          tt("modpacks.changeVersion.successWithIncompatible", {
            mods: incompatibleNames.slice(0, 8).join(", "),
            more:
              incompatibleNames.length > 8
                ? tt("modpacks.changeVersion.incompatibleMore", {
                    count: incompatibleNames.length - 8,
                  })
                : "",
          }),
        );
      } else {
        showNotification("success", tt("modpacks.changeVersion.success"));
      }
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", tt("modpacks.changeVersion.failed", { msg }));
    } finally {
      setMigrateBusy(false);
    }
  }

  useEffect(() => {
    if (!isChangeVersionOpen || !selectedProfile) return;
    if (migrateLoader === "vanilla") {
      migrateLoaderRequestRef.current += 1;
      setMigrateLoaderVersionsLoading(false);
      return;
    }
    void loadMigrateLoaderVersions();
  }, [isChangeVersionOpen, selectedProfile, migrateLoader, migrateGameVersion, loadMigrateLoaderVersions]);

  useEffect(() => {
    const requestId = ++migratePreviewRequestRef.current;
    setMigratePreview(null);
    setMigratePreviewFailed(false);
    const profileId = selectedProfile?.id;
    const unchanged =
      migrateGameVersion === selectedProfile?.game_version &&
      migrateLoader === selectedProfile?.loader;
    if (!isChangeVersionOpen || !profileId || !migrateGameVersion || unchanged) {
      setMigratePreviewLoading(false);
      return;
    }
    setMigratePreviewLoading(true);
    const timer = window.setTimeout(() => {
      invoke<ProfileVersionChangePreview>("preview_profile_version_change", {
        profileId,
        gameVersion: migrateGameVersion,
        loader: migrateLoader,
      })
        .then((preview) => {
          if (requestId === migratePreviewRequestRef.current) setMigratePreview(preview);
        })
        .catch((e) => {
          console.warn("Version change preview failed:", e);
          if (requestId === migratePreviewRequestRef.current) setMigratePreviewFailed(true);
        })
        .finally(() => {
          if (requestId === migratePreviewRequestRef.current) setMigratePreviewLoading(false);
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    isChangeVersionOpen,
    selectedProfile?.id,
    selectedProfile?.game_version,
    selectedProfile?.loader,
    migrateGameVersion,
    migrateLoader,
  ]);

  useEffect(() => {
    if (!isChangeVersionOpen) return;
    setMigrateVersionOptions([]);
    void ensureMigrateVersionsLoaded();
  }, [migrateAllVersions]);

  return {
    backupBeforeVersionChange,
    setBackupBeforeVersionChange,
    isChangeVersionOpen,
    migrateLoader,
    selectMigrateLoader,
    migrateGameVersion,
    setMigrateGameVersion,
    migrateLoaderVersion,
    setMigrateLoaderVersion,
    migrateLoaderVersionOptions,
    migrateLoaderVersionsLoading,
    migrateBusy,
    migratePreview,
    migratePreviewLoading,
    migratePreviewFailed,
    isMigrateVersionDropdownOpen,
    setIsMigrateVersionDropdownOpen,
    isMigrateLoaderVersionDropdownOpen,
    setIsMigrateLoaderVersionDropdownOpen,
    migrateAllVersions,
    setMigrateAllVersions,
    migrateVersionOptions,
    migrateVersionsLoading,
    ensureMigrateVersionsLoaded,
    loadMigrateLoaderVersions,
    openChangeVersionModal,
    closeChangeVersionModal,
    handleChangeProfileVersion,
  };
}
