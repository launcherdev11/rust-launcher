import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, Download, UploadCloud } from "lucide-react";
import { SettingsToggle, SettingsSlider } from "../settings-ui/SettingsComponents";
import { JavaSettingsTab } from "./JavaSettings";
import {
  formatByteSize,
  formatPlaytimeShort,
  localeTag,
  t,
  useT,
  type Language,
} from "../i18n";
import { DeleteIcon } from "../components/delete_icon";
import { ProfileInstanceIcon } from "../components/profile_instance_icon";
import { resolveIconSrc } from "../lib/profile-icon";
import {
  assignProfilesToGroup,
  dedupeProfileGroupAssignments,
  loadProfileGroups,
  newProfileGroupId,
  PROFILE_GROUP_COLOR_STYLES,
  PROFILE_GROUP_COLORS,
  pruneEmptyProfileGroups,
  sanitizeProfileGroups,
  saveProfileGroups,
  ungroupProfiles,
  type ProfileGroup,
  type ProfileGroupColor,
} from "../lib/profile-groups";
import type { DownloadJobKind } from "../hooks/useDownloadJobs";
import type { ModpackHotkeyActions, ModpackNavigationActions } from "../hooks/useHotkeys";
import { ScreenshotsModal } from "../features/screenshots";
import {
  ProfileInfoIcon,
  ProfileInfoModal,
  type ProfileInfoData,
} from "../components/profile_info_modal";

type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";
type LoaderVersionChannel = "stable" | "beta" | "alpha";
type LoaderVersionOption = {
  version: string;
  channel?: LoaderVersionChannel | null;
};
type NotificationKind = "info" | "success" | "error" | "warning";
type Settings = {
  game_directory: string | null;
  ram_mb: number;
  show_console_on_launch: boolean;
  close_launcher_on_game_start: boolean;
  check_game_processes: boolean;
  resolution_width: number | null;
  resolution_height: number | null;
  show_snapshots: boolean;
  show_alpha_versions: boolean;
  notify_new_update: boolean;
  notify_new_message: boolean;
  notify_system_message: boolean;
  check_updates_on_start: boolean;
  auto_install_updates: boolean;
  ui_sounds_enabled: boolean;
  open_launcher_on_profiles_tab: boolean;
};

type InstanceProfile = {
  id: string;
  name: string;
  icon_path: string | null;
  game_version: string;
  loader: string;
  loader_version?: string | null;
  created_at: number;
  play_time_seconds: number | null;
  last_played_at?: number | null;
  mods_count: number;
  resourcepacks_count: number;
  shaderpacks_count: number;
  total_size_bytes: number;
  directory: string;
};

type ExternalLauncherType =
  | "auto"
  | "multimc"
  | "prism_launcher"
  | "atlauncher"
  | "gdlauncher"
  | "curseforge"
  | "unknown";

type ImportableExternalInstance = {
  id: string;
  launcher_type: ExternalLauncherType;
  path: string;
  display_name: string;
  loader: string | null;
  game_version: string | null;
  icon_path: string | null;
  icon_data_uri: string | null;
  approx_size_bytes: number | null;
  mods_count: number | null;
  last_modified: number | null;
};

type BuildPresetSettings = {
  ram_mb?: number | null;
  jvm_args?: string | null;
  java_settings?: {
    use_custom_jvm_args: boolean;
    java_path: string | null;
    xms: string | null;
    xmx: string | null;
    jvm_args: string | null;
    preset: string | null;
  } | null;
  resolution_width?: number | null;
  resolution_height?: number | null;
  show_console_on_launch?: boolean | null;
  close_launcher_on_game_start?: boolean | null;
  check_game_processes?: boolean | null;
};

type BuildPreset = {
  id: string;
  name: string;
  game_version: string;
  loader: string;
  loader_version?: string | null;
  settings?: BuildPresetSettings | null;
  created_at: number;
  icon_path?: string | null;
};

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

type GameConsoleLine = {
  id: number;
  line: string;
  source: "stdout" | "stderr";
};

type GameConsoleSession = {
  id: string;
  startedAt: number;
  endedAt?: number;
  lines: GameConsoleLine[];
};

type GameStatus = "idle" | "running" | "stopped" | "crashed";

type ModpackTabProps = {
  language: Language;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean }) => void;
  onProfileSelectionChange?: (profile: InstanceProfile | null) => void;
  initialSelectedProfileId?: string | null;
  onOpenModsTab?: () => void;
  onPlaySelectedProfile?: () => void;
  primaryLabel?: string;
  primaryColorClasses?: string;
  isLaunching?: boolean;
  isStopping?: boolean;
  onProfilesChange?: (profiles: InstanceProfile[]) => void;
  onTogglePinInSidebar?: (profile: InstanceProfile) => void;
  isPinnedInSidebar?: (profileId: string) => boolean;
  gameStatus?: GameStatus;
  consoleLines?: GameConsoleLine[];
  consoleHistorySessions?: GameConsoleSession[];
  onClearConsole?: () => void;
  openedMrpackPath?: string | null;
  onOpenedMrpackPathConsumed?: () => void;
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
  onRegisterModpackHotkeys?: (actions: ModpackHotkeyActions | null) => void;
  onActiveViewChange?: (view: ViewId) => void;
  onRegisterModpackNavigation?: (actions: ModpackNavigationActions | null) => void;
  requestedModpackView?: ViewId | null;
  onRequestedModpackViewApplied?: () => void;
};

type ViewId = "list" | "create" | "import" | "manage";
type ContentTab = "mods" | "resourcepacks" | "shaderpacks";

type ProfileItemEntry = {
  name: string;
  enabled: boolean;
};

type ProfileContentUpdate = {
  filename: string;
  enabled: boolean;
  projectId: string;
  title: string;
  currentVersionId: string;
  currentVersionNumber: string;
  latestVersionId: string;
  latestVersionNumber: string;
  latestUrl: string;
  latestFilename: string;
  latestSha1?: string | null;
};

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
type PlaytimeUpdatedPayload = { profile_id: string; delta_seconds: number };
type LastPlayedUpdatedPayload = { profile_id: string; last_played_at: number };

const loaderLabels: Record<LoaderId, string> = {
  vanilla: "Vanilla",
  forge: "Forge",
  fabric: "Fabric",
  quilt: "Quilt",
  neoforge: "NeoForge",
};

function shortGameVersionLabel(gameVersion: string): string {
  const parts = gameVersion.split(".");
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return `${parts[0]}.${parts[1]}`;
  }
  return gameVersion;
}

function defaultProfileName(loader: LoaderId, gameVersion: string): string {
  return `${loaderLabels[loader]} ${shortGameVersionLabel(gameVersion)}`.slice(0, 50);
}

function pickDefaultLoaderVersion(options: LoaderVersionOption[]): string {
  const stable = options.find((o) => o.channel === "stable");
  return stable?.version ?? options[0]?.version ?? "";
}

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

function ScreenshotsIcon({ className }: IconProps) {
  return <ImageIcon src="/launcher-assets/pack_image.png" className={className} />;
}

function countLabel(count: number, language: Language): string {
  return t(language, "common.format.modsCount", { count });
}

