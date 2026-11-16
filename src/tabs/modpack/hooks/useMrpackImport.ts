import type { Language } from "../../../i18n";
import type { DownloadJobDetail, DownloadJobKind } from "../../../hooks/useDownloadJobs";
import type { Dispatch, SetStateAction } from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "../../../i18n";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  type ContentTab,
  type InstanceProfile,
  type NotificationKind,
  type ViewId,
} from "../types";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { disposeWhenResolved } from "../../../lib/tauriEvents";

type MrpackImportDeps = {
  finishDownloadJob: ((id: string) => void) | undefined;
  updateDownloadJob: ((id: string, percent: number | null, detail?: DownloadJobDetail | null) => void) | undefined;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  language: Language;
  makeDownloadJobId: ((prefix: string) => string) | undefined;
  registerDownloadJob: ((params: { id: string; label: string; kind: DownloadJobKind; percent?: number | null; }) => void) | undefined;
  refreshProfiles: (options?: { background?: boolean; }) => Promise<void>;
  setSelectedProfileId: Dispatch<SetStateAction<string | null>>;
  setContentTab: Dispatch<SetStateAction<ContentTab>>;
  setActiveView: Dispatch<SetStateAction<ViewId>>;
  refreshItems: (id: string, tab: ContentTab) => Promise<void>;
  openedMrpackPath: string | null;
  onOpenedMrpackPathConsumed: (() => void) | undefined;
  activeView: ViewId;
};

