import { invoke } from "@tauri-apps/api/core";
import type { DownloadJobKind } from "../../hooks/useDownloadJobs";
import {
  fetchCurseforgeVersions,
  fetchModrinthVersions,
} from "./catalogApi";
import {
  invokeErrorMessage,
  isDownloadCancelledMessage,
  type CatalogVersion,
  type ContentProvider,
  type LoaderFilter,
  type ModrinthContentType,
  type MrpackImportProgressPayload,
  type NotificationKind,
} from "./types";

export type DownloadVersionDeps = {
  contentProvider: ContentProvider;
  contentType: ModrinthContentType;
  projectKey: string | null;
  gameVersion: string;
  loader: LoaderFilter;
  activeProfileId?: string | null;
  projectTitle?: string | null;
  projectIconUrl?: string | null;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  showNotification: (
    kind: NotificationKind,
    message: string,
    options?: { sound?: boolean },
  ) => void;
  registerDownloadJob?: (params: {
    id: string;
    label: string;
    kind: DownloadJobKind;
    percent?: number | null;
  }) => void;
  finishDownloadJob?: (id: string) => void;
  makeDownloadJobId?: (prefix: string) => string;
  onOpenModpacksTab?: () => void;
  modpackDownloadJobIdRef: { current: string | null };
  modpackImportStopReasonRef: { current: "cancel" | null };
  setModpackImportBusy: (busy: boolean) => void;
  setModpackImportProgress: (
    progress: MrpackImportProgressPayload | null,
  ) => void;
  onInstalled: (filenames: string[], projectKey: string | null) => void;
};

