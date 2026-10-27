import type { useT } from "../i18n";

export type Profile = {
  nickname: string;
  ely_username: string | null;
  ely_uuid: string | null;
  ms_id_token: string | null;
  mc_uuid: string | null;
  mc_username: string | null;
};

export type LauncherAccountSummary = {
  id: string;
  label: string;
  kind: string;
  is_active: boolean;
};

export type SidebarItemId = "play" | "settings" | "friends" | "rooms" | "mods" | "modpacks" | "accounts";
export type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";

export type SettingsTabId = "game" | "versions" | "launcher";

export type Settings = {
  game_directory: string | null;
  ram_mb: number;
  graphics_adapter: string | null;
  show_console_on_launch: boolean;
  close_launcher_on_game_start: boolean;
  check_game_processes: boolean;
  resolution_width: number | null;
  resolution_height: number | null;
  show_snapshots: boolean;
  show_alpha_versions: boolean;
  forge_ipv6_download: boolean;
  forge_proxy_fallback: boolean;
  world_auto_backup?: boolean;
  notify_new_update: boolean;
  notify_new_message: boolean;
  notify_system_message: boolean;
  check_updates_on_start: boolean;
  auto_install_updates: boolean;
  open_launcher_on_profiles_tab: boolean;
  ui_sounds_enabled: boolean;
  discord_rpc_enabled: boolean;
  minimize_to_tray_on_close: boolean;
  autostart_enabled: boolean;
  animations_disabled: boolean;
  background_animation_disabled?: boolean;
  thematic_decorations_disabled?: boolean;
  interface_language?: string;
  background_accent_color: string;
  background_image_url: string | null;
  adaptive_accent_enabled?: boolean;
  background_blur_enabled: boolean;
  split_view_enabled: boolean;
  sidebar_position?: string;
  onboarding_completed?: boolean;
  custom_theme_id?: string | null;
  custom_theme_hot_reload?: boolean;
};

export type InstanceProfileSummary = {
  id: string;
  name: string;
  game_version: string;
  loader: string;
  loader_version?: string | null;
};

export type InstanceProfileCard = InstanceProfileSummary & {
  icon_path: string | null;
  created_at: number;
  play_time_seconds: number;
  last_played_at?: number | null;
  mods_count: number;
  resourcepacks_count: number;
  shaderpacks_count: number;
  total_size_bytes: number;
  directory: string;
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

export type NeoForgeVersionSummary = {
  id: string;
  mc_version: string;
  neoforge_build: string;
  installer_url: string;
};

export type VersionItem = VersionSummary | ForgeVersionSummary | NeoForgeVersionSummary;

export type DownloadProgressPayload = {
  version_id: string;
  downloaded: number;
  total: number;
  percent: number;
};

export type GameConsoleLinePayload = {
  line: string;
  source: "stdout" | "stderr";
};

export type GameConsoleLine = GameConsoleLinePayload & {
  id: number;
};

export type GameConsoleSession = {
  id: string;
  startedAt: number;
  endedAt?: number;
  lines: GameConsoleLine[];
};

export type ProfileConsoleData = {
  lines: GameConsoleLine[];
  sessions: GameConsoleSession[];
};

export type GameStatus = "idle" | "running" | "stopped" | "crashed";

export type Tt = ReturnType<typeof useT>;
