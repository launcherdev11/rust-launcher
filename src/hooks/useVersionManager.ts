import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RoomCurrentGame, RoomGameSettings } from "../tabs/RoomsTab";
import type { Language } from "../i18n";
import type { NotificationKind, ShowNotificationOptions } from "../app/notifications";
import {
  getVersionLabel,
  isForgeVersion,
  isNeoForgeVersion,
  neoForgeInstallVersionId,
  versionInstallJobId,
} from "../app/versions";
import type {
  DownloadProgressPayload,
  ForgeVersionSummary,
  InstanceProfileSummary,
  LoaderId,
  NeoForgeVersionSummary,
  Settings,
  Tt,
  VersionItem,
  VersionSummary,
} from "../app/types";
import type { useDownloadJobs } from "./useDownloadJobs";

type DownloadJobs = ReturnType<typeof useDownloadJobs>;

type UseVersionManagerOptions = {
  settings: Settings | null;
  activeInstanceProfile: InstanceProfileSummary | null;
  language: Language;
  tt: Tt;
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  startDownloadJob: DownloadJobs["startJob"];
  updateDownloadJobProgress: DownloadJobs["updateJobProgress"];
  setDownloadJobPaused: DownloadJobs["setJobPaused"];
  finishDownloadJob: DownloadJobs["finishJob"];
  prepareInstallConsole: (profileId?: string | null) => string;
  setIsConsoleVisible: Dispatch<SetStateAction<boolean>>;
};

