import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, Download, UploadCloud } from "lucide-react";
import { SettingsToggle, SettingsSlider } from "../settings-ui/SettingsComponents";
import { JavaSettingsTab } from "./JavaSettings";

type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";
type Language = "ru" | "en";
type NotificationKind = "info" | "success" | "error" | "warning";
type Settings = {
  ram_mb: number;
  show_console_on_launch: boolean;
  close_launcher_on_game_start: boolean;
  check_game_processes: boolean;
  show_snapshots: boolean;
  show_alpha_versions: boolean;
  notify_new_update: boolean;
  notify_new_message: boolean;
  notify_system_message: boolean;
  check_updates_on_start: boolean;
  auto_install_updates: boolean;
};

type InstanceProfile = {
  id: string;
  name: string;
  icon_path: string | null;
  game_version: string;
  loader: string;
  created_at: number;
  mods_count: number;
  resourcepacks_count: number;
  shaderpacks_count: number;
  total_size_bytes: number;
  directory: string;
};

type VersionSummary = {
  id: string;
  version_type: string;
  url: string;
  release_time: string;
};

type ModpackTabProps = {
  language: Language;
  showNotification: (kind: NotificationKind, message: string) => void;
  onProfileSelectionChange?: (profile: InstanceProfile | null) => void;
  initialSelectedProfileId?: string | null;
};

type ViewId = "list" | "create" | "import" | "manage";
type ContentTab = "mods" | "resourcepacks" | "shaderpacks";

type FileNode = {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
  children?: FileNode[] | null;
};

type PreviewFile = { path: string; size: number };
type PreviewResult = { files: PreviewFile[]; total_bytes: number };
type ExportProgressPayload = { bytes_written: number; total_bytes: number; current_file: string };
type ExportFinishedPayload = { path: string; skipped_files: string[] };
type ExportErrorPayload = { message: string };

const loaderLabels: Record<LoaderId, string> = {
  vanilla: "Vanilla",
  forge: "Forge",
  fabric: "Fabric",
  quilt: "Quilt",
  neoforge: "NeoForge",
};

type IconProps = {
  className?: string;
};

function ImageIcon({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt ?? ""}
      className={className ?? "h-4 w-4 object-contain"}
      aria-hidden={alt ? undefined : true}
    />
  );
}

function FolderIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/folder.png" className={className} />;
}

function FileIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/file.png" className={className} />;
}

function EditIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/edit.png" className={className} />;
}

function DeleteIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/delete.png" className={className} />;
}

function ExportIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/export.png" className={className} />;
}

function PlusIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/add.png" className={className} />;
}

function RefreshIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/refresh.png" className={className} />;
}

function ModsIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/mods.png" className={className} />;
}

function SettingsIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/settings.png" className={className} />;
}

function SearchIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/search.png" className={className} />;
}

function WeightIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/weight.png" className={className} />;
}

function GridViewIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/grid.png" className={className} />;
}

function ListViewIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/list.png" className={className} />;
}

