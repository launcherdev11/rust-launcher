import type { NotificationKind } from "../../app/notifications";
import type { ReorderableSidebarId } from "../../app/sidebar";
import type { LoaderId, Settings, SettingsTabId } from "../../app/types";
import type { Language } from "../../i18n";

export type SidebarItemId = ReorderableSidebarId;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up-to-date"
  | "error";

export type SettingsTabProps = {
  settings: Settings | null;
  settingsTab: SettingsTabId;
  setSettingsTab: (id: SettingsTabId) => void;
  systemMemoryGb: number;
  updateSettings: (patch: Partial<Settings>) => void;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean }) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  sidebarOrder: SidebarItemId[];
  setSidebarOrder: (order: SidebarItemId[]) => void;
  updateStatus?: UpdateStatus;
  updateVersion?: string | null;
  updateDownloadPercent?: number | null;
  onCheckUpdate?: () => void;
  onPreviewUpdatePopup?: () => void;
  onInstallUpdate?: () => void;
  fillPane?: boolean;
};


export type VersionListItem = {
  id: string;
  version_type: string;
  release_time: string;
  loader: LoaderId;
  url?: string;
  installer_url?: string;
};


export type VersionIntegrityCheckResult = {
  is_ok: boolean;
  checked_files: number;
  missing_files: number;
  corrupted_files: number;
};

export type LoaderVersionChannel = "stable" | "beta" | "alpha";

export type LoaderVersionOption = {
  version: string;
  channel?: LoaderVersionChannel | null;
};

export type VersionInstallDetails = {
  gameVersion: string;
  hasGameFiles: boolean;
  hasLoader: boolean;
  loaderVersions: string[];
  profileIds: string[];
  loaderVersionId: string | null;
};

export type VersionDeleteScope = "game" | "loader" | "all";


export type LauncherSettingsBackupV1 = {
  format_version: number;
  exported_at_ms: number;
  settings: Settings;
  java_settings: unknown;
  sidebar_order?: SidebarItemId[] | null;
};
