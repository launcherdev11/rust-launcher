import type { Language } from "../../../i18n";
import type { Dispatch, SetStateAction } from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type ContentTab,
  type ExternalLauncherType,
  type ImportableExternalInstance,
  type InstanceProfile,
  type NotificationKind,
  type ViewId,
} from "../types";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { t } from "../../../i18n";

type ExternalImportDeps = {
  language: Language;
  refreshProfiles: (options?: { background?: boolean; }) => Promise<void>;
  setSelectedProfileId: Dispatch<SetStateAction<string | null>>;
  setContentTab: Dispatch<SetStateAction<ContentTab>>;
  setActiveView: Dispatch<SetStateAction<ViewId>>;
  refreshItems: (id: string, tab: ContentTab) => Promise<void>;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
};

export function useExternalImport(deps: ExternalImportDeps) {
  const {
    language,
    refreshProfiles,
    setSelectedProfileId,
    setContentTab,
    setActiveView,
    refreshItems,
    showNotification,
  } = deps;

  const [externalImportLauncher, setExternalImportLauncher] =
    useState<ExternalLauncherType>("auto");

  const [externalImportPath, setExternalImportPath] = useState("");
  const [externalImportBusy, setExternalImportBusy] = useState(false);

  const [externalImportProgress, setExternalImportProgress] = useState<{
    phase: string;
    current?: number;
    total?: number;
    message?: string;
  } | null>(null);

  const [externalImportScanBusy, setExternalImportScanBusy] = useState(false);
  const [externalImportScanError, setExternalImportScanError] = useState<string | null>(null);

  const [externalImportInstances, setExternalImportInstances] = useState<
    ImportableExternalInstance[]

  >([]);

  const [externalImportSearch, setExternalImportSearch] = useState("");
  const [externalImportSort, setExternalImportSort] = useState<"name" | "date" | "size">("name");
  const [isExternalLauncherDropdownOpen, setIsExternalLauncherDropdownOpen] = useState(false);
  const [isExternalSortDropdownOpen, setIsExternalSortDropdownOpen] = useState(false);
  const externalLauncherDropdownRef = useRef<HTMLDivElement | null>(null);
  const externalSortDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isExternalLauncherDropdownOpen && !isExternalSortDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        isExternalLauncherDropdownOpen &&
        externalLauncherDropdownRef.current &&
        !externalLauncherDropdownRef.current.contains(target)
      ) {
        setIsExternalLauncherDropdownOpen(false);
      }
      if (
        isExternalSortDropdownOpen &&
        externalSortDropdownRef.current &&
        !externalSortDropdownRef.current.contains(target)
      ) {
        setIsExternalSortDropdownOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsExternalLauncherDropdownOpen(false);
        setIsExternalSortDropdownOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isExternalLauncherDropdownOpen, isExternalSortDropdownOpen]);

  const ensureExternalImportPathDefault = useCallback(async () => {
    if (externalImportPath.trim().length > 0) return;
    if (externalImportLauncher === "unknown") return;
    if (externalImportLauncher === "auto") return;
    try {
      const p = await invoke<string | null>("default_external_launcher_path", {
        launcherType: externalImportLauncher,
      });
      if (p) setExternalImportPath(p);
    } catch (e) {
      console.error(e);
    }
  }, [externalImportLauncher, externalImportPath]);

  useEffect(() => {
    void ensureExternalImportPathDefault();
  }, [externalImportLauncher, ensureExternalImportPathDefault]);

  const handleBrowseExternalImportPath = useCallback(async () => {
    try {
      const p = await openFileDialog({ directory: true, multiple: false });
      if (typeof p === "string") {
        setExternalImportPath(p);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleScanExternalInstances = useCallback(async () => {
    setExternalImportScanBusy(true);
    setExternalImportScanError(null);
    setExternalImportInstances([]);
    try {
      const list = await invoke<ImportableExternalInstance[]>("list_importable_instances", {
        launcherType: externalImportLauncher,
        basePath: externalImportPath.trim().length ? externalImportPath.trim() : null,
      });
      setExternalImportInstances(list ?? []);
      if (!list || list.length === 0) {
        setExternalImportScanError(t(language, "modpacks.toast.noProfilesFound"));
      }
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      setExternalImportScanError(msg);
    } finally {
      setExternalImportScanBusy(false);
    }
  }, [externalImportLauncher, externalImportPath, language]);

  const handleImportExternalInstance = useCallback(
    async (inst: ImportableExternalInstance) => {
      if (externalImportBusy) return;
      setExternalImportBusy(true);
      setExternalImportProgress(null);
      try {
        const newProfile = await invoke<InstanceProfile>("import_selected_external_instance", {
          launcherType:
            inst.launcher_type !== "unknown" && inst.launcher_type !== "auto"
              ? inst.launcher_type
              : externalImportLauncher,
          basePath: externalImportPath.trim().length ? externalImportPath.trim() : null,
          instancePath: inst.path,
          displayName: inst.display_name,
          loader: inst.loader,
          gameVersion: inst.game_version,
          iconPath: inst.icon_path,
        });
        await invoke("set_selected_profile", { id: newProfile.id });
        await refreshProfiles();
        setSelectedProfileId(newProfile.id);
        setContentTab("mods");
        setActiveView("manage");
        await refreshItems(newProfile.id, "mods");
        showNotification("success", t(language, "modpacks.toast.profileImported"));
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        showNotification("error", t(language, "modpacks.toast.importProfileFailed", { msg }));
      } finally {
        setExternalImportBusy(false);
        setExternalImportProgress(null);
      }
    },
    [
      externalImportBusy,
      externalImportLauncher,
      externalImportPath,
      language,
      showNotification,
    ],
  );

  return {
    externalImportLauncher,
    setExternalImportLauncher,
    externalImportPath,
    setExternalImportPath,
    externalImportBusy,
    externalImportProgress,
    setExternalImportProgress,
    externalImportScanBusy,
    externalImportScanError,
    setExternalImportScanError,
    externalImportInstances,
    setExternalImportInstances,
    externalImportSearch,
    setExternalImportSearch,
    externalImportSort,
    setExternalImportSort,
    isExternalLauncherDropdownOpen,
    setIsExternalLauncherDropdownOpen,
    isExternalSortDropdownOpen,
    setIsExternalSortDropdownOpen,
    externalLauncherDropdownRef,
    externalSortDropdownRef,
    ensureExternalImportPathDefault,
    handleBrowseExternalImportPath,
    handleScanExternalInstances,
    handleImportExternalInstance,
  };
}