export function useVersionManager({
  settings,
  activeInstanceProfile,
  language,
  tt,
  showNotification,
  startDownloadJob,
  updateDownloadJobProgress,
  setDownloadJobPaused,
  finishDownloadJob,
  prepareInstallConsole,
  setIsConsoleVisible,
}: UseVersionManagerOptions) {
  const [loader, setLoader] = useState<LoaderId>(() => {
    if (typeof window === "undefined") return "vanilla";
    try {
      const saved = window.localStorage.getItem("selected_loader");
      if (
        saved === "vanilla" ||
        saved === "fabric" ||
        saved === "forge" ||
        saved === "quilt" ||
        saved === "neoforge"
      ) {
        return saved;
      }
    } catch {
    }
    return "vanilla";
  });
  const pendingRoomGameRef = useRef<RoomGameSettings | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<VersionItem | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<DownloadProgressPayload | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installedGameVersions, setInstalledGameVersions] = useState<Set<string>>(new Set());
  const [fabricProfileId, setFabricProfileId] = useState<string | null>(null);
  const [quiltProfileId, setQuiltProfileId] = useState<string | null>(null);
  const [installPaused, setInstallPaused] = useState(false);
  const installStopReasonRef = useRef<"pause" | "cancel" | null>(null);
  const versionInstallJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("selected_loader", loader);
    } catch {
    }
  }, [loader]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      setVersionsLoading(true);
      try {
        const installed = await invoke<string[]>("list_installed_versions");
        setInstalledIds(new Set(installed));

        if (loader === "forge") {
          const result = await invoke<ForgeVersionSummary[]>("fetch_forge_versions");
          setVersions(result);
          const pending = pendingRoomGameRef.current;
          const preferId =
            pending && pending.loader === "forge" ? pending.gameVersion : null;
          const savedId =
            preferId ??
            (typeof window !== "undefined"
              ? window.localStorage.getItem("selected_version_id_forge")
              : null);
          const match = savedId ? result.find((v) => v.id === savedId) : undefined;
          setSelectedVersion(match ?? (result.length > 0 ? result[0] : null));
          if (preferId && match) pendingRoomGameRef.current = null;
          setInstalledGameVersions(new Set());
        } else if (loader === "neoforge") {
          const result = await invoke<NeoForgeVersionSummary[]>("fetch_neoforge_versions");
          setVersions(result);
          const pending = pendingRoomGameRef.current;
          const preferId =
            pending && pending.loader === "neoforge" ? pending.gameVersion : null;
          const savedId =
            preferId ??
            (typeof window !== "undefined"
              ? window.localStorage.getItem("selected_version_id_neoforge")
              : null);
          const match = savedId ? result.find((v) => v.id === savedId) : undefined;
          setSelectedVersion(match ?? (result.length > 0 ? result[0] : null));
          if (preferId && match) pendingRoomGameRef.current = null;
          setInstalledGameVersions(new Set());
        } else {
          const filtered = await invoke<VersionSummary[]>("fetch_versions_for_loader", {
            loader,
            showSnapshots: settings?.show_snapshots ?? false,
            showAlpha: settings?.show_alpha_versions ?? false,
          });
          setVersions(filtered);
          const pending = pendingRoomGameRef.current;
          const preferId =
            pending && pending.loader === loader ? pending.gameVersion : null;
          const savedKey =
            loader === "fabric"
              ? "selected_version_id_fabric"
              : loader === "quilt"
                ? "selected_version_id_quilt"
                : "selected_version_id_vanilla";
          const savedId =
            preferId ??
            (typeof window !== "undefined" ? window.localStorage.getItem(savedKey) : null);
          const match = savedId ? filtered.find((v) => v.id === savedId) : undefined;
          setSelectedVersion(match ?? (filtered.length > 0 ? filtered[0] : null));
          if (preferId && match) pendingRoomGameRef.current = null;

          if (loader === "fabric") {
            try {
              const installedGv = await invoke<string[]>("list_installed_fabric_game_versions");
              setInstalledGameVersions(new Set(installedGv ?? []));
            } catch {
              setInstalledGameVersions(new Set());
            }
          } else if (loader === "quilt") {
            try {
              const installedGv = await invoke<string[]>("list_installed_quilt_game_versions");
              setInstalledGameVersions(new Set(installedGv ?? []));
            } catch {
              setInstalledGameVersions(new Set());
            }
          } else {
            setInstalledGameVersions(new Set());
          }
        }
      } catch (error) {
        console.error("Не удалось загрузить список версий:", error);
        const msg = error instanceof Error ? error.message : String(error);
        if (loader === "forge") {
          showNotification(
            "error",
            tt("app.errors.forgeVersionsLoadFailed", { msg }),
          );
        } else if (loader === "neoforge") {
          showNotification(
            "error",
            tt("app.errors.neoforgeVersionsLoadFailed", { msg }),
          );
        } else {
          showNotification(
            "error",
            tt("app.errors.versionsLoadFailed", { msg }),
          );
        }
        setVersions([]);
        setSelectedVersion(null);
        setInstalledGameVersions(new Set());
      } finally {
        setVersionsLoading(false);
      }

      try {
        unlisten = await listen<DownloadProgressPayload>(
          "download-progress",
          (event) => {
            setProgress(event.payload);
            updateDownloadJobProgress(
              versionInstallJobId(event.payload.version_id),
              event.payload.percent,
            );
          },
        );
      } catch (error) {
        console.error("Не удалось подписаться на прогресс загрузки:", error);
      }
    })();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    loader,
    settings?.show_snapshots,
    settings?.show_alpha_versions,
    showNotification,
    language,
    updateDownloadJobProgress,
  ]);

  useEffect(() => {
    if (activeInstanceProfile) return;
    if (!selectedVersion) return;
    if (typeof window === "undefined") return;
    try {
      const key =
        loader === "forge"
          ? "selected_version_id_forge"
          : loader === "neoforge"
            ? "selected_version_id_neoforge"
            : loader === "fabric"
              ? "selected_version_id_fabric"
              : loader === "quilt"
                ? "selected_version_id_quilt"
                : "selected_version_id_vanilla";
      window.localStorage.setItem(key, selectedVersion.id);
    } catch {
    }
  }, [activeInstanceProfile, loader, selectedVersion]);

  useEffect(() => {
    if (
      (loader !== "fabric" && loader !== "quilt") ||
      !selectedVersion ||
      isForgeVersion(selectedVersion)
    ) {
      setFabricProfileId(null);
      setQuiltProfileId(null);
      return;
    }
    (async () => {
      try {
        if (loader === "fabric") {
          const id = await invoke<string | null>("get_installed_fabric_profile_id", {
            gameVersion: selectedVersion.id,
            loaderVersion: null,
          });
          setFabricProfileId(id);
          setQuiltProfileId(null);
          if (id) {
            setInstalledGameVersions((prev) => new Set(prev).add(selectedVersion.id));
          }
        } else if (loader === "quilt") {
          const id = await invoke<string | null>("get_installed_quilt_profile_id", {
            gameVersion: selectedVersion.id,
            loaderVersion: null,
          });
          setQuiltProfileId(id);
          setFabricProfileId(null);
          if (id) {
            setInstalledGameVersions((prev) => new Set(prev).add(selectedVersion.id));
          }
        }
      } catch {
        setFabricProfileId(null);
        setQuiltProfileId(null);
      }
    })();
  }, [loader, selectedVersion]);

  const isInstalled = useMemo(() => {
    if (!selectedVersion) return false;
    if (loader === "fabric" && !isForgeVersion(selectedVersion)) {
      return (
        !!fabricProfileId || installedGameVersions.has(selectedVersion.id)
      );
    }
    if (loader === "quilt" && !isForgeVersion(selectedVersion)) {
      return (
        !!quiltProfileId || installedGameVersions.has(selectedVersion.id)
      );
    }
    return installedIds.has(selectedVersion.id);
  }, [installedIds, selectedVersion, loader, fabricProfileId, quiltProfileId, installedGameVersions]);

  const installedVersionIdsForDropdown = useMemo(() => {
    if (loader === "fabric" || loader === "quilt") {
      return installedGameVersions;
    }
    return installedIds;
  }, [installedGameVersions, installedIds, loader]);

  useEffect(() => {
    if (!activeInstanceProfile || versions.length === 0) return;

    const desiredLoader = activeInstanceProfile.loader as LoaderId;
    const allowedLoaders: LoaderId[] = [
      "vanilla",
      "fabric",
      "forge",
      "quilt",
      "neoforge",
    ];
    if (allowedLoaders.includes(desiredLoader)) {
      setLoader(desiredLoader);
    }

    const versionId = activeInstanceProfile.game_version;
    const loaderVer = activeInstanceProfile.loader_version?.trim() || null;
    const match = versions.find((v) => {
      if (isForgeVersion(v)) {
        if (loaderVer) {
          return (
            v.id === `${versionId}-forge-${loaderVer}` ||
            (v.mc_version === versionId && v.forge_build === loaderVer)
          );
        }
        return v.mc_version === versionId || v.id === versionId;
      }
      if (isNeoForgeVersion(v)) {
        if (loaderVer) {
          return (
            v.id === `${versionId}-neoforge-${loaderVer}` ||
            (v.mc_version === versionId && v.neoforge_build === loaderVer)
          );
        }
        return v.mc_version === versionId || v.id === versionId;
      }
      return (v as VersionSummary).id === versionId;
    });
    if (match) {
      setSelectedVersion(match);
    }
  }, [activeInstanceProfile, versions]);

  const handlePauseInstall = async () => {
    if (!isInstalling) return;
    installStopReasonRef.current = "pause";
    try {
      await invoke("cancel_download");
    } catch (error) {
      console.error("Не удалось поставить загрузку на паузу:", error);
      installStopReasonRef.current = null;
    }
  };

  const handleCancelInstall = async () => {
    installStopReasonRef.current = "cancel";
    setInstallPaused(false);
    setIsInstalling(false);
    const jobId =
      versionInstallJobIdRef.current ??
      (selectedVersion ? versionInstallJobId(selectedVersion.id) : null);
    if (jobId) {
      finishDownloadJob(jobId);
      versionInstallJobIdRef.current = null;
    }
    setProgress(null);
    try {
      await invoke("cancel_download");
    } catch (error) {
      console.error("Не удалось отменить загрузку:", error);
    }
  };

  const handleResumeInstall = () => {
    if (isInstalled || !selectedVersion || isInstalling) return;
    void runVersionInstall({ resume: true });
  };

  const runVersionInstall = async (options?: { resume?: boolean }) => {
    if (!selectedVersion) return;

    let installVersionId = isNeoForgeVersion(selectedVersion)
      ? neoForgeInstallVersionId(selectedVersion)
      : selectedVersion.id;
    const jobId = versionInstallJobId(installVersionId);
    versionInstallJobIdRef.current = jobId;

    setInstallPaused(false);
    setIsInstalling(true);
    prepareInstallConsole();
    setIsConsoleVisible(true);
    if (!options?.resume) {
      setProgress(null);
      showNotification("info", tt("app.toast.downloadStarted"));
    }
    startDownloadJob({
      id: jobId,
      label: getVersionLabel(selectedVersion),
      kind: "version",
      percent: options?.resume ? (progress?.percent ?? null) : null,
    });
    if (options?.resume) {
      setDownloadJobPaused(jobId, false);
    }

    try {
      try {
        await invoke("reset_download_cancel");
      } catch (e) {
        console.error("Не удалось сбросить состояние загрузки:", e);
      }
      if (loader === "vanilla" && !isForgeVersion(selectedVersion) && !isNeoForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        if (v.version_type === "custom" || !v.url) {
          await invoke("install_local_version", { versionId: v.id });
        } else {
          await invoke("install_version", {
            versionId: v.id,
            versionUrl: v.url,
          });
        }
      } else if (loader === "fabric" && !isForgeVersion(selectedVersion) && !isNeoForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        const loaders = await invoke<{ version: string }[]>("fetch_fabric_loaders", {
          gameVersion: v.id,
        });
        const loaderVersion = loaders[0]?.version;
        if (!loaderVersion) throw new Error(tt("app.install.noFabricLoader"));
        const profileId = await invoke<string>("install_fabric", {
          gameVersion: v.id,
          loaderVersion,
        });
        setInstalledIds((prev) => new Set(prev).add(profileId));
        setFabricProfileId(profileId);
        setInstalledGameVersions((prev) => new Set(prev).add(v.id));
        showNotification("success", tt("app.toast.downloadFinished"), { sound: true });
        return;
      } else if (loader === "quilt" && !isForgeVersion(selectedVersion) && !isNeoForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        const profileId = await invoke<string>("install_quilt", {
          gameVersion: v.id,
          loaderVersion: null,
        });
        setInstalledIds((prev) => new Set(prev).add(profileId));
        setQuiltProfileId(profileId);
        setInstalledGameVersions((prev) => new Set(prev).add(v.id));
        showNotification("success", tt("app.toast.downloadFinished"), { sound: true });
        return;
      } else if (loader === "forge" && isForgeVersion(selectedVersion)) {
        await invoke("install_forge", {
          versionId: selectedVersion.id,
          installerUrl: selectedVersion.installer_url,
        });
      } else if (loader === "neoforge" && isNeoForgeVersion(selectedVersion)) {
        await invoke("install_neoforge", {
          versionId: installVersionId,
        });
      } else if (
        loader === "neoforge" &&
        !isForgeVersion(selectedVersion) &&
        !isNeoForgeVersion(selectedVersion)
      ) {
        const v = selectedVersion as VersionSummary;
        const builds = await invoke<{ version: string }[]>("fetch_neoforge_builds_for_game", {
          gameVersion: v.id,
        });
        const loaderVersion = builds[0]?.version;
        if (!loaderVersion) throw new Error(tt("app.install.noNeoForgeLoader"));
        installVersionId = `${v.id}-neoforge-${loaderVersion}`;
        await invoke("install_neoforge", { versionId: installVersionId });
      } else {
        throw new Error(tt("app.install.unknownVersionType"));
      }

      showNotification("success", tt("app.toast.downloadFinished"), { sound: true });
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.add(installVersionId);
        return next;
      });
    } catch (error) {
      if (
        installStopReasonRef.current === "pause" ||
        installStopReasonRef.current === "cancel"
      ) {
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Ошибка установки версии:", error);
      showNotification("error", tt("app.errors.installError", { msg }));
    } finally {
      const stopReason = installStopReasonRef.current;
      if (stopReason === "pause") {
        setInstallPaused(true);
        setIsInstalling(false);
        setDownloadJobPaused(jobId, true);
        installStopReasonRef.current = null;
      } else {
        setIsInstalling(false);
        setInstallPaused(false);
        finishDownloadJob(jobId);
        versionInstallJobIdRef.current = null;
        if (stopReason === "cancel") {
          setProgress(null);
          try {
            await invoke("reset_download_cancel");
          } catch (e) {
            console.error("Не удалось сбросить состояние загрузки:", e);
          }
        }
        installStopReasonRef.current = null;
      }
    }
  };

  const roomCurrentGame = useMemo<RoomCurrentGame | null>(() => {
    const known = ["vanilla", "fabric", "quilt", "forge", "neoforge"];
    if (activeInstanceProfile?.game_version?.trim()) {
      const l = (activeInstanceProfile.loader || "vanilla").toLowerCase();
      return {
        loader: (known.includes(l) ? l : "vanilla") as RoomCurrentGame["loader"],
        gameVersion: activeInstanceProfile.game_version.trim(),
        loaderVersion: activeInstanceProfile.loader_version ?? null,
        source: "profile",
        label: activeInstanceProfile.name,
      };
    }
    if (selectedVersion) {
      return {
        loader: loader as RoomCurrentGame["loader"],
        gameVersion: selectedVersion.id,
        loaderVersion: null,
        source: "menu",
        label: "",
      };
    }
    return null;
  }, [activeInstanceProfile, loader, selectedVersion]);

  const applyRoomGameSettings = useCallback(
    (settings: RoomGameSettings) => {
      pendingRoomGameRef.current = settings;
      if (loader === settings.loader) {
        const match = versions.find((v) => v.id === settings.gameVersion);
        if (match) {
          setSelectedVersion(match);
          pendingRoomGameRef.current = null;
          return;
        }
      }
      setLoader(settings.loader);
    },
    [loader, versions],
  );

  return {
    loader,
    setLoader,
    versions,
    selectedVersion,
    setSelectedVersion,
    versionsLoading,
    isInstalling,
    installPaused,
    progress,
    fabricProfileId,
    quiltProfileId,
    isInstalled,
    installedVersionIdsForDropdown,
    handlePauseInstall,
    handleCancelInstall,
    handleResumeInstall,
    runVersionInstall,
    roomCurrentGame,
    applyRoomGameSettings,
  };
}
