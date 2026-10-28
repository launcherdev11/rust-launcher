import type { DownloadJobKind } from "../../hooks/useDownloadJobs";
import type { ModpackHotkeyActions, ModpackNavigationActions } from "../../hooks/useHotkeys";
import type { Language } from "../../i18n";
import type { EditorSection as EditorSectionId } from "../../features/profile-editor/ManageEditorSections";

export type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";
export type LoaderVersionChannel = "stable" | "beta" | "alpha";
export type LoaderVersionOption = {
  version: string;
  channel?: LoaderVersionChannel | null;
};
export type NotificationKind = "info" | "success" | "error" | "warning";
export type Settings = {
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

export type InstanceProfile = {
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

export type ProfileBackupInfo = {
  id: string;
  profile_id: string;
  created_at: number;
  size_bytes: number;
  path: string;
  profile_name: string;
  kind?: ProfileBackupKind | null;
};

export type ProfileBackupKind = "auto" | "pre_update";

export type ProfileBackupSettings = {
  auto_backup: "off" | "daily" | "weekly";
  auto_backup_keep: number;
  backup_before_update: "off" | "ask" | "auto";
};

export type ExternalLauncherType =
  | "auto"
  | "multimc"
  | "prism_launcher"
  | "atlauncher"
  | "gdlauncher"
  | "curseforge"
  | "unknown";

export type ImportableExternalInstance = {
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

export type BuildPresetSettings = {
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

export type BuildPreset = {
  id: string;
  name: string;
  game_version: string;
  loader: string;
  loader_version?: string | null;
  settings?: BuildPresetSettings | null;
  created_at: number;
  icon_path?: string | null;
};

export type VersionSummary = {
  id: string;
  version_type: string;
  url: string;
  release_time: string;
};

export type ForgeVersionSummary = {
  id: string;
  mc_version: string;
  forge_build: string;
  installer_url: string;
};

export type GameConsoleLine = {
  id: number;
  line: string;
  source: "stdout" | "stderr";
};

export type GameConsoleSession = {
  id: string;
  startedAt: number;
  endedAt?: number;
  lines: GameConsoleLine[];
};

export type GameStatus = "idle" | "running" | "stopped" | "crashed";

export type ContinueTarget = {
  kind: "world" | "server";
  id: string;
  name: string;
  last_played: number | null;
};

export type ModpackTabProps = {
  language: Language;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean }) => void;
  onProfileSelectionChange?: (profile: InstanceProfile | null) => void;
  initialSelectedProfileId?: string | null;
  initialProfiles?: InstanceProfile[];
  onOpenModsTab?: () => void;
  onPlaySelectedProfile?: () => void;
  onContinueProfile?: (profile: InstanceProfile, target: ContinueTarget) => void;
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
  prepareInstallConsole?: (profileId?: string | null) => void;
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
  requestedProfileSettingsId?: string | null;
  onRequestedProfileSettingsApplied?: () => void;
  onManageConsoleExpandedChange?: (expanded: boolean) => void;
};

export type ViewId = "list" | "create" | "import" | "manage";
export type ContentTab = "mods" | "resourcepacks" | "shaderpacks";
export type EditorSection = EditorSectionId;
export type ContentFilter = "all" | "enabled" | "disabled" | "updates";
export type ProfileWorldInfo = {
  name: string;
  path: string;
  sizeBytes: number;
  lastPlayed: number | null;
};
export type ProfileDiskFolderUsage = {
  id: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  cleanable: boolean;
};
export type ProfileDiskUsage = {
  totalBytes: number;
  folders: ProfileDiskFolderUsage[];
};

export type ProfileItemEntry = {
  name: string;
  enabled: boolean;
};

export type ProfileItemMetadata = {
  filename: string;
  title?: string | null;
  iconUrl?: string | null;
  iconDataUri?: string | null;
  source?: string | null;
  projectId?: string | null;
};

export type LazyContentType = "mod" | "resourcepack" | "shader";

export type LazyModItem = {
  provider: "modrinth" | "curseforge";
  project_id: string;
  content_type: LazyContentType;
  title: string;
  icon_url?: string | null;
};

export type LazyModSet = {
  id: string;
  name: string;
  items: LazyModItem[];
  auto_apply: boolean;
  created_at: number;
};

export type LazyApplyReport = {
  installed: number;
  already_present: number;
  unavailable: string[];
  failed: { title: string; reason: string }[];
};

export type ProfileContentUpdate = {
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

export type ContentSnapshot = {
  id: string;
  category: "mods" | "resourcepacks" | "shaderpacks";
  createdAt: number;
  items: { oldName: string; newName?: string | null }[];
};

export type ProfileIncompatibleContent = {
  filename: string;
  enabled: boolean;
  title: string;
  projectId?: string | null;
};

export type FileNode = {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
  children?: FileNode[] | null;
};

export type PreviewFile = { path: string; size: number; source?: string };
export type PreviewResult = {
  files: PreviewFile[];
  total_bytes: number;
  download_bytes?: number;
  resolved_count?: number;
  override_count?: number;
};
export type ExportProgressPayload = { bytes_written: number; total_bytes: number; current_file: string };
export type ExportFinishedPayload = {
  path: string;
  skipped_files: string[];
  resolved_count?: number;
  override_count?: number;
};
export type ExportErrorPayload = { message: string };

export type PlaytimeUpdatedPayload = {
  profile_id: string;
  delta_seconds: number;
  total_seconds?: number;
};
export type LastPlayedUpdatedPayload = { profile_id: string; last_played_at: number };

export type IconProps = {
  className?: string;
};