function formatLastPlayedAt(ts: number | null | undefined, language: Language): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return "—";
  try {
    return new Date(ts * 1000).toLocaleString(localeTag(language), {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

const CONTENT_TAB_KEYS: Record<ContentTab, string> = {
  mods: "modpacks.contentTabs.mods",
  resourcepacks: "modpacks.contentTabs.resourcepacks",
  shaderpacks: "modpacks.contentTabs.shaderpacks",
};

function filterPathsForContentTab(tab: ContentTab, paths: string[]): string[] {
  const okExt = (p: string, exts: string[]) => {
    const lower = p.toLowerCase();
    const dot = lower.lastIndexOf(".");
    if (dot < 0) return false;
    const ext = lower.slice(dot + 1);
    return exts.includes(ext);
  };
  if (tab === "mods") return paths.filter((p) => okExt(p, ["jar"]));
  if (tab === "shaderpacks") return paths.filter((p) => okExt(p, ["zip"]));
  return paths.filter((p) => okExt(p, ["zip", "rar", "7z", "mcpack"]));
}

const MANAGE_ACTION_BTN_CLASS =
  "interactive-press inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden rounded-2xl px-2.5 py-2 text-xs font-semibold text-white sm:min-w-[8.75rem] sm:px-3";

const MANAGE_ICON_BTN_CLASS =
  "interactive-press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white";

const MODPACK_MANAGE_SPLIT_STORAGE_KEY = "modpack_manage_main_width_frac";
const MODPACK_MANAGE_SPLIT_MIN = 0.22;
const MODPACK_MANAGE_SPLIT_MAX = 0.9;
const MODPACK_MANAGE_SPLIT_DEFAULT = 0.68;

const BUILD_PRESETS_UI_ENABLED = false;

export function ModpackTab({
  language,
  showNotification,
  onProfileSelectionChange,
  initialSelectedProfileId,
  onOpenModsTab,
  onPlaySelectedProfile,
  primaryLabel,
  primaryColorClasses = "accent-bg hover:opacity-90",
  isLaunching = false,
  isStopping = false,
  onProfilesChange,
  onTogglePinInSidebar,
  isPinnedInSidebar,
  gameStatus = "idle",
  consoleLines = [],
  consoleHistorySessions = [],
  onClearConsole,
  openedMrpackPath = null,
  onOpenedMrpackPathConsumed,
  fillPane = false,
  registerDownloadJob,
  updateDownloadJob,
  finishDownloadJob,
  makeDownloadJobId,
  onRegisterModpackHotkeys,
  onActiveViewChange,
  onRegisterModpackNavigation,
  requestedModpackView,
  onRequestedModpackViewApplied,
}: ModpackTabProps) {
  const tt = useT(language);
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
  const [items, setItems] = useState<ProfileItemEntry[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const profilesLoadedRef = useRef(false);
  const [search, setSearch] = useState("");
  const [createName, setCreateName] = useState("");
  const createNameUserEdited = useRef(false);
  const [createLoader, setCreateLoader] = useState<LoaderId>("fabric");
  const [createGameVersion, setCreateGameVersion] = useState("1.20.1");
  const [createLoaderVersion, setCreateLoaderVersion] = useState("");
  const [loaderVersionOptions, setLoaderVersionOptions] = useState<LoaderVersionOption[]>([]);
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false);
  const [isLoaderVersionDropdownOpen, setIsLoaderVersionDropdownOpen] = useState(false);
  const [createAllVersions, setCreateAllVersions] = useState(false);
  const [createIconPath, setCreateIconPath] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [buildPresets, setBuildPresets] = useState<BuildPreset[]>([]);
  const [buildPresetsLoading, setBuildPresetsLoading] = useState(false);
  const [createSelectedPresetId, setCreateSelectedPresetId] = useState<string | null>(null);
  const [isPresetsModalOpen, setIsPresetsModalOpen] = useState(false);
  const [presetIconUris, setPresetIconUris] = useState<Record<string, string>>({});
  const [profileIconRevisions, setProfileIconRevisions] = useState<Record<string, number>>({});
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
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [itemsSearch, setItemsSearch] = useState("");
  const [contentUpdates, setContentUpdates] = useState<ProfileContentUpdate[]>([]);
  const [contentUpdatesChecking, setContentUpdatesChecking] = useState(false);
  const [contentUpdatesApplying, setContentUpdatesApplying] = useState(false);
  const [contentUpdatesAvailableFilenames, setContentUpdatesAvailableFilenames] = useState<
    Set<string>
  >(new Set());
  const [contentUpdatesAvailabilityLoading, setContentUpdatesAvailabilityLoading] =
    useState(false);
  const [contentUpdatesSingleApplyingFilename, setContentUpdatesSingleApplyingFilename] =
    useState<string | null>(null);
  const [isContentUpdatesModalOpen, setIsContentUpdatesModalOpen] = useState(false);
  const [selectedContentUpdateFilenames, setSelectedContentUpdateFilenames] = useState<
    Set<string>
  >(new Set());
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
  const [listContextMenu, setListContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{
    groupId: string;
    x: number;
    y: number;
  } | null>(null);
  const [profileGroups, setProfileGroups] = useState<ProfileGroup[]>(() => loadProfileGroups());
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupFormName, setGroupFormName] = useState("");
  const [groupFormColor, setGroupFormColor] = useState<ProfileGroupColor>("purple");
  const [groupFormProfileIds, setGroupFormProfileIds] = useState<Set<string>>(new Set());
  const [isGroupProfilesDropdownOpen, setIsGroupProfilesDropdownOpen] = useState(false);
  const [multiSelectedProfileIds, setMultiSelectedProfileIds] = useState<Set<string>>(new Set());
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const profileDragIdsRef = useRef<string[]>([]);
  const groupProfilesDropdownRef = useRef<HTMLDivElement | null>(null);
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<string | null>(
    null,
  );
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [profileSettingsTab, setProfileSettingsTab] = useState<"general" | "java">("general");
  const [profileEffectiveSettings, setProfileEffectiveSettings] = useState<Settings | null>(null);
  const [isChangeVersionOpen, setIsChangeVersionOpen] = useState(false);
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
  const [systemMemoryGb, setSystemMemoryGb] = useState<number>(16);
  const profileRamSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileRamPendingRef = useRef<{ profileId: string; mb: number } | null>(null);

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isScreenshotsOpen, setIsScreenshotsOpen] = useState(false);
  const [profileInfoProfile, setProfileInfoProfile] = useState<ProfileInfoData | null>(null);
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
  const manageContentTabsContainerRef = useRef<HTMLDivElement | null>(null);
  const manageDropZoneRef = useRef<HTMLDivElement | null>(null);
  const [isManageDropTarget, setIsManageDropTarget] = useState(false);
  const [manageContentIndicator, setManageContentIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const [manageConsoleExpanded, setManageConsoleExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("modpack_manage_console_expanded") !== "0";
    } catch {
      return true;
    }
  });
  const [selectedLogSessionId, setSelectedLogSessionId] = useState<"live" | string>(
    "live",
  );
  const [isCopyingConsole, setIsCopyingConsole] = useState(false);
  const [isConsoleCopied, setIsConsoleCopied] = useState(false);

  const [manageMainWidthFrac, setManageMainWidthFrac] = useState(() => {
    if (typeof window === "undefined") return MODPACK_MANAGE_SPLIT_DEFAULT;
    try {
      const raw = window.localStorage.getItem(MODPACK_MANAGE_SPLIT_STORAGE_KEY);
      const v = raw == null ? Number.NaN : Number.parseFloat(raw);
      if (
        Number.isFinite(v) &&
        v >= MODPACK_MANAGE_SPLIT_MIN &&
        v <= MODPACK_MANAGE_SPLIT_MAX
      ) {
        return v;
      }
    } catch {
    }
    return MODPACK_MANAGE_SPLIT_DEFAULT;
  });
  const [isManageSplitDragging, setIsManageSplitDragging] = useState(false);
  const manageSplitRowRef = useRef<HTMLDivElement | null>(null);
  const manageSplitHandleRef = useRef<HTMLDivElement | null>(null);
  const manageSplitDragRef = useRef<{
    pointerId: number;
    startX: number;
    startFrac: number;
    rowWidth: number;
  } | null>(null);

  const onManageSplitPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const row = manageSplitRowRef.current;
      if (!row) return;
      if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) {
        return;
      }
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      manageSplitDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startFrac: manageMainWidthFrac,
        rowWidth: Math.max(1, rect.width),
      };
      setIsManageSplitDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
      }
    },
    [manageMainWidthFrac],
  );

  useEffect(() => {
    if (!isManageSplitDragging) return;
    const handleEl = manageSplitHandleRef.current;

    const onMove = (e: PointerEvent) => {
      const d = manageSplitDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const row = manageSplitRowRef.current;
      const rowWidth = row ? Math.max(1, row.getBoundingClientRect().width) : d.rowWidth;
      const delta = e.clientX - d.startX;
      let next = d.startFrac + delta / rowWidth;
      next = Math.min(MODPACK_MANAGE_SPLIT_MAX, Math.max(MODPACK_MANAGE_SPLIT_MIN, next));
      setManageMainWidthFrac(next);
    };

    const finish = (e: PointerEvent) => {
      const d = manageSplitDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      manageSplitDragRef.current = null;
      setIsManageSplitDragging(false);
      if (handleEl) {
        try {
          handleEl.releasePointerCapture(e.pointerId);
        } catch {
        }
      }
      setManageMainWidthFrac((frac) => {
        try {
          window.localStorage.setItem(MODPACK_MANAGE_SPLIT_STORAGE_KEY, String(frac));
        } catch {
        }
        return frac;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [isManageSplitDragging]);

  useEffect(() => {
    if (!isManageSplitDragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [isManageSplitDragging]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "modpack_manage_console_expanded",
        manageConsoleExpanded ? "1" : "0",
      );
    } catch {
    }
  }, [manageConsoleExpanded]);

  useEffect(() => {
    setSelectedLogSessionId("live");
  }, [selectedProfileId]);

  useEffect(() => {
    if (selectedLogSessionId === "live") return;
    const exists = consoleHistorySessions.some((s) => s.id === selectedLogSessionId);
    if (!exists) setSelectedLogSessionId("live");
  }, [consoleHistorySessions, selectedLogSessionId]);

  const displayedConsoleLines = useMemo(() => {
    if (selectedLogSessionId === "live") return consoleLines;
    return consoleHistorySessions.find((s) => s.id === selectedLogSessionId)?.lines ?? [];
  }, [selectedLogSessionId, consoleLines, consoleHistorySessions]);

  const consoleTextForCopy = useMemo(
    () => displayedConsoleLines.map((e) => e.line).join("\n"),
    [displayedConsoleLines],
  );

  const manageConsoleStatusDotClass = useMemo(() => {
    if (selectedLogSessionId !== "live") return "bg-gray-500";
    if (gameStatus === "running") return "bg-emerald-400";
    if (gameStatus === "crashed") return "bg-red-500";
    if (gameStatus === "stopped") return "bg-sky-400";
    return "bg-gray-500";
  }, [selectedLogSessionId, gameStatus]);

  const handleCopyManageConsole = useCallback(async () => {
    if (isCopyingConsole) return;
    setIsCopyingConsole(true);
    let ok = false;
    try {
      await navigator.clipboard.writeText(consoleTextForCopy);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = consoleTextForCopy;
        ta.style.position = "fixed";
        ta.style.left = "-10000px";
        ta.style.top = "-10000px";
        ta.setAttribute("readonly", "true");
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
      }
    } finally {
      setIsCopyingConsole(false);
    }
    if (ok) {
      setIsConsoleCopied(true);
      window.setTimeout(() => setIsConsoleCopied(false), 1200);
    }
  }, [consoleTextForCopy, isCopyingConsole]);

  function formatLogSessionOptionLabel(session: GameConsoleSession): string {
    const d = new Date(session.endedAt ?? session.startedAt);
    const ds = d.toLocaleString(localeTag(language));
    return t(language, "common.format.archiveLabel", { date: ds });
  }

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const selectedCreatePreset = useMemo(
    () => buildPresets.find((p) => p.id === createSelectedPresetId) ?? null,
    [buildPresets, createSelectedPresetId],
  );

  const refreshBuildPresets = useCallback(async () => {
    setBuildPresetsLoading(true);
    try {
      const list = await invoke<BuildPreset[]>("list_build_presets");
      setBuildPresets(list);
    } catch (e) {
      console.error(e);
    } finally {
      setBuildPresetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!BUILD_PRESETS_UI_ENABLED) return;
    void refreshBuildPresets();
  }, [refreshBuildPresets]);

  useEffect(() => {
    if (!BUILD_PRESETS_UI_ENABLED) return;
    let cancelled = false;
    (async () => {
      for (const preset of buildPresets) {
        try {
          const uri = await invoke<string | null>("get_build_preset_icon_data_uri", {
            presetId: preset.id,
          });
          if (cancelled || !uri) continue;
          setPresetIconUris((prev) =>
            prev[preset.id] ? prev : { ...prev, [preset.id]: uri },
          );
        } catch {
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildPresets]);

  function applyBuildPresetToCreateForm(preset: BuildPreset) {
    const loader = preset.loader as LoaderId;
    if (
      loader === "vanilla" ||
      loader === "fabric" ||
      loader === "forge" ||
      loader === "quilt" ||
      loader === "neoforge"
    ) {
      setCreateLoader(loader);
    }
    setCreateGameVersion(preset.game_version);
    setCreateLoaderVersion(preset.loader_version ?? "");
    setLoaderVersionOptions([]);
    setCreateSelectedPresetId(preset.id);
  }

  function clearCreatePresetSelection() {
    setCreateSelectedPresetId(null);
  }

  async function handleSaveBuildPresetFromForm() {
    const presetName = window.prompt(tt("modpacks.presets.namePrompt"), createName.trim() || "");
    if (!presetName?.trim()) return;
    const loaderVersion =
      createLoader === "vanilla" ? null : createLoaderVersion.trim() || null;
    if (createLoader !== "vanilla" && !loaderVersion) {
      showNotification("warning", tt("modpacks.toast.selectLoaderBeforePreset"));
      return;
    }
    try {
      const preset = await invoke<BuildPreset>("save_build_preset", {
        id: null,
        name: presetName.trim(),
        gameVersion: createGameVersion,
        loader: createLoader,
        loaderVersion,
        settings: selectedCreatePreset?.settings ?? null,
        iconSourcePath: createIconPath,
      });
      await refreshBuildPresets();
      setCreateSelectedPresetId(preset.id);
      showNotification("success", tt("modpacks.presets.saved"));
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.presets.saveFailed"));
    }
  }

  async function handleSaveBuildPresetFromProfile(profile: InstanceProfile) {
    const presetName = window.prompt(tt("modpacks.presets.namePrompt"), profile.name);
    if (!presetName?.trim()) return;
    try {
      await invoke<BuildPreset>("create_build_preset_from_profile", {
        profileId: profile.id,
        name: presetName.trim(),
      });
      await refreshBuildPresets();
      showNotification("success", tt("modpacks.presets.saved"));
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      showNotification("error", `${tt("modpacks.presets.saveFailed")} ${msg}`);
    }
  }

  async function handleDeleteBuildPreset(preset: BuildPreset) {
    const ok = window.confirm(tt("modpacks.presets.deleteConfirm", { name: preset.name }));
    if (!ok) return;
    try {
      await invoke("delete_build_preset", { presetId: preset.id });
      if (createSelectedPresetId === preset.id) {
        clearCreatePresetSelection();
      }
      setPresetIconUris((prev) => {
        const next = { ...prev };
        delete next[preset.id];
        return next;
      });
      await refreshBuildPresets();
      showNotification("success", tt("modpacks.presets.deleted"));
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.presets.deleteFailed"));
    }
  }

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
        tt("modpacks.export.readFilesFailed"),
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
        tt("modpacks.export.selectAtLeastOnePath"),
      );
      return;
    }
    setPreviewLoading(true);
    setPreviewResult(null);
    try {
      const res = await invoke<PreviewResult>("preview_export", {
        buildId: selectedProfile.id,
        selected,
        ignores: parseIgnorePatterns(ignorePatternsText),
      });
      setPreviewResult(res);
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("modpacks.export.previewFailed"),
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
        tt("modpacks.export.selectAtLeastOnePath"),
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
        selected,
        ignores: parseIgnorePatterns(ignorePatternsText),
        format: exportFormat,
        outPath,
      });
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      showNotification(
        "error",
        tt("modpacks.export.failed", { msg }),
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
                `${formatByteSize(language, bps)}${tt("modpacks.export.perSecond")}`,
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
            tt("modpacks.export.finished"),
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
                : tt("modpacks.export.errorGeneric");
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
    profileRamPendingRef.current = null;
    if (profileRamSaveTimerRef.current !== null) {
      clearTimeout(profileRamSaveTimerRef.current);
      profileRamSaveTimerRef.current = null;
    }
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

  async function patchProfileGameSettings(
    profileId: string,
    patch: Partial<Settings>,
    opts?: { notifySuccess?: boolean },
  ) {
    const notifySuccess = opts?.notifySuccess !== false;
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
      if (notifySuccess) {
        showNotification("success", tt("modpacks.profileSettings.saved"));
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("modpacks.profileSettings.saveFailed"),
      );
    }
  }

  function clearProfileRamSaveDebounce() {
    if (profileRamSaveTimerRef.current !== null) {
      clearTimeout(profileRamSaveTimerRef.current);
      profileRamSaveTimerRef.current = null;
    }
  }

  function scheduleProfileRamSave(profileId: string, ramMb: number) {
    profileRamPendingRef.current = { profileId, mb: ramMb };
    clearProfileRamSaveDebounce();
    profileRamSaveTimerRef.current = setTimeout(() => {
      profileRamSaveTimerRef.current = null;
      const pending = profileRamPendingRef.current;
      if (!pending) return;
      profileRamPendingRef.current = null;
      void patchProfileGameSettings(pending.profileId, { ram_mb: pending.mb });
    }, 450);
  }

  function commitProfileRamSaveNow(profileId: string, ramMb: number) {
    clearProfileRamSaveDebounce();
    profileRamPendingRef.current = null;
    void patchProfileGameSettings(profileId, { ram_mb: ramMb });
  }

  function closeProfileSettingsModal() {
    clearProfileRamSaveDebounce();
    const pending = profileRamPendingRef.current;
    profileRamPendingRef.current = null;
    if (pending) {
      void patchProfileGameSettings(pending.profileId, { ram_mb: pending.mb });
    }
    setIsProfileSettingsOpen(false);
  }

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
    const loader = selectedProfile.loader as LoaderId;
    if (loader === "vanilla") {
      setMigrateLoaderVersionOptions([]);
      setMigrateLoaderVersion("");
      return;
    }
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
      setMigrateLoaderVersionOptions(options);
      const versionIds = options.map((o) => o.version);
      setMigrateLoaderVersion((prev) =>
        prev && versionIds.includes(prev) ? prev : pickDefaultLoaderVersion(options),
      );
    } catch (e) {
      console.error(e);
      setMigrateLoaderVersionOptions([]);
      setMigrateLoaderVersion("");
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", t(language, "modpacks.toast.loadLoaderVersionsFailed", { msg }));
    } finally {
      setMigrateLoaderVersionsLoading(false);
    }
  }, [selectedProfile, migrateGameVersion, language, showNotification]);

  const installGameAndLoader = useCallback(
    async (
      gameVersion: string,
      loader: LoaderId,
      loaderVersion: string | null,
      versions: VersionSummary[],
    ) => {
      let versionUrl: string | null = versions.find((v) => v.id === gameVersion)?.url ?? null;
      if (!versionUrl) {
        const all = await invoke<VersionSummary[]>("fetch_all_versions");
        versionUrl = all.find((v) => v.id === gameVersion)?.url ?? null;
      }
      if (!versionUrl) {
        throw new Error(t(language, "modpacks.toast.manifestUrlFailed", { version: gameVersion }));
      }

      try {
        await invoke("reset_download_cancel");
      } catch (e) {
        console.error(e);
      }

      const installed = await invoke<string[]>("list_installed_versions");
      if (!installed.includes(gameVersion)) {
        const versionJobId = `version:${gameVersion}`;
        registerDownloadJob?.({
          id: versionJobId,
          label: gameVersion,
          kind: "version",
        });
        showNotification("info", t(language, "modpacks.toast.versionNotInstalled", { version: gameVersion }));
        try {
          await invoke("install_version", {
            versionId: gameVersion,
            versionUrl,
          });
        } finally {
          finishDownloadJob?.(versionJobId);
        }
        showNotification("success", t(language, "modpacks.toast.versionInstalled", { version: gameVersion }));
      }

      if (loader === "fabric" && loaderVersion) {
        showNotification("info", t(language, "modpacks.toast.installingFabric", { version: loaderVersion }));
        await invoke("install_fabric", {
          gameVersion,
          loaderVersion,
        });
      } else if (loader === "quilt" && loaderVersion) {
        showNotification("info", t(language, "modpacks.toast.installingQuilt", { version: loaderVersion }));
        await invoke("install_quilt", {
          gameVersion,
          loaderVersion,
        });
      } else if (loader === "forge" && loaderVersion) {
        const forgeList = await invoke<ForgeVersionSummary[]>("fetch_forge_versions");
        const match = forgeList.find(
          (v) => v.mc_version === gameVersion && v.forge_build === loaderVersion,
        );
        const versionId = match?.id ?? `${gameVersion}-forge-${loaderVersion}`;
        const installerUrl =
          match?.installer_url ??
          `https://forgemvn.lumintomc.ru/net/minecraftforge/forge/${gameVersion}-${loaderVersion}/forge-${gameVersion}-${loaderVersion}-installer.jar`;
        showNotification("info", t(language, "modpacks.toast.installingForge", { version: loaderVersion }));
        await invoke("install_forge", { versionId, installerUrl });
      } else if (loader === "neoforge" && loaderVersion) {
        const versionId = `${gameVersion}-neoforge-${loaderVersion}`;
        showNotification("info", t(language, "modpacks.toast.installingNeoForge", { version: loaderVersion }));
        await invoke("install_neoforge", { versionId });
      }
    },
    [language, showNotification, registerDownloadJob, finishDownloadJob],
  );

  function openChangeVersionModal() {
    if (!selectedProfile) return;
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

  async function handleChangeProfileVersion() {
    if (!selectedProfile || migrateBusy) return;
    const loader = selectedProfile.loader as LoaderId;
    const loaderVersion =
      loader === "vanilla" ? null : migrateLoaderVersion.trim() || null;
    if (loader !== "vanilla" && !loaderVersion) {
      showNotification("warning", tt("modpacks.changeVersion.selectLoaderVersion"));
      return;
    }
    const sameGame = migrateGameVersion === selectedProfile.game_version;
    const sameLoader =
      (selectedProfile.loader_version ?? null) === loaderVersion;
    if (sameGame && sameLoader) {
      showNotification("warning", tt("modpacks.changeVersion.sameVersion"));
      return;
    }

    setMigrateBusy(true);
    try {
      await installGameAndLoader(
        migrateGameVersion,
        loader,
        loaderVersion,
        migrateVersionOptions,
      );
      const updated = await invoke<InstanceProfile>("change_profile_version", {
        id: selectedProfile.id,
        gameVersion: migrateGameVersion,
        loaderVersion,
      });
      setProfiles((prev) => {
        const next = prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p));
        onProfilesChange?.(next);
        return next;
      });
      onProfileSelectionChange?.(updated);
      await refreshItems(selectedProfile.id, contentTab);
      setIsChangeVersionOpen(false);
      showNotification("success", tt("modpacks.changeVersion.success"));
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
    if (selectedProfile.loader === "vanilla") return;
    void loadMigrateLoaderVersions();
  }, [isChangeVersionOpen, selectedProfile, migrateGameVersion, loadMigrateLoaderVersions]);

  useEffect(() => {
    if (!isChangeVersionOpen) return;
    setMigrateVersionOptions([]);
    void ensureMigrateVersionsLoaded();
  }, [migrateAllVersions]);

  useEffect(() => () => clearProfileRamSaveDebounce(), []);

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
    let raf = 0;
    let cancelled = false;

    const updateIndicator = () => {
      if (cancelled) return;
      const el = exportFormatTabRefs.current[exportFormat];
      if (el) {
        setExportFormatIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateIndicator);
    };

    updateIndicator();
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [isExportOpen, exportFormat]);

  useLayoutEffect(() => {
    let raf = 0;
    let cancelled = false;

    const updateIndicator = () => {
      if (cancelled) return;

      const btnEl = manageContentTabRefs.current[contentTab];
      const containerEl = manageContentTabsContainerRef.current;
      if (!btnEl || !containerEl) return;

      const btnRect = btnEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      setManageContentIndicator({
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
    };
  }, [contentTab, activeView]);

  useEffect(() => {
    if (!onProfileSelectionChange) return;

    const profile = profiles.find((p) => p.id === selectedProfileId) ?? null;
    onProfileSelectionChange(profile);
  }, [onProfileSelectionChange, profiles, selectedProfileId]);

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
    const unlistenPromise = listen<{
      phase: string;
      current?: number;
      total?: number;
      message?: string;
    }>("mrpack-import-progress", (event) => {
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
        updateDownloadJob(jobId, (payload.current / payload.total) * 100);
      }
      if (payload.phase === "start") {
        showNotification(
          "info",
          t(language, "modpacks.import.started"),
        );
      }
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [language, showNotification, updateDownloadJob]);

  useEffect(() => {
    const unlistenPromise = listen<{
      phase: string;
      current?: number;
      total?: number;
      message?: string;
    }>("external-import-progress", (event) => {
      setExternalImportProgress(event.payload);
      if (event.payload.phase === "start") {
        showNotification("info", t(language, "modpacks.import.started"));
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
      profilesLoadedRef.current = true;
      setProfiles(list);
      onProfilesChange?.(list);
      try {
        const current = await invoke<InstanceProfile | null>("get_selected_profile");
        if (current && current.id) {
          setSelectedProfileId(current.id);
        }
      } catch {
      }
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.loadProfilesFailed"));
    } finally {
      setLoadingProfiles(false);
    }
  }

  useEffect(() => {
    const unlistenPlaytime = listen<PlaytimeUpdatedPayload>(
      "playtime-updated",
      (event) => {
        const { profile_id } = event.payload;
        void (async () => {
          try {
            const seconds = await invoke<number>(
              "get_profile_play_time_seconds",
              { profile_id },
            );
            setProfiles((prev) =>
              prev.map((p) =>
                p.id === profile_id ? { ...p, play_time_seconds: seconds } : p,
              ),
            );
          } catch (e) {
            console.error(e);
          }
        })();
      },
    );
    const unlistenLastPlayed = listen<LastPlayedUpdatedPayload>(
      "last-played-updated",
      (event) => {
        const { profile_id, last_played_at } = event.payload;
        setProfiles((prev) =>
          prev.map((p) =>
            p.id === profile_id ? { ...p, last_played_at } : p,
          ),
        );
      },
    );
    return () => {
      unlistenPlaytime.then((fn) => fn());
      unlistenLastPlayed.then((fn) => fn());
    };
  }, []);

  async function refreshItems(id: string, tab: ContentTab) {
    setItemsLoading(true);
    try {
      const category =
        tab === "mods"
          ? "mods"
          : tab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      const files = await invoke<ProfileItemEntry[]>("list_profile_items", {
        id,
        category,
      });
      setItems(files);
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.loadFilesFailed"));
    } finally {
      setItemsLoading(false);
    }
  }

  async function addProfileFilesFromPaths(paths: string[]) {
    if (!selectedProfile || paths.length === 0) return;
    try {
      const category =
        contentTab === "mods"
          ? "mods"
          : contentTab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      await invoke("add_profile_files", {
        id: selectedProfile.id,
        category,
        files: paths,
      });
      await refreshItems(selectedProfile.id, contentTab);
      showNotification("success", t(language, "modpacks.toast.filesAdded"));
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.addFilesFailed"));
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

  const handleOpenCreateView = useCallback(() => {
    createNameUserEdited.current = false;
    setActiveView("create");
    void ensureVersionsLoaded();
  }, [versionOptions.length, versionsLoading, createAllVersions]);

  const handleOpenImportView = useCallback(() => {
    setActiveView("import");
  }, []);

  useEffect(() => {
    if (!onRegisterModpackHotkeys) return;
    onRegisterModpackHotkeys({
      openCreate: handleOpenCreateView,
      openImport: handleOpenImportView,
    });
    return () => onRegisterModpackHotkeys(null);
  }, [handleOpenCreateView, handleOpenImportView, onRegisterModpackHotkeys]);

  useEffect(() => {
    onActiveViewChange?.(activeView);
  }, [activeView, onActiveViewChange]);

  const goToModpackList = useCallback(() => {
    setActiveView("list");
  }, []);

  useEffect(() => {
    if (!onRegisterModpackNavigation) return;
    onRegisterModpackNavigation({
      getActiveView: () => activeView,
      goToList: goToModpackList,
      setActiveView,
    });
    return () => onRegisterModpackNavigation(null);
  }, [activeView, goToModpackList, onRegisterModpackNavigation]);

  useEffect(() => {
    if (!requestedModpackView) return;
    if (requestedModpackView !== activeView) {
      setActiveView(requestedModpackView);
    }
    onRequestedModpackViewApplied?.();
  }, [requestedModpackView, onRequestedModpackViewApplied]);

  const loadCreateLoaderVersions = useCallback(async () => {
    if (createLoader === "vanilla") {
      setLoaderVersionOptions([]);
      setCreateLoaderVersion("");
      return;
    }
    setLoaderVersionsLoading(true);
    try {
      let options: LoaderVersionOption[] = [];
      if (createLoader === "fabric") {
        options = await invoke<LoaderVersionOption[]>("fetch_fabric_loaders", {
          gameVersion: createGameVersion,
        });
      } else if (createLoader === "quilt") {
        options = await invoke<LoaderVersionOption[]>("fetch_quilt_loaders", {
          gameVersion: createGameVersion,
        });
      } else if (createLoader === "forge") {
        options = await invoke<LoaderVersionOption[]>("fetch_forge_builds_for_game", {
          gameVersion: createGameVersion,
        });
      } else if (createLoader === "neoforge") {
        options = await invoke<LoaderVersionOption[]>("fetch_neoforge_builds_for_game", {
          gameVersion: createGameVersion,
        });
      }
      setLoaderVersionOptions(options);
      const versionIds = options.map((o) => o.version);
      setCreateLoaderVersion((prev) =>
        prev && versionIds.includes(prev) ? prev : pickDefaultLoaderVersion(options),
      );
    } catch (e) {
      console.error(e);
      setLoaderVersionOptions([]);
      setCreateLoaderVersion("");
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", t(language, "modpacks.toast.loadLoaderVersionsFailed", { msg }));
    } finally {
      setLoaderVersionsLoading(false);
    }
  }, [createLoader, createGameVersion, language, showNotification]);

  const selectedLoaderVersionOption = useMemo(
    () => loaderVersionOptions.find((o) => o.version === createLoaderVersion) ?? null,
    [loaderVersionOptions, createLoaderVersion],
  );

  const loaderChannelLabel = useCallback(
    (channel: LoaderVersionChannel | null | undefined) => {
      if (!channel) return null;
      return tt(`modpacks.create.loaderChannel.${channel}`);
    },
    [tt],
  );

  useEffect(() => {
    if (activeView !== "create" || createLoader === "vanilla") {
      return;
    }
    void loadCreateLoaderVersions();
  }, [activeView, createLoader, createGameVersion, loadCreateLoaderVersions]);

  useEffect(() => {
    if (activeView !== "create" || createNameUserEdited.current) {
      return;
    }
    setCreateName(defaultProfileName(createLoader, createGameVersion));
  }, [activeView, createLoader, createGameVersion]);

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter((p) =>
      p.name.toLowerCase().includes(query) ||
      p.game_version.toLowerCase().includes(query),
    );
  }, [profiles, search]);

  const profilesById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );

  const groupedProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of profileGroups) {
      for (const id of group.profileIds) ids.add(id);
    }
    return ids;
  }, [profileGroups]);

  const ungroupedProfiles = useMemo(
    () => filteredProfiles.filter((p) => !groupedProfileIds.has(p.id)),
    [filteredProfiles, groupedProfileIds],
  );

  const profileIdsSignature = useMemo(
    () => profiles.map((p) => p.id).sort().join("\0"),
    [profiles],
  );

  const visibleProfileGroups = useMemo(() => {
    const query = search.trim();
    return profileGroups.map((group) => ({
      ...group,
      profiles: group.profileIds
        .map((id) => profilesById.get(id))
        .filter((p): p is InstanceProfile => !!p)
        .filter((p) =>
          !query ||
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.game_version.toLowerCase().includes(query.toLowerCase()),
        ),
    }));
  }, [profileGroups, profilesById, search]);

  useEffect(() => {
    if (!profilesLoadedRef.current || profileIdsSignature.length === 0) return;
    const validIds = new Set(profileIdsSignature.split("\0"));
    setProfileGroups((prev) => {
      const sanitized = sanitizeProfileGroups(prev, validIds);
      const next = dedupeProfileGroupAssignments(sanitized);
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        saveProfileGroups(next);
        return next;
      }
      return prev;
    });
  }, [profileIdsSignature]);

  useEffect(() => {
    if (!isGroupProfilesDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = groupProfilesDropdownRef.current;
      if (el && !el.contains(e.target as Node)) {
        setIsGroupProfilesDropdownOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isGroupProfilesDropdownOpen]);

  const totalProfilesLabel = tt("modpacks.header.totalProfiles", { count: profiles.length });

  const manageTabLabels = useMemo(
    () =>
      Object.fromEntries(
        (Object.entries(CONTENT_TAB_KEYS) as [ContentTab, string][]).map(([tab, key]) => [
          tab,
          tt(key),
        ]),
      ) as Record<ContentTab, string>,
    [tt],
  );

  const headerTitle =
    activeView === "create"
      ? tt("modpacks.create.title")
      : activeView === "import"
        ? tt("modpacks.header.importMrpack")
        : activeView === "manage"
          ? selectedProfile?.name ?? ""
          : tt("modpacks.header.profiles");

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

  async function handleChooseProfileIcon() {
    if (!selectedProfile) return;
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
      if (typeof path !== "string") return;

      const iconPath = await invoke<string | null>("set_profile_icon_from_file", {
        profileId: selectedProfile.id,
        iconSourcePath: path,
      });

      setProfiles((prev) => {
        const next = prev.map((p) =>
          p.id === selectedProfile.id ? { ...p, icon_path: iconPath ?? p.icon_path } : p,
        );
        onProfilesChange?.(next);
        return next;
      });
      setProfileIconRevisions((prev) => ({
        ...prev,
        [selectedProfile.id]: (prev[selectedProfile.id] ?? 0) + 1,
      }));
      showNotification("success", tt("modpacks.profile.iconChanged"));
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.profile.iconChangeFailed"));
    }
  }

  async function handleCreateProfile() {
    const name = (
      createName.trim() || defaultProfileName(createLoader, createGameVersion)
    ).slice(0, 50);
    const loaderVersion =
      createLoader === "vanilla" ? null : createLoaderVersion.trim() || null;
    if (createLoader !== "vanilla" && !loaderVersion) {
      showNotification("warning", t(language, "modpacks.toast.selectLoaderVersion"));
      return;
    }
    setCreateBusy(true);
    try {
      let versionUrl: string | null = null;
      const fromLoaded = versionOptions.find((v) => v.id === createGameVersion);
      if (fromLoaded?.url) {
        versionUrl = fromLoaded.url;
      } else {
        try {
          const all = await invoke<VersionSummary[]>("fetch_all_versions");
          const found = all.find((v) => v.id === createGameVersion);
          if (found?.url) versionUrl = found.url;
        } catch (e) {
          console.error(e);
        }
      }
      if (!versionUrl) {
        throw new Error(t(language, "modpacks.toast.manifestUrlFailed", { version: createGameVersion }));
      }

      const profile = await invoke<InstanceProfile>("create_profile", {
        name,
        gameVersion: createGameVersion,
        loader: createLoader,
        loaderVersion,
        iconSourcePath: createIconPath,
        initialSettings: BUILD_PRESETS_UI_ENABLED
          ? (selectedCreatePreset?.settings ?? null)
          : null,
      });

      try {
        try {
          await invoke("reset_download_cancel");
        } catch (e) {
          console.error(e);
        }

        const installed = await invoke<string[]>("list_installed_versions");
        const isInstalled = installed.includes(createGameVersion);
        if (!isInstalled) {
          const versionJobId = `version:${createGameVersion}`;
          registerDownloadJob?.({
            id: versionJobId,
            label: createGameVersion,
            kind: "version",
          });
          showNotification("info", t(language, "modpacks.toast.versionNotInstalled", { version: createGameVersion }));
          try {
            await invoke("install_version", {
              versionId: createGameVersion,
              versionUrl,
            });
          } finally {
            finishDownloadJob?.(versionJobId);
          }
          showNotification("success", t(language, "modpacks.toast.versionInstalled", { version: createGameVersion }));
        }

        if (createLoader === "fabric" && loaderVersion) {
          showNotification("info", t(language, "modpacks.toast.installingFabric", { version: loaderVersion }));
          await invoke("install_fabric", {
            gameVersion: createGameVersion,
            loaderVersion,
          });
        } else if (createLoader === "quilt" && loaderVersion) {
          showNotification("info", t(language, "modpacks.toast.installingQuilt", { version: loaderVersion }));
          await invoke("install_quilt", {
            gameVersion: createGameVersion,
            loaderVersion,
          });
        } else if (createLoader === "forge" && loaderVersion) {
          const forgeList = await invoke<ForgeVersionSummary[]>("fetch_forge_versions");
          const match = forgeList.find(
            (v) => v.mc_version === createGameVersion && v.forge_build === loaderVersion,
          );
          const versionId =
            match?.id ?? `${createGameVersion}-forge-${loaderVersion}`;
          const installerUrl =
            match?.installer_url ??
            `https://forgemvn.lumintomc.ru/net/minecraftforge/forge/${createGameVersion}-${loaderVersion}/forge-${createGameVersion}-${loaderVersion}-installer.jar`;
          showNotification("info", t(language, "modpacks.toast.installingForge", { version: loaderVersion }));
          await invoke("install_forge", { versionId, installerUrl });
        } else if (createLoader === "neoforge" && loaderVersion) {
          const versionId = `${createGameVersion}-neoforge-${loaderVersion}`;
          showNotification("info", t(language, "modpacks.toast.installingNeoForge", { version: loaderVersion }));
          await invoke("install_neoforge", { versionId });
        }
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        showNotification("warning", t(language, "modpacks.toast.profileCreatedInstallFailed", { msg }));
      }

      setProfiles((prev) => [...prev, profile]);
      createNameUserEdited.current = false;
      setCreateName("");
      setCreateIconPath(null);
      setCreateLoaderVersion("");
      setLoaderVersionOptions([]);
      clearCreatePresetSelection();
      setActiveView("manage");
      setSelectedProfileId(profile.id);
      try {
        await invoke("set_selected_profile", { id: profile.id });
      } catch (e) {
        console.error(e);
      }
      showNotification("success", t(language, "modpacks.toast.profileCreated"));
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : JSON.stringify(e);
      showNotification("error", t(language, "modpacks.toast.createProfileFailed", { msg }));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleCreateDesktopShortcut(profile: InstanceProfile) {
    try {
      const path = await invoke<string>("create_profile_desktop_shortcut", {
        profileId: profile.id,
      });
      showNotification(
        "success",
        path
          ? `${tt("modpacks.shortcut.created")} (${path})`
          : tt("modpacks.shortcut.created"),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showNotification("error", tt("modpacks.shortcut.failed", { msg }));
    }
  }

  async function handleSelectProfile(profile: InstanceProfile) {
    const isAlreadySelected = selectedProfileId === profile.id;
    try {
      if (isAlreadySelected) {
        await invoke("set_selected_profile", { id: null });
        setSelectedProfileId(null);
        showNotification("info", t(language, "modpacks.toast.profileUnselected", { name: profile.name }));
      } else {
        await invoke("set_selected_profile", { id: profile.id });
        setSelectedProfileId(profile.id);
        showNotification("success", t(language, "modpacks.toast.profileSelected", { name: profile.name }));
      }
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.selectProfileFailed"));
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

      showNotification("success", t(language, "modpacks.toast.profileDeleted"));
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.deleteProfileFailed"));
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

    const jobId = makeDownloadJobId?.("modpack") ?? `modpack-${Date.now()}`;
    const jobLabel =
      chosen.split(/[/\\]/).pop()?.replace(/\.mrpack$/i, "") ?? "Modpack";
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
      showNotification("success", t(language, "modpacks.import.finishedWithVersion"));
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
          launcherType: externalImportLauncher,
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

  useEffect(() => {
    if (!openedMrpackPath) return;
    const path = openedMrpackPath;
    onOpenedMrpackPathConsumed?.();
    void handleImportMrpack(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- реакция только на путь из ОС
  }, [openedMrpackPath, onOpenedMrpackPathConsumed]);

  useEffect(() => {
    if (activeView !== "import") return;
    void ensureExternalImportPathDefault();
  }, [activeView, ensureExternalImportPathDefault]);

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
    //eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "manage" || !selectedProfile) return;
    let unlisten: (() => void) | undefined;
    const webview = getCurrentWebview();
    void webview
      .onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "leave") {
          setIsManageDropTarget(false);
          return;
        }
        if (p.type === "enter") {
          return;
        }
        const factor = await getCurrentWindow().scaleFactor();
        const el = manageDropZoneRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const pos = new PhysicalPosition(p.position.x, p.position.y).toLogical(factor);
        const inside =
          pos.x >= rect.left &&
          pos.x <= rect.right &&
          pos.y >= rect.top &&
          pos.y <= rect.bottom;
        if (p.type === "over") {
          setIsManageDropTarget(inside);
          return;
        }
        if (p.type === "drop") {
          setIsManageDropTarget(false);
          if (!inside || !p.paths?.length) return;
          const filtered = filterPathsForContentTab(contentTab, p.paths);
          if (filtered.length === 0) {
            showNotification("warning", t(language, "modpacks.toast.noMatchingFiles"));
            return;
          }
          await addProfileFilesFromPaths(filtered);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);
    return () => {
      setIsManageDropTarget(false);
      unlisten?.();
    };
    //eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedProfile?.id, contentTab, language]);

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
      await addProfileFilesFromPaths(arr);
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.addFilesFailed"));
    }
  }

  async function handleDeleteItem(item: ProfileItemEntry) {
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
        filename: item.name,
      });
      setItems((prev) => prev.filter((f) => f.name !== item.name));
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.deleteFileFailed"));
    }
  }

  async function handleToggleItemEnabled(item: ProfileItemEntry) {
    if (!selectedProfile) return;
    const nextEnabled = !item.enabled;
    try {
      const category =
        contentTab === "mods"
          ? "mods"
          : contentTab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      await invoke("set_profile_item_enabled", {
        id: selectedProfile.id,
        category,
        filename: item.name,
        enabled: nextEnabled,
      });
      setItems((prev) =>
        prev.map((entry) =>
          entry.name === item.name ? { ...entry, enabled: nextEnabled } : entry,
        ),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("modpacks.manage.toggleFailed"),
      );
    }
  }

  async function handleCheckContentUpdates() {
    if (!selectedProfile) return;
    const category =
      contentTab === "mods"
        ? "mods"
        : contentTab === "resourcepacks"
          ? "resourcepacks"
          : "shaderpacks";
    setContentUpdatesChecking(true);
    try {
      const updates = await invoke<ProfileContentUpdate[]>("check_profile_content_updates", {
        profileId: selectedProfile.id,
        category,
      });
      setContentUpdates(updates);
      if (category === "mods") {
        setContentUpdatesAvailableFilenames(new Set(updates.map((u) => u.filename)));
      }
      if (updates.length === 0) {
        showNotification("info", tt("modpacks.contentUpdates.noneFound"));
        return;
      }
      setSelectedContentUpdateFilenames(new Set(updates.map((u) => u.filename)));
      setIsContentUpdatesModalOpen(true);
      showNotification(
        "info",
        tt("modpacks.contentUpdates.found", { count: updates.length }),
      );
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", tt("modpacks.contentUpdates.checkFailed", { msg }));
    } finally {
      setContentUpdatesChecking(false);
    }
  }

  async function handleApplyContentUpdates(updateAll: boolean) {
    if (!selectedProfile) return;
    const category =
      contentTab === "mods"
        ? "mods"
        : contentTab === "resourcepacks"
          ? "resourcepacks"
          : "shaderpacks";
    const selected = updateAll
      ? contentUpdates
      : contentUpdates.filter((u) => selectedContentUpdateFilenames.has(u.filename));
    if (selected.length === 0) {
      showNotification("warning", tt("modpacks.contentUpdates.selectAtLeastOne"));
      return;
    }
    setContentUpdatesApplying(true);
    try {
      const payload = selected.map((u) => ({
        filename: u.filename,
        enabled: u.enabled,
        latestUrl: u.latestUrl,
        latestFilename: u.latestFilename,
        latestSha1: u.latestSha1 ?? null,
      }));
      const applied = await invoke<number>("apply_profile_content_updates", {
        profileId: selectedProfile.id,
        category,
        updates: payload,
      });
      showNotification("success", tt("modpacks.contentUpdates.applied", { count: applied }));
      setIsContentUpdatesModalOpen(false);
      setContentUpdates([]);
      setSelectedContentUpdateFilenames(new Set());
      await refreshItems(selectedProfile.id, contentTab);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", tt("modpacks.contentUpdates.applyFailed", { msg }));
    } finally {
      setContentUpdatesApplying(false);
    }
  }

  async function handleUpdateSingleItem(item: ProfileItemEntry) {
    if (!selectedProfile) return;
    const category =
      contentTab === "mods"
        ? "mods"
        : contentTab === "resourcepacks"
          ? "resourcepacks"
          : "shaderpacks";

    setContentUpdatesSingleApplyingFilename(item.name);
    try {
      const updates = await invoke<ProfileContentUpdate[]>("check_profile_content_updates", {
        profileId: selectedProfile.id,
        category,
      });
      const update = updates.find((u) => u.filename === item.name);
      if (!update) {
        setContentUpdatesAvailableFilenames((prev) => {
          if (!prev.has(item.name)) return prev;
          const next = new Set(prev);
          next.delete(item.name);
          return next;
        });
        showNotification("info", tt("modpacks.contentUpdates.noneFoundForItem"));
        return;
      }

      const applied = await invoke<number>("apply_profile_content_updates", {
        profileId: selectedProfile.id,
        category,
        updates: [
          {
            filename: update.filename,
            enabled: update.enabled,
            latestUrl: update.latestUrl,
            latestFilename: update.latestFilename,
            latestSha1: update.latestSha1 ?? null,
          },
        ],
      });

      showNotification("success", tt("modpacks.contentUpdates.applied", { count: applied }));
      await refreshItems(selectedProfile.id, contentTab);
      setContentUpdatesAvailableFilenames((prev) => {
        if (!prev.has(item.name)) return prev;
        const next = new Set(prev);
        next.delete(item.name);
        return next;
      });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", tt("modpacks.contentUpdates.applyFailed", { msg }));
    } finally {
      setContentUpdatesSingleApplyingFilename(null);
    }
  }

  useEffect(() => {
    if (!selectedProfile) {
      setContentUpdatesAvailableFilenames(new Set());
      setContentUpdatesAvailabilityLoading(false);
      return;
    }
    if (contentTab !== "mods") return;

    let cancelled = false;
    setContentUpdatesAvailabilityLoading(true);
    (async () => {
      try {
        const updates = await invoke<ProfileContentUpdate[]>("check_profile_content_updates", {
          profileId: selectedProfile.id,
          category: "mods",
        });
        if (cancelled) return;
        setContentUpdatesAvailableFilenames(new Set(updates.map((u) => u.filename)));
      } catch {
        if (cancelled) return;
        setContentUpdatesAvailableFilenames(new Set());
      } finally {
        if (!cancelled) setContentUpdatesAvailabilityLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProfile?.id, contentTab]);

  async function handleOpenFolder() {
    if (!selectedProfile) return;
    try {
      await revealItemInDir(selectedProfile.directory);
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.openFolderFailed"));
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
        tt("modpacks.profile.renamed"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("modpacks.profile.renameFailed"),
      );
    } finally {
      setIsRenaming(false);
    }
  }

  function openCreateGroupModal() {
    setEditingGroupId(null);
    setGroupFormName("");
    setGroupFormColor("purple");
    setGroupFormProfileIds(new Set());
    setIsGroupProfilesDropdownOpen(false);
    setIsGroupModalOpen(true);
  }

  function openEditGroupModal(group: ProfileGroup) {
    setEditingGroupId(group.id);
    setGroupFormName(group.name);
    setGroupFormColor(group.color);
    setGroupFormProfileIds(new Set(group.profileIds));
    setIsGroupProfilesDropdownOpen(false);
    setIsGroupModalOpen(true);
  }

  function handleSaveGroup() {
    const name = groupFormName.trim();
    if (!name) {
      showNotification("warning", tt("modpacks.groups.nameRequired"));
      return;
    }
    const profileIds = [...groupFormProfileIds];
    const editingId = editingGroupId;
    let savedAsEdit = false;

    setProfileGroups((prev) => {
      const isEditing =
        editingId != null && prev.some((group) => group.id === editingId);

      if (isEditing && editingId) {
        savedAsEdit = true;
        const otherGroups = prev.filter((group) => group.id !== editingId);
        const cleanedOthers =
          profileIds.length > 0
            ? pruneEmptyProfileGroups(ungroupProfiles(otherGroups, profileIds))
            : pruneEmptyProfileGroups(otherGroups);
        const existing = prev.find((group) => group.id === editingId)!;
        const next = dedupeProfileGroupAssignments([
          ...cleanedOthers,
          {
            ...existing,
            name,
            color: groupFormColor,
            profileIds,
          },
        ]);
        saveProfileGroups(next);
        return next;
      }

      const cleaned =
        profileIds.length > 0
          ? pruneEmptyProfileGroups(ungroupProfiles(prev, profileIds))
          : prev;
      const newGroup: ProfileGroup = {
        id: newProfileGroupId(),
        name,
        color: groupFormColor,
        profileIds,
        collapsed: false,
      };
      const next = dedupeProfileGroupAssignments([...cleaned, newGroup]);
      saveProfileGroups(next);
      return next;
    });

    showNotification(
      "success",
      savedAsEdit
        ? tt("modpacks.groups.updated", { name })
        : tt("modpacks.groups.created", { name }),
    );
    setEditingGroupId(null);
    setIsGroupModalOpen(false);
  }

  function handleDeleteGroup(groupId: string) {
    setProfileGroups((prev) => {
      const next = pruneEmptyProfileGroups(prev.filter((group) => group.id !== groupId));
      saveProfileGroups(next);
      return next;
    });
    if (editingGroupId === groupId) {
      setEditingGroupId(null);
      setIsGroupModalOpen(false);
    }
    showNotification("info", tt("modpacks.groups.deleted"));
  }

  function toggleGroupCollapsed(groupId: string) {
    setProfileGroups((prev) => {
      const next = prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
      saveProfileGroups(next);
      return next;
    });
  }

  function handleDropProfilesOnGroup(groupId: string | "ungrouped") {
    const ids = profileDragIdsRef.current;
    if (ids.length === 0) return;
    if (groupId === "ungrouped") {
      setProfileGroups((prev) => {
        const next = pruneEmptyProfileGroups(ungroupProfiles(prev, ids));
        saveProfileGroups(next);
        return next;
      });
    } else {
      setProfileGroups((prev) => {
        const next = dedupeProfileGroupAssignments(assignProfilesToGroup(prev, groupId, ids));
        saveProfileGroups(next);
        return next;
      });
    }
    setDragOverGroupId(null);
    setMultiSelectedProfileIds(new Set());
    profileDragIdsRef.current = [];
  }

  function handleProfileDragStart(profileId: string, e: React.DragEvent) {
    const dragIds =
      multiSelectedProfileIds.has(profileId) && multiSelectedProfileIds.size > 0
        ? [...multiSelectedProfileIds]
        : [profileId];
    profileDragIdsRef.current = dragIds;
    e.dataTransfer.setData("text/plain", dragIds.join(","));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleListAreaContextMenuCapture(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-profile-card]")) return;
    if (target.closest("[data-group-header]")) return;
    if (target.closest("button, input, textarea, select, a, label")) return;
    e.preventDefault();
    e.stopPropagation();
    setListContextMenu({ x: e.clientX, y: e.clientY });
  }

  const profilesGridClass = "grid grid-cols-1 gap-2 sm:grid-cols-2 items-start";

  function renderProfileCard(p: InstanceProfile) {
    const isSelected = selectedProfileId === p.id;
    const isPinned = isPinnedInSidebar?.(p.id) ?? false;
    const isMultiSelected = multiSelectedProfileIds.has(p.id);
    return (
      <div
        key={p.id}
        data-profile-card
        draggable
        onDragStart={(e) => handleProfileDragStart(p.id, e)}
        onDragEnd={() => {
          setDragOverGroupId(null);
          profileDragIdsRef.current = [];
        }}
        className={`relative flex items-center justify-between rounded-2xl border px-4 py-3 shadow-soft transition ${
          isMultiSelected
            ? "border-sky-400/80 bg-sky-500/10 ring-1 ring-sky-400/40"
            : isSelected
              ? "border-emerald-400/80 bg-white/15"
              : "border-white/10 bg-black/40 hover:border-white/40 hover:bg-black/60"
        }`}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            setMultiSelectedProfileIds((prev) => {
              const next = new Set(prev);
              if (next.has(p.id)) next.delete(p.id);
              else next.add(p.id);
              return next;
            });
            return;
          }
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
          <ProfileInstanceIcon
            profile={p}
            refreshKey={profileIconRevisions[p.id] ?? 0}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-white">{p.name}</span>
              {isPinned && (
                <img
                  src="/launcher-assets/favorite.png"
                  alt=""
                  className="h-3.5 w-3.5 object-contain opacity-90"
                />
              )}
              {isSelected && (
                <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                  {tt("modpacks.list.activeBadge")}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-col gap-1 text-[11px] text-white/70">
              <div className="flex flex-wrap items-center gap-2">
                <span>{`${p.game_version} • ${p.loader}`}</span>
                <span className="flex items-center gap-1">
                  <img
                    src="/launcher-assets/cllock.png"
                    alt=""
                    title={tt("modpacks.list.playtimeLabel")}
                    className="h-3 w-3 object-contain opacity-80"
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.dataset.failedOnce !== "1") {
                        img.dataset.failedOnce = "1";
                        img.src = "/launcher-assets/clock.png";
                        return;
                      }
                      img.style.display = "none";
                    }}
                  />
                  <span>{formatPlaytimeShort(language, p.play_time_seconds)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <ModsIcon className="h-3 w-3" />
                  <span>{countLabel(p.mods_count, language)}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1">
                  <WeightIcon className="h-3 w-3" />
                  <span>{formatByteSize(language, p.total_size_bytes)}</span>
                </span>
                <span className="text-white/55">
                  {tt("modpacks.list.lastPlayed", {
                    date: formatLastPlayedAt(p.last_played_at, language),
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSelected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPlaySelectedProfile?.();
              }}
              className="interactive-press rounded-xl accent-bg px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-soft hover:opacity-90"
              title={tt("modpacks.list.playSelectedTitle")}
            >
              {tt("modpacks.actions.play")}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleSelectProfile(p);
            }}
            className={`interactive-press inline-flex shrink-0 items-center justify-center rounded-xl px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap ${
              isSelected
                ? "min-w-[96px] bg-white/10 text-white/80 hover:bg-white/20"
                : "accent-bg text-white hover:opacity-90"
            }`}
          >
            {isSelected ? tt("modpacks.actions.unselect") : tt("modpacks.actions.select")}
          </button>
        </div>
      </div>
    );
  }

  function renderGroupDropZone(
    groupId: string | "ungrouped",
    children: ReactNode,
    className?: string,
  ) {
    const isOver = dragOverGroupId === groupId;
    return (
      <div
        className={className}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOverGroupId(groupId);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverGroupId((prev) => (prev === groupId ? null : prev));
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDropProfilesOnGroup(groupId);
        }}
      >
        {isOver && (
          <div className="pointer-events-none mb-2 rounded-xl border border-dashed border-white/30 bg-white/5 px-3 py-2 text-center text-[11px] text-white/60">
            {tt("modpacks.list.dropHint")}
          </div>
        )}
        {children}
      </div>
    );
  }

  function renderListView() {
    return (
      <div
        className={`flex w-full min-h-0 flex-1 flex-col gap-3 ${
          fillPane ? "h-full" : ""
        }`}
        onContextMenuCapture={handleListAreaContextMenuCapture}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-[22rem] items-center gap-3 rounded-2xl border border-white/15 bg-black/40 px-4 py-2.5 shadow-soft backdrop-blur-xl">
            <SearchIcon className="h-4 w-4" />
            <input
              type="text"
              placeholder={tt("modpacks.list.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
            />
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto">
            {BUILD_PRESETS_UI_ENABLED && (
              <button
                type="button"
                onClick={() => {
                  void refreshBuildPresets();
                  setIsPresetsModalOpen(true);
                }}
                className="interactive-press inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-white/20"
              >
                <span>{tt("modpacks.presets.manage")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenCreateView}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl border border-white/20 accent-bg px-4 py-2 text-sm font-semibold text-white shadow-soft hover:opacity-90"
            >
              <PlusIcon className="h-4 w-4" />
              <span>{tt("modpacks.actions.create")}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenImportView}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-white/20"
            >
              <UploadCloud className="h-4 w-4" />
              <span>{tt("modpacks.actions.import")}</span>
            </button>
            <button
              type="button"
              onClick={() => void refreshProfiles()}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-sm font-semibold text-white/80 shadow-soft hover:bg-black/60"
            >
              <RefreshIcon className="h-4 w-4" />
              <span>{tt("modpacks.actions.refresh")}</span>
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
                title={tt("modpacks.list.layout.list")}
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
                title={tt("modpacks.list.layout.grid")}
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

        <div className="glass-panel relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-1 flex shrink-0 items-center justify-between pl-3 text-xs text-white/60">
            <div className="flex items-center gap-3">
              <span>{totalProfilesLabel}</span>
              {multiSelectedProfileIds.size > 0 && (
                <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-medium text-sky-200">
                  {tt("modpacks.list.selectedCount", { count: multiSelectedProfileIds.size })}
                </span>
              )}
            </div>
            {loadingProfiles && <span>{tt("modpacks.common.loading")}</span>}
          </div>
          <div className="custom-scrollbar -mr-2 min-h-0 flex-1 overflow-y-auto px-4 pr-3">
            <div className="flex flex-col gap-4">
              {visibleProfileGroups.map((group) => {
                const styles = PROFILE_GROUP_COLOR_STYLES[group.color];
                const showProfiles = !group.collapsed;
                if (search.trim() && group.profileIds.length > 0 && group.profiles.length === 0) {
                  return null;
                }
                return (
                  <div
                    key={group.id}
                    className={`rounded-2xl border p-2 transition ${styles.border} ${
                      dragOverGroupId === group.id ? `ring-2 ${styles.ring}` : ""
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverGroupId(group.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverGroupId((prev) => (prev === group.id ? null : prev));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDropProfilesOnGroup(group.id);
                    }}
                  >
                    <div
                      data-group-header
                      className={`mb-2 flex items-center gap-2 rounded-xl px-3 py-2 ${styles.headerBg}`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setGroupContextMenu({
                          groupId: group.id,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapsed(group.id)}
                        className="interactive-press rounded-lg p-1 text-white/70 hover:bg-white/10"
                        aria-label={group.collapsed ? "Expand" : "Collapse"}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition ${group.collapsed ? "-rotate-90" : ""}`}
                        />
                      </button>
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`} />
                      <span className={`truncate text-sm font-semibold ${styles.accent}`}>
                        {group.name}
                      </span>
                      <span className="text-[11px] text-white/45">{group.profileIds.length}</span>
                    </div>
                    {showProfiles && (
                      <div
                        className={
                          profilesLayout === "grid" ? profilesGridClass : "flex flex-col gap-2"
                        }
                      >
                        {group.profiles.map((p) => renderProfileCard(p))}
                        {group.profiles.length === 0 && (
                          <div className="rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-[11px] text-white/45">
                            {tt("modpacks.list.dropHint")}
                          </div>
                        )}
                      </div>
                    )}
                    {!showProfiles && dragOverGroupId === group.id && (
                      <div className="rounded-xl border border-dashed border-white/20 bg-white/5 px-3 py-2 text-center text-[11px] text-white/55">
                        {tt("modpacks.list.dropHint")}
                      </div>
                    )}
                  </div>
                );
              })}

              {(ungroupedProfiles.length > 0 || profileGroups.length === 0) &&
                renderGroupDropZone(
                  "ungrouped",
                  <div>
                    {(profileGroups.length > 0 || ungroupedProfiles.length > 0) && (
                      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                        {tt("modpacks.list.ungroupedTitle")}
                      </div>
                    )}
                    <div
                      className={
                        profilesLayout === "grid" ? profilesGridClass : "flex flex-col gap-2"
                      }
                    >
                      {ungroupedProfiles.map((p) => renderProfileCard(p))}
                    </div>
                  </div>,
                  dragOverGroupId === "ungrouped" ? "rounded-2xl ring-2 ring-white/25" : "",
                )}

              {!loadingProfiles && filteredProfiles.length === 0 && (
                <div className="mt-4 rounded-2xl border border-dashed border-white/20 bg-black/40 px-4 py-6 text-center text-sm text-white/70">
                  {tt("modpacks.list.empty")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderCreateView() {
    return (
      <div className="glass-panel flex w-full max-w-2xl flex-col gap-4 px-6 py-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {tt("modpacks.create.title")}
          </h2>
          <button
            type="button"
            onClick={() => setActiveView("list")}
            className="interactive-press rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/20"
          >
            {tt("modpacks.common.backToList")}
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
                //eslint-disable-next-line jsx-a11y/img-redundant-alt
                <img
                  src={resolveIconSrc(createIconPath)}
                  alt="icon"
                  className="h-full w-full object-contain"
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = "none";
                  }}
                />
              ) : (
                <span>
                  {tt("modpacks.create.uploadIcon")}
                </span>
              )}
            </button>
            {createIconPath && (
              <button
                type="button"
                onClick={() => setCreateIconPath(null)}
                className="interactive-press text-[11px] text-white/60 hover:text-white/90"
              >
                {tt("modpacks.create.removeIcon")}
              </button>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-3 min-w-0">
            {BUILD_PRESETS_UI_ENABLED && (
              <div>
                <label className="mb-1 block text-xs font-medium text-white/70">
                  {tt("modpacks.create.presetLabel")}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={createSelectedPresetId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) {
                        clearCreatePresetSelection();
                        return;
                      }
                      const preset = buildPresets.find((p) => p.id === id);
                      if (preset) {
                        applyBuildPresetToCreateForm(preset);
                        showNotification("info", tt("modpacks.presets.applied"));
                      }
                    }}
                    className="min-w-[12rem] flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                  >
                    <option value="">{tt("modpacks.create.noPreset")}</option>
                    {buildPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      void refreshBuildPresets();
                      setIsPresetsModalOpen(true);
                    }}
                    className="interactive-press rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white/85 hover:bg-white/20"
                  >
                    {tt("modpacks.presets.manage")}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">
                {tt("modpacks.create.nameLabel")}
              </label>
              <input
                type="text"
                value={createName}
                onChange={(e) => {
                  createNameUserEdited.current = true;
                  setCreateName(e.target.value.slice(0, 50));
                }}
                maxLength={50}
                placeholder={
                  tt("modpacks.create.namePlaceholder")
                }
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
              />
              <span className="mt-0.5 block text-[10px] text-white/50">
                {createName.length}/50
              </span>
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-white/70">
                {tt("modpacks.create.loaderLabel")}
              </span>
              <div className="flex flex-wrap gap-2">
                {(["vanilla", "forge", "fabric", "quilt", "neoforge"] as LoaderId[]).map(
                  (id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setCreateLoader(id);
                        setIsLoaderVersionDropdownOpen(false);
                      }}
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
                {tt("modpacks.create.gameVersionLabel")}
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
                    {createGameVersion || tt("modpacks.common.select")}
                  </span>
                  <ChevronDown className="h-3 w-3 text-white/60" />
                </button>
                {isVersionDropdownOpen && (
                  <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                    {versionsLoading && (
                      <div className="px-3 py-2 text-white/60">
                        {tt("modpacks.common.loading")}
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
                  className="accent-checkbox"
                />
                <span>
                  {tt("modpacks.create.allVersions")}
                </span>
              </label>
            </div>

            {createLoader !== "vanilla" && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-white/70">
                  {tt("modpacks.create.loaderVersionLabel")}
                </label>
                <div className="relative inline-flex w-72 items-center justify-between rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white/90">
                  <button
                    type="button"
                    onClick={() => {
                      if (loaderVersionOptions.length === 0) {
                        void loadCreateLoaderVersions();
                      }
                      setIsLoaderVersionDropdownOpen((v) => !v);
                    }}
                    disabled={loaderVersionsLoading}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:opacity-60"
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <span className="truncate">
                        {loaderVersionsLoading
                          ? tt("modpacks.common.loading")
                          : createLoaderVersion || tt("modpacks.common.select")}
                      </span>
                      {selectedLoaderVersionOption?.channel && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            selectedLoaderVersionOption.channel === "stable"
                              ? "bg-emerald-500/20 text-emerald-200"
                              : selectedLoaderVersionOption.channel === "alpha"
                                ? "bg-violet-500/20 text-violet-200"
                                : "bg-amber-500/20 text-amber-200"
                          }`}
                        >
                          {loaderChannelLabel(selectedLoaderVersionOption.channel)}
                        </span>
                      )}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-white/60" />
                  </button>
                  {isLoaderVersionDropdownOpen && (
                    <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                      {loaderVersionOptions.length === 0 && !loaderVersionsLoading && (
                        <div className="px-3 py-2 text-white/60">
                          {tt("modpacks.manage.noVersionsForGame")}
                        </div>
                      )}
                      {loaderVersionOptions.map((opt, idx) => {
                        const channelLabel = loaderChannelLabel(opt.channel ?? null);
                        const selected = createLoaderVersion === opt.version;
                        return (
                          <button
                            key={`${createLoader}-${opt.version}-${idx}`}
                            type="button"
                            onClick={() => {
                              setCreateLoaderVersion(opt.version);
                              setIsLoaderVersionDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left transition-colors ${
                              selected
                                ? "bg-white/90 text-black"
                                : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            <span className="truncate">{opt.version}</span>
                            {channelLabel && (
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  selected
                                    ? opt.channel === "stable"
                                      ? "bg-emerald-600/25 text-emerald-900"
                                      : opt.channel === "alpha"
                                        ? "bg-violet-600/25 text-violet-900"
                                        : "bg-amber-600/25 text-amber-900"
                                    : opt.channel === "stable"
                                      ? "bg-emerald-500/20 text-emerald-200"
                                      : opt.channel === "alpha"
                                        ? "bg-violet-500/20 text-violet-200"
                                        : "bg-amber-500/20 text-amber-200"
                                }`}
                              >
                                {channelLabel}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          className={`mt-2 flex flex-wrap items-center gap-2 ${
            BUILD_PRESETS_UI_ENABLED ? "justify-between" : "justify-end"
          }`}
        >
          {BUILD_PRESETS_UI_ENABLED && (
            <button
              type="button"
              disabled={createBusy}
              onClick={() => void handleSaveBuildPresetFromForm()}
              className="interactive-press rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white/85 hover:bg-white/20 disabled:opacity-60"
            >
              {tt("modpacks.create.saveFormAsPreset")}
            </button>
          )}
          <button
            type="button"
            disabled={createBusy}
            onClick={() => void handleCreateProfile()}
            className="interactive-press inline-flex items-center gap-2 rounded-2xl accent-bg px-6 py-2.5 text-sm font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-60"
          >
            <PlusIcon className="h-4 w-4" />
            <span>{tt("modpacks.actions.create")}</span>
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
            {tt("modpacks.import.title")}
          </h2>
          <button
            type="button"
            onClick={() => setActiveView("list")}
            className="interactive-press rounded-full bg-white/10 px-5 py-1 text-xs font-medium text-white/80 hover:bg-white/20"
          >
            {tt("modpacks.common.backToList")}
          </button>
        </div>

        {mrpackBusy && (
          <div className="flex flex-col gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-white">
                {mrpackProgress?.phase === "start"
                  ? tt("modpacks.import.progress.preparing")
                  : mrpackProgress?.phase === "overrides"
                    ? tt("modpacks.import.progress.extractingOverrides")
                    : mrpackProgress?.phase === "files" &&
                        mrpackProgress.total != null &&
                        mrpackProgress.total > 0
                      ? tt("modpacks.import.progress.downloading", {
                          current: mrpackProgress.current ?? 0,
                          total: mrpackProgress.total,
                          msg: mrpackProgress.message ? ` — ${mrpackProgress.message}` : "",
                        })
                      : tt("modpacks.import.progress.importing")}
              </p>
              <button
                type="button"
                onClick={() => void handleCancelMrpackImport()}
                className="interactive-press shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 hover:bg-white/20"
              >
                {tt("common.cancel")}
              </button>
            </div>
            {mrpackProgress?.total != null &&
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
            {tt("modpacks.import.dropzone.title")}
          </p>
          <p className="max-w-md text-xs text-white/60">
            {tt("modpacks.import.dropzone.hint")}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={mrpackBusy}
              onClick={() => void handleImportMrpack()}
              className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              <span>{tt("modpacks.import.chooseFile")}</span>
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-white/15 bg-black/45 px-5 py-4 backdrop-blur-xl">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">
                {tt("modpacks.externalImport.title")}
              </h3>
              <p className="mt-1 text-xs text-white/60">
                {tt("modpacks.externalImport.hint")}
              </p>
            </div>
          </div>

          {externalImportBusy && (
            <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
              <p className="text-xs font-medium text-white">
                {externalImportProgress?.phase === "copy"
                  ? tt("modpacks.externalImport.copying")
                  : tt("modpacks.externalImport.importing")}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                <div className="h-full w-1/2 rounded-full bg-emerald-500/90" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-[11px] font-semibold text-white/70">
                {tt("modpacks.externalImport.launcher")}
              </label>
              <select
                value={externalImportLauncher}
                onChange={(e) => {
                  const v = e.target.value as ExternalLauncherType;
                  setExternalImportLauncher(v);
                  setExternalImportInstances([]);
                  setExternalImportScanError(null);
                  setExternalImportSearch("");
                  setExternalImportSort("name");
                  setTimeout(() => void ensureExternalImportPathDefault(), 0);
                }}
                className="w-full rounded-2xl border border-white/15 bg-black/60 px-3 py-2 text-xs text-white focus:outline-none"
              >
                <option value="auto">{tt("modpacks.externalImport.auto")}</option>
                <option value="multimc">MultiMC</option>
                <option value="prism_launcher">PrismLauncher</option>
                <option value="atlauncher">ATLauncher</option>
                <option value="gdlauncher">GDLauncher</option>
                <option value="curseforge">CurseForge</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-white/70">
                {tt("modpacks.externalImport.path")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={externalImportPath}
                  onChange={(e) => setExternalImportPath(e.target.value)}
                  placeholder={
                    tt("modpacks.externalImport.pathPlaceholder")
                  }
                  className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-black/60 px-3 py-2 text-xs text-white/90 placeholder:text-white/35 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={externalImportScanBusy || externalImportBusy}
                  onClick={() => void handleBrowseExternalImportPath()}
                  className="interactive-press shrink-0 rounded-2xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/85 hover:bg-white/20 disabled:opacity-60"
                >
                  {tt("common.browse")}
                </button>
                <button
                  type="button"
                  disabled={externalImportScanBusy || externalImportBusy}
                  onClick={() => void handleScanExternalInstances()}
                  className="interactive-press shrink-0 rounded-2xl accent-bg px-4 py-2 text-xs font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-60"
                >
                  {externalImportScanBusy
                    ? tt("modpacks.externalImport.scanning")
                    : tt("modpacks.externalImport.scan")}
                </button>
              </div>
              {externalImportScanError && (
                <p className="mt-2 text-xs text-amber-200/90">{externalImportScanError}</p>
              )}
            </div>
          </div>

          {externalImportInstances.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  type="text"
                  value={externalImportSearch}
                  onChange={(e) => setExternalImportSearch(e.target.value)}
                  placeholder={tt("common.search")}
                  className="w-full rounded-2xl border border-white/15 bg-black/60 px-3 py-2 text-xs text-white/90 placeholder:text-white/35 focus:outline-none sm:w-72"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-white/60">
                    {tt("modpacks.externalImport.sort")}
                  </span>
                  <select
                    value={externalImportSort}
                    onChange={(e) =>
                      setExternalImportSort(e.target.value as "name" | "date" | "size")
                    }
                    className="rounded-2xl border border-white/15 bg-black/60 px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="name">{tt("modpacks.externalImport.sortName")}</option>
                    <option value="date">{tt("modpacks.externalImport.sortDate")}</option>
                    <option value="size">{tt("modpacks.externalImport.sortSize")}</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {externalImportInstances
                  .filter((p) => {
                    const q = externalImportSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      p.display_name.toLowerCase().includes(q) ||
                      p.path.toLowerCase().includes(q) ||
                      (p.loader ?? "").toLowerCase().includes(q) ||
                      (p.game_version ?? "").toLowerCase().includes(q)
                    );
                  })
                  .slice()
                  .sort((a, b) => {
                    if (externalImportSort === "size") {
                      return (b.approx_size_bytes ?? 0) - (a.approx_size_bytes ?? 0);
                    }
                    if (externalImportSort === "date") {
                      return (b.last_modified ?? 0) - (a.last_modified ?? 0);
                    }
                    return a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase());
                  })
                  .map((p) => {
                    const iconSrc = p.icon_data_uri || p.icon_path || "/launcher-assets/modpack_icon.png";
                    const meta = [
                      p.loader ? p.loader : null,
                      p.game_version ? p.game_version : null,
                      p.mods_count != null
                        ? tt("common.format.modsMeta", { count: p.mods_count })
                        : null,
                      p.approx_size_bytes != null ? formatByteSize(language, p.approx_size_bytes) : null,
                    ].filter(Boolean) as string[];

                    return (
                      <div
                        key={`${p.launcher_type}:${p.id}:${p.path}`}
                        className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <img
                            src={iconSrc}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-xl bg-black/40 object-contain ring-1 ring-white/10"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">
                              {p.display_name}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/60">
                              {meta.length > 0 && <span>{meta.join(" • ")}</span>}
                              <span className="truncate">{p.path}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={externalImportBusy}
                            onClick={() => void handleImportExternalInstance(p)}
                            className="interactive-press rounded-2xl accent-bg px-4 py-2 text-xs font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-60"
                          >
                            {tt("modpacks.actions.import")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
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
        : items.filter((item) => item.name.toLowerCase().includes(searchValue));

    return (
      <div className="custom-scrollbar flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <div className="sticky top-0 z-20 -mx-1 flex w-full shrink-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 w-fit max-w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
            <ProfileInstanceIcon
              profile={selectedProfile}
              imageFit="contain"
              refreshKey={profileIconRevisions[selectedProfile.id] ?? 0}
              editable
              editTitle={tt("modpacks.profile.changeIconTitle")}
              onEditClick={() => void handleChooseProfileIcon()}
            />
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
                  <>
                    <button
                      type="button"
                      onClick={() => setProfileInfoProfile(selectedProfile)}
                      className="interactive-press rounded-full bg-white/10 p-0.5 text-white/70 hover:bg-white/20"
                      title={tt("modpacks.profileInfo.buttonTitle")}
                    >
                      <ProfileInfoIcon className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameValue(selectedProfile.name);
                        setIsRenaming(true);
                      }}
                      className="interactive-press rounded-full bg-white/10 p-1 text-white/70 hover:bg-white/20"
                      title={tt("common.rename")}
                    >
                      <EditIcon className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                {isRenaming && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRenameConfirm()}
                      className="interactive-press rounded-full accent-bg p-1 text-white hover:opacity-90"
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
              <div className="mt-0.5 flex flex-col gap-1 text-xs text-white/70">
                <div className="flex flex-wrap items-center gap-3">
                  <span>{`${selectedProfile.game_version} • ${selectedProfile.loader}`}</span>
                  <span className="flex items-center gap-1">
                    <img
                      src="/launcher-assets/cllock.png"
                      alt=""
                      title={tt("modpacks.list.playtimeLabel")}
                      className="h-3 w-3 object-contain opacity-80"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.dataset.failedOnce !== "1") {
                          img.dataset.failedOnce = "1";
                          img.src = "/launcher-assets/clock.png";
                          return;
                        }
                        img.style.display = "none";
                      }}
                    />
                    <span>
                      {formatPlaytimeShort(language, selectedProfile.play_time_seconds)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <ModsIcon className="h-3 w-3" />
                    <span>{countLabel(selectedProfile.mods_count, language)}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1">
                    <WeightIcon className="h-3 w-3" />
                    <span>
                      {formatByteSize(language, selectedProfile.total_size_bytes)}
                    </span>
                  </span>
                  <span className="text-white/55">
                    {tt("modpacks.list.lastPlayed", {
                      date: formatLastPlayedAt(selectedProfile.last_played_at, language),
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="ml-auto flex w-fit shrink-0 flex-wrap items-center justify-end gap-2 rounded-2xl border border-white/10 bg-black/55 px-2 py-2 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setActiveView("list")}
              className={`${MANAGE_ACTION_BTN_CLASS} bg-white/10 hover:bg-white/20`}
              title={tt("modpacks.manage.backToList")}
            >
              <span className="truncate">
                {tt("modpacks.manage.backToList")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleOpenFolder()}
              className={`${MANAGE_ICON_BTN_CLASS} bg-white/10 hover:bg-white/20`}
              title={tt("modpacks.manage.openFolder")}
            >
              <FolderIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void openExportModal()}
              className={`${MANAGE_ICON_BTN_CLASS} bg-white/10 hover:bg-white/20`}
              title={tt("modpacks.manage.exportBuild")}
            >
              <ExportIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsScreenshotsOpen(true)}
              className={`${MANAGE_ICON_BTN_CLASS} bg-white/10 hover:bg-white/20`}
              title={tt("modpacks.screenshots.title")}
            >
              <ScreenshotsIcon className="h-3.5 w-3.5" />
            </button>
            {BUILD_PRESETS_UI_ENABLED && (
              <button
                type="button"
                onClick={() => void handleSaveBuildPresetFromProfile(selectedProfile)}
                className={`${MANAGE_ACTION_BTN_CLASS} bg-white/10 hover:bg-white/20`}
                title={tt("modpacks.presets.saveFromProfile")}
              >
                <span className="truncate">{tt("modpacks.presets.saveFromProfile")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void openProfileSettings(selectedProfile.id)}
              className={`${MANAGE_ICON_BTN_CLASS} bg-white/10 hover:bg-white/20`}
              title={tt("modpacks.manage.profileSettings")}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onPlaySelectedProfile?.()}
              disabled={isLaunching || isStopping}
              className={`${MANAGE_ACTION_BTN_CLASS} shadow-soft ${primaryColorClasses} ${
                isLaunching || isStopping ? "cursor-not-allowed" : "interactive-press"
              }`}
              title={tt("modpacks.list.playSelectedTitle")}
            >
              <span className="truncate">
                {primaryLabel ?? tt("modpacks.actions.play")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleSelectProfile(selectedProfile)}
              className={`${MANAGE_ACTION_BTN_CLASS} bg-white/10 hover:bg-white/20`}
              title={tt("modpacks.manage.selectProfile")}
            >
              <Download className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {selectedProfileId === selectedProfile.id
                  ? tt("modpacks.actions.unselect")
                  : tt("modpacks.actions.select")}
              </span>
            </button>
          </div>
        </div>

        <div
          ref={manageSplitRowRef}
          className="flex min-h-0 w-full flex-1 flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-0"
          style={
            {
              ["--modpack-main-frac" as string]: String(manageMainWidthFrac),
            } as CSSProperties
          }
        >
          <div className="glass-panel flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden lg:flex-none lg:shrink-0 lg:pr-2 lg:[flex-basis:calc(var(--modpack-main-frac,0.68)*100%)]">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 basis-[18rem] items-center gap-3 rounded-2xl border border-white/15 bg-black/35 px-4 py-2 shadow-soft backdrop-blur-xl">
              <SearchIcon className="h-4 w-4" />
              <input
                type="text"
                placeholder={tt("modpacks.manage.searchFiles")}
                value={itemsSearch}
                onChange={(e) => setItemsSearch(e.target.value)}
                className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
              />
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto lg:flex-nowrap">
              <button
                type="button"
                onClick={() =>
                  selectedProfile && void refreshItems(selectedProfile.id, contentTab)
                }
                className="interactive-press rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                title={tt("modpacks.manage.rescan")}
              >
                <RefreshIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleCheckContentUpdates()}
                disabled={contentUpdatesChecking || !selectedProfile}
                className="interactive-press rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                title={tt("modpacks.contentUpdates.check")}
              >
                {contentUpdatesChecking
                  ? tt("modpacks.contentUpdates.checking")
                  : tt("modpacks.contentUpdates.check")}
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsAddMenuOpen((v) => !v)}
                  className="interactive-press inline-flex items-center gap-2 rounded-full accent-bg px-4 py-1.5 text-xs font-semibold text-white shadow-soft hover:opacity-90"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  <span>{tt("common.add")}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {isAddMenuOpen && (
                  <div className="absolute right-0 z-30 mt-1 w-44 rounded-2xl bg-black/90 p-1 text-xs text-white shadow-soft backdrop-blur-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      onOpenModsTab?.();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>
                      {tt("modpacks.manage.downloadFromCatalog")}
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
                      {tt("modpacks.manage.chooseFileFromPc")}
                    </span>
                  </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <div
              ref={manageContentTabsContainerRef}
              className="relative inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-white/10 p-1"
            >
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

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={manageDropZoneRef}
              className={`custom-scrollbar min-h-0 flex-1 overflow-y-auto rounded-2xl bg-black/35 p-2.5 shadow-inner transition-colors ${
                isManageDropTarget
                  ? "bg-purple-500/15 ring-2 ring-purple-400/70 ring-inset"
                  : ""
              }`}
            >
            {itemsLoading ? (
              <div className="flex h-32 items-center justify-center text-xs text-white/70">
                {tt("modpacks.manage.loadingFiles")}
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="flex min-h-[10rem] items-center justify-center rounded-2xl bg-black/40 px-4 text-center text-xs text-white/60">
                <div className="max-w-sm space-y-2">
                  <p>
                    {tt("modpacks.manage.emptyTab")}
                  </p>
                  <p className="text-white/45">
                    {tt("modpacks.manage.dropHint")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {visibleItems.map((item) => (
                  <div
                    key={item.name}
                    className={`flex items-center justify-between gap-2 rounded-2xl bg-black/45 px-3 py-3 text-xs transition-opacity ${
                      item.enabled ? "text-white/85" : "text-white/45 opacity-75"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[11px]">
                        {contentTab === "mods" ? (
                          <ModsIcon className="h-5 w-5" />
                        ) : contentTab === "resourcepacks" ? (
                          "R"
                        ) : (
                          "S"
                        )}
                      </span>
                      <span className="max-w-[200px] truncate md:max-w-[280px]">
                        {item.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.enabled}
                        onClick={() => void handleToggleItemEnabled(item)}
                        className={`interactive-press relative h-6 w-10 rounded-full transition-colors ${
                          item.enabled ? "bg-emerald-500/90" : "bg-white/20"
                        }`}
                        title={
                          item.enabled
                            ? tt("modpacks.manage.disableItem")
                            : tt("modpacks.manage.enableItem")
                        }
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${
                            item.enabled ? "left-[1.125rem]" : "left-0.5"
                          }`}
                        />
                      </button>
                      {contentTab === "mods" &&
                        !contentUpdatesAvailabilityLoading &&
                        contentUpdatesAvailableFilenames.has(item.name) && (
                        <button
                          type="button"
                          onClick={() => void handleUpdateSingleItem(item)}
                          disabled={
                            contentUpdatesApplying ||
                            contentUpdatesChecking ||
                            contentUpdatesSingleApplyingFilename === item.name
                          }
                          className="interactive-press rounded-full bg-white/10 p-1.5 text-white/80 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                          title={tt("modpacks.manage.update")}
                        >
                          <img
                            src="/launcher-assets/download.png"
                            alt=""
                            className="h-3.5 w-3.5 object-contain"
                            aria-hidden="true"
                          />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDeleteItem(item)}
                        className="interactive-press rounded-full bg-white/10 p-1.5 text-white/80 hover:bg-red-600 hover:text-white"
                        title={tt("common.delete")}
                      >
                        <DeleteIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </div>

        <div
          ref={manageSplitHandleRef}
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(manageMainWidthFrac * 100)}
          aria-valuemin={Math.round(MODPACK_MANAGE_SPLIT_MIN * 100)}
          aria-valuemax={Math.round(MODPACK_MANAGE_SPLIT_MAX * 100)}
          aria-label={tt("modpacks.manage.splitResizeAria")}
          title={tt("modpacks.manage.splitResizeTitle")}
          onPointerDown={onManageSplitPointerDown}
          className={`hidden lg:flex lg:w-2 lg:shrink-0 lg:cursor-col-resize lg:select-none lg:touch-none lg:flex-col lg:items-center lg:justify-center lg:self-stretch ${
            isManageSplitDragging ? "lg:bg-white/25" : "lg:bg-transparent lg:hover:bg-white/10"
          }`}
        >
          <span className="pointer-events-none h-24 w-1 rounded-full bg-white/35 shadow-sm" />
        </div>

        <div className="glass-panel relative z-10 flex min-h-0 w-full min-w-0 flex-1 flex-col rounded-2xl border border-white/12 bg-black/65 px-3 py-3 shadow-soft backdrop-blur-xl max-h-[min(42rem,calc(100vh-6rem))] lg:sticky lg:top-2 lg:mt-0 lg:min-w-[11rem] lg:flex-1 lg:self-stretch lg:shadow-lg">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${manageConsoleStatusDotClass} ${
                  selectedLogSessionId === "live" && gameStatus === "running"
                    ? "animate-pulse"
                    : ""
                }`}
              />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                {tt("play.console.title")}
              </span>
              <select
                value={selectedLogSessionId}
                onChange={(e) => setSelectedLogSessionId(e.target.value)}
                className="max-w-[min(100%,15rem)] rounded-2xl border border-white/15 bg-black/50 px-2 py-1 text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-white/30"
              >
                <option value="live">
                  {tt("modpacks.manage.currentOutput")}
                </option>
                {consoleHistorySessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatLogSessionOptionLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (selectedLogSessionId === "live") onClearConsole?.();
                }}
                disabled={selectedLogSessionId !== "live"}
                className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                title={
                  selectedLogSessionId !== "live"
                    ? tt("modpacks.manage.clearOnlyLive")
                    : undefined
                }
              >
                {tt("play.console.clear")}
              </button>
              <button
                type="button"
                onClick={() => setManageConsoleExpanded((v) => !v)}
                className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20"
              >
                {manageConsoleExpanded
                  ? tt("play.console.hide")
                  : tt("play.console.show")}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyManageConsole()}
                disabled={isCopyingConsole}
                className="interactive-press inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-50"
                title={
                  isConsoleCopied ? tt("app.toast.copied") : tt("app.toast.copy")
                }
                aria-label={tt("app.toast.copy")}
              >
                <img
                  src="/launcher-assets/copy.png"
                  alt=""
                  className="h-4 w-4 object-contain"
                />
              </button>
            </div>
          </div>

          {manageConsoleExpanded && (
            <div className="mt-1 flex min-h-0 flex-1 flex-col">
              {displayedConsoleLines.length > 0 ? (
                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto rounded-xl bg-black/80 px-3 py-2 text-[11px] font-mono text-white/80 sm:min-h-[12rem]">
                  {displayedConsoleLines.map((entry, idx) => (
                    <div
                      key={`${selectedLogSessionId}-${idx}`}
                      className={`whitespace-pre break-all ${
                        entry.source === "stderr" ? "text-red-300" : "text-emerald-200"
                      }`}
                    >
                      {entry.line}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-24 w-full shrink-0 items-center justify-center rounded-xl bg-black/70 px-3 py-2 text-[11px] text-white/60 lg:flex-1">
                  {tt("play.console.empty")}
                </div>
              )}
              <p className="mt-2 shrink-0 text-[10px] text-white/40">
                {tt("modpacks.manage.consoleResizeHint")}
              </p>
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex w-full min-h-0 flex-1 flex-col gap-4 ${
        fillPane || activeView === "manage"
          ? "h-full max-w-none self-stretch px-0 sm:px-1"
          : "max-w-none self-stretch"
      }`}
    >
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
                setProfileInfoProfile(profile);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <ProfileInfoIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.profileInfo.menuItem")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                void openProfileSettings(profile.id);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.contextMenu.settings")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                void handleCreateDesktopShortcut(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <ExportIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.actions.createShortcut")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                onTogglePinInSidebar?.(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>
                {(() => {
                  const pinned = isPinnedInSidebar?.(contextMenu.profileId) ?? false;
                  return pinned
                    ? tt("modpacks.contextMenu.unpinFromSidebar")
                    : tt("modpacks.contextMenu.pinToSidebar");
                })()}
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
                setPendingDeleteProfileId(profile.id);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-red-300 hover:bg-red-600/20"
            >
              <DeleteIcon className="h-3.5 w-3.5" />
              <span>
                {tt("modpacks.contextMenu.deleteProfile")}
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
                {tt("modpacks.contextMenu.renameProfile")}
              </span>
            </button>
          </div>
        </div>
      )}

      {listContextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setListContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setListContextMenu(null);
          }}
        >
          <div
            className="absolute z-50 w-56 rounded-2xl bg-black/90 p-1 text-xs text-white shadow-soft backdrop-blur-lg"
            style={{ top: listContextMenu.y, left: listContextMenu.x }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={() => {
                setListContextMenu(null);
                openCreateGroupModal();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.list.createGroupMenu")}</span>
            </button>
          </div>
        </div>
      )}

      {groupContextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setGroupContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setGroupContextMenu(null);
          }}
        >
          <div
            className="absolute z-50 w-56 rounded-2xl bg-black/90 p-1 text-xs text-white shadow-soft backdrop-blur-lg"
            style={{ top: groupContextMenu.y, left: groupContextMenu.x }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={() => {
                const group = profileGroups.find((g) => g.id === groupContextMenu.groupId);
                setGroupContextMenu(null);
                if (!group) return;
                openEditGroupModal(group);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <EditIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.list.editGroupMenu")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const groupId = groupContextMenu.groupId;
                setGroupContextMenu(null);
                handleDeleteGroup(groupId);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-red-300 hover:bg-red-600/20"
            >
              <DeleteIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.list.deleteGroupMenu")}</span>
            </button>
          </div>
        </div>
      )}

      {isGroupModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => {
            setEditingGroupId(null);
            setIsGroupModalOpen(false);
          }}
        >
          <div
            className="glass-panel flex w-full max-w-md flex-col rounded-3xl border border-white/15 bg-black/70 p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-semibold text-white">
              {editingGroupId ? tt("modpacks.groups.editTitle") : tt("modpacks.groups.createTitle")}
            </h3>

            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-medium text-white/60">
                {tt("modpacks.groups.nameLabel")}
              </span>
              <input
                type="text"
                value={groupFormName}
                onChange={(e) => setGroupFormName(e.target.value)}
                placeholder={tt("modpacks.groups.namePlaceholder")}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-white/30"
                autoFocus
              />
            </label>

            <div className="mb-3">
              <span className="mb-1.5 block text-xs font-medium text-white/60">
                {tt("modpacks.groups.colorLabel")}
              </span>
              <div className="flex flex-wrap gap-2">
                {PROFILE_GROUP_COLORS.map((color) => {
                  const styles = PROFILE_GROUP_COLOR_STYLES[color];
                  const selected = groupFormColor === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setGroupFormColor(color)}
                      className={`interactive-press flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs ${
                        selected
                          ? `${styles.border} ${styles.headerBg} ${styles.accent}`
                          : "border-white/10 bg-black/30 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      <span className={`h-3 w-3 rounded-full ${styles.dot}`} />
                      {tt(`modpacks.groups.color.${color}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-4" ref={groupProfilesDropdownRef}>
              <span className="mb-1.5 block text-xs font-medium text-white/60">
                {tt("modpacks.groups.profilesLabel")}
              </span>
              <button
                type="button"
                onClick={() => setIsGroupProfilesDropdownOpen((v) => !v)}
                className="interactive-press flex w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-left text-sm text-white/85 hover:bg-black/55"
              >
                <span className="truncate">
                  {groupFormProfileIds.size > 0
                    ? tt("modpacks.groups.profilesSelected", {
                        count: groupFormProfileIds.size,
                      })
                    : tt("modpacks.groups.profilesPlaceholder")}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-white/50 transition ${
                    isGroupProfilesDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isGroupProfilesDropdownOpen && (
                <div className="custom-scrollbar mt-1 max-h-48 overflow-y-auto rounded-xl border border-white/15 bg-black/80 p-1 shadow-soft">
                  {profiles.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-white/50">{tt("modpacks.list.empty")}</div>
                  ) : (
                    profiles.map((p) => {
                      const checked = groupFormProfileIds.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-white/85 hover:bg-white/10"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setGroupFormProfileIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) next.delete(p.id);
                                else next.add(p.id);
                                return next;
                              });
                            }}
                            className="rounded border-white/30 bg-black/40"
                          />
                          <ProfileInstanceIcon profile={p} className="h-6 w-6 shrink-0 rounded-lg" />
                          <span className="min-w-0 truncate">{p.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingGroupId(null);
                  setIsGroupModalOpen(false);
                }}
                className="interactive-press rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/20"
              >
                {tt("modpacks.groups.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveGroup}
                className="interactive-press rounded-xl accent-bg px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                {editingGroupId ? tt("modpacks.groups.save") : tt("modpacks.groups.create")}
              </button>
            </div>
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
                {tt("modpacks.deleteConfirm.title")}
              </h2>
            </div>
            <p className="mb-4 text-xs text-yellow-50">
              {(() => {
                const profile = profiles.find((p) => p.id === pendingDeleteProfileId);
                const name = profile?.name ?? "";
                return tt("modpacks.deleteConfirm.prompt", { name });
              })()}
            </p>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPendingDeleteProfileId(null)}
                className="interactive-press rounded-full bg-white/10 px-4 py-1.5 font-semibold text-white hover:bg-white/20"
              >
                {tt("common.cancel")}
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
                {tt("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {BUILD_PRESETS_UI_ENABLED && isPresetsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setIsPresetsModalOpen(false)}
        >
          <div
            className="glass-panel flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl border border-white/15 bg-black/70 p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-white">
                {tt("modpacks.presets.title")}
              </h3>
              <button
                type="button"
                onClick={() => setIsPresetsModalOpen(false)}
                className="interactive-press rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
              >
                {tt("modpacks.common.backToList")}
              </button>
            </div>

            {buildPresetsLoading && (
              <p className="text-sm text-white/60">{tt("modpacks.common.loading")}</p>
            )}

            {!buildPresetsLoading && buildPresets.length === 0 && (
              <p className="text-sm text-white/70">{tt("modpacks.presets.empty")}</p>
            )}

            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
              {buildPresets.map((preset) => {
                const iconUri = presetIconUris[preset.id];
                const loaderVersionLabel =
                  preset.loader === "vanilla"
                    ? preset.game_version
                    : `${preset.game_version}${preset.loader_version ? ` · ${preset.loader_version}` : ""}`;
                return (
                  <div
                    key={preset.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                      {iconUri ? (
                        <img
                          src={iconUri}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] uppercase text-white/40">
                          {preset.loader.slice(0, 2)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">
                        {preset.name}
                      </div>
                      <div className="truncate text-[11px] text-white/55">
                        {tt("modpacks.presets.loaderInfo", {
                          loader: loaderLabels[preset.loader as LoaderId] ?? preset.loader,
                          version: loaderVersionLabel,
                        })}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          applyBuildPresetToCreateForm(preset);
                          setActiveView("create");
                          void ensureVersionsLoaded();
                          setIsPresetsModalOpen(false);
                          showNotification("info", tt("modpacks.presets.applied"));
                        }}
                        className="interactive-press rounded-xl accent-bg px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                      >
                        {tt("modpacks.presets.apply")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteBuildPreset(preset)}
                        className="interactive-press rounded-xl bg-red-600/80 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
                      >
                        {tt("modpacks.presets.delete")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {activeView === "create" && (
              <button
                type="button"
                onClick={() => void handleSaveBuildPresetFromForm()}
                className="interactive-press mt-4 w-full rounded-2xl border border-white/20 bg-white/10 py-2 text-sm font-semibold text-white hover:bg-white/20"
              >
                {tt("modpacks.presets.saveFromForm")}
              </button>
            )}
          </div>
        </div>
      )}

      {isContentUpdatesModalOpen && selectedProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => {
            if (contentUpdatesApplying) return;
            setIsContentUpdatesModalOpen(false);
          }}
        >
          <div
            className="glass-panel w-full max-w-4xl rounded-3xl border border-white/15 bg-black/70 p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.16em] text-white/50">
                  {tt("modpacks.contentUpdates.modalTitle")}
                </div>
                <div className="truncate text-lg font-semibold text-white">
                  {selectedProfile.name}
                </div>
                <div className="text-xs text-white/65">
                  {tt("modpacks.contentUpdates.modalSubtitle")}
                </div>
              </div>
              <button
                type="button"
                className="interactive-press rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20 disabled:opacity-60"
                disabled={contentUpdatesApplying}
                onClick={() => setIsContentUpdatesModalOpen(false)}
              >
                {tt("common.close")}
              </button>
            </div>

            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {contentUpdates.map((update) => {
                const checked = selectedContentUpdateFilenames.has(update.filename);
                return (
                  <label
                    key={update.filename}
                    className={`flex cursor-pointer select-none items-center gap-3 rounded-2xl border px-3 py-2 text-sm ${
                      checked
                        ? "border-emerald-400/35 bg-emerald-500/10 text-white/95"
                        : "border-white/10 bg-black/35 text-white/90"
                    }`}
                    onClick={() => {
                      if (contentUpdatesApplying) return;
                      setSelectedContentUpdateFilenames((prev) => {
                        const next = new Set(prev);
                        if (next.has(update.filename)) next.delete(update.filename);
                        else next.add(update.filename);
                        return next;
                      });
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="accent-checkbox pointer-events-none"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{update.title}</div>
                      <div className="truncate text-xs text-white/70">{update.filename}</div>
                    </div>
                    <div className="text-right text-xs text-white/70">
                      <div>
                        {tt("modpacks.contentUpdates.currentVersion")}: {update.currentVersionNumber}
                      </div>
                      <div>
                        {tt("modpacks.contentUpdates.latestVersion")}: {update.latestVersionNumber}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 text-xs text-white/55">
              {tt("modpacks.contentUpdates.notOnModrinth")}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleApplyContentUpdates(false)}
                disabled={contentUpdatesApplying}
                className="interactive-press rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {contentUpdatesApplying
                  ? tt("modpacks.contentUpdates.updating")
                  : tt("modpacks.contentUpdates.updateSelected")}
              </button>
              <button
                type="button"
                onClick={() => void handleApplyContentUpdates(true)}
                disabled={contentUpdatesApplying}
                className="interactive-press rounded-2xl accent-bg px-4 py-2 text-sm font-semibold text-white shadow-soft hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {contentUpdatesApplying
                  ? tt("modpacks.contentUpdates.updating")
                  : tt("modpacks.contentUpdates.updateAll")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProfileInfoModal
        language={language}
        profile={profileInfoProfile}
        onClose={() => setProfileInfoProfile(null)}
      />

      {isProfileSettingsOpen && selectedProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeProfileSettingsModal}
        >
          <div
            className="glass-panel w-full max-w-3xl rounded-3xl border border-white/15 bg-black/70 p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.16em] text-white/50">
                  {tt("modpacks.profileSettingsModal.title")}
                </div>
                <div className="truncate text-lg font-semibold text-white">
                  {selectedProfile.name}
                </div>
              </div>
              <button
                type="button"
                className="interactive-press rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
                onClick={closeProfileSettingsModal}
              >
                {tt("common.close")}
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
                {tt("modpacks.profileSettingsModal.general")}
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
                  <div className="mb-3 text-xs text-white/60">
                    {tt("modpacks.profileSettingsModal.hint")}
                  </div>
                  <div className="flex flex-col gap-4">
                    <SettingsToggle
                      label={
                        tt("modpacks.profileSettingsModal.closeLauncherOnStart")
                      }
                      yesLabel={tt("common.yes")}
                      noLabel={tt("common.no")}
                      value={profileEffectiveSettings?.close_launcher_on_game_start ?? false}
                      onChange={(value: boolean) =>
                        void patchProfileGameSettings(selectedProfile.id, {
                          close_launcher_on_game_start: value,
                        })
                      }
                    />
                    <SettingsToggle
                      label={
                        tt("modpacks.profileSettingsModal.checkGameProcesses")
                      }
                      yesLabel={tt("common.yes")}
                      noLabel={tt("common.no")}
                      value={profileEffectiveSettings?.check_game_processes ?? true}
                      onChange={(value: boolean) =>
                        void patchProfileGameSettings(selectedProfile.id, {
                          check_game_processes: value,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/12 bg-black/35 px-4 py-3">
                  <div className="mb-2 text-xs font-medium text-white/70">
                    {tt("modpacks.changeVersion.currentVersion")}
                  </div>
                  <div className="mb-3 text-sm text-white/90">
                    {selectedProfile.game_version}
                    {selectedProfile.loader !== "vanilla" && (
                      <span className="text-white/60">
                        {" "}
                        · {loaderLabels[selectedProfile.loader as LoaderId] ?? selectedProfile.loader}
                        {selectedProfile.loader_version
                          ? ` ${selectedProfile.loader_version}`
                          : ""}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={openChangeVersionModal}
                    className="interactive-press w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
                  >
                    {tt("modpacks.changeVersion.button")}
                  </button>
                </div>

                <div className="mt-4 rounded-2xl border border-white/12 bg-black/35 px-4 py-3">
                  <SettingsSlider
                    label={tt("modpacks.profileSettingsModal.memoryRam")}
                    min={1}
                    max={Math.max(64, systemMemoryGb)}
                    value={Math.max(
                      1,
                      Math.round((profileEffectiveSettings?.ram_mb ?? 4096) / 1024),
                    )}
                    onChange={(value: number) => {
                      const ramMb = Math.max(1, value) * 1024;
                      setProfileEffectiveSettings((prev) =>
                        prev ? { ...prev, ram_mb: ramMb } : prev,
                      );
                      scheduleProfileRamSave(selectedProfile.id, ramMb);
                    }}
                    onChangeCommitted={(value: number) =>
                      commitProfileRamSaveNow(selectedProfile.id, Math.max(1, value) * 1024)
                    }
                    right={
                      <span className="text-sm font-semibold text-white/90">
                        {tt("settings.game.ram.gbValue", {
                          gb: Math.max(
                            1,
                            Math.round((profileEffectiveSettings?.ram_mb ?? 4096) / 1024),
                          ),
                        })}
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

      {isChangeVersionOpen && selectedProfile && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeChangeVersionModal}
        >
          <div
            className="glass-panel w-full max-w-lg rounded-3xl border border-white/15 bg-black/70 p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <div className="text-xs uppercase tracking-[0.16em] text-white/50">
                {tt("modpacks.changeVersion.title")}
              </div>
              <div className="mt-1 text-sm text-white/70">
                {tt("modpacks.changeVersion.description")}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-white/70">
                  {tt("modpacks.changeVersion.gameVersionLabel")}
                </label>
                <div className="relative inline-flex w-full items-center justify-between rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white/90">
                  <button
                    type="button"
                    onClick={() => {
                      void ensureMigrateVersionsLoaded();
                      setIsMigrateVersionDropdownOpen((v) => !v);
                    }}
                    disabled={migrateBusy}
                    className="flex flex-1 items-center justify-between gap-2 text-left disabled:opacity-60"
                  >
                    <span className="truncate">
                      {migrateVersionsLoading
                        ? tt("modpacks.common.loading")
                        : migrateGameVersion || tt("modpacks.common.select")}
                    </span>
                    <ChevronDown className="h-3 w-3 text-white/60" />
                  </button>
                  {isMigrateVersionDropdownOpen && (
                    <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                      {migrateVersionsLoading && (
                        <div className="px-3 py-2 text-white/60">
                          {tt("modpacks.common.loading")}
                        </div>
                      )}
                      {!migrateVersionsLoading &&
                        migrateVersionOptions.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              setMigrateGameVersion(v.id);
                              setIsMigrateVersionDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                              migrateGameVersion === v.id
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
                    checked={migrateAllVersions}
                    onChange={(e) => setMigrateAllVersions(e.target.checked)}
                    disabled={migrateBusy}
                    className="accent-checkbox"
                  />
                  <span>{tt("modpacks.changeVersion.allVersions")}</span>
                </label>
              </div>

              {selectedProfile.loader !== "vanilla" && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-white/70">
                    {tt("modpacks.changeVersion.loaderVersionLabel")} (
                    {loaderLabels[selectedProfile.loader as LoaderId] ?? selectedProfile.loader})
                  </label>
                  <div className="relative inline-flex w-full items-center justify-between rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white/90">
                    <button
                      type="button"
                      onClick={() => {
                        if (migrateLoaderVersionOptions.length === 0) {
                          void loadMigrateLoaderVersions();
                        }
                        setIsMigrateLoaderVersionDropdownOpen((v) => !v);
                      }}
                      disabled={migrateBusy || migrateLoaderVersionsLoading}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:opacity-60"
                    >
                      <span className="truncate">
                        {migrateLoaderVersionsLoading
                          ? tt("modpacks.common.loading")
                          : migrateLoaderVersion || tt("modpacks.common.select")}
                      </span>
                      <ChevronDown className="h-3 w-3 shrink-0 text-white/60" />
                    </button>
                    {isMigrateLoaderVersionDropdownOpen && (
                      <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                        {migrateLoaderVersionOptions.length === 0 &&
                          !migrateLoaderVersionsLoading && (
                            <div className="px-3 py-2 text-white/60">
                              {tt("modpacks.common.select")}
                            </div>
                          )}
                        {migrateLoaderVersionOptions.map((o) => (
                          <button
                            key={o.version}
                            type="button"
                            onClick={() => {
                              setMigrateLoaderVersion(o.version);
                              setIsMigrateLoaderVersionDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                              migrateLoaderVersion === o.version
                                ? "bg-white/90 text-black"
                                : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            <span>{o.version}</span>
                            {o.channel && (
                              <span className="ml-2 text-[10px] uppercase text-gray-400">
                                {loaderChannelLabel(o.channel)}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeChangeVersionModal}
                disabled={migrateBusy}
                className="interactive-press rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleChangeProfileVersion()}
                disabled={migrateBusy || !migrateGameVersion}
                className="interactive-press rounded-2xl accent-bg px-4 py-2 text-sm font-semibold text-white shadow-soft hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {migrateBusy
                  ? tt("modpacks.changeVersion.migrating")
                  : tt("modpacks.changeVersion.confirm")}
              </button>
            </div>
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
                  {tt("modpacks.exportModal.title")}
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
                {tt("common.close")}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-white/12 bg-black/35 px-4 py-3">
                <div className="mb-2 text-xs font-semibold text-white/80">
                  {tt("modpacks.exportModal.format")}
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
                  {tt("modpacks.exportModal.ignorePatterns")}
                </div>
                <textarea
                  value={ignorePatternsText}
                  disabled={exportBusy}
                  onChange={(e) => setIgnorePatternsText(e.target.value)}
                  placeholder={"*.log\ncache/\n!important.log"}
                  className="custom-scrollbar mt-2 h-32 w-full resize-none rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-xs text-white/85 placeholder:text-white/35 focus:border-white/35 focus:outline-none"
                />
                <div className="mt-2 text-[11px] text-white/55">
                  {tt("modpacks.exportModal.ignoreHint")}
                </div>
              </div>

              <div className="rounded-2xl border border-white/12 bg-black/35 px-4 py-3 lg:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-white/80">
                    {tt("modpacks.exportModal.buildFiles")}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={exportBusy || exportTreeLoading || !exportTree}
                      onClick={() => setSelectedExportPaths(new Set(flattenTreePaths(exportTree)))}
                      className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                    >
                      {tt("modpacks.exportModal.selectAll")}
                    </button>
                    <button
                      type="button"
                      disabled={exportBusy}
                      onClick={() => setSelectedExportPaths(new Set())}
                      className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                    >
                      {tt("modpacks.exportModal.clearAll")}
                    </button>
                  </div>
                </div>

                <div className="custom-scrollbar max-h-[360px] overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2">
                  {exportTreeLoading ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {tt("modpacks.exportModal.scanning")}
                    </div>
                  ) : !exportTree ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {tt("modpacks.exportModal.noData")}
                    </div>
                  ) : exportTree.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {tt("modpacks.exportModal.emptyFolder")}
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
                                  className="accent-checkbox"
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
                                {formatByteSize(language, n.size)}
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
                    className="interactive-press inline-flex items-center gap-2 rounded-2xl bg-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
                  >
                    {tt("modpacks.exportModal.preview")}
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy}
                    onClick={() => void handleStartExport()}
                    className="interactive-press inline-flex items-center gap-2 rounded-2xl accent-bg px-4 py-2 text-xs font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-60"
                  >
                    <ExportIcon className="h-4 w-4" />
                    <span>{tt("modpacks.exportModal.export")}</span>
                  </button>

                  {exportBusy && exportProgress && (
                    <div className="ml-auto flex min-w-[260px] flex-1 flex-col gap-1 rounded-2xl border border-white/12 bg-black/40 px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-[11px] text-white/70">
                        <span className="truncate">
                          {exportProgress.current_file || tt("modpacks.exportModal.exporting")}
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
                          {formatByteSize(language, exportProgress.bytes_written)} /{" "}
                          {formatByteSize(language, exportProgress.total_bytes)}
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
                        {tt("modpacks.exportModal.finalContents")}
                      </div>
                      <div className="text-xs text-white/70">
                        {tt("modpacks.exportModal.size")}{" "}
                        <span className="font-semibold text-white/90">
                          {formatByteSize(language, previewResult.total_bytes)}
                        </span>
                      </div>
                    </div>
                    <div className="custom-scrollbar mt-2 max-h-40 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2 text-[11px] text-white/75">
                      {previewResult.files.length === 0 ? (
                        <div className="py-6 text-center text-white/55">
                          {tt("modpacks.exportModal.nothingIncluded")}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {previewResult.files.slice(0, 400).map((f) => (
                            <div key={f.path} className="flex items-center justify-between gap-3 px-2 py-0.5">
                              <span className="min-w-0 truncate">{f.path}</span>
                              <span className="shrink-0 text-white/50">
                                {formatByteSize(language, f.size)}
                              </span>
                            </div>
                          ))}
                          {previewResult.files.length > 400 && (
                            <div className="px-2 py-1 text-white/50">
                              {`… +${previewResult.files.length - 400}`}
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
                        {tt("modpacks.exportModal.done")}
                      </div>
                      <button
                        type="button"
                        onClick={() => void revealItemInDir(exportResultPath)}
                        className="interactive-press rounded-full accent-bg px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                      >
                        {tt("modpacks.exportModal.openFolder")}
                      </button>
                    </div>
                    <div className="break-all text-[11px] text-emerald-100/90">{exportResultPath}</div>
                    {exportSkippedFiles.length > 0 && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-white/70">
                        <div className="mb-1 font-semibold text-white/80">
                          ({exportSkippedFiles.length})
                        </div>
                        <div className="custom-scrollbar max-h-20 overflow-y-auto">
                          {exportSkippedFiles.slice(0, 80).map((p) => (
                            <div key={p} className="truncate">{p}</div>
                          ))}
                          {exportSkippedFiles.length > 80 && (
                            <div className="text-white/50">
                              {`… +${exportSkippedFiles.length - 80}`}
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

      <ScreenshotsModal
        language={language}
        profileId={selectedProfileId}
        open={isScreenshotsOpen}
        onClose={() => setIsScreenshotsOpen(false)}
        showNotification={showNotification}
      />
    </div>
  );
}

export default ModpackTab;