function formatBytes(bytes: number, language: Language): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return language === "ru" ? "0 МБ" : "0 MB";
  const units = language === "ru" ? ["Б", "КБ", "МБ", "ГБ"] : ["B", "KB", "MB", "GB"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function countLabel(count: number, language: Language): string {
  if (language === "ru") {
    return `Модов: ${count}`;
  }
  return `Mods: ${count}`;
}

const contentTabLabelsRu: Record<ContentTab, string> = {
  mods: "Моды",
  resourcepacks: "Ресурспаки",
  shaderpacks: "Шейдеры",
};

const contentTabLabelsEn: Record<ContentTab, string> = {
  mods: "Mods",
  resourcepacks: "Resource packs",
  shaderpacks: "Shaders",
};

export function ModpackTab({
  language,
  showNotification,
  onProfileSelectionChange,
  initialSelectedProfileId,
}: ModpackTabProps) {
  const [profiles, setProfiles] = useState<InstanceProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(() => {
    if (typeof window === "undefined") return initialSelectedProfileId ?? null;
    try {
      const saved = window.localStorage.getItem("modpacks_selected_profile_id");
      if (saved && saved.trim().length > 0) {
        return saved;
      }
    } catch {
    }
    return initialSelectedProfileId ?? null;
  });
  const [activeView, setActiveView] = useState<ViewId>("list");
  const [contentTab, setContentTab] = useState<ContentTab>("mods");
  const [items, setItems] = useState<string[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [search, setSearch] = useState("");
  const [createName, setCreateName] = useState("");
  const [createLoader, setCreateLoader] = useState<LoaderId>("fabric");
  const [createGameVersion, setCreateGameVersion] = useState("1.20.1");
  const [createAllVersions, setCreateAllVersions] = useState(false);
  const [createIconPath, setCreateIconPath] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [versionOptions, setVersionOptions] = useState<VersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false);
  const [mrpackBusy, setMrpackBusy] = useState(false);
  const [mrpackProgress, setMrpackProgress] = useState<{
    phase: string;
    current?: number;
    total?: number;
    message?: string;
  } | null>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [itemsSearch, setItemsSearch] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [profilesLayout, setProfilesLayout] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    try {
      const saved = window.localStorage.getItem("modpacks_profiles_layout");
      return saved === "grid" || saved === "list" ? saved : "list";
    } catch {
      return "list";
    }
  });
  const [contextMenu, setContextMenu] = useState<{
    profileId: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<string | null>(
    null,
  );
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [profileSettingsTab, setProfileSettingsTab] = useState<"general" | "java">("general");
  const [profileEffectiveSettings, setProfileEffectiveSettings] = useState<Settings | null>(null);
  const [systemMemoryGb, setSystemMemoryGb] = useState<number>(16);

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"mrpack" | "zip">("mrpack");
  const [exportTree, setExportTree] = useState<FileNode[] | null>(null);
  const [exportTreeLoading, setExportTreeLoading] = useState(false);
  const [selectedExportPaths, setSelectedExportPaths] = useState<Set<string>>(new Set());
  const [ignorePatternsText, setIgnorePatternsText] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgressPayload | null>(null);
  const [exportResultPath, setExportResultPath] = useState<string | null>(null);
  const [exportSkippedFiles, setExportSkippedFiles] = useState<string[]>([]);
  const [exportSpeedLabel, setExportSpeedLabel] = useState<string>("");
  const [collapsedExportPaths, setCollapsedExportPaths] = useState<Set<string>>(new Set());
  const lastProgressRef = useRef<{ t: number; bytes: number } | null>(null);
  const exportFormatTabRefs = useRef<
    Partial<Record<"mrpack" | "zip", HTMLButtonElement | null>>
  >({});
  const [exportFormatIndicator, setExportFormatIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const manageContentTabRefs = useRef<
    Partial<Record<ContentTab, HTMLButtonElement | null>>
  >({});
  const [manageContentIndicator, setManageContentIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  function parseIgnorePatterns(text: string): string[] {
    return text
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
  }

  function flattenTreePaths(nodes: FileNode[] | null): string[] {
    if (!nodes) return [];
    const out: string[] = [];
    const stack: FileNode[] = [...nodes];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      out.push(n.path);
      if (n.children && n.children.length) {
        for (const c of n.children) stack.push(c);
      }
    }
    return out;
  }

  function getDefaultSelectedPaths(tree: FileNode[] | null): Set<string> {
    const next = new Set<string>();
    if (!tree) return next;
    for (const n of tree) {
      next.add(n.path);
    }
    return next;
  }

  async function openExportModal() {
    if (!selectedProfile) return;
    setIsExportOpen(true);
    setExportResultPath(null);
    setExportProgress(null);
    setExportSkippedFiles([]);
    setExportSpeedLabel("");
    lastProgressRef.current = null;
    setPreviewResult(null);
    if (exportTree || exportTreeLoading) return;
    setExportTreeLoading(true);
    try {
      const tree = await invoke<FileNode[]>("list_build_files", { buildId: selectedProfile.id });
      setExportTree(tree);
      setSelectedExportPaths(getDefaultSelectedPaths(tree));
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru" ? "Не удалось прочитать файлы сборки." : "Failed to read build files.",
      );
      setExportTree(null);
    } finally {
      setExportTreeLoading(false);
    }
  }

  async function handlePreviewExport() {
    if (!selectedProfile) return;
    const selected = Array.from(selectedExportPaths);
    if (selected.length === 0) {
      showNotification(
        "warning",
        language === "ru" ? "Выберите хотя бы один путь." : "Select at least one path.",
      );
      return;
    }
    setPreviewLoading(true);
    setPreviewResult(null);
    try {
      const res = await invoke<PreviewResult>("preview_export", {
        buildId: selectedProfile.id,
        selectedPaths: selected,
        ignorePatterns: parseIgnorePatterns(ignorePatternsText),
      });
      setPreviewResult(res);
      showNotification(
        "info",
        language === "ru" ? "Предпросмотр обновлён." : "Preview updated.",
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru" ? "Не удалось сделать предпросмотр." : "Failed to preview export.",
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleStartExport() {
    if (!selectedProfile) return;
    const selected = Array.from(selectedExportPaths);
    if (selected.length === 0) {
      showNotification(
        "warning",
        language === "ru" ? "Выберите хотя бы один путь." : "Select at least one path.",
      );
      return;
    }

    let outPath: string | null = null;
    try {
      const ext = exportFormat === "mrpack" ? "mrpack" : "zip";
      const suggested = `${selectedProfile.name}-${selectedProfile.id}.${ext}`;
      const chosen = await saveFileDialog({
        defaultPath: suggested,
        filters: [
          exportFormat === "mrpack"
            ? { name: "Modrinth pack", extensions: ["mrpack"] }
            : { name: "Zip archive", extensions: ["zip"] },
        ],
      });
      if (typeof chosen === "string" && chosen.trim()) {
        outPath = chosen;
      }
    } catch (e) {
      console.error(e);
    }
    if (!outPath) return;

    setExportBusy(true);
    setExportProgress({ bytes_written: 0, total_bytes: 0, current_file: "" });
    setExportResultPath(null);
    setExportSkippedFiles([]);
    setExportSpeedLabel("");
    lastProgressRef.current = null;

    try {
      await invoke("export_build", {
        buildId: selectedProfile.id,
        selectedPaths: selected,
        ignorePatterns: parseIgnorePatterns(ignorePatternsText),
        format: exportFormat,
        outPath,
      });
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      showNotification(
        "error",
        language === "ru" ? `Экспорт не удался: ${msg}` : `Export failed: ${msg}`,
      );
      setExportBusy(false);
    }
  }

  useLayoutEffect(() => {
    if (!isExportOpen) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    (async () => {
      try {
        unlistenProgress = await listen<ExportProgressPayload>("export-progress", (event) => {
          const p = event.payload;
          setExportProgress(p);
          const now = Date.now();
          const prev = lastProgressRef.current;
          if (prev && p.bytes_written >= prev.bytes) {
            const dt = Math.max(1, now - prev.t);
            const db = p.bytes_written - prev.bytes;
            const bps = (db * 1000) / dt;
            if (Number.isFinite(bps)) {
              setExportSpeedLabel(
                language === "ru"
                  ? `${formatBytes(bps, language)}/с`
                  : `${formatBytes(bps, language)}/s`,
              );
            }
          }
          lastProgressRef.current = { t: now, bytes: p.bytes_written };
        });
      } catch (e) {
        console.error(e);
      }

      try {
        unlistenFinished = await listen<ExportFinishedPayload>("export-finished", (event) => {
          const p = event.payload;
          setExportResultPath(p.path);
          setExportSkippedFiles(Array.isArray(p.skipped_files) ? p.skipped_files : []);
          setExportBusy(false);
          setExportProgress(null);
          showNotification(
            "success",
            language === "ru" ? "Экспорт завершён." : "Export finished.",
          );
        });
      } catch (e) {
        console.error(e);
      }

      try {
        unlistenError = await listen<ExportErrorPayload>("export-error", (event) => {
          const p = event.payload;
          const msg =
            typeof p === "string"
              ? p
              : p && typeof p.message === "string"
                ? p.message
                : "Export error";
          setExportBusy(false);
          showNotification("error", msg);
        });
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      unlistenProgress?.();
      unlistenFinished?.();
      unlistenError?.();
    };
  }, [isExportOpen, language, showNotification]);

  async function openProfileSettings(profileId: string) {
    setSelectedProfileId(profileId);
    setActiveView("manage");
    setProfileSettingsTab("general");
    setIsProfileSettingsOpen(true);
    try {
      void invoke("set_selected_profile", { id: profileId });
    } catch {
      // ignore
    }
    try {
      const totalGb = await invoke<number>("get_system_memory_gb");
      if (typeof totalGb === "number" && Number.isFinite(totalGb) && totalGb >= 1) {
        setSystemMemoryGb(Math.max(1, Math.min(64, Math.round(totalGb))));
      }
    } catch {
      setSystemMemoryGb(16);
    }
    try {
      const s = await invoke<Settings>("get_effective_settings", { profileId });
      setProfileEffectiveSettings(s);
    } catch (e) {
      console.error(e);
      setProfileEffectiveSettings(null);
    }
  }

  async function patchProfileGameSettings(profileId: string, patch: Partial<Settings>) {
    setProfileEffectiveSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    const profilePatch: Record<string, unknown> = {};
    if (patch.ram_mb !== undefined) profilePatch.ram_mb = patch.ram_mb;
    if (patch.show_console_on_launch !== undefined)
      profilePatch.show_console_on_launch = patch.show_console_on_launch;
    if (patch.close_launcher_on_game_start !== undefined)
      profilePatch.close_launcher_on_game_start = patch.close_launcher_on_game_start;
    if (patch.check_game_processes !== undefined)
      profilePatch.check_game_processes = patch.check_game_processes;
    try {
      await invoke("update_profile_settings", { id: profileId, patch: profilePatch });
      showNotification(
        "success",
        language === "ru" ? "Настройки сборки сохранены." : "Profile settings saved.",
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось сохранить настройки сборки."
          : "Failed to save profile settings.",
      );
    }
  }

  // Если `App` уже знает выбранный профиль (например, после рестарта лаунчера),
  // синхронизируем локальное состояние при первом монтировании или смене id.
  useEffect(() => {
    if (!initialSelectedProfileId) return;
    setSelectedProfileId((prev) => prev ?? initialSelectedProfileId);
  }, [initialSelectedProfileId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (selectedProfileId) {
        window.localStorage.setItem("modpacks_selected_profile_id", selectedProfileId);
      } else {
        window.localStorage.removeItem("modpacks_selected_profile_id");
      }
    } catch {
      // ignore
    }
  }, [selectedProfileId]);

  useEffect(() => {
    void refreshProfiles();
  }, []);

  useEffect(() => {
    if (!selectedProfileId) {
      setItems([]);
      return;
    }
    if (activeView === "manage") {
      void refreshItems(selectedProfileId, contentTab);
    }
  }, [selectedProfileId, contentTab, activeView]);

  useEffect(() => {
    if (!isExportOpen) return;
    const updateIndicator = () => {
      const el = exportFormatTabRefs.current[exportFormat];
      if (el) {
        setExportFormatIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };
    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [isExportOpen, exportFormat]);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const el = manageContentTabRefs.current[contentTab];
      if (el) {
        setManageContentIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };
    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [contentTab]);

  useEffect(() => {
    if (!onProfileSelectionChange) return;

    const profile = profiles.find((p) => p.id === selectedProfileId) ?? null;
    onProfileSelectionChange(profile);
  }, [onProfileSelectionChange, profiles, selectedProfileId]);

  useEffect(() => {
    const unlistenPromise = listen<{
      phase: string;
      current?: number;
      total?: number;
      message?: string;
    }>("mrpack-import-progress", (event) => {
      const payload = event.payload;
      setMrpackProgress(payload);
      if (payload.phase === "start") {
        showNotification(
          "info",
          language === "ru" ? "Импорт начат…" : "Import started…",
        );
      }
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [language, showNotification]);

  async function refreshProfiles() {
    setLoadingProfiles(true);
    try {
      const list = await invoke<InstanceProfile[]>("get_profiles");
      setProfiles(list);
      try {
        const current = await invoke<InstanceProfile | null>("get_selected_profile");
        if (current && current.id) {
          setSelectedProfileId(current.id);
        }
      } catch {
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось загрузить список сборок."
          : "Failed to load profiles.",
      );
    } finally {
      setLoadingProfiles(false);
    }
  }

  async function refreshItems(id: string, tab: ContentTab) {
    setItemsLoading(true);
    try {
      const category =
        tab === "mods"
          ? "mods"
          : tab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      const files = await invoke<string[]>("list_profile_items", {
        id,
        category,
      });
      setItems(files);
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось загрузить файлы сборки."
          : "Failed to load profile files.",
      );
    } finally {
      setItemsLoading(false);
    }
  }

  async function ensureVersionsLoaded() {
    if (versionOptions.length > 0 || versionsLoading) return;
    setVersionsLoading(true);
    try {
      const all = await invoke<VersionSummary[]>("fetch_all_versions");
      const filtered = all.filter((v) =>
        createAllVersions ? true : v.version_type === "release",
      );
      setVersionOptions(filtered);
      if (filtered.length > 0) {
        setCreateGameVersion(filtered[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setVersionsLoading(false);
    }
  }

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter((p) =>
      p.name.toLowerCase().includes(query) ||
      p.game_version.toLowerCase().includes(query),
    );
  }, [profiles, search]);

  const totalProfilesLabel =
    language === "ru"
      ? `Всего сборок: ${profiles.length}`
      : `Total profiles: ${profiles.length}`;

  const manageTabLabels = language === "ru" ? contentTabLabelsRu : contentTabLabelsEn;

  const headerTitle =
    activeView === "create"
      ? language === "ru"
        ? "Создать сборку"
        : "Create profile"
      : activeView === "import"
        ? language === "ru"
          ? "Импортировать .mrpack"
          : "Import .mrpack"
        : activeView === "manage"
          ? selectedProfile?.name ?? ""
          : language === "ru"
            ? "Сборки"
            : "Profiles";

  async function handleChooseIcon() {
    try {
      const path = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
      if (typeof path === "string") {
        setCreateIconPath(path);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreateProfile() {
    const name = createName.trim();
    if (!name) {
      showNotification(
        "warning",
        language === "ru"
          ? "Введите название сборки."
          : "Enter profile name.",
      );
      return;
    }
    setCreateBusy(true);
    try {
      const profile = await invoke<InstanceProfile>("create_profile", {
        name,
        gameVersion: createGameVersion,
        loader: createLoader,
        iconSourcePath: createIconPath,
      });
      setProfiles((prev) => [...prev, profile]);
      setCreateName("");
      setCreateIconPath(null);
      setActiveView("manage");
      setSelectedProfileId(profile.id);
      try {
        await invoke("set_selected_profile", { id: profile.id });
      } catch (e) {
        console.error(e);
      }
      showNotification(
        "success",
        language === "ru"
          ? "Сборка создана."
          : "Profile created.",
      );
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : JSON.stringify(e);
      showNotification(
        "error",
        language === "ru"
          ? `Не удалось создать сборку: ${msg}`
          : `Failed to create profile: ${msg}`,
      );
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSelectProfile(profile: InstanceProfile) {
    const isAlreadySelected = selectedProfileId === profile.id;
    try {
      if (isAlreadySelected) {
        await invoke("set_selected_profile", { id: null });
        setSelectedProfileId(null);
        showNotification(
          "info",
          language === "ru"
            ? `Профиль «${profile.name}» снят с выбора.`
            : `Profile “${profile.name}” unselected.`,
        );
      } else {
        await invoke("set_selected_profile", { id: profile.id });
        setSelectedProfileId(profile.id);
        showNotification(
          "success",
          language === "ru"
            ? `Профиль «${profile.name}» выбран.`
            : `Profile “${profile.name}” selected.`,
        );
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось выбрать профиль."
          : "Failed to select profile.",
      );
    }
  }

  async function handleDeleteProfile(profile: InstanceProfile) {
    try {
      await invoke("delete_profile", { id: profile.id });
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));

      if (selectedProfileId === profile.id) {
        setSelectedProfileId(null);
        try {
          await invoke("set_selected_profile", { id: null });
        } catch (e) {
          console.error(e);
        }
        if (activeView === "manage") {
          setActiveView("list");
        }
      }

      showNotification(
        "success",
        language === "ru" ? "Сборка удалена." : "Profile deleted.",
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось удалить сборку."
          : "Failed to delete profile.",
      );
    }
  }

  async function handleImportMrpack(path?: string) {
    let chosen = path;
    if (!chosen) {
      try {
        const p = await openFileDialog({
          multiple: false,
          directory: false,
          filters: [{ name: "Modrinth pack", extensions: ["mrpack"] }],
        });
        if (typeof p === "string") {
          chosen = p;
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (!chosen) return;

    setMrpackBusy(true);
    setMrpackProgress(null);
    try {
      const newProfile = await invoke<InstanceProfile>("import_mrpack_as_new_profile", {
        mrpackPath: chosen,
      });
      setMrpackProgress(null);
      await invoke("set_selected_profile", { id: newProfile.id });
      await refreshProfiles();
      setSelectedProfileId(newProfile.id);
      setContentTab("mods");
      setActiveView("manage");
      await refreshItems(newProfile.id, "mods");
      showNotification(
        "success",
        language === "ru"
          ? "Импорт завершён. Сборка создана с версией игры из пакета."
          : "Import finished. Profile created with pack's game version.",
      );
    } catch (e) {
      console.error(e);
      setMrpackProgress(null);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : JSON.stringify(e);
      showNotification(
        "error",
        language === "ru"
          ? `Не удалось импортировать .mrpack: ${msg}`
          : `Failed to import .mrpack: ${msg}`,
      );
    } finally {
      setMrpackBusy(false);
    }
  }

  useEffect(() => {
    if (activeView !== "import") return;
    let unlisten: (() => void) | undefined;
    const webview = getCurrentWebview();
    void webview.onDragDropEvent((event: { payload: { type: string; paths?: string[] } }) => {
      if (event.payload.type === "drop" && event.payload.paths?.length) {
        const path = event.payload.paths.find((p: string) =>
          p.toLowerCase().endsWith(".mrpack"),
        );
        if (path) void handleImportMrpack(path);
      }
    }).then((fn) => { unlisten = fn; }).catch(console.error);
    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  async function handleAddFilesFromPc() {
    if (!selectedProfile) return;
    try {
      const paths = await openFileDialog({
        multiple: true,
        directory: false,
        filters: [
          {
            name: "Files",
            extensions:
              contentTab === "mods"
                ? ["jar"]
                : contentTab === "shaderpacks"
                  ? ["zip"]
                  : ["zip", "rar", "7z", "mcpack"],
          },
        ],
      });
      const arr =
        typeof paths === "string"
          ? [paths]
          : Array.isArray(paths)
            ? (paths as string[])
            : [];
      if (arr.length === 0) return;
      const category =
        contentTab === "mods"
          ? "mods"
          : contentTab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      await invoke("add_profile_files", {
        id: selectedProfile.id,
        category,
        files: arr,
      });
      await refreshItems(selectedProfile.id, contentTab);
      showNotification(
        "success",
        language === "ru"
          ? "Файлы добавлены в сборку."
          : "Files added to profile.",
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось добавить файлы."
          : "Failed to add files.",
      );
    }
  }

  async function handleDeleteItem(filename: string) {
    if (!selectedProfile) return;
    try {
      const category =
        contentTab === "mods"
          ? "mods"
          : contentTab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      await invoke("delete_item", {
        id: selectedProfile.id,
        category,
        filename,
      });
      setItems((prev) => prev.filter((f) => f !== filename));
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось удалить файл."
          : "Failed to delete file.",
      );
    }
  }

  async function handleOpenFolder() {
    if (!selectedProfile) return;
    try {
      await revealItemInDir(selectedProfile.directory);
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось открыть папку сборки."
          : "Failed to open profile folder.",
      );
    }
  }

  async function handleRenameConfirm() {
    if (!selectedProfile) return;
    const next = renameValue.trim();
    if (!next || next === selectedProfile.name) {
      setIsRenaming(false);
      return;
    }
    try {
      await invoke("rename_profile", { id: selectedProfile.id, name: next });
      setProfiles((prev) =>
        prev.map((p) => (p.id === selectedProfile.id ? { ...p, name: next } : p)),
      );
      showNotification(
        "success",
        language === "ru"
          ? "Название сборки изменено."
          : "Profile renamed.",
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось переименовать сборку."
          : "Failed to rename profile.",
      );
    } finally {
      setIsRenaming(false);
    }
  }

  function renderListView() {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-3 rounded-2xl border border-white/15 bg-black/40 px-4 py-2.5 shadow-soft backdrop-blur-xl">
            <SearchIcon className="h-4 w-4" />
            <input
              type="text"
              placeholder={language === "ru" ? "Поиск..." : "Search..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveView("create");
                void ensureVersionsLoaded();
              }}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-emerald-500"
            >
              <PlusIcon className="h-4 w-4" />
              <span>{language === "ru" ? "Создать" : "Create"}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView("import")}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-white/20"
            >
              <UploadCloud className="h-4 w-4" />
              <span>{language === "ru" ? "Импорт" : "Import"}</span>
            </button>
            <button
              type="button"
              onClick={() => void refreshProfiles()}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-sm font-semibold text-white/80 shadow-soft hover:bg-black/60"
            >
              <RefreshIcon className="h-4 w-4" />
              <span>{language === "ru" ? "Обновить" : "Refresh"}</span>
            </button>
            <div className="flex items-center gap-1 rounded-2xl border border-white/20 bg-black/40 p-1">
              <button
                type="button"
                onClick={() => {
                  setProfilesLayout("list");
                  try {
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("modpacks_profiles_layout", "list");
                    }
                  } catch {
                    // ignore
                  }
                }}
                className={`interactive-press rounded-xl p-1.5 ${
                  profilesLayout === "list"
                    ? "bg-white text-black shadow-soft"
                    : "text-white/70 hover:bg-white/10"
                }`}
                title={language === "ru" ? "Список" : "List"}
              >
                {profilesLayout === "list" ? (
                  <ImageIcon
                    src="/launcher-assets/list-black.png"
                    className="h-4 w-4 object-contain"
                  />
                ) : (
                  <ListViewIcon className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfilesLayout("grid");
                  try {
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("modpacks_profiles_layout", "grid");
                    }
                  } catch {
                    // ignore
                  }
                }}
                className={`interactive-press rounded-xl p-1.5 ${
                  profilesLayout === "grid"
                    ? "bg-white text-black shadow-soft"
                    : "text-white/70 hover:bg-white/10"
                }`}
                title={language === "ru" ? "Сетка" : "Grid"}
              >
                {profilesLayout === "grid" ? (
                  <ImageIcon
                    src="/launcher-assets/grid-black.png"
                    className="h-4 w-4 object-contain"
                  />
                ) : (
                  <GridViewIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="glass-panel relative flex-1 overflow-hidden">
          <div className="mb-1 flex items-center justify-between pl-3 text-xs text-white/60">
            <span>{totalProfilesLabel}</span>
            {loadingProfiles && (
              <span>
                {language === "ru" ? "Загрузка..." : "Loading..."}
              </span>
            )}
          </div>
          <div className="custom-scrollbar -mr-2 h-full overflow-y-auto px-4 pr-3">
            <div
              className={
                profilesLayout === "grid"
                  ? "grid grid-cols-1 gap-2 md:grid-cols-2"
                  : "flex flex-col gap-2"
              }
            >
              {filteredProfiles.map((p) => {
                const isSelected = selectedProfileId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 shadow-soft transition ${
                      isSelected
                        ? "border-emerald-400/80 bg-white/15"
                        : "border-white/10 bg-black/40 hover:border-white/40 hover:bg-black/60"
                    }`}
                    onClick={() => {
                      setSelectedProfileId(p.id);
                      setActiveView("manage");
                      void invoke("set_selected_profile", { id: p.id });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        profileId: p.id,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                        {p.icon_path ? (
                          <img
                            src={p.icon_path}
                            alt="icon"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ModsIcon className="h-6 w-6" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">
                            {p.name}
                          </span>
                          {isSelected && (
                            <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                              {language === "ru" ? "Выбран" : "Active"}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                          <span>{`${p.game_version} • ${p.loader}`}</span>
                          <span className="flex items-center gap-1">
                            <ModsIcon className="h-3 w-3" />
                            <span>{countLabel(p.mods_count, language)}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <WeightIcon className="h-3 w-3" />
                            <span>{formatBytes(p.total_size_bytes, language)}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleSelectProfile(p);
                        }}
                        className={`interactive-press rounded-xl px-3 py-1.5 text-xs font-semibold ${
                          isSelected
                            ? "bg-white/10 text-white/80 hover:bg-white/20"
                            : "bg-emerald-600 text-white hover:bg-emerald-500"
                        }`}
                      >
                        {language === "ru"
                          ? isSelected
                            ? "Снять выбор"
                            : "Выбрать"
                          : isSelected
                            ? "Unselect"
                            : "Select"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {!loadingProfiles && filteredProfiles.length === 0 && (
              <div className="mt-4 rounded-2xl border border-dashed border-white/20 bg-black/40 px-4 py-6 text-center text-sm text-white/70">
                {language === "ru"
                  ? "Сборки ещё не созданы. Нажмите «Создать», чтобы добавить первую."
                  : "No profiles yet. Click “Create” to add one."}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderCreateView() {
    return (
      <div className="glass-panel flex w-full max-w-2xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {language === "ru" ? "Создать сборку" : "Create profile"}
          </h2>
          <button
            type="button"
            onClick={() => setActiveView("list")}
            className="interactive-press rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/20"
          >
            {language === "ru" ? "Назад к списку" : "Back to list"}
          </button>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => void handleChooseIcon()}
              className="interactive-press flex h-28 w-24 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-black/40 text-xs text-white/70 hover:bg-black/60"
            >
              {createIconPath ? (
                // eslint-disable-next-line jsx-a11y/img-redundant-alt
                <img
                  src={createIconPath}
                  alt="icon"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>
                  {language === "ru" ? "Загрузить\nиконку" : "Upload\nicon"}
                </span>
              )}
            </button>
            {createIconPath && (
              <button
                type="button"
                onClick={() => setCreateIconPath(null)}
                className="interactive-press text-[11px] text-white/60 hover:text-white/90"
              >
                {language === "ru" ? "Удалить иконку" : "Remove icon"}
              </button>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">
                {language === "ru" ? "Название:" : "Name:"}
              </label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={
                  language === "ru"
                    ? "Введите название вашей сборки..."
                    : "Enter profile name..."
                }
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
              />
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-white/70">
                {language === "ru" ? "Загрузчик:" : "Loader:"}
              </span>
              <div className="flex flex-wrap gap-2">
                {(["vanilla", "forge", "fabric", "quilt", "neoforge"] as LoaderId[]).map(
                  (id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCreateLoader(id)}
                      className={`interactive-press rounded-full px-3 py-1.5 text-xs font-semibold ${
                        createLoader === id
                          ? "bg-white text-black shadow-soft"
                          : "bg-white/10 text-white/80 hover:bg-white/20"
                      }`}
                    >
                      {loaderLabels[id]}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-white/70">
                {language === "ru" ? "Версия игры:" : "Game version:"}
              </label>
              <div className="relative inline-flex w-60 items-center justify-between rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white/90">
                <button
                  type="button"
                  onClick={() => {
                    void ensureVersionsLoaded();
                    setIsVersionDropdownOpen((v) => !v);
                  }}
                  className="flex flex-1 items-center justify-between gap-2 text-left"
                >
                  <span className="truncate">
                    {createGameVersion || (language === "ru" ? "Выберите" : "Select")}
                  </span>
                  <ChevronDown className="h-3 w-3 text-white/60" />
                </button>
                {isVersionDropdownOpen && (
                  <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                    {versionsLoading && (
                      <div className="px-3 py-2 text-white/60">
                        {language === "ru" ? "Загрузка..." : "Loading..."}
                      </div>
                    )}
                    {!versionsLoading &&
                      versionOptions.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setCreateGameVersion(v.id);
                            setIsVersionDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                            createGameVersion === v.id
                              ? "bg-white/90 text-black"
                              : "text-white/80 hover:bg-white/10"
                          }`}
                        >
                          <span>{v.id}</span>
                          <span className="ml-2 text-[10px] uppercase text-gray-400">
                            {v.version_type}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={createAllVersions}
                  onChange={(e) => {
                    setCreateAllVersions(e.target.checked);
                    setVersionOptions([]);
                  }}
                  className="h-3.5 w-3.5 cursor-pointer appearance-none rounded-[6px] border border-white/35 bg-black/50 shadow-[0_0_0_1px_rgba(0,0,0,0.6)] transition-colors checked:border-emerald-400 checked:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                />
                <span>
                  {language === "ru" ? "Все версии" : "All versions"}
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={createBusy}
            onClick={() => void handleCreateProfile()}
            className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-emerald-500 disabled:opacity-60"
          >
            <PlusIcon className="h-4 w-4" />
            <span>{language === "ru" ? "Создать" : "Create"}</span>
          </button>
        </div>
      </div>
    );
  }

  function renderImportView() {
    return (
      <div className="glass-panel flex w-full max-w-2x2 flex-col gap-3">
        <div className="mb-2 flex items-center justify-between pl-2">
          <h2 className="text-lg font-semibold text-white">
            {language === "ru" ? "Импорт Modrinth пакета" : "Import Modrinth pack"}
          </h2>
          <button
            type="button"
            onClick={() => setActiveView("list")}
            className="interactive-press rounded-full bg-white/10 px-5 py-1 text-xs font-medium text-white/80 hover:bg-white/20"
          >
            {language === "ru" ? "Назад к списку" : "Back to list"}
          </button>
        </div>

        {mrpackBusy && mrpackProgress && (
          <div className="flex flex-col gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
            <p className="text-sm font-medium text-white">
              {mrpackProgress.phase === "start"
                ? language === "ru"
                  ? "Подготовка…"
                  : "Preparing…"
                : mrpackProgress.phase === "overrides"
                  ? language === "ru"
                    ? "Распаковка файлов пакета…"
                    : "Extracting pack overrides…"
                  : mrpackProgress.phase === "files" && mrpackProgress.total != null && mrpackProgress.total > 0
                    ? language === "ru"
                      ? `Скачивание: ${mrpackProgress.current ?? 0} / ${mrpackProgress.total}${mrpackProgress.message ? ` — ${mrpackProgress.message}` : ""}`
                      : `Downloading: ${mrpackProgress.current ?? 0} / ${mrpackProgress.total}${mrpackProgress.message ? ` — ${mrpackProgress.message}` : ""}`
                    : language === "ru"
                      ? "Импорт…"
                      : "Importing…"}
            </p>
            {mrpackProgress.total != null &&
              mrpackProgress.total > 0 &&
              mrpackProgress.current != null && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{
                      width: `${Math.round(
                        (mrpackProgress.current / mrpackProgress.total) * 100,
                      )}%`,
                    }}
                  />
                </div>
              )}
          </div>
        )}

        <div
          className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/25 bg-black/50 px-6 py-10 text-center text-sm text-white/70 backdrop-blur-xl"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
          }}
        >
          <UploadCloud className="mb-2 h-10 w-10 text-white/70" />
          <p className="text-sm font-medium text-white">
            {language === "ru"
              ? "Перетащите сюда .mrpack файл"
              : "Drag & drop a .mrpack file here"}
          </p>
          <p className="max-w-md text-xs text-white/60">
            {language === "ru"
              ? "Будет создана новая сборка с именем пакета и версией игры из .mrpack. Моды и ресурсы скачаются автоматически."
              : "A new profile will be created with the pack name and game version from the .mrpack. Mods and resources will be downloaded automatically."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={mrpackBusy}
              onClick={() => void handleImportMrpack()}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-white/15 px-5 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              <span>{language === "ru" ? "Выбрать файл" : "Choose file"}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderManageView() {
    if (!selectedProfile) return renderListView();

    const searchValue = itemsSearch.trim().toLowerCase();
    const visibleItems =
      searchValue.length === 0
        ? items
        : items.filter((name) => name.toLowerCase().includes(searchValue));

    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white/5">
              {selectedProfile.icon_path ? (
                // eslint-disable-next-line jsx-a11y/img-redundant-alt
                <img
                  src={selectedProfile.icon_path}
                  alt="icon"
                  className="h-full w-full object-cover"
                />
              ) : (
                <ModsIcon className="h-6 w-6" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {isRenaming ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void handleRenameConfirm();
                        } else if (e.key === "Escape") {
                          setIsRenaming(false);
                        }
                      }}
                      className="w-60 rounded-xl border border-white/30 bg-black/60 px-2 py-1 text-sm text-white focus:outline-none"
                    />
                  </>
                ) : (
                  <h2 className="truncate text-lg font-semibold text-white">
                    {selectedProfile.name}
                  </h2>
                )}
                {!isRenaming && (
                  <button
                    type="button"
                    onClick={() => {
                      setRenameValue(selectedProfile.name);
                      setIsRenaming(true);
                    }}
                    className="interactive-press rounded-full bg-white/10 p-1 text-white/70 hover:bg-white/20"
                    title={language === "ru" ? "Переименовать" : "Rename"}
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                  </button>
                )}
                {isRenaming && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRenameConfirm()}
                      className="interactive-press rounded-full bg-emerald-600 p-1 text-white hover:bg-emerald-500"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRenaming(false)}
                      className="interactive-press rounded-full bg-white/10 p-1 text-white hover:bg-white/20"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-white/70">
                <span>{`${selectedProfile.game_version} • ${selectedProfile.loader}`}</span>
                <span className="flex items-center gap-1">
                  <ModsIcon className="h-3 w-3" />
                  <span>{countLabel(selectedProfile.mods_count, language)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <WeightIcon className="h-3 w-3" />
                  <span>
                    {formatBytes(selectedProfile.total_size_bytes, language)}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView("list")}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
            >
              <span>{language === "ru" ? "К списку сборок" : "Back to list"}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleOpenFolder()}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
            >
              <FolderIcon className="h-4 w-4" />
              <span>{language === "ru" ? "Открыть папку" : "Open folder"}</span>
            </button>
            <button
              type="button"
              onClick={() => void openExportModal()}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
              title={language === "ru" ? "Экспортировать сборку" : "Export build"}
            >
              <ExportIcon className="h-4 w-4" />
              <span>{language === "ru" ? "Экспорт" : "Export"}</span>
            </button>
            <button
              type="button"
              onClick={() => void openProfileSettings(selectedProfile.id)}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
              title={language === "ru" ? "Настройки сборки" : "Profile settings"}
            >
              <img
                src="/launcher-assets/setttings.png"
                alt=""
                className="h-4 w-4 object-contain"
                onError={(e) => {
                  const img = e.currentTarget;
                  img.style.display = "none";
                }}
              />
              <SettingsIcon className="h-4 w-4" />
              <span>{language === "ru" ? "Настройки" : "Settings"}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSelectProfile(selectedProfile)}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-soft hover:bg-emerald-500"
            >
              <Download className="h-4 w-4" />
              <span>{language === "ru" ? "Выбрать" : "Select"}</span>
            </button>
          </div>
        </div>

          <div className="glass-panel flex flex-1 flex-col">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex flex-1 items-center gap-3 rounded-2xl border border-white/15 bg-black/35 px-4 py-2 shadow-soft backdrop-blur-xl">
              <SearchIcon className="h-4 w-4" />
              <input
                type="text"
                placeholder={language === "ru" ? "Поиск файлов..." : "Search files..."}
                value={itemsSearch}
                onChange={(e) => setItemsSearch(e.target.value)}
                className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                selectedProfile && void refreshItems(selectedProfile.id, contentTab)
              }
              className="interactive-press rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              title={language === "ru" ? "Пересканировать" : "Rescan"}
            >
              <RefreshIcon className="h-3.5 w-3.5" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsAddMenuOpen((v) => !v)}
                className="interactive-press inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-emerald-500"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                <span>{language === "ru" ? "Добавить" : "Add"}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {isAddMenuOpen && (
                <div className="absolute right-0 z-30 mt-1 w-44 rounded-2xl bg-black/90 p-1 text-xs text-white shadow-soft backdrop-blur-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      showNotification(
                        "info",
                        language === "ru"
                          ? "Каталог Modrinth доступен на вкладке «Моды»."
                          : "Modrinth catalog is available on the “Mods” tab.",
                      );
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>
                      {language === "ru"
                        ? "Скачать из каталога"
                        : "Download from catalog"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      void handleAddFilesFromPc();
                    }}
                    className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                  >
                    <FolderIcon className="h-3.5 w-3.5" />
                    <span>
                      {language === "ru"
                        ? "Выбрать файл с ПК"
                        : "Choose file from PC"}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <div className="relative inline-flex gap-1 rounded-full bg-white/10 p-1 overflow-hidden">
              <div
                className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-white/90 transition-all duration-200 ease-out"
                style={{
                  left: `${manageContentIndicator.left}px`,
                  width: `${manageContentIndicator.width}px`,
                }}
              />
              {(["mods", "resourcepacks", "shaderpacks"] as ContentTab[]).map(
                (tab) => {
                  const active = tab === contentTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      ref={(el) => {
                        manageContentTabRefs.current[tab] = el;
                      }}
                      onClick={() => setContentTab(tab)}
                      className={`interactive-press relative z-10 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        active ? "text-black" : "text-white/70 hover:text-white"
                      }`}
                    >
                      {manageTabLabels[tab]}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          <div className="custom-scrollbar -mr-2 flex-1 overflow-y-auto pr-2">
            {itemsLoading ? (
              <div className="flex h-32 items-center justify-center text-xs text-white/70">
                {language === "ru" ? "Загрузка файлов..." : "Loading files..."}
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="flex h-32 items-center justify-center rounded-2xl bg-black/40 text-xs text-white/60">
                {language === "ru"
                  ? "В этой вкладке ещё нет файлов."
                  : "There are no files in this tab yet."}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {visibleItems.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-2xl bg-black/45 px-3 py-3 text-xs text-white/85"
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-[11px]">
                        {contentTab === "mods" ? (
                          <ModsIcon className="h-5 w-5" />
                        ) : contentTab === "resourcepacks" ? (
                          "R"
                        ) : (
                          "S"
                        )}
                      </span>
                      <span className="max-w-[260px] truncate md:max-w-[360px]">
                        {name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteItem(name)}
                      className="interactive-press rounded-full bg-white/10 p-1.5 text-white/80 hover:bg-red-600 hover:text-white"
                      title={language === "ru" ? "Удалить" : "Delete"}
                    >
                      <DeleteIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-5xl flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">{headerTitle}</h1>
      </div>

      {activeView === "list"
        ? renderListView()
        : activeView === "create"
          ? renderCreateView()
          : activeView === "import"
            ? renderImportView()
            : renderManageView()}

      {contextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            className="absolute z-50 w-56 rounded-2xl bg-black/90 p-1 text-xs text-white shadow-soft backdrop-blur-lg"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                void openProfileSettings(profile.id);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              <span>{language === "ru" ? "Настройки" : "Settings"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find(
                  (p) => p.id === contextMenu.profileId,
                );
                setContextMenu(null);
                if (!profile) return;
                setPendingDeleteProfileId(profile.id);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-red-300 hover:bg-red-600/20"
            >
              <DeleteIcon className="h-3.5 w-3.5" />
              <span>
                {language === "ru" ? "Удалить сборку" : "Delete profile"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find(
                  (p) => p.id === contextMenu.profileId,
                );
                setContextMenu(null);
                if (!profile) return;
                setSelectedProfileId(profile.id);
                setActiveView("manage");
                setRenameValue(profile.name);
                setIsRenaming(true);
                void invoke("set_selected_profile", { id: profile.id });
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <EditIcon className="h-3.5 w-3.5" />
              <span>
                {language === "ru"
                  ? "Редактировать название"
                  : "Rename profile"}
              </span>
            </button>
          </div>
        </div>
      )}

      {pendingDeleteProfileId && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPendingDeleteProfileId(null)}
        >
          <div
            className="glass-panel relative w-full max-w-sm rounded-2xl border border-yellow-400/60 bg-black/80 p-5 text-sm text-white shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-300">
                !
              </div>
              <h2 className="text-sm font-semibold text-yellow-200">
                {language === "ru" ? "Подтверждение удаления" : "Delete confirmation"}
              </h2>
            </div>
            <p className="mb-4 text-xs text-yellow-50">
              {(() => {
                const profile = profiles.find((p) => p.id === pendingDeleteProfileId);
                const name = profile?.name ?? "";
                return language === "ru"
                  ? `Удалить сборку «${name}»? Это действие нельзя отменить.`
                  : `Delete profile “${name}”? This action cannot be undone.`;
              })()}
            </p>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPendingDeleteProfileId(null)}
                className="interactive-press rounded-full bg-white/10 px-4 py-1.5 font-semibold text-white hover:bg-white/20"
              >
                {language === "ru" ? "Отмена" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const profile = profiles.find(
                    (p) => p.id === pendingDeleteProfileId,
                  );
                  if (!profile) {
                    setPendingDeleteProfileId(null);
                    return;
                  }
                  setPendingDeleteProfileId(null);
                  void handleDeleteProfile(profile);
                }}
                className="interactive-press rounded-full bg-red-600 px-4 py-1.5 font-semibold text-white hover:bg-red-500"
              >
                {language === "ru" ? "Удалить" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isProfileSettingsOpen && selectedProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setIsProfileSettingsOpen(false)}
        >
          <div
            className="glass-panel w-full max-w-3xl rounded-3xl border border-white/15 bg-black/70 p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.16em] text-white/50">
                  {language === "ru" ? "Настройки сборки" : "Profile settings"}
                </div>
                <div className="truncate text-lg font-semibold text-white">
                  {selectedProfile.name}
                </div>
              </div>
              <button
                type="button"
                className="interactive-press rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
                onClick={() => setIsProfileSettingsOpen(false)}
              >
                {language === "ru" ? "Закрыть" : "Close"}
              </button>
            </div>

            <div className="mb-4 flex items-center gap-2 rounded-full bg-white/10 p-1">
              <button
                type="button"
                onClick={() => setProfileSettingsTab("general")}
                className={`interactive-press flex-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  profileSettingsTab === "general"
                    ? "bg-white text-black shadow-soft"
                    : "text-white/70 hover:text-white"
                }`}
              >
                {language === "ru" ? "Общие" : "General"}
              </button>
              <button
                type="button"
                onClick={() => setProfileSettingsTab("java")}
                className={`interactive-press flex-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  profileSettingsTab === "java"
                    ? "bg-white text-black shadow-soft"
                    : "text-white/70 hover:text-white"
                }`}
              >
                Java
              </button>
            </div>

            {profileSettingsTab === "general" ? (
              <div className="max-h-[420px] overflow-y-auto pr-1">
                <div className="rounded-2xl border border-white/12 bg-black/35 px-4 py-3">
                  <div className="mb-2 text-xs text-white/60">
                    {language === "ru"
                      ? "Эти параметры применяются только к выбранной сборке и используются при запуске игры."
                      : "These settings apply only to this profile and are used on launch."}
                  </div>
                  <SettingsToggle
                    label={
                      language === "ru"
                        ? "Консоль при запуске:"
                        : "Show console on game start:"
                    }
                    yesLabel={language === "ru" ? "Да" : "On"}
                    noLabel={language === "ru" ? "Нет" : "Off"}
                    value={profileEffectiveSettings?.show_console_on_launch ?? false}
                    onChange={(value: boolean) =>
                      void patchProfileGameSettings(selectedProfile.id, {
                        show_console_on_launch: value,
                      })
                    }
                  />
                  <SettingsToggle
                    label={
                      language === "ru"
                        ? "Закрывать лаунчер при запуске игры:"
                        : "Close launcher when game starts:"
                    }
                    yesLabel={language === "ru" ? "Да" : "Yes"}
                    noLabel={language === "ru" ? "Нет" : "No"}
                    value={profileEffectiveSettings?.close_launcher_on_game_start ?? false}
                    onChange={(value: boolean) =>
                      void patchProfileGameSettings(selectedProfile.id, {
                        close_launcher_on_game_start: value,
                      })
                    }
                  />
                  <SettingsToggle
                    label={
                      language === "ru"
                        ? "Проверять запущенные процессы игры:"
                        : "Check running game processes:"
                    }
                    yesLabel={language === "ru" ? "Да" : "Yes"}
                    noLabel={language === "ru" ? "Нет" : "No"}
                    value={profileEffectiveSettings?.check_game_processes ?? true}
                    onChange={(value: boolean) =>
                      void patchProfileGameSettings(selectedProfile.id, {
                        check_game_processes: value,
                      })
                    }
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-white/12 bg-black/35 px-4 py-3">
                  <SettingsSlider
                    label={language === "ru" ? "Оперативная память:" : "Memory (RAM):"}
                    min={1}
                    max={Math.max(64, systemMemoryGb)}
                    value={Math.max(
                      1,
                      Math.round((profileEffectiveSettings?.ram_mb ?? 4096) / 1024),
                    )}
                    onChange={(value: number) =>
                      void patchProfileGameSettings(selectedProfile.id, {
                        ram_mb: Math.max(1, value) * 1024,
                      })
                    }
                    right={
                      <span className="text-sm font-semibold text-white/90">
                        {Math.max(
                          1,
                          Math.round((profileEffectiveSettings?.ram_mb ?? 4096) / 1024),
                        )}
                        ГБ
                      </span>
                    }
                  />
                </div>
              </div>
            ) : (
              <JavaSettingsTab
                language={language}
                systemMemoryGb={systemMemoryGb}
                showNotification={showNotification}
                profileId={selectedProfile.id}
              />
            )}
          </div>
        </div>
      )}

      {isExportOpen && selectedProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => {
            if (exportBusy) return;
            setIsExportOpen(false);
          }}
        >
          <div
            className="glass-panel w-full max-w-5xl max-h-[80vh] overflow-y-auto rounded-3xl border border-white/15 bg-black/70 p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.16em] text-white/50">
                  {language === "ru" ? "Экспорт сборки" : "Export build"}
                </div>
                <div className="truncate text-lg font-semibold text-white">
                  {selectedProfile.name}
                </div>
              </div>
              <button
                type="button"
                className="interactive-press rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20 disabled:opacity-60"
                disabled={exportBusy}
                onClick={() => setIsExportOpen(false)}
              >
                {language === "ru" ? "Закрыть" : "Close"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-white/12 bg-black/35 px-4 py-3">
                <div className="mb-2 text-xs font-semibold text-white/80">
                  {language === "ru" ? "Формат" : "Format"}
                </div>
                <div className="relative inline-flex gap-1 rounded-full bg-white/10 p-1 overflow-hidden">
                  <div
                    className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-white/90 transition-all duration-200 ease-out"
                    style={{
                      left: `${exportFormatIndicator.left}px`,
                      width: `${exportFormatIndicator.width}px`,
                    }}
                  />
                  <button
                    type="button"
                    disabled={exportBusy}
                    ref={(el) => {
                      exportFormatTabRefs.current.mrpack = el;
                    }}
                    onClick={() => setExportFormat("mrpack")}
                    className={`interactive-press relative z-10 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      exportFormat === "mrpack"
                        ? "text-black"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    MRPack
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy}
                    ref={(el) => {
                      exportFormatTabRefs.current.zip = el;
                    }}
                    onClick={() => setExportFormat("zip")}
                    className={`interactive-press relative z-10 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      exportFormat === "zip"
                        ? "text-black"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    ZIP
                  </button>
                </div>

                <div className="mt-4 text-xs font-semibold text-white/80">
                  {language === "ru" ? "Исключения" : "Ignore patterns"}
                </div>
                <textarea
                  value={ignorePatternsText}
                  disabled={exportBusy}
                  onChange={(e) => setIgnorePatternsText(e.target.value)}
                  placeholder={language === "ru" ? "*.log\ncache/\n!important.log" : "*.log\ncache/\n!important.log"}
                  className="custom-scrollbar mt-2 h-32 w-full resize-none rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-xs text-white/85 placeholder:text-white/35 focus:border-white/35 focus:outline-none"
                />
                <div className="mt-2 text-[11px] text-white/55">
                  {language === "ru"
                    ? "Поддерживаются: *, **, ! (отмена исключения)."
                    : "Supported: *, **, ! (negation)."}
                </div>
              </div>

              <div className="rounded-2xl border border-white/12 bg-black/35 px-4 py-3 lg:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-white/80">
                    {language === "ru" ? "Файлы сборки" : "Build files"}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={exportBusy || exportTreeLoading || !exportTree}
                      onClick={() => setSelectedExportPaths(new Set(flattenTreePaths(exportTree)))}
                      className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                    >
                      {language === "ru" ? "Выбрать всё" : "Select all"}
                    </button>
                    <button
                      type="button"
                      disabled={exportBusy}
                      onClick={() => setSelectedExportPaths(new Set())}
                      className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                    >
                      {language === "ru" ? "Снять всё" : "Clear"}
                    </button>
                  </div>
                </div>

                <div className="custom-scrollbar max-h-[360px] overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2">
                  {exportTreeLoading ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {language === "ru" ? "Сканирование..." : "Scanning..."}
                    </div>
                  ) : !exportTree ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {language === "ru" ? "Нет данных." : "No data."}
                    </div>
                  ) : exportTree.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {language === "ru" ? "Папка сборки пуста." : "Build folder is empty."}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {(function renderNodes(nodes: FileNode[], depth: number): ReactNode[] {
                        return nodes.flatMap((n) => {
                          const checked = selectedExportPaths.has(n.path);
                          const isCollapsed = collapsedExportPaths.has(n.path);
                          const row = (
                            <label
                              key={n.path}
                              className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1 hover:bg-white/5"
                              style={{ paddingLeft: 8 + depth * 14 }}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                {n.is_dir ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setCollapsedExportPaths((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(n.path)) next.delete(n.path);
                                        else next.add(n.path);
                                        return next;
                                      });
                                    }}
                                    className="interactive-press mr-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/5 text-white/70 hover:bg-white/15"
                                  >
                                    <ChevronDown
                                      className={`h-3 w-3 transition-transform ${
                                        isCollapsed ? "-rotate-90" : "rotate-0"
                                      }`}
                                    />
                                  </button>
                                ) : (
                                  <span className="mr-0.5 h-4 w-4" />
                                )}
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={exportBusy}
                                  onChange={(e) => {
                                    const next = new Set(selectedExportPaths);
                                    if (e.target.checked) next.add(n.path);
                                    else next.delete(n.path);
                                    setSelectedExportPaths(next);
                                  }}
                                  className="h-3.5 w-3.5 cursor-pointer appearance-none rounded-[6px] border border-white/35 bg-black/50 shadow-[0_0_0_1px_rgba(0,0,0,0.6)] transition-colors checked:border-emerald-400 checked:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                                />
                                {n.is_dir ? (
                                  <FolderIcon className="h-4 w-4 opacity-90" />
                                ) : (
                                  <FileIcon className="h-4 w-4 opacity-90" />
                                )}
                                <span className="truncate text-xs text-white/85">
                                  {n.name}
                                </span>
                              </span>
                              <span className="shrink-0 text-[11px] text-white/55">
                                {formatBytes(n.size, language)}
                              </span>
                            </label>
                          );

                          const children =
                            n.children && n.children.length && !isCollapsed
                              ? renderNodes(n.children, depth + 1)
                              : [];
                          return [row, ...children];
                        });
                      })(exportTree, 0)}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={exportBusy || previewLoading}
                    onClick={() => void handlePreviewExport()}
                    className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-white/15 px-5 py-2 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
                  >
                    {language === "ru" ? "Предпросмотр" : "Preview"}
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy}
                    onClick={() => void handleStartExport()}
                    className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-soft hover:bg-emerald-500 disabled:opacity-60"
                  >
                    <ExportIcon className="h-4 w-4" />
                    <span>{language === "ru" ? "Экспортировать" : "Export"}</span>
                  </button>

                  {exportBusy && exportProgress && (
                    <div className="ml-auto flex min-w-[260px] flex-1 flex-col gap-1 rounded-2xl border border-white/12 bg-black/40 px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-[11px] text-white/70">
                        <span className="truncate">
                          {exportProgress.current_file || (language === "ru" ? "Экспорт…" : "Exporting…")}
                        </span>
                        <span className="shrink-0">
                          {exportSpeedLabel || ""}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                          style={{
                            width:
                              exportProgress.total_bytes > 0
                                ? `${Math.min(
                                    100,
                                    Math.round(
                                      (exportProgress.bytes_written / exportProgress.total_bytes) * 100,
                                    ),
                                  )}%`
                                : "8%",
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-white/55">
                        <span>
                          {formatBytes(exportProgress.bytes_written, language)} /{" "}
                          {formatBytes(exportProgress.total_bytes, language)}
                        </span>
                        <span>
                          {exportProgress.total_bytes > 0
                            ? `${Math.round(
                                (exportProgress.bytes_written / exportProgress.total_bytes) * 100,
                              )}%`
                            : ""}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {previewResult && (
                  <div className="mt-3 rounded-2xl border border-white/12 bg-black/35 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-white/80">
                        {language === "ru" ? "Итоговое содержимое" : "Final contents"}
                      </div>
                      <div className="text-xs text-white/70">
                        {language === "ru" ? "Размер:" : "Size:"}{" "}
                        <span className="font-semibold text-white/90">
                          {formatBytes(previewResult.total_bytes, language)}
                        </span>
                      </div>
                    </div>
                    <div className="custom-scrollbar mt-2 max-h-40 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2 text-[11px] text-white/75">
                      {previewResult.files.length === 0 ? (
                        <div className="py-6 text-center text-white/55">
                          {language === "ru" ? "Ничего не попадёт в архив." : "Nothing will be included."}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {previewResult.files.slice(0, 400).map((f) => (
                            <div key={f.path} className="flex items-center justify-between gap-3 px-2 py-0.5">
                              <span className="min-w-0 truncate">{f.path}</span>
                              <span className="shrink-0 text-white/50">
                                {formatBytes(f.size, language)}
                              </span>
                            </div>
                          ))}
                          {previewResult.files.length > 400 && (
                            <div className="px-2 py-1 text-white/50">
                              {language === "ru"
                                ? `… и ещё ${previewResult.files.length - 400} файлов`
                                : `… and ${previewResult.files.length - 400} more files`}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {exportResultPath && (
                  <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-emerald-200">
                        {language === "ru" ? "Готово" : "Done"}
                      </div>
                      <button
                        type="button"
                        onClick={() => void revealItemInDir(exportResultPath)}
                        className="interactive-press rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        {language === "ru" ? "Открыть папку" : "Open folder"}
                      </button>
                    </div>
                    <div className="break-all text-[11px] text-emerald-100/90">{exportResultPath}</div>
                    {exportSkippedFiles.length > 0 && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-white/70">
                        <div className="mb-1 font-semibold text-white/80">
                          {language === "ru"
                            ? `Пропущено файлов: ${exportSkippedFiles.length}`
                            : `Skipped files: ${exportSkippedFiles.length}`}
                        </div>
                        <div className="custom-scrollbar max-h-20 overflow-y-auto">
                          {exportSkippedFiles.slice(0, 80).map((p) => (
                            <div key={p} className="truncate">{p}</div>
                          ))}
                          {exportSkippedFiles.length > 80 && (
                            <div className="text-white/50">
                              {language === "ru"
                                ? `… и ещё ${exportSkippedFiles.length - 80}`
                                : `… and ${exportSkippedFiles.length - 80} more`}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ModpackTab;