export async function downloadCatalogVersion(
  v: CatalogVersion,
  deps: DownloadVersionDeps,
): Promise<void> {
  const {
    contentProvider,
    contentType,
    projectKey,
    gameVersion,
    loader,
    activeProfileId,
    projectTitle,
    projectIconUrl,
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
    onInstalled,
  } = deps;

  const canDownload =
    contentProvider === "curseforge"
      ? Boolean(projectKey && v.filename)
      : Boolean(v.file_url && v.filename);
  if (!canDownload) return;

  const jobId = makeDownloadJobId?.("modpack") ?? `modpack-${Date.now()}`;
  const jobLabel = projectTitle ?? v.filename;
  const fileKind: DownloadJobKind =
    contentType === "modpack" ? "modpack" : "mod";
  registerDownloadJob?.({ id: jobId, label: jobLabel, kind: fileKind });

  try {
    if (contentType === "modpack" && contentProvider === "modrinth") {
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
      const imported = await invoke<{ id: string; name: string }>(
        "download_modrinth_modpack_and_import",
        {
          url: v.file_url,
          filename: v.filename,
          iconUrl: projectIconUrl ?? null,
        },
      );
      await invoke("set_selected_profile", { id: imported.id });
      onOpenModpacksTab?.();
      showNotification(
        "success",
        tt("mods.modpackImportSuccess", {
          name: imported.name ?? imported.id,
        }),
      );
    } else if (contentProvider === "curseforge") {
      const modId = Number(projectKey);
      if (!modId) return;
      await invoke("download_curseforge_file", {
        modId,
        fileId: Number(v.id),
        category: contentType,
        filename: v.filename,
        profileId: activeProfileId ?? null,
      });
      if (activeProfileId) {
        onInstalled([v.filename], projectKey);
      }
      showNotification(
        "success",
        contentType === "modpack"
          ? tt("mods.curseforgeModpackHint")
          : activeProfileId
            ? tt("mods.saveSuccessProfile", { filename: v.filename })
            : tt("mods.saveSuccessFolder", {
                filename: v.filename,
                folder:
                  contentType === "mod"
                    ? "mods"
                    : contentType === "resourcepack"
                      ? "resourcepacks"
                      : contentType === "shader"
                        ? "shaderpacks"
                        : "modpacks",
              }),
      );
    } else if (contentType === "mod" && contentProvider === "modrinth") {
      const downloaded = await invoke<{ filename: string; skipped: boolean }[]>(
        "download_modrinth_with_dependencies",
        {
          category: contentType,
          versionId: v.id,
          gameVersion,
          loader,
          profileId: activeProfileId ?? null,
        },
      );
      if (activeProfileId) {
        onInstalled(
          downloaded.map((item) => item.filename),
          projectKey,
        );
      }
      const skippedCount = downloaded.filter((item) => item.skipped).length;
      const downloadedCount = downloaded.length - skippedCount;
      if (downloadedCount === 0) {
        showNotification(
          "success",
          tt("mods.alreadyInstalled", { filename: v.filename }),
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
        const depCount = Math.max(0, downloadedCount - 1);
        showNotification(
          "success",
          depCount > 0
            ? tt("mods.saveSuccessWithDeps", {
                filename: v.filename,
                count: depCount,
              })
            : activeProfileId
              ? tt("mods.saveSuccessProfile", { filename: v.filename })
              : tt("mods.saveSuccessFolder", {
                  filename: v.filename,
                  folder: "mods",
                }),
        );
      }
    } else {
      await invoke("download_modrinth_file", {
        category: contentType,
        url: v.file_url,
        filename: v.filename,
        profileId: activeProfileId ?? null,
      });
      if (activeProfileId) {
        onInstalled([v.filename], projectKey);
      }
      showNotification(
        "success",
        activeProfileId
          ? tt("mods.saveSuccessProfile", { filename: v.filename })
          : tt("mods.saveSuccessFolder", {
              filename: v.filename,
              folder:
                contentType === "resourcepack"
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
    if (contentType === "modpack" && contentProvider === "modrinth") {
      setModpackImportBusy(false);
      setModpackImportProgress(null);
    }
  }
}

export async function resolveLatestCompatibleVersion(params: {
  projectKey: string;
  contentProvider: ContentProvider;
  contentType: ModrinthContentType;
  gameVersion: string;
  loader: LoaderFilter;
  fallbackVersions?: CatalogVersion[];
}): Promise<CatalogVersion | null> {
  const {
    projectKey,
    contentProvider,
    contentType,
    gameVersion,
    loader,
    fallbackVersions,
  } = params;

  if (fallbackVersions && fallbackVersions.length > 0) {
    return fallbackVersions[0];
  }

  if (contentProvider === "modrinth") {
    const data = await fetchModrinthVersions(
      projectKey,
      gameVersion,
      contentType,
      loader,
    );
    const filtered = data.filter((v) => {
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
    const v = filtered[0];
    if (!v) return null;
    const primaryFile = v.files.find((f) => f.primary) ?? v.files[0];
    return {
      id: v.id,
      version_number: v.version_number,
      game_versions: v.game_versions,
      loaders: v.loaders,
      file_url: primaryFile?.url ?? "",
      filename: primaryFile?.filename ?? "",
    };
  }

  const data = await fetchCurseforgeVersions(
    Number(projectKey),
    gameVersion,
    loader,
  );
  const filtered = data.filter((f) => {
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
  const f = filtered[0];
  if (!f) return null;
  return {
    id: String(f.id),
    version_number: f.displayName,
    game_versions: f.gameVersions,
    loaders: f.loaders,
    file_url: f.downloadUrl ?? "",
    filename: f.fileName,
  };
}

export async function cancelModpackImport(params: {
  busy: boolean;
  finishDownloadJob?: (id: string) => void;
  modpackDownloadJobIdRef: { current: string | null };
  modpackImportStopReasonRef: { current: "cancel" | null };
}): Promise<void> {
  if (!params.busy) return;
  params.modpackImportStopReasonRef.current = "cancel";
  const jobId = params.modpackDownloadJobIdRef.current;
  if (jobId) {
    params.finishDownloadJob?.(jobId);
    params.modpackDownloadJobIdRef.current = null;
  }
  try {
    await invoke("cancel_download");
  } catch (e) {
    console.error(e);
  }
}