export function useMrpackImport(deps: MrpackImportDeps) {
  const {
    finishDownloadJob,
    updateDownloadJob,
    showNotification,
    language,
    makeDownloadJobId,
    registerDownloadJob,
    refreshProfiles,
    setSelectedProfileId,
    setContentTab,
    setActiveView,
    refreshItems,
    openedMrpackPath,
    onOpenedMrpackPathConsumed,
    activeView,
  } = deps;

  const [mrpackBusy, setMrpackBusy] = useState(false);

  const [mrpackProgress, setMrpackProgress] = useState<{
    phase: string;
    current?: number;
    total?: number;
    message?: string;
  } | null>(null);

  const [importDragActive, setImportDragActive] = useState(false);
  const mrpackDownloadJobIdRef = useRef<string | null>(null);
  const mrpackImportStopReasonRef = useRef<"cancel" | null>(null);

  const handleCancelMrpackImport = useCallback(async () => {
    if (!mrpackBusy) return;
    mrpackImportStopReasonRef.current = "cancel";
    const jobId = mrpackDownloadJobIdRef.current;
    if (jobId) {
      finishDownloadJob?.(jobId);
      mrpackDownloadJobIdRef.current = null;
    }
    try {
      await invoke("cancel_download");
    } catch (e) {
      console.error("Не удалось отменить импорт сборки:", e);
    }
  }, [mrpackBusy, finishDownloadJob]);

  useEffect(() => {
    type ProgressPayload = {
      phase: string;
      current?: number;
      total?: number;
      message?: string;
    };
    const onProgress = (event: { payload: ProgressPayload }) => {
      if (!mrpackDownloadJobIdRef.current) return;
      const payload = event.payload;
      setMrpackProgress(payload);
      const jobId = mrpackDownloadJobIdRef.current;
      if (
        jobId &&
        updateDownloadJob &&
        payload.phase === "files" &&
        payload.current != null &&
        payload.total != null &&
        payload.total > 0
      ) {
        updateDownloadJob(jobId, (payload.current / payload.total) * 100, {
          current: payload.current,
          total: payload.total,
          unit: "files",
        });
      }
      if (payload.phase === "start") {
        showNotification(
          "info",
          t(language, "modpacks.import.started"),
        );
      }
    };
    const unlistenPromises = [
      listen<ProgressPayload>("mrpack-import-progress", onProgress),
      listen<ProgressPayload>("curseforge-install-progress", onProgress),
    ];
    return () => {
      unlistenPromises.forEach((p) => void p.then((fn) => fn()));
    };
  }, [language, showNotification, updateDownloadJob]);

  async function handleImportMrpack(path?: string) {
    let chosen = path;
    if (!chosen) {
      try {
        const p = await openFileDialog({
          multiple: false,
          directory: false,
          filters: [{ name: "Modpack", extensions: ["mrpack", "zip"] }],
        });
        if (typeof p === "string") {
          chosen = p;
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (!chosen) return;

    const jobId = makeDownloadJobId?.("modpack") ?? `modpack-${Date.now()}`;
    const jobLabel =
      chosen.split(/[/\\]/).pop()?.replace(/\.(mrpack|zip)$/i, "") ?? "Modpack";
    mrpackImportStopReasonRef.current = null;
    try {
      await invoke("reset_download_cancel");
    } catch (e) {
      console.error(e);
    }
    mrpackDownloadJobIdRef.current = jobId;
    registerDownloadJob?.({ id: jobId, label: jobLabel, kind: "modpack" });
    setMrpackBusy(true);
    setMrpackProgress(null);
    try {
      let failedFiles = 0;
      let newProfile: InstanceProfile;
      if (/\.mrpack$/i.test(chosen)) {
        newProfile = await invoke<InstanceProfile>("import_mrpack_as_new_profile", {
          mrpackPath: chosen,
        });
      } else {
        const result = await invoke<{ profile: InstanceProfile; failed_files: number }>(
          "import_zip_as_new_profile",
          { zipPath: chosen },
        );
        newProfile = result.profile;
        failedFiles = result.failed_files;
      }
      setMrpackProgress(null);
      await invoke("set_selected_profile", { id: newProfile.id });
      await refreshProfiles();
      setSelectedProfileId(newProfile.id);
      setContentTab("mods");
      setActiveView("manage");
      await refreshItems(newProfile.id, "mods");
      if (failedFiles > 0) {
        showNotification(
          "warning",
          t(language, "modpacks.import.finishedWithMissing", { count: failedFiles }),
        );
      } else {
        showNotification("success", t(language, "modpacks.import.finishedWithVersion"));
      }
    } catch (e) {
      console.error(e);
      setMrpackProgress(null);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : JSON.stringify(e);
      const cancelled =
        mrpackImportStopReasonRef.current === "cancel" ||
        msg.includes(t(language, "modpacks.import.cancelledKeyword")) ||
        msg.toLowerCase().includes("cancelled") ||
        msg.toLowerCase().includes("canceled");
      if (cancelled) {
        showNotification("info", t(language, "mods.modpackImport.cancelled"));
      } else {
        showNotification("error", t(language, "modpacks.import.failed", { msg }));
      }
    } finally {
      mrpackImportStopReasonRef.current = null;
      mrpackDownloadJobIdRef.current = null;
      finishDownloadJob?.(jobId);
      setMrpackBusy(false);
    }
  }

  useEffect(() => {
    if (!openedMrpackPath) return;
    const path = openedMrpackPath;
    onOpenedMrpackPathConsumed?.();
    void handleImportMrpack(path);
  }, [openedMrpackPath, onOpenedMrpackPathConsumed]);

  useEffect(() => {
    if (activeView !== "import") return;
    const webview = getCurrentWebview();
    const dispose = disposeWhenResolved(
      webview.onDragDropEvent((event: { payload: { type: string; paths?: string[] } }) => {
        setImportDragActive(event.payload.type === "enter" || event.payload.type === "over");
        if (event.payload.type === "drop" && event.payload.paths?.length) {
          const path = event.payload.paths.find((p: string) => /\.(mrpack|zip)$/i.test(p));
          if (path) void handleImportMrpack(path);
        }
      }),
    );
    return () => {
      setImportDragActive(false);
      dispose();
    };
  }, [activeView]);

  return {
    mrpackBusy,
    mrpackProgress,
    importDragActive,
    handleCancelMrpackImport,
    handleImportMrpack,
  };
}
