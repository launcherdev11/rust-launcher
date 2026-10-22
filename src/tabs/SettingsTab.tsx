import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { subscribeTauriEvent } from "../lib/tauriEvents";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { InputClearButton } from "../components/ui";
import { AssetIcon } from "../components/asset_icon";
import {
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitchRow,
} from "../settings-ui/SettingsComponents";
import { JavaSettingsTab } from "./JavaSettings";
import { clearLauncherAvatarCache } from "../lib/avatar";
import { localeTag, useT, SUPPORTED_LANGUAGES, type Language } from "../i18n";
import { playTabSwitchSound } from "../uiSounds";
import { isVersionInstallConsoleLine } from "../lib/gameConsoleFilter";
import { isSeasonalThemePeriod } from "../lib/seasonalTheme";
import { errorMessage, type ThemeInfo } from "../lib/customTheme";
import { ThemeCard } from "../features/theme-editor/ThemeCard";
import { ThemeEditorPanel } from "../features/theme-editor/ThemeEditorPanel";


type SettingsTabId = "game" | "versions" | "launcher";

type SettingSearchId =
  | "game.showConsole"
  | "game.graphicsAdapter"
  | "game.closeLauncher"
  | "game.checkProcesses"
  | "game.gameDirectory"
  | "game.windowSize"
  | "game.ram"
  | "game.java"
  | "versions.showSnapshots"
  | "versions.showAlpha"
  | "versions.forgeProxy"
  | "versions.loaderFilter"
  | "versions.versionFilter"
  | "versions.available"
  | "launcher.updates"
  | "launcher.openOnProfiles"
  | "launcher.uiSounds"
  | "launcher.discordRpc"
  | "launcher.minimizeToTray"
  | "launcher.autostart"
  | "launcher.splitView"
  | "launcher.disableAnimations"
  | "launcher.backgroundAnimation"
  | "launcher.hideBanners"
  | "launcher.disableThematicDecorations"
  | "launcher.language"
  | "launcher.accentColor"
  | "launcher.backgroundImage"
  | "launcher.backgroundBlur"
  | "launcher.customThemes"
  | "launcher.sidebarPosition"
  | "launcher.sidebarOrder"
  | "launcher.resetSettings"
  | "launcher.cache"
  | "launcher.backup";

type SettingSearchDef = {
  id: SettingSearchId;
  tab: SettingsTabId;
  keys: string[];
};

const SETTING_SEARCH_CATALOG: SettingSearchDef[] = [
  {
    id: "game.showConsole",
    tab: "game",
    keys: ["settings.game.showConsoleOnLaunch.label"],
  },
  {
    id: "game.graphicsAdapter",
    tab: "game",
    keys: [
      "settings.section.display",
      "settings.game.graphicsAdapter.label",
      "settings.game.graphicsAdapter.hint",
    ],
  },
  {
    id: "game.closeLauncher",
    tab: "game",
    keys: ["settings.game.closeLauncherOnStart.label"],
  },
  {
    id: "game.checkProcesses",
    tab: "game",
    keys: ["settings.game.checkGameProcesses.label"],
  },
  {
    id: "game.gameDirectory",
    tab: "game",
    keys: [
      "settings.game.gameDirectory.label",
      "settings.game.gameDirectory.hint",
      "settings.game.gameDirectory.defaultPathHint",
    ],
  },
  {
    id: "game.windowSize",
    tab: "game",
    keys: ["settings.section.display", "settings.game.windowSize.label"],
  },
  {
    id: "game.ram",
    tab: "game",
    keys: ["settings.section.java", "settings.game.ram.label", "settings.game.subtab.java"],
  },
  {
    id: "game.java",
    tab: "game",
    keys: [
      "settings.section.java",
      "settings.game.subtab.java",
      "javaSettings.description",
      "javaSettings.useCustomArgs.label",
      "javaSettings.preferIpv6.label",
      "javaSettings.javaPath.label",
      "javaSettings.memory.title",
      "javaSettings.jvmArgs.title",
      "javaSettings.actions.verify",
      "javaSettings.actions.reinstall",
    ],
  },
  {
    id: "versions.showSnapshots",
    tab: "versions",
    keys: [
      "settings.section.versionList",
      "settings.versions.showSnapshots.label",
      "settings.tab.versions",
    ],
  },
  {
    id: "versions.showAlpha",
    tab: "versions",
    keys: ["settings.section.versionList", "settings.versions.showAlpha.label"],
  },
  {
    id: "versions.forgeProxy",
    tab: "versions",
    keys: ["settings.section.versionList", "settings.versions.forgeProxyFallback.label"],
  },
  {
    id: "versions.loaderFilter",
    tab: "versions",
    keys: ["settings.versions.loaderFilter.label"],
  },
  {
    id: "versions.versionFilter",
    tab: "versions",
    keys: ["settings.versions.versionFilter.label"],
  },
  {
    id: "versions.available",
    tab: "versions",
    keys: ["settings.versions.available.label", "settings.card.versions"],
  },
  {
    id: "launcher.updates",
    tab: "launcher",
    keys: [
      "settings.card.updates",
      "settings.updates.checkOnStart.label",
      "settings.updates.autoInstall.label",
      "settings.updates.checkNow",
    ],
  },
  {
    id: "launcher.openOnProfiles",
    tab: "launcher",
    keys: [
      "settings.section.behavior",
      "settings.launcher.openOnProfilesTab.label",
      "settings.card.customization",
    ],
  },
  {
    id: "launcher.uiSounds",
    tab: "launcher",
    keys: ["settings.section.behavior", "settings.launcher.uiSounds.label"],
  },
  {
    id: "launcher.discordRpc",
    tab: "launcher",
    keys: [
      "settings.section.behavior",
      "settings.launcher.discordRpc.label",
      "settings.launcher.discordRpc.hint",
    ],
  },
  {
    id: "launcher.minimizeToTray",
    tab: "launcher",
    keys: ["settings.section.behavior", "settings.launcher.minimizeToTray.label"],
  },
  {
    id: "launcher.autostart",
    tab: "launcher",
    keys: ["settings.section.behavior", "settings.launcher.autostart.label"],
  },
  {
    id: "launcher.splitView",
    tab: "launcher",
    keys: [
      "settings.section.behavior",
      "settings.launcher.splitView.label",
      "settings.launcher.splitView.hint",
    ],
  },
  {
    id: "launcher.disableAnimations",
    tab: "launcher",
    keys: ["settings.section.appearance", "settings.launcher.disableAnimations.label"],
  },
  {
    id: "launcher.backgroundAnimation",
    tab: "launcher",
    keys: [
      "settings.section.appearance",
      "settings.launcher.backgroundAnimation.label",
      "settings.launcher.backgroundAnimation.hint",
    ],
  },
  {
    id: "launcher.hideBanners",
    tab: "launcher",
    keys: [
      "settings.section.appearance",
      "settings.launcher.hideBanners.label",
      "settings.launcher.hideBanners.hint",
    ],
  },
  {
    id: "launcher.disableThematicDecorations",
    tab: "launcher",
    keys: [
      "settings.section.appearance",
      "settings.launcher.disableThematicDecorations.label",
      "settings.launcher.disableThematicDecorations.hint",
    ],
  },
  {
    id: "launcher.language",
    tab: "launcher",
    keys: [
      "settings.section.interface",
      "settings.launcher.interfaceLanguage.label",
      "settings.card.interfaceLanguage",
    ],
  },
  {
    id: "launcher.accentColor",
    tab: "launcher",
    keys: ["settings.section.appearance", "settings.launcher.accentColor.label"],
  },
  {
    id: "launcher.backgroundImage",
    tab: "launcher",
    keys: [
      "settings.section.appearance",
      "settings.launcher.backgroundImage.label",
      "settings.launcher.backgroundImage.hint",
    ],
  },
  {
    id: "launcher.backgroundBlur",
    tab: "launcher",
    keys: ["settings.section.appearance", "settings.launcher.backgroundBlur.label"],
  },
  {
    id: "launcher.customThemes",
    tab: "launcher",
    keys: [
      "settings.section.themes",
      "settings.launcher.customThemes.label",
      "settings.launcher.customThemes.default",
      "settings.launcher.customThemes.importZip",
      "settings.launcher.customThemes.create",
      "settings.launcher.customThemes.openFolder",
      "settings.launcher.customThemes.editCss",
      "settings.launcher.customThemes.delete",
      "settings.launcher.customThemes.openEditor",
      "settings.launcher.customThemes.duplicate",
      "settings.launcher.customThemes.exportZip",
      "settings.launcher.customThemes.hotReload.label",
    ],
  },
  {
    id: "launcher.sidebarPosition",
    tab: "launcher",
    keys: ["settings.section.interface", "settings.launcher.sidebarPosition.label"],
  },
  {
    id: "launcher.sidebarOrder",
    tab: "launcher",
    keys: ["settings.section.interface", "settings.launcher.sidebarOrder.label"],
  },
  {
    id: "launcher.resetSettings",
    tab: "launcher",
    keys: ["settings.section.data", "settings.launcher.resetSettings.button"],
  },
  {
    id: "launcher.cache",
    tab: "launcher",
    keys: [
      "settings.section.data",
      "settings.launcher.cache.label",
      "settings.launcher.cache.description",
    ],
  },
  {
    id: "launcher.backup",
    tab: "launcher",
    keys: [
      "settings.section.data",
      "settings.launcher.backup.title",
      "settings.launcher.backup.exportButton",
      "settings.launcher.backup.importButton",
      "settings.launcher.backup.hint",
    ],
  },
];

type SidebarItemId = "play" | "settings" | "mods" | "modpacks";

type Settings = {
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
  show_launcher_banners?: boolean;
  interface_language?: string;
  background_accent_color: string;
  background_image_url: string | null;
  background_blur_enabled: boolean;
  split_view_enabled: boolean;
  sidebar_position?: string;
  custom_theme_id?: string | null;
  custom_theme_hot_reload?: boolean;
};

const SIDEBAR_POSITIONS = ["left", "right", "top", "bottom"] as const;
type SidebarPosition = (typeof SIDEBAR_POSITIONS)[number];

function parseSidebarPosition(value: string | undefined | null): SidebarPosition {
  if (value && SIDEBAR_POSITIONS.includes(value as SidebarPosition)) {
    return value as SidebarPosition;
  }
  return "left";
}

type NotificationKind = "info" | "success" | "error" | "warning";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up-to-date"
  | "error";

type SettingsTabProps = {
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

type NeoForgeVersionSummary = {
  id: string;
  mc_version: string;
  neoforge_build: string;
  installer_url: string;
};

type LoaderId = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

type VersionListItem = {
  id: string;
  version_type: string;
  release_time: string;
  loader: LoaderId;
  url?: string;
  installer_url?: string;
};

type DownloadProgressPayload = {
  version_id: string;
  downloaded: number;
  total: number;
  percent: number;
};

type VersionIntegrityCheckResult = {
  is_ok: boolean;
  checked_files: number;
  missing_files: number;
  corrupted_files: number;
};

type LoaderVersionChannel = "stable" | "beta" | "alpha";

type LoaderVersionOption = {
  version: string;
  channel?: LoaderVersionChannel | null;
};

type VersionInstallDetails = {
  gameVersion: string;
  hasGameFiles: boolean;
  hasLoader: boolean;
  loaderVersions: string[];
  profileIds: string[];
  loaderVersionId: string | null;
};

type VersionDeleteScope = "game" | "loader" | "all";

function gameVersionFromListItem(version: VersionListItem): string {
  if (version.loader === "forge") {
    const m = /^(.+)-forge-/.exec(version.id);
    return m?.[1] ?? version.id;
  }
  if (version.loader === "neoforge") {
    const m = /^(.+)-neoforge-/.exec(version.id);
    return m?.[1] ?? version.id;
  }
  return version.id;
}

type LauncherSettingsBackupV1 = {
  format_version: number;
  exported_at_ms: number;
  settings: Settings;
  java_settings: unknown;
  sidebar_order?: SidebarItemId[] | null;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, v: v * 100 };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  v = Math.max(0, Math.min(100, v)) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function hexWithHueFromWheel(baseHex: string, hueDeg: number): string {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return baseHex;
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const next = hsvToRgb(hueDeg, hsv.s, hsv.v);
  return rgbToHex(next.r, next.g, next.b);
}

function hueDegFromWheelClientPos(el: HTMLElement, clientX: number, clientY: number): number | null {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 4) return null;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (angleDeg + 90 + 360) % 360;
}

const ACCENT_PRESETS = [
  "#4a22a8",
  "#7c3aed",
  "#c026d3",
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
];

const ACCENT_HUE_RING_STYLE: CSSProperties = {
  backgroundImage: `conic-gradient(from 0deg, ${Array.from({ length: 72 }, (_, i) => {
    const h = (i * 360) / 72;
    return `hsl(${h} 95% 52%)`;
  }).join(", ")})`,
};

export function SettingsTab({
  settings,
  settingsTab,
  setSettingsTab,
  systemMemoryGb,
  updateSettings,
  showNotification,
  language,
  setLanguage,
  sidebarOrder,
  setSidebarOrder,
  updateStatus = "idle",
  updateVersion = null,
  updateDownloadPercent = null,
  onCheckUpdate,
  onPreviewUpdatePopup,
  onInstallUpdate,
  fillPane = false,
}: SettingsTabProps) {
  const tt = useT(language);
  const [settingsSearch, setSettingsSearch] = useState("");
  const [installedThemes, setInstalledThemes] = useState<ThemeInfo[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [isRamEditing, setIsRamEditing] = useState(false);
  const [ramInputMb, setRamInputMb] = useState("");
  const ramInputRef = useRef<HTMLInputElement | null>(null);

  const [availableVersions, setAvailableVersions] = useState<VersionListItem[] | null>(null);
  const [installedVersions, setInstalledVersions] = useState<string[]>([]);
  const [installedFabricGameVersions, setInstalledFabricGameVersions] = useState<string[]>([]);
  const [installedQuiltGameVersions, setInstalledQuiltGameVersions] = useState<string[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [installingVersionId, setInstallingVersionId] = useState<string | null>(null);
  const [checkingVersionId, setCheckingVersionId] = useState<string | null>(null);
  const [versionsLoader, setVersionsLoader] = useState<LoaderId>("vanilla");
  const [isVersionFilterDropdownOpen, setIsVersionFilterDropdownOpen] = useState(false);
  const [versionFilterQuery, setVersionFilterQuery] = useState("");
  const [selectedVersionFilterId, setSelectedVersionFilterId] = useState<string | null>(null);
  const [repairPrompt, setRepairPrompt] = useState<{
    version: VersionListItem;
    result: VersionIntegrityCheckResult;
  } | null>(null);
  const [reinstallDialog, setReinstallDialog] = useState<{
    version: VersionListItem;
    gameVersion: string;
    selectedLoaderVersion: string;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    version: VersionListItem;
    details: VersionInstallDetails;
  } | null>(null);
  const [simpleDeleteDialog, setSimpleDeleteDialog] = useState<{
    version: VersionListItem;
    scope: VersionDeleteScope;
    targetLabel: string;
  } | null>(null);
  const [reinstallLoaderOptions, setReinstallLoaderOptions] = useState<LoaderVersionOption[]>([]);
  const [reinstallLoaderLoading, setReinstallLoaderLoading] = useState(false);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const [skipRepairPrompt, setSkipRepairPrompt] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("skip_version_repair_prompt") === "1";
    } catch {
      return false;
    }
  });
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgressPayload>>(
    {},
  );
  const [installLogLines, setInstallLogLines] = useState<
    { line: string; source: "stdout" | "stderr" }[]
  >([]);
  const installLogEndRef = useRef<HTMLDivElement | null>(null);
  const settingsTabRefs = useRef<
    Partial<Record<SettingsTabId, HTMLButtonElement | null>>
  >({});
  const [settingsIndicator, setSettingsIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const [accentInput, setAccentInput] = useState<string>("");
  const [isAccentPickerOpen, setIsAccentPickerOpen] = useState(false);
  const accentHueWheelRef = useRef<HTMLDivElement | null>(null);
  const accentHueDragBaseRef = useRef<string | null>(null);
  const accentSvPadRef = useRef<HTMLDivElement | null>(null);
  const accentSvDragHueRef = useRef<number | null>(null);
  const [cacheSizeBytes, setCacheSizeBytes] = useState<number | null>(null);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [isResettingSettings, setIsResettingSettings] = useState(false);
  const accentPickerRef = useRef<HTMLDivElement | null>(null);
  const versionsFilterDropdownRef = useRef<HTMLDivElement | null>(null);
  const versionFilterInputRef = useRef<HTMLInputElement | null>(null);
  const versionFilterListRef = useRef<HTMLDivElement | null>(null);
  const selectedVersionFilterButtonRef = useRef<HTMLButtonElement | null>(null);

  const versionFilterOptions = useMemo(() => {
    if (!availableVersions) return [];
    const q = versionFilterQuery.trim().toLowerCase();
    if (!q) return availableVersions;
    return availableVersions.filter((v) => v.id.toLowerCase().includes(q));
  }, [availableVersions, versionFilterQuery]);

  const selectedVersionFilterLabel = useMemo(() => {
    if (!selectedVersionFilterId) return tt("settings.versions.versionFilter.all");
    return selectedVersionFilterId;
  }, [selectedVersionFilterId, tt]);

  const filteredAvailableVersions = useMemo(() => {
    if (!availableVersions) return [];
    if (!selectedVersionFilterId) return availableVersions;
    return availableVersions.filter((v) => v.id === selectedVersionFilterId);
  }, [availableVersions, selectedVersionFilterId]);

  useLayoutEffect(() => {
    let raf = 0;
    let cancelled = false;

    const updateIndicator = () => {
      if (cancelled) return;
      const el = settingsTabRefs.current[settingsTab];
      if (el) {
        setSettingsIndicator({
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
  }, [settingsTab, settingsSearch, language]);


  useEffect(() => {
    const current = settings?.background_accent_color ?? "#4a22a8";
    setAccentInput(current);
  }, [settings?.background_accent_color]);

  const refreshThemes = useCallback(async () => {
    setThemesLoading(true);
    try {
      const list = await invoke<ThemeInfo[]>("list_themes");
      setInstalledThemes(list);
    } catch (e) {
      console.error(e);
    } finally {
      setThemesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settingsTab === "launcher") {
      void refreshThemes();
    }
  }, [settingsTab, refreshThemes]);

  const activeThemeId = settings?.custom_theme_id ?? null;
  const activeTheme = useMemo(
    () => installedThemes.find((theme) => theme.id === activeThemeId) ?? null,
    [installedThemes, activeThemeId],
  );

  const accentColorHsv = useMemo(() => {
    const c = settings?.background_accent_color ?? "#4a22a8";
    const rgb = hexToRgb(c);
    if (!rgb) return { h: 0, s: 0, v: 0 };
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  }, [settings?.background_accent_color]);

  const applyAccentHueFromPointer = (clientX: number, clientY: number) => {
    const el = accentHueWheelRef.current;
    if (!el) return;
    const hue = hueDegFromWheelClientPos(el, clientX, clientY);
    if (hue === null) return;
    const base =
      accentHueDragBaseRef.current ?? settings?.background_accent_color ?? "#4a22a8";
    const next = hexWithHueFromWheel(base, hue);
    setAccentInput(next);
    updateSettings({ background_accent_color: next });
  };

  const handleAccentWheelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    accentHueDragBaseRef.current = settings?.background_accent_color ?? "#4a22a8";
    e.currentTarget.setPointerCapture(e.pointerId);
    applyAccentHueFromPointer(e.clientX, e.clientY);
  };

  const handleAccentWheelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyAccentHueFromPointer(e.clientX, e.clientY);
  };

  const handleAccentWheelPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    accentHueDragBaseRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
    }
  };

  const applyAccentSvFromPointer = (clientX: number, clientY: number) => {
    const el = accentSvPadRef.current;
    if (!el) return;
    const h =
      accentSvDragHueRef.current !== null
        ? accentSvDragHueRef.current
        : accentColorHsv.h;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const s = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const v = Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100));
    const next = hsvToRgb(h, s, v);
    const hex = rgbToHex(next.r, next.g, next.b);
    setAccentInput(hex);
    updateSettings({ background_accent_color: hex });
  };

  const handleAccentSvPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const c = settings?.background_accent_color ?? "#4a22a8";
    const rgb = hexToRgb(c);
    accentSvDragHueRef.current = rgb ? rgbToHsv(rgb.r, rgb.g, rgb.b).h : accentColorHsv.h;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyAccentSvFromPointer(e.clientX, e.clientY);
  };

  const handleAccentSvPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyAccentSvFromPointer(e.clientX, e.clientY);
  };

  const handleAccentSvPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    accentSvDragHueRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
    }
  };

  useEffect(() => {
    if (settingsTab !== "launcher") return;
    let cancelled = false;
    setIsCacheLoading(true);
    invoke<number>("get_launcher_cache_size")
      .then((bytes) => {
        if (!cancelled) {
          setCacheSizeBytes(bytes);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCacheSizeBytes(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCacheLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settingsTab, language]);

  const currentRamMb = settings?.ram_mb ?? 4096;
  const currentRamGbRounded = Math.max(1, Math.round(currentRamMb / 1024));
  const ramMinMb = 1024;
  const ramMaxMb = systemMemoryGb * 1024; 
  const ramSliderMaxGb = systemMemoryGb;

  const [ramSliderLocal, setRamSliderLocal] = useState<number | null>(null);
  const displayRamGb = ramSliderLocal ?? currentRamGbRounded;

  useEffect(() => {
    if (!isRamEditing) {
      setRamInputMb(String(currentRamMb));
    }
  }, [currentRamMb, isRamEditing]);

  useEffect(() => {
    setRamSliderLocal(null);
  }, [currentRamMb]);

  useEffect(() => {
    if (isRamEditing) {
      ramInputRef.current?.focus();
      ramInputRef.current?.select();
    }
  }, [isRamEditing]);

  const loadInstalledVersions = async () => {
    const ids = await invoke<string[]>("list_installed_versions");
    setInstalledVersions(ids);
    try {
      const fabric = await invoke<string[]>("list_installed_fabric_game_versions");
      setInstalledFabricGameVersions(fabric ?? []);
    } catch {
      setInstalledFabricGameVersions([]);
    }
    try {
      const quilt = await invoke<string[]>("list_installed_quilt_game_versions");
      setInstalledQuiltGameVersions(quilt ?? []);
    } catch {
      setInstalledQuiltGameVersions([]);
    }
  };

  const loadAvailableByLoader = async (loader: LoaderId): Promise<VersionListItem[]> => {
    if (loader === "forge") {
      const result = await invoke<ForgeVersionSummary[]>("fetch_forge_versions");
      return result.map((v) => ({
        id: v.id,
        version_type: "forge",
        release_time: "",
        installer_url: v.installer_url,
        loader: "forge",
      }));
    }
    if (loader === "neoforge") {
      const result = await invoke<NeoForgeVersionSummary[]>("fetch_neoforge_versions");
      return result.map((v) => ({
        id: v.id,
        version_type: "neoforge",
        release_time: "",
        installer_url: v.installer_url,
        loader: "neoforge",
      }));
    }

    const filtered = await invoke<VersionSummary[]>("fetch_versions_for_loader", {
      loader,
      showSnapshots: settings?.show_snapshots ?? false,
      showAlpha: settings?.show_alpha_versions ?? false,
    });
    return filtered.map((v) => ({ ...v, loader }));
  };

  useEffect(() => {
    let isMounted = true;
    const refreshAvailable = async () => {
      if (settingsTab !== "versions") return;
      setIsLoadingVersions(true);
      try {
        const [available] = await Promise.all([
          loadAvailableByLoader(versionsLoader),
          loadInstalledVersions(),
        ]);
        if (!isMounted) return;
        setAvailableVersions(available);
      } catch (e) {
        console.error("Failed to load versions list:", e);
        if (isMounted) {
          showNotification("error", tt("settings.versions.loadFailed"));
        }
      } finally {
        if (isMounted) {
          setIsLoadingVersions(false);
        }
      }
    };
    void refreshAvailable();
    return () => {
      isMounted = false;
    };
  }, [settingsTab, settings?.show_snapshots, settings?.show_alpha_versions, versionsLoader, language]);

  useEffect(() => {
    setSelectedVersionFilterId(null);
    setVersionFilterQuery("");
    setIsVersionFilterDropdownOpen(false);
  }, [versionsLoader]);

  useEffect(() => {
    if (!isVersionFilterDropdownOpen) return;
    requestAnimationFrame(() => {
      try {
        versionFilterInputRef.current?.focus({ preventScroll: true });
      } catch {
        versionFilterInputRef.current?.focus();
      }
      const container = versionFilterListRef.current;
      const selectedButton = selectedVersionFilterButtonRef.current;
      if (!container || !selectedButton) return;
      const cRect = container.getBoundingClientRect();
      const iRect = selectedButton.getBoundingClientRect();
      const centerOffset = (iRect.top - cRect.top) - (cRect.height / 2 - iRect.height / 2);
      container.scrollTop = Math.max(0, Math.min(container.scrollHeight, container.scrollTop + centerOffset));
    });
  }, [isVersionFilterDropdownOpen, versionFilterOptions.length]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        versionsFilterDropdownRef.current &&
        !versionsFilterDropdownRef.current.contains(target)
      ) {
        setIsVersionFilterDropdownOpen(false);
      }
      if (accentPickerRef.current && !accentPickerRef.current.contains(target)) {
        setIsAccentPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    return subscribeTauriEvent<DownloadProgressPayload>("download-progress", (event) => {
      const payload = event.payload;
      setDownloadProgress((prev) => ({
        ...prev,
        [payload.version_id]: payload,
      }));
    });
  }, []);

  useEffect(() => {
    if (!installingVersionId) {
      setInstallLogLines([]);
      return;
    }

    return subscribeTauriEvent<{ line: string; source?: string }>("game-console-line", (event) => {
      const payload = event.payload;
      const text =
        typeof payload === "string"
          ? payload
          : typeof payload.line === "string"
            ? payload.line
            : "";
      if (!text || !isVersionInstallConsoleLine(text)) return;
      const source: "stdout" | "stderr" =
        typeof payload === "string"
          ? "stdout"
          : payload.source === "stderr"
            ? "stderr"
            : "stdout";
      setInstallLogLines((prev) => [...prev.slice(-199), { line: text, source }]);
    });
  }, [installingVersionId]);

  useEffect(() => {
    if (!installingVersionId) return;
    installLogEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [installLogLines, installingVersionId]);

  const handleImportCustomVersion = async () => {
    try {
      const jsonPath = await openFile({
        multiple: false,
        filters: [{ name: "Minecraft version JSON", extensions: ["json"] }],
      });
      if (!jsonPath || typeof jsonPath !== "string") return;

      const wantJar = window.confirm(tt("settings.versions.custom.importJarPrompt"));
      let jarPath: string | null = null;
      if (wantJar) {
        const picked = await openFile({
          multiple: false,
          filters: [{ name: "Minecraft client JAR", extensions: ["jar"] }],
        });
        if (picked && typeof picked === "string") {
          jarPath = picked;
        }
      }

      const versionId = await invoke<string>("import_custom_version", {
        jsonPath,
        jarPath,
      });
      showNotification(
        "success",
        tt("settings.versions.custom.importSuccess", { version: versionId }),
        { sound: true },
      );
      const [available] = await Promise.all([
        loadAvailableByLoader(versionsLoader),
        loadInstalledVersions(),
      ]);
      setAvailableVersions(available);
    } catch (e) {
      console.error("Failed to import custom version:", e);
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("settings.versions.custom.importFailed", { msg }));
    }
  };

  const loadReinstallLoaderOptions = useCallback(
    async (version: VersionListItem, gameVersion: string) => {
      if (version.loader === "vanilla") {
        setReinstallLoaderOptions([]);
        return;
      }
      setReinstallLoaderLoading(true);
      try {
        let options: LoaderVersionOption[] = [];
        if (version.loader === "fabric") {
          options = await invoke<LoaderVersionOption[]>("fetch_fabric_loaders", {
            gameVersion,
          });
        } else if (version.loader === "quilt") {
          options = await invoke<LoaderVersionOption[]>("fetch_quilt_loaders", {
            gameVersion,
          });
        } else if (version.loader === "forge") {
          options = await invoke<LoaderVersionOption[]>("fetch_forge_builds_for_game", {
            gameVersion,
          });
        } else if (version.loader === "neoforge") {
          options = await invoke<LoaderVersionOption[]>("fetch_neoforge_builds_for_game", {
            gameVersion,
          });
        }
        setReinstallLoaderOptions(options);
      } catch (e) {
        console.error("Failed to load loader versions:", e);
        setReinstallLoaderOptions([]);
      } finally {
        setReinstallLoaderLoading(false);
      }
    },
    [],
  );

  const handleInstallVersion = async (
    version: VersionListItem,
    options?: { silentSuccess?: boolean; loaderVersion?: string },
  ) => {
    try {
      setInstallingVersionId(version.id);
      setInstallLogLines([]);
      const pickedLoader = options?.loaderVersion?.trim() || null;
      if (version.loader === "forge") {
        const gameVersion = gameVersionFromListItem(version);
        let versionId = version.id;
        let installerUrl = version.installer_url;
        if (pickedLoader) {
          const builds = await invoke<ForgeVersionSummary[]>("fetch_forge_versions");
          const match = builds.find(
            (v) => v.mc_version === gameVersion && v.forge_build === pickedLoader,
          );
          versionId = match?.id ?? `${gameVersion}-forge-${pickedLoader}`;
          installerUrl =
            match?.installer_url ??
            `https://forgemvn.lumintomc.ru/net/minecraftforge/forge/${gameVersion}-${pickedLoader}/forge-${gameVersion}-${pickedLoader}-installer.jar`;
        }
        if (!installerUrl) throw new Error("Missing Forge installer URL");
        await invoke("install_forge", {
          versionId,
          installerUrl,
        });
      } else if (version.loader === "neoforge") {
        const gameVersion = gameVersionFromListItem(version);
        const versionId = pickedLoader
          ? `${gameVersion}-neoforge-${pickedLoader}`
          : version.id;
        await invoke("install_neoforge", {
          versionId,
        });
      } else if (version.loader === "fabric") {
        let loaderVersion = pickedLoader;
        if (!loaderVersion) {
          const loaders = await invoke<LoaderVersionOption[]>("fetch_fabric_loaders", {
            gameVersion: version.id,
          });
          loaderVersion = loaders[0]?.version;
        }
        if (!loaderVersion) throw new Error("No suitable Fabric loader");
        await invoke("install_fabric", {
          gameVersion: version.id,
          loaderVersion,
        });
      } else if (version.loader === "quilt") {
        await invoke("install_quilt", {
          gameVersion: version.id,
          loaderVersion: pickedLoader,
        });
      } else if (version.version_type === "custom" || !version.url) {
        await invoke("install_local_version", { versionId: version.id });
      } else {
        await invoke("install_version", {
          versionId: version.id,
          versionUrl: version.url,
        });
      }
      if (!options?.silentSuccess) {
        showNotification(
          "success",
          tt("settings.versions.installSuccess", { version: version.id }),
          { sound: true },
        );
      }
      await loadInstalledVersions();
    } catch (e) {
      console.error("Failed to install version:", e);
      showNotification(
        "error",
        tt("settings.versions.installFailed", { version: version.id }),
      );
    } finally {
      setInstallingVersionId(null);
    }
  };

  const handleCheckVersionFiles = async (version: VersionListItem) => {
    try {
      setCheckingVersionId(version.id);
      const result = await invoke<VersionIntegrityCheckResult>("check_version_files_integrity", {
        versionId: version.id,
        versionUrl: version.url || null,
      });
      if (result.is_ok) {
        showNotification(
          "success",
          tt("settings.versions.verify.ok", { version: version.id }),
          { sound: true },
        );
        return;
      }

      if (skipRepairPrompt) {
        await handleInstallVersion(version, { silentSuccess: true });
        showNotification(
          "warning",
          tt("settings.versions.verify.rewritten", { version: version.id }),
          { sound: true },
        );
        return;
      }

      setRepairPrompt({ version, result });
    } catch (e) {
      console.error("Failed to verify version files:", e);
      showNotification(
        "error",
        tt("settings.versions.verify.failed", { version: version.id }),
      );
    } finally {
      setCheckingVersionId(null);
    }
  };

  const openReinstallDialog = async (version: VersionListItem) => {
    if (version.loader === "vanilla") {
      void handleInstallVersion(version);
      return;
    }
    const gameVersion = gameVersionFromListItem(version);
    let selectedLoaderVersion = "";
    try {
      const details = await invoke<VersionInstallDetails>("get_version_install_details", {
        loader: version.loader,
        itemId: version.id,
      });
      selectedLoaderVersion = details.loaderVersions[0] ?? "";
    } catch {
      //ignore
    }
    setReinstallDialog({ version, gameVersion, selectedLoaderVersion });
    void loadReinstallLoaderOptions(version, gameVersion);
  };

  useEffect(() => {
    if (!reinstallDialog || reinstallLoaderLoading || reinstallLoaderOptions.length === 0) {
      return;
    }
    if (reinstallDialog.selectedLoaderVersion) return;
    const first = reinstallLoaderOptions[0]?.version;
    if (!first) return;
    setReinstallDialog((prev) => (prev ? { ...prev, selectedLoaderVersion: first } : null));
  }, [reinstallDialog, reinstallLoaderLoading, reinstallLoaderOptions]);

  const confirmReinstall = async () => {
    if (!reinstallDialog) return;
    const { version, selectedLoaderVersion } = reinstallDialog;
    const loaderVersion = selectedLoaderVersion.trim();
    if (!loaderVersion) {
      showNotification("error", tt("settings.versions.manage.loaderRequired"));
      return;
    }
    setReinstallDialog(null);
    try {
      if (version.loader !== "vanilla") {
        const details = await invoke<VersionInstallDetails>("get_version_install_details", {
          loader: version.loader,
          itemId: version.id,
        });
        const changingLoader =
          details.hasLoader &&
          details.loaderVersions.length > 0 &&
          !details.loaderVersions.includes(loaderVersion);
        if (changingLoader) {
          await invoke("delete_minecraft_installation", {
            loader: version.loader,
            itemId: version.id,
            scope: "loader" as VersionDeleteScope,
          });
        }
      }
      await handleInstallVersion(version, { loaderVersion });
    } catch (e) {
      console.error("Failed to reinstall version:", e);
    }
  };

  const performDelete = async (
    version: VersionListItem,
    scope: VersionDeleteScope,
    targetLabel: string,
  ) => {
    try {
      setDeletingVersionId(version.id);
      await invoke("delete_minecraft_installation", {
        loader: version.loader,
        itemId: version.id,
        scope,
      });
      showNotification(
        "success",
        tt("settings.versions.delete.success", { target: targetLabel }),
        { sound: true },
      );
      await loadInstalledVersions();
      const available = await loadAvailableByLoader(versionsLoader);
      setAvailableVersions(available);
    } catch (e) {
      console.error("Failed to delete version:", e);
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("settings.versions.delete.failed", { msg }));
    } finally {
      setDeletingVersionId(null);
    }
  };

  const openDeleteFlow = async (version: VersionListItem) => {
    try {
      const details = await invoke<VersionInstallDetails>("get_version_install_details", {
        loader: version.loader,
        itemId: version.id,
      });
      if (!details.hasGameFiles && !details.hasLoader) {
        showNotification(
          "warning",
          tt("settings.versions.delete.simplePrompt", { version: version.id }),
        );
        return;
      }
      const needsChoice =
        version.loader !== "vanilla" && details.hasGameFiles && details.hasLoader;
      if (!needsChoice) {
        const scope: VersionDeleteScope = !details.hasGameFiles
          ? "loader"
          : details.hasLoader
            ? "all"
            : "game";
        setSimpleDeleteDialog({ version, scope, targetLabel: version.id });
        return;
      }
      setDeleteDialog({ version, details });
    } catch (e) {
      console.error("Failed to prepare delete:", e);
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("settings.versions.delete.failed", { msg }));
    }
  };

  const isVersionInstalled = (version: VersionListItem): boolean => {
    if (version.loader === "fabric") {
      return installedFabricGameVersions.includes(version.id);
    }
    if (version.loader === "quilt") {
      return installedQuiltGameVersions.includes(version.id);
    }
    return installedVersions.includes(version.id);
  };

  const handleSkipRepairPromptToggle = (value: boolean) => {
    setSkipRepairPrompt(value);
    try {
      window.localStorage.setItem("skip_version_repair_prompt", value ? "1" : "0");
    } catch {
      //ignore
    }
  };

  const commitRamMb = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setRamInputMb(String(currentRamMb));
      setIsRamEditing(false);
      return;
    }
    const rounded = Math.round(parsed);
    const clamped = Math.min(ramMaxMb, Math.max(ramMinMb, rounded));
    updateSettings({ ram_mb: clamped });
    setRamInputMb(String(clamped));
    setIsRamEditing(false);
  };

  const cancelRamEditing = () => {
    setRamInputMb(String(currentRamMb));
    setIsRamEditing(false);
  };

  const [graphicsAdapters, setGraphicsAdapters] = useState<string[]>([]);
  const [resolutionWidthInput, setResolutionWidthInput] = useState<string>("");
  const [resolutionHeightInput, setResolutionHeightInput] = useState<string>("");

  useEffect(() => {
    void invoke<string[]>("get_graphics_adapters")
      .then((adapters) => setGraphicsAdapters(Array.isArray(adapters) ? adapters : []))
      .catch(() => setGraphicsAdapters([]));
  }, []);

  useEffect(() => {
    setResolutionWidthInput(
      settings?.resolution_width != null ? String(settings.resolution_width) : "",
    );
    setResolutionHeightInput(
      settings?.resolution_height != null ? String(settings.resolution_height) : "",
    );
  }, [settings?.resolution_width, settings?.resolution_height]);

  const commitResolution = () => {
    const wRaw = resolutionWidthInput.trim();
    const hRaw = resolutionHeightInput.trim();
    if (!wRaw && !hRaw) {
      updateSettings({ resolution_width: null, resolution_height: null });
      return;
    }

    const w = Number(wRaw);
    const h = Number(hRaw);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const wi = Math.round(w);
    const hi = Math.round(h);
    if (wi <= 0 || hi <= 0) return;

    const clamp = (v: number) => Math.min(7680, Math.max(320, v));
    const wc = clamp(wi);
    const hc = clamp(hi);
    updateSettings({ resolution_width: wc, resolution_height: hc });
    setResolutionWidthInput(String(wc));
    setResolutionHeightInput(String(hc));
  };

  const formatCacheSize = (bytes: number | null): string => {
    if (bytes == null) {
      return tt("settings.launcher.cache.sizeUnknown");
    }
    if (bytes < 1024) {
      return tt("settings.launcher.cache.bytes", { value: bytes });
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
      return tt("settings.launcher.cache.kb", { value: Math.round(kb) });
    }
    const mb = kb / 1024;
    if (mb < 1024) {
      return tt("settings.launcher.cache.mb", { value: Math.round(mb * 10) / 10 });
    }
    const gb = mb / 1024;
    return tt("settings.launcher.cache.gb", { value: Math.round(gb * 10) / 10 });
  };

  const handleClearCache = async () => {
    setIsCacheLoading(true);
    try {
      await invoke("clear_launcher_cache");
      clearLauncherAvatarCache();
      const next = await invoke<number>("get_launcher_cache_size").catch(() => null);
      setCacheSizeBytes(next ?? 0);
      showNotification(
        "success",
        tt("settings.launcher.cache.cleared"),
      );
    } catch {
      showNotification(
        "error",
        tt("settings.launcher.cache.clearFailed"),
      );
    } finally {
      setIsCacheLoading(false);
    }
  };

  const handleResetSettings = async () => {
    if (!window.confirm(tt("settings.launcher.resetSettings.confirm"))) return;
    setIsResettingSettings(true);
    try {
      try {
        await invoke("set_background_image", { sourcePath: null as string | null });
      } catch {
      }
      const defaults = await invoke<Settings>("reset_settings_to_default");
      updateSettings(defaults);
      setSidebarOrder(["play", "settings", "mods", "modpacks"]);
      try {
        window.localStorage.removeItem("sidebar_order");
        window.localStorage.removeItem("mc16launcher:onboarding_completed");
        window.localStorage.removeItem("mc16launcher:onboarding_legacy_migrated");
        window.localStorage.removeItem("mc16launcher:product_tour_completed");
      } catch {
        //ignore
      }
      showNotification(
        "success",
        tt("settings.launcher.resetSettings.success"),
      );
    } catch {
      showNotification(
        "error",
        tt("settings.launcher.resetSettings.failed"),
      );
    } finally {
      setIsResettingSettings(false);
    }
  };

  const [isImportingSettings, setIsImportingSettings] = useState(false);
  const [isExportingSettings, setIsExportingSettings] = useState(false);

  const handleExportSettings = async () => {
    setIsExportingSettings(true);
    try {
      const path = await saveFile({
        title: tt("settings.launcher.backup.exportDialogTitle"),
        defaultPath: "16launcher-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      await invoke<string>("export_launcher_settings_backup", {
        path,
        sidebarOrder: sidebarOrder,
      });
      showNotification("success", tt("settings.launcher.backup.exportSuccess"), { sound: true });
    } catch (e) {
      console.error(e);
      showNotification("error", tt("settings.launcher.backup.exportFailed"));
    } finally {
      setIsExportingSettings(false);
    }
  };

  const handleImportSettings = async () => {
    setIsImportingSettings(true);
    try {
      const path = await openFile({
        title: tt("settings.launcher.backup.importDialogTitle"),
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      const backup = await invoke<LauncherSettingsBackupV1>("import_launcher_settings_backup", {
        path,
      });
      if (backup?.settings) {
        updateSettings(backup.settings);
      }
      const so = backup?.sidebar_order ?? null;
      if (Array.isArray(so) && so.length > 0) {
        const normalized = so
          .filter(
            (x): x is SidebarItemId =>
              x === "play" ||
              x === "settings" ||
              x === "mods" ||
              x === "modpacks",
          );
        if (normalized.length > 0) {
          setSidebarOrder(normalized);
          try {
            window.localStorage.setItem("sidebar_order", JSON.stringify(normalized));
          } catch {
          }
        }
      }
      showNotification("success", tt("settings.launcher.backup.importSuccess"), { sound: true });
    } catch (e) {
      console.error(e);
      showNotification("error", tt("settings.launcher.backup.importFailed"));
    } finally {
      setIsImportingSettings(false);
    }
  };

  const moveSidebarItem = (id: SidebarItemId, direction: "up" | "down") => {
    const current = sidebarOrder;
    const idx = current.indexOf(id);
    if (idx === -1) return;
    const next = current.slice();
    if (direction === "up" && idx > 0) {
      const tmp = next[idx - 1];
      next[idx - 1] = next[idx];
      next[idx] = tmp;
    } else if (direction === "down" && idx < next.length - 1) {
      const tmp = next[idx + 1];
      next[idx + 1] = next[idx];
      next[idx] = tmp;
    } else {
      return;
    }
    setSidebarOrder(next);
    try {
      window.localStorage.setItem("sidebar_order", JSON.stringify(next));
    } catch {
      //ignore
    }
  };

  const settingsSearchQuery = settingsSearch.trim().toLowerCase();
  const settingsSearchActive = settingsSearchQuery.length > 0;

  const matchedSettingIds = useMemo(() => {
    if (!settingsSearchActive) return null;
    const ids = new Set<SettingSearchId>();
    const seasonalActive = isSeasonalThemePeriod();
    for (const item of SETTING_SEARCH_CATALOG) {
      if (item.id === "launcher.disableThematicDecorations" && !seasonalActive) {
        continue;
      }
      const haystack = item.keys
        .map((key) => tt(key))
        .join(" ")
        .toLowerCase();
      if (haystack.includes(settingsSearchQuery)) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [settingsSearchActive, settingsSearchQuery, tt, language]);

  const showSetting = useCallback(
    (id: SettingSearchId) => !matchedSettingIds || matchedSettingIds.has(id),
    [matchedSettingIds],
  );

  const searchHasAnyMatches = !matchedSettingIds || matchedSettingIds.size > 0;
  const searchHasMatchesOnTab = useMemo(() => {
    if (!matchedSettingIds) return true;
    return SETTING_SEARCH_CATALOG.some(
      (item) => item.tab === settingsTab && matchedSettingIds.has(item.id),
    );
  }, [matchedSettingIds, settingsTab]);

  const tabMatchCounts = useMemo(() => {
    if (!matchedSettingIds) return null;
    const counts: Record<SettingsTabId, number> = { game: 0, versions: 0, launcher: 0 };
    for (const item of SETTING_SEARCH_CATALOG) {
      if (matchedSettingIds.has(item.id)) counts[item.tab] += 1;
    }
    return counts;
  }, [matchedSettingIds]);

  const anyVisible = (...ids: SettingSearchId[]) => ids.some((id) => showSetting(id));

  useEffect(() => {
    if (!matchedSettingIds || matchedSettingIds.size === 0) return;
    const firstMatch = SETTING_SEARCH_CATALOG.find((item) => matchedSettingIds.has(item.id));
    if (!firstMatch) return;
    const hasOnCurrentTab = SETTING_SEARCH_CATALOG.some(
      (item) => item.tab === settingsTab && matchedSettingIds.has(item.id),
    );
    if (!hasOnCurrentTab) {
      setSettingsTab(firstMatch.tab);
    }
  }, [settingsSearchQuery]);

  const label = (key: string) => tt(key).replace(/\s*:\s*$/, "");
  const accentColor = settings?.background_accent_color ?? "#4a22a8";
  const seasonalThemeActive = isSeasonalThemePeriod();

  const applyAccentColor = (hex: string) => {
    setAccentInput(hex);
    updateSettings({ background_accent_color: hex });
  };

  const resetResolutionInputs = () => {
    setResolutionWidthInput(
      settings?.resolution_width != null ? String(settings.resolution_width) : "",
    );
    setResolutionHeightInput(
      settings?.resolution_height != null ? String(settings.resolution_height) : "",
    );
  };

  const refreshVersionsList = async () => {
    try {
      setIsLoadingVersions(true);
      const [available] = await Promise.all([
        loadAvailableByLoader(versionsLoader),
        loadInstalledVersions(),
      ]);
      setAvailableVersions(available);
    } catch (e) {
      console.error("Failed to refresh versions list:", e);
      showNotification("error", tt("settings.versions.refreshFailed"));
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const chooseGameDirectory = async () => {
    try {
      const path = await openFile({ multiple: false, directory: true });
      if (typeof path === "string" && path.trim()) {
        updateSettings({ game_directory: path });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const chooseBackgroundImage = async () => {
    try {
      const path = await openFile({
        multiple: false,
        directory: false,
        filters: [
          {
            name: tt("settings.common.imagesFilterName"),
            extensions: ["png", "jpg", "jpeg", "webp", "gif"],
          },
        ],
      });
      if (!path) return;
      const stored = await invoke<string | null>("set_background_image", { sourcePath: path });
      updateSettings({ background_image_url: stored });
    } catch (e) {
      console.error(e);
    }
  };

  const resetBackgroundImage = async () => {
    try {
      await invoke("set_background_image", { sourcePath: null });
      updateSettings({ background_image_url: null });
    } catch (e) {
      console.error(e);
    }
  };

  const importThemeZip = async () => {
    try {
      const path = await openFile({
        multiple: false,
        directory: false,
        filters: [{ name: tt("settings.launcher.customThemes.zipFilterName"), extensions: ["zip"] }],
      });
      if (!path) return;
      const imported = await invoke<ThemeInfo>("import_theme_zip", { sourcePath: path });
      await refreshThemes();
      updateSettings({ custom_theme_id: imported.id });
      showNotification(
        "success",
        tt("settings.launcher.customThemes.imported", { name: imported.name }),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.importFailed")),
      );
    }
  };

  const createTheme = async () => {
    const name = window.prompt(tt("settings.launcher.customThemes.createPrompt"));
    if (!name?.trim()) return;
    try {
      const created = await invoke<ThemeInfo>("create_empty_theme", { name: name.trim() });
      await refreshThemes();
      updateSettings({ custom_theme_id: created.id });
      setEditingThemeId(created.id);
      showNotification(
        "success",
        tt("settings.launcher.customThemes.created", { name: created.name }),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.createFailed")),
      );
    }
  };

  const openThemesFolder = async () => {
    try {
      await invoke("open_themes_folder");
    } catch (e) {
      console.error(e);
      showNotification("error", tt("settings.launcher.customThemes.openFolderFailed"));
    }
  };

  const openActiveThemeCss = async () => {
    if (!activeThemeId) return;
    try {
      await invoke("open_theme_css_file", { themeId: activeThemeId });
    } catch (e) {
      console.error(e);
      showNotification("error", tt("settings.launcher.customThemes.editCssFailed"));
    }
  };

  const duplicateActiveTheme = async () => {
    if (!activeThemeId) return;
    const name = window.prompt(
      tt("settings.launcher.customThemes.duplicatePrompt"),
      tt("settings.launcher.customThemes.duplicateDefault", {
        name: activeTheme?.name ?? activeThemeId,
      }),
    );
    if (!name?.trim()) return;
    try {
      const copy = await invoke<ThemeInfo>("duplicate_theme", {
        themeId: activeThemeId,
        name: name.trim(),
      });
      await refreshThemes();
      updateSettings({ custom_theme_id: copy.id });
      showNotification(
        "success",
        tt("settings.launcher.customThemes.duplicated", { name: copy.name }),
      );
    } catch (e) {
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.duplicateFailed")),
      );
    }
  };

  const exportActiveTheme = async () => {
    if (!activeThemeId) return;
    try {
      const dest = await saveFile({
        defaultPath: `${activeThemeId}.zip`,
        filters: [{ name: tt("settings.launcher.customThemes.zipFilterName"), extensions: ["zip"] }],
      });
      if (!dest) return;
      await invoke("export_theme_zip", { themeId: activeThemeId, destPath: dest });
      showNotification("success", tt("settings.launcher.customThemes.exported"));
    } catch (e) {
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.exportFailed")),
      );
    }
  };

  const deleteActiveTheme = async () => {
    if (!activeThemeId) return;
    const themeName = activeTheme?.name ?? activeThemeId;
    if (!window.confirm(tt("settings.launcher.customThemes.deleteConfirm", { name: themeName }))) {
      return;
    }
    try {
      setEditingThemeId(null);
      await invoke("delete_theme", { themeId: activeThemeId });
      await refreshThemes();
      updateSettings({ custom_theme_id: null });
      showNotification(
        "success",
        tt("settings.launcher.customThemes.deleted", { name: themeName }),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.deleteFailed")),
      );
    }
  };

  const updateStatusText = (() => {
    switch (updateStatus) {
      case "checking":
        return tt("settings.updates.checking");
      case "downloading":
        return tt("settings.updates.downloading", { percent: updateDownloadPercent ?? 0 });
      case "installing":
        return tt("settings.updates.installing");
      case "available":
        return updateVersion
          ? tt("settings.updates.available", { version: updateVersion })
          : tt("settings.updates.idle");
      case "up-to-date":
        return tt("settings.updates.upToDate");
      case "error":
        return tt("settings.updates.checkFailed");
      default:
        return tt("settings.updates.idle");
    }
  })();

  const graphicsAdapterOptions = [
    { value: "", label: tt("settings.game.graphicsAdapter.auto") },
    ...graphicsAdapters.map((adapter) => ({ value: adapter, label: adapter })),
    ...(settings?.graphics_adapter && !graphicsAdapters.includes(settings.graphics_adapter)
      ? [{ value: settings.graphics_adapter, label: settings.graphics_adapter }]
      : []),
  ];

  const sidebarItemLabel = (id: SidebarItemId) =>
    tt(
      id === "play"
        ? "app.sidebar.play"
        : id === "settings"
          ? "app.sidebar.settings"
          : id === "mods"
            ? "app.sidebar.mods"
            : "app.sidebar.modpacks",
    );

  const settingsTabs: { id: SettingsTabId; label: string; icon: string }[] = [
    { id: "game", label: tt("settings.tab.game"), icon: "play" },
    { id: "versions", label: tt("settings.tab.versions"), icon: "versions" },
    { id: "launcher", label: tt("settings.tab.launcher"), icon: "settings" },
  ];

  const numberInputClass =
    "glass-control no-number-spin h-9 w-24 px-3 text-sm text-white/90 outline-none placeholder:text-white/35";

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      {reinstallDialog && (
        <div
          className="glass-overlay fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={() => setReinstallDialog(null)}
        >
          <div
            className="glass-modal w-[min(92vw,28rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-[0.9375rem] font-semibold text-white">
              {tt("settings.versions.manage.reinstallTitle", {
                version: reinstallDialog.version.id,
              })}
            </h3>
            <p className="ui-meta mt-1">
              {tt("settings.versions.manage.reinstallHint", {
                gameVersion: reinstallDialog.gameVersion,
              })}
            </p>
            <label className="ui-meta mb-1.5 mt-4 block" htmlFor="reinstall-loader-select">
              {label("settings.versions.manage.loaderVersionLabel")}
            </label>
            <SettingsSelect
              id="reinstall-loader-select"
              className="w-full"
              disabled={reinstallLoaderLoading}
              value={reinstallDialog.selectedLoaderVersion}
              placeholder={
                reinstallLoaderLoading ? tt("common.loading") : tt("modpacks.common.select")
              }
              options={reinstallLoaderOptions.map((opt) => ({
                value: opt.version,
                label: opt.version,
              }))}
              onChange={(version) =>
                setReinstallDialog((prev) =>
                  prev ? { ...prev, selectedLoaderVersion: version } : null,
                )
              }
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReinstallDialog(null)}
                className="btn btn-sm btn-ghost"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                disabled={installingVersionId === reinstallDialog.version.id}
                onClick={() => void confirmReinstall()}
                className="btn btn-sm btn-accent"
              >
                {tt("settings.versions.manage.reinstallConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
      {simpleDeleteDialog && (
        <div
          className="glass-overlay fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={() => setSimpleDeleteDialog(null)}
        >
          <div
            className="glass-modal w-[min(92vw,26rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-delete-simple-title"
          >
            <p
              id="version-delete-simple-title"
              className="text-sm leading-relaxed text-white/90"
            >
              {tt("settings.versions.delete.simplePrompt", {
                version: simpleDeleteDialog.version.id,
              })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSimpleDeleteDialog(null)}
                className="btn btn-sm btn-ghost"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                disabled={deletingVersionId === simpleDeleteDialog.version.id}
                onClick={() => {
                  const { version, scope, targetLabel } = simpleDeleteDialog;
                  setSimpleDeleteDialog(null);
                  void performDelete(version, scope, targetLabel);
                }}
                className="btn btn-sm btn-danger"
              >
                {tt("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteDialog && (
        <div
          className="glass-overlay fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={() => setDeleteDialog(null)}
        >
          <div
            className="glass-modal w-[min(92vw,28rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-[0.9375rem] font-semibold text-white">
              {tt("settings.versions.delete.title", { version: deleteDialog.version.id })}
            </h3>
            <p className="ui-meta mt-1">
              {tt("settings.versions.delete.choicePrompt", {
                version: deleteDialog.version.id,
              })}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={deletingVersionId === deleteDialog.version.id}
                onClick={() => {
                  const { version, details } = deleteDialog;
                  setDeleteDialog(null);
                  void performDelete(
                    version,
                    "game",
                    tt("settings.versions.delete.gameOnly", {
                      gameVersion: details.gameVersion,
                    }),
                  );
                }}
                className="btn btn-soft w-full justify-start"
              >
                {tt("settings.versions.delete.gameOnly", {
                  gameVersion: deleteDialog.details.gameVersion,
                })}
              </button>
              <button
                type="button"
                disabled={deletingVersionId === deleteDialog.version.id}
                onClick={() => {
                  const { version, details } = deleteDialog;
                  const suffix =
                    details.loaderVersions.length > 0
                      ? ` (${details.loaderVersions.join(", ")})`
                      : "";
                  setDeleteDialog(null);
                  void performDelete(
                    version,
                    "loader",
                    tt("settings.versions.delete.loaderOnly", { loaderSuffix: suffix }),
                  );
                }}
                className="btn btn-soft w-full justify-start"
              >
                <span className="truncate">
                  {tt("settings.versions.delete.loaderOnly", {
                    loaderSuffix:
                      deleteDialog.details.loaderVersions.length > 0
                        ? ` (${deleteDialog.details.loaderVersions.join(", ")})`
                        : "",
                  })}
                </span>
              </button>
              <button
                type="button"
                disabled={deletingVersionId === deleteDialog.version.id}
                onClick={() => {
                  const { version } = deleteDialog;
                  setDeleteDialog(null);
                  void performDelete(version, "all", version.id);
                }}
                className="btn btn-danger w-full justify-start"
              >
                {tt("settings.versions.delete.all")}
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="btn btn-sm btn-ghost"
              >
                {tt("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
      {repairPrompt && (
        <div
          className="glass-overlay fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={() => setRepairPrompt(null)}
        >
          <div
            className="glass-modal w-[min(92vw,28rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <p className="text-sm leading-relaxed text-white/90">
              {tt("settings.versions.verify.promptText", {
                version: repairPrompt.version.id,
                checked: repairPrompt.result.checked_files,
                missing: repairPrompt.result.missing_files,
                corrupted: repairPrompt.result.corrupted_files,
              })}
            </p>
            <label className="ui-meta mt-4 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="accent-checkbox"
                checked={skipRepairPrompt}
                onChange={(e) => handleSkipRepairPromptToggle(e.target.checked)}
              />
              <span>{tt("settings.versions.verify.skipPrompt")}</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRepairPrompt(null)}
                className="btn btn-sm btn-ghost"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = repairPrompt.version;
                  setRepairPrompt(null);
                  void (async () => {
                    await handleInstallVersion(target, { silentSuccess: true });
                    showNotification(
                      "warning",
                      tt("settings.versions.verify.rewritten", { version: target.id }),
                      { sound: true },
                    );
                  })();
                }}
                className="btn btn-sm btn-accent"
              >
                {tt("settings.versions.verify.rewriteButton")}
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className={`flex min-h-0 w-full flex-1 flex-col ${fillPane ? "px-1 py-1" : "px-4 py-4"}`}
      >
        <div
          className={`mx-auto flex min-h-0 w-full flex-1 flex-col gap-3 ${
            fillPane ? "" : "max-w-5xl"
          }`}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div
              role="tablist"
              className="seg-track relative flex items-center overflow-hidden p-1"
            >
              <div
                className="seg-indicator pointer-events-none absolute bottom-1 top-1 rounded-lg transition-all duration-200 ease-out"
                style={{
                  left: `${settingsIndicator.left}px`,
                  width: `${settingsIndicator.width}px`,
                }}
              />
              {settingsTabs.map((tab) => {
                const active = settingsTab === tab.id;
                const count = tabMatchCounts?.[tab.id] ?? null;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    ref={(el) => {
                      settingsTabRefs.current[tab.id] = el;
                    }}
                    onClick={() => {
                      if ((settings?.ui_sounds_enabled ?? true) && settingsTab !== tab.id) {
                        playTabSwitchSound();
                      }
                      setSettingsTab(tab.id);
                    }}
                    className={`interactive-press relative z-10 flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[0.8125rem] font-semibold transition-colors ${
                      active
                        ? "text-white"
                        : count === 0
                          ? "text-white/35 hover:text-white/60"
                          : "text-white/65 hover:text-white"
                    }`}
                  >
                    <AssetIcon name={tab.icon} />
                    <span>{tab.label}</span>
                    {count != null && count > 0 && (
                      <span className="rounded-md bg-white/10 px-1.5 text-[0.6875rem] leading-5 text-white/80">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <label className="glass-toolbar flex min-w-[14rem] flex-1 items-center gap-3 px-3.5 py-2 sm:ml-auto sm:max-w-sm">
              <Search className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
              <input
                type="search"
                value={settingsSearch}
                onChange={(e) => setSettingsSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSettingsSearch("");
                }}
                placeholder={tt("settings.search.placeholder")}
                className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                aria-label={tt("settings.search.placeholder")}
              />
              <InputClearButton
                value={settingsSearch}
                onClear={() => setSettingsSearch("")}
                aria-label={tt("common.clear")}
              />
            </label>
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
            {settingsSearchActive && (!searchHasAnyMatches || !searchHasMatchesOnTab) ? (
              <div className="glass-panel px-6 py-10 text-center">
                <Search className="mx-auto mb-3 h-5 w-5 text-white/30" aria-hidden />
                <p className="ui-meta">{tt("settings.search.noResults")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 pb-1">
                {settingsTab === "game" && (
                  <>
                    {anyVisible(
                      "game.gameDirectory",
                      "game.showConsole",
                      "game.closeLauncher",
                      "game.checkProcesses",
                    ) && (
                      <SettingsSection
                        title={tt("settings.game.subtab.general")}
                        icon={<AssetIcon name="versions" />}
                      >
                        {showSetting("game.gameDirectory") && (
                          <SettingsRow
                            label={tt("settings.game.gameDirectory.label")}
                            hint={tt("settings.game.gameDirectory.hint")}
                            stacked
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <div
                                className="glass-control flex h-9 min-w-0 flex-1 items-center px-3"
                                title={settings?.game_directory ?? undefined}
                              >
                                <span
                                  className={`truncate ${
                                    settings?.game_directory
                                      ? "font-mono text-[0.8125rem] text-white/85"
                                      : "text-sm text-white/45"
                                  }`}
                                >
                                  {settings?.game_directory ||
                                    tt("settings.game.gameDirectory.defaultPathHint")}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => void chooseGameDirectory()}
                                  className="btn btn-soft"
                                >
                                  <AssetIcon name="folder" />
                                  {tt("settings.game.gameDirectory.choose")}
                                </button>
                                <button
                                  type="button"
                                  disabled={!settings?.game_directory}
                                  onClick={() => updateSettings({ game_directory: null })}
                                  className="btn btn-ghost"
                                >
                                  {tt("settings.common.reset")}
                                </button>
                              </div>
                            </div>
                          </SettingsRow>
                        )}
                        {showSetting("game.showConsole") && (
                          <SettingsSwitchRow
                            label={tt("settings.game.showConsoleOnLaunch.label")}
                            value={settings?.show_console_on_launch ?? false}
                            onChange={(v) => updateSettings({ show_console_on_launch: v })}
                          />
                        )}
                        {showSetting("game.closeLauncher") && (
                          <SettingsSwitchRow
                            label={tt("settings.game.closeLauncherOnStart.label")}
                            value={settings?.close_launcher_on_game_start ?? false}
                            onChange={(v) => updateSettings({ close_launcher_on_game_start: v })}
                          />
                        )}
                        {showSetting("game.checkProcesses") && (
                          <SettingsSwitchRow
                            label={tt("settings.game.checkGameProcesses.label")}
                            value={settings?.check_game_processes ?? true}
                            onChange={(v) => updateSettings({ check_game_processes: v })}
                          />
                        )}
                      </SettingsSection>
                    )}

                    {anyVisible("game.windowSize", "game.graphicsAdapter") && (
                      <SettingsSection
                        title={tt("settings.section.display")}
                        icon={<AssetIcon name="display" />}
                      >
                        {showSetting("game.windowSize") && (
                          <SettingsRow label={tt("settings.game.windowSize.label")}>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={320}
                              max={7680}
                              aria-label={tt("settings.game.windowSize.widthPlaceholder")}
                              placeholder={tt("settings.game.windowSize.widthPlaceholder")}
                              value={resolutionWidthInput}
                              onChange={(e) => setResolutionWidthInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitResolution();
                                if (e.key === "Escape") resetResolutionInputs();
                              }}
                              onBlur={commitResolution}
                              className={numberInputClass}
                            />
                            <span className="text-sm text-white/40">×</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={320}
                              max={7680}
                              aria-label={tt("settings.game.windowSize.heightPlaceholder")}
                              placeholder={tt("settings.game.windowSize.heightPlaceholder")}
                              value={resolutionHeightInput}
                              onChange={(e) => setResolutionHeightInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitResolution();
                                if (e.key === "Escape") resetResolutionInputs();
                              }}
                              onBlur={commitResolution}
                              className={numberInputClass}
                            />
                          </SettingsRow>
                        )}
                        {showSetting("game.graphicsAdapter") && (
                          <SettingsRow
                            label={tt("settings.game.graphicsAdapter.label")}
                            hint={tt("settings.game.graphicsAdapter.hint")}
                            htmlFor="graphics-adapter-select"
                          >
                            <SettingsSelect
                              id="graphics-adapter-select"
                              value={settings?.graphics_adapter ?? ""}
                              options={graphicsAdapterOptions}
                              onChange={(value) =>
                                updateSettings({ graphics_adapter: value || null })
                              }
                            />
                          </SettingsRow>
                        )}
                      </SettingsSection>
                    )}

                    {anyVisible("game.ram", "game.java") && (
                      <SettingsSection
                        title={tt("settings.section.java")}
                        icon={<AssetIcon name="java" />}
                      >
                        {showSetting("game.ram") && (
                          <div className="py-3.5">
                            <SettingsSlider
                              label={label("settings.game.ram.label")}
                              min={1}
                              max={ramSliderMaxGb}
                              value={displayRamGb}
                              onChange={(value: number) =>
                                setRamSliderLocal(Math.min(ramSliderMaxGb, Math.max(1, value)))
                              }
                              onChangeCommitted={(value: number) => {
                                const clamped = Math.min(ramSliderMaxGb, Math.max(1, value));
                                updateSettings({ ram_mb: clamped * 1024 });
                                setRamSliderLocal(null);
                              }}
                              right={
                                isRamEditing ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      ref={ramInputRef}
                                      type="number"
                                      inputMode="numeric"
                                      min={ramMinMb}
                                      max={ramMaxMb}
                                      value={ramInputMb}
                                      onChange={(e) => setRamInputMb(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") commitRamMb(ramInputMb);
                                        if (e.key === "Escape") cancelRamEditing();
                                      }}
                                      onBlur={() => commitRamMb(ramInputMb)}
                                      className="glass-control no-number-spin h-8 w-28 px-2.5 text-right text-sm font-semibold text-white/90 outline-none"
                                    />
                                    <span className="ui-meta">{tt("settings.game.ram.mbUnit")}</span>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setIsRamEditing(true)}
                                    className="interactive-press glass-control h-8 px-2.5 text-sm font-semibold text-white/90 hover:text-white"
                                    title={tt("settings.game.ram.editInMbHint")}
                                  >
                                    {tt("settings.game.ram.gbValue", {
                                      gb: ramSliderLocal ?? currentRamGbRounded,
                                    })}
                                  </button>
                                )
                              }
                            />
                          </div>
                        )}
                        {showSetting("game.java") && (
                          <div className="py-3.5">
                            <JavaSettingsTab
                              embedded
                              language={language}
                              systemMemoryGb={systemMemoryGb}
                              showNotification={showNotification}
                            />
                          </div>
                        )}
                      </SettingsSection>
                    )}
                  </>
                )}

                {settingsTab === "versions" && (
                  <>
                    {anyVisible(
                      "versions.showSnapshots",
                      "versions.showAlpha",
                      "versions.forgeProxy",
                    ) && (
                      <SettingsSection
                        title={tt("settings.section.versionList")}
                        icon={<AssetIcon name="filter" />}
                      >
                        {showSetting("versions.showSnapshots") && (
                          <SettingsSwitchRow
                            label={tt("settings.versions.showSnapshots.label")}
                            value={settings?.show_snapshots ?? false}
                            onChange={(v) => updateSettings({ show_snapshots: v })}
                          />
                        )}
                        {showSetting("versions.showAlpha") && (
                          <SettingsSwitchRow
                            label={tt("settings.versions.showAlpha.label")}
                            value={settings?.show_alpha_versions ?? false}
                            onChange={(v) => updateSettings({ show_alpha_versions: v })}
                          />
                        )}
                        {showSetting("versions.forgeProxy") && (
                          <SettingsSwitchRow
                            label={tt("settings.versions.forgeProxyFallback.label")}
                            value={settings?.forge_proxy_fallback ?? false}
                            onChange={(v) => updateSettings({ forge_proxy_fallback: v })}
                          />
                        )}
                      </SettingsSection>
                    )}

                    {anyVisible(
                      "versions.loaderFilter",
                      "versions.versionFilter",
                      "versions.available",
                    ) && (
                      <SettingsSection
                        title={tt("settings.card.versions")}
                        icon={<AssetIcon name="versions" />}
                        actions={
                          showSetting("versions.available") ? (
                            <>
                              {versionsLoader === "vanilla" && (
                                <button
                                  type="button"
                                  onClick={() => void handleImportCustomVersion()}
                                  className="btn btn-sm btn-soft"
                                >
                                  <AssetIcon name="import" className="h-3.5 w-3.5" />
                                  {tt("settings.versions.custom.importButton")}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isLoadingVersions}
                                onClick={() => void refreshVersionsList()}
                                className="btn btn-sm btn-ghost"
                              >
                                <AssetIcon
                                  name="updates"
                                  className={`h-3.5 w-3.5 ${isLoadingVersions ? "animate-spin" : ""}`}
                                  />
                                {tt("settings.versions.refresh")}
                              </button>
                            </>
                          ) : undefined
                        }
                      >
                        {anyVisible("versions.loaderFilter", "versions.versionFilter") && (
                          <div className="grid grid-cols-1 gap-3 py-3.5 sm:grid-cols-2">
                            {showSetting("versions.loaderFilter") && (
                              <div>
                                <label
                                  htmlFor="versions-loader-select"
                                  className="ui-meta mb-1.5 block"
                                >
                                  {label("settings.versions.loaderFilter.label")}
                                </label>
                                <SettingsSelect
                                  id="versions-loader-select"
                                  className="w-full"
                                  value={versionsLoader}
                                  options={(
                                    ["vanilla", "fabric", "quilt", "forge", "neoforge"] as LoaderId[]
                                  ).map((id) => ({
                                    value: id,
                                    label: tt(`settings.versions.loader.${id}`),
                                  }))}
                                  onChange={(id) => {
                                    setVersionsLoader(id);
                                    setIsVersionFilterDropdownOpen(false);
                                  }}
                                />
                              </div>
                            )}
                            {showSetting("versions.versionFilter") && (
                              <div ref={versionsFilterDropdownRef} className="relative">
                                <span className="ui-meta mb-1.5 block">
                                  {label("settings.versions.versionFilter.label")}
                                </span>
                                <button
                                  type="button"
                                  aria-haspopup="listbox"
                                  aria-expanded={isVersionFilterDropdownOpen}
                                  onClick={() => setIsVersionFilterDropdownOpen((prev) => !prev)}
                                  className="interactive-press launcher-select glass-control flex h-9 w-full items-center px-3 text-left text-sm outline-none"
                                >
                                  <span className="truncate">{selectedVersionFilterLabel}</span>
                                </button>
                                <AnimatePresence>
                                  {isVersionFilterDropdownOpen && (
                                    <motion.div
                                      initial={{ opacity: 0, y: 6, scale: 0.98 }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      exit={{ opacity: 0, y: 4, scale: 0.98 }}
                                      transition={{ duration: 0.14, ease: "easeOut" }}
                                      className="glass-popover absolute left-0 z-30 mt-1 w-full p-1"
                                    >
                                      <div className="relative px-1 pb-1 pt-0.5">
                                        <input
                                          ref={versionFilterInputRef}
                                          type="text"
                                          value={versionFilterQuery}
                                          onChange={(e) => setVersionFilterQuery(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Escape") {
                                              setIsVersionFilterDropdownOpen(false);
                                              return;
                                            }
                                            if (e.key === "Enter") {
                                              const q = versionFilterQuery.trim().toLowerCase();
                                              const exact = q
                                                ? versionFilterOptions.find(
                                                    (v) => v.id.toLowerCase() === q,
                                                  )
                                                : null;
                                              const chosen = exact ?? versionFilterOptions[0] ?? null;
                                              if (chosen) {
                                                setSelectedVersionFilterId(chosen.id);
                                                setIsVersionFilterDropdownOpen(false);
                                              }
                                            }
                                          }}
                                          placeholder={tt("play.version.searchPlaceholder")}
                                          className={`glass-control h-8 w-full px-3 text-xs text-white/90 outline-none placeholder:text-white/35 ${
                                            versionFilterQuery ? "pr-8" : ""
                                          }`}
                                        />
                                        <InputClearButton
                                          value={versionFilterQuery}
                                          onClear={() => setVersionFilterQuery("")}
                                          className="absolute right-2 top-1/2 -translate-y-1/2"
                                          aria-label={tt("common.clear")}
                                        />
                                      </div>
                                      <div
                                        ref={versionFilterListRef}
                                        className="custom-scrollbar max-h-[240px] overflow-y-auto px-1 pb-1"
                                      >
                                        <button
                                          type="button"
                                          ref={(el) => {
                                            if (selectedVersionFilterId === null) {
                                              selectedVersionFilterButtonRef.current = el;
                                            }
                                          }}
                                          onClick={() => {
                                            setSelectedVersionFilterId(null);
                                            setIsVersionFilterDropdownOpen(false);
                                          }}
                                          className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                                            selectedVersionFilterId === null
                                              ? "seg-on"
                                              : "text-white/80 hover:bg-white/10"
                                          }`}
                                        >
                                          {tt("settings.versions.versionFilter.all")}
                                        </button>
                                        {versionFilterOptions.length === 0 ? (
                                          <div className="ui-meta px-3 py-2">
                                            {tt("settings.versions.versionFilter.noneFound")}
                                          </div>
                                        ) : (
                                          versionFilterOptions.map((v) => {
                                            const selected = selectedVersionFilterId === v.id;
                                            return (
                                              <button
                                                key={v.id}
                                                ref={(el) => {
                                                  if (selected) {
                                                    selectedVersionFilterButtonRef.current = el;
                                                  }
                                                }}
                                                type="button"
                                                onClick={() => {
                                                  setSelectedVersionFilterId(v.id);
                                                  setIsVersionFilterDropdownOpen(false);
                                                }}
                                                className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                                                  selected
                                                    ? "seg-on"
                                                    : "text-white/80 hover:bg-white/10"
                                                }`}
                                              >
                                                <span className="truncate">{v.id}</span>
                                              </button>
                                            );
                                          })
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}
                          </div>
                        )}

                        {showSetting("versions.available") && (
                          <div className="py-3.5">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <span className="ui-meta">
                                {label("settings.versions.available.label")}
                              </span>
                              {!isLoadingVersions && availableVersions && (
                                <span className="ui-caption">{filteredAvailableVersions.length}</span>
                              )}
                            </div>
                            <div className="custom-scrollbar glass-inset max-h-[26rem] min-h-[8rem] overflow-y-auto p-1">
                              {isLoadingVersions ? (
                                <div className="ui-meta flex h-32 items-center justify-center">
                                  {tt("settings.versions.loading")}
                                </div>
                              ) : !availableVersions || availableVersions.length === 0 ? (
                                <div className="ui-meta flex h-32 items-center justify-center px-4 text-center">
                                  {tt("settings.versions.noneFound")}
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  {filteredAvailableVersions.map((v) => {
                                    const installed = isVersionInstalled(v);
                                    const progress = downloadProgress[v.id];
                                    const percent =
                                      progress && progress.total > 0
                                        ? Math.round(progress.percent)
                                        : null;
                                    const installing = installingVersionId === v.id;
                                    const checking = checkingVersionId === v.id;
                                    const deleting = deletingVersionId === v.id;
                                    return (
                                      <div
                                        key={v.id}
                                        className="flex flex-col gap-2 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.035] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                                      >
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="truncate text-sm font-semibold text-white/90">
                                              {v.id}
                                            </span>
                                            <span className="tag">
                                              {tt(`settings.versions.loader.${v.loader}`)}
                                            </span>
                                            {v.version_type && v.version_type !== v.loader && (
                                              <span className="tag">{v.version_type}</span>
                                            )}
                                            {installed && (
                                              <span className="tag bg-emerald-500/15 text-emerald-300">
                                                {tt("settings.versions.installedBadge")}
                                              </span>
                                            )}
                                          </div>
                                          {v.release_time && (
                                            <div className="ui-caption mt-0.5">
                                              {new Date(v.release_time).toLocaleDateString(
                                                localeTag(language),
                                              )}
                                            </div>
                                          )}
                                          {percent !== null && installing && (
                                            <div className="mt-1.5 flex items-center gap-2">
                                              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                                                <div
                                                  className="progress-fill h-full rounded-full transition-[width]"
                                                  style={{
                                                    width: `${Math.min(100, Math.max(0, percent))}%`,
                                                  }}
                                                />
                                              </div>
                                              <span className="ui-caption">{percent}%</span>
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1.5">
                                          {installed && (
                                            <>
                                              <button
                                                type="button"
                                                disabled={checking || installing || deleting}
                                                onClick={() => void handleCheckVersionFiles(v)}
                                                className="btn btn-sm btn-ghost"
                                              >
                                                {checking
                                                  ? tt("settings.versions.verify.checking")
                                                  : tt("settings.versions.verify.button")}
                                              </button>
                                              <button
                                                type="button"
                                                disabled={installing || deleting}
                                                onClick={() => void openDeleteFlow(v)}
                                                className="icon-btn hover:!bg-red-500/15 hover:!text-red-200"
                                                title={
                                                  deleting
                                                    ? tt("settings.versions.action.deleting")
                                                    : tt("settings.versions.action.delete")
                                                }
                                                aria-label={tt("settings.versions.action.delete")}
                                              >
                                                <AssetIcon name="delete" />
                                              </button>
                                            </>
                                          )}
                                          <button
                                            type="button"
                                            disabled={installing || deleting}
                                            onClick={() =>
                                              void (installed
                                                ? openReinstallDialog(v)
                                                : handleInstallVersion(v))
                                            }
                                            className={`btn btn-sm min-w-[7.5rem] ${
                                              installed ? "btn-soft" : "btn-accent"
                                            }`}
                                          >
                                            {!installed && !installing && (
                                              <AssetIcon name="download" className="h-3.5 w-3.5" />
                                            )}
                                            {installing
                                              ? tt("settings.versions.action.installing")
                                              : installed
                                                ? tt("settings.versions.action.reinstall")
                                                : tt("settings.versions.action.install")}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {installingVersionId && (
                              <div className="mt-3">
                                <div className="ui-caption mb-1.5">
                                  {tt("settings.versions.installLog", {
                                    version: installingVersionId,
                                  })}
                                </div>
                                <div className="custom-scrollbar max-h-36 min-h-[5rem] overflow-y-auto rounded-xl border border-[color:var(--seam)] bg-black/50 px-3 py-2 font-mono text-[0.75rem] text-white/75">
                                  {installLogLines.length > 0 ? (
                                    installLogLines.map((entry, idx) => (
                                      <div
                                        key={`${idx}-${entry.line.slice(0, 24)}`}
                                        className={`whitespace-pre break-all ${
                                          entry.source === "stderr" ? "text-red-300" : ""
                                        }`}
                                      >
                                        {entry.line}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-white/40">{tt("play.install.logWaiting")}</div>
                                  )}
                                  <div ref={installLogEndRef} />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </SettingsSection>
                    )}
                  </>
                )}

                {settingsTab === "launcher" && (
                  <>
                    {onCheckUpdate && showSetting("launcher.updates") && (
                      <SettingsSection
                        title={tt("settings.card.updates")}
                        icon={<AssetIcon name="updates" />}
                      >
                        <SettingsRow
                          label={
                            <>
                              <span>{updateStatusText}</span>
                              {updateStatus === "downloading" && updateDownloadPercent != null && (
                                <span className="mt-2 block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                                  <span
                                    className="progress-fill block h-full rounded-full transition-[width]"
                                    style={{
                                      width: `${Math.min(100, Math.max(0, updateDownloadPercent))}%`,
                                    }}
                                  />
                                </span>
                              )}
                            </>
                          }
                        >
                          {updateStatus === "available" && onInstallUpdate && (
                            <button
                              type="button"
                              onClick={() => void onInstallUpdate()}
                              className="btn btn-sm btn-accent"
                            >
                              <AssetIcon name="download" className="h-3.5 w-3.5" />
                              {tt("settings.updates.installNow")}
                            </button>
                          )}
                          {updateStatus !== "downloading" && updateStatus !== "installing" && (
                            <button
                              type="button"
                              disabled={updateStatus === "checking"}
                              title={
                                onPreviewUpdatePopup ? tt("settings.updates.checkNowHint") : undefined
                              }
                              onClick={(e) => {
                                if (e.shiftKey && onPreviewUpdatePopup) {
                                  void onPreviewUpdatePopup();
                                  return;
                                }
                                void onCheckUpdate?.();
                              }}
                              className="btn btn-sm btn-soft"
                            >
                              <AssetIcon
                                name="updates"
                                className={`h-3.5 w-3.5 ${updateStatus === "checking" ? "animate-spin" : ""}`}
                                />
                              {tt("settings.updates.checkNow")}
                            </button>
                          )}
                        </SettingsRow>
                        <SettingsSwitchRow
                          label={tt("settings.updates.checkOnStart.label")}
                          value={settings?.check_updates_on_start ?? true}
                          onChange={(v) => updateSettings({ check_updates_on_start: v })}
                        />
                        <SettingsSwitchRow
                          label={tt("settings.updates.autoInstall.label")}
                          value={settings?.auto_install_updates ?? false}
                          onChange={(v) => updateSettings({ auto_install_updates: v })}
                        />
                      </SettingsSection>
                    )}

                    {anyVisible(
                      "launcher.openOnProfiles",
                      "launcher.uiSounds",
                      "launcher.discordRpc",
                      "launcher.minimizeToTray",
                      "launcher.autostart",
                      "launcher.splitView",
                    ) && (
                      <SettingsSection
                        title={tt("settings.section.behavior")}
                        icon={<AssetIcon name="options" />}
                      >
                        {showSetting("launcher.openOnProfiles") && (
                          <SettingsRow label={tt("settings.launcher.openOnProfilesTab.label")}>
                            <SettingsSegmented
                              ariaLabel={label("settings.launcher.openOnProfilesTab.label")}
                              value={settings?.open_launcher_on_profiles_tab ? "profiles" : "home"}
                              options={[
                                { value: "home", label: tt("settings.launcher.openOnProfilesTab.no") },
                                {
                                  value: "profiles",
                                  label: tt("settings.launcher.openOnProfilesTab.yes"),
                                },
                              ]}
                              onChange={(value) =>
                                updateSettings({
                                  open_launcher_on_profiles_tab: value === "profiles",
                                })
                              }
                            />
                          </SettingsRow>
                        )}
                        {showSetting("launcher.uiSounds") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.uiSounds.label")}
                            value={settings?.ui_sounds_enabled ?? true}
                            onChange={(v) => updateSettings({ ui_sounds_enabled: v })}
                          />
                        )}
                        {showSetting("launcher.discordRpc") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.discordRpc.label")}
                            hint={tt("settings.launcher.discordRpc.hint")}
                            value={settings?.discord_rpc_enabled ?? true}
                            onChange={(v) => updateSettings({ discord_rpc_enabled: v })}
                          />
                        )}
                        {showSetting("launcher.minimizeToTray") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.minimizeToTray.label")}
                            value={settings?.minimize_to_tray_on_close ?? false}
                            onChange={(v) => updateSettings({ minimize_to_tray_on_close: v })}
                          />
                        )}
                        {showSetting("launcher.autostart") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.autostart.label")}
                            value={settings?.autostart_enabled ?? false}
                            onChange={(v) => updateSettings({ autostart_enabled: v })}
                          />
                        )}
                        {showSetting("launcher.splitView") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.splitView.label")}
                            hint={tt("settings.launcher.splitView.hint")}
                            value={settings?.split_view_enabled ?? false}
                            onChange={(v) => updateSettings({ split_view_enabled: v })}
                          />
                        )}
                      </SettingsSection>
                    )}

                    {anyVisible(
                      "launcher.language",
                      "launcher.sidebarPosition",
                      "launcher.sidebarOrder",
                    ) && (
                      <SettingsSection
                        title={tt("settings.section.interface")}
                        icon={<AssetIcon name="grid" />}
                      >
                        {showSetting("launcher.language") && (
                          <SettingsRow label={tt("settings.launcher.interfaceLanguage.label")}>
                            <SettingsSegmented
                              ariaLabel={label("settings.launcher.interfaceLanguage.label")}
                              value={language}
                              options={SUPPORTED_LANGUAGES.map((code) => ({
                                value: code,
                                label: tt(`settings.launcher.interfaceLanguage.${code}`),
                              }))}
                              onChange={(code) => setLanguage(code)}
                            />
                          </SettingsRow>
                        )}
                        {showSetting("launcher.sidebarPosition") && (
                          <SettingsRow
                            label={tt("settings.launcher.sidebarPosition.label")}
                            htmlFor="sidebar-position-select"
                          >
                            <SettingsSelect
                              id="sidebar-position-select"
                              className="w-full sm:w-48"
                              value={parseSidebarPosition(settings?.sidebar_position)}
                              options={SIDEBAR_POSITIONS.map((pos) => ({
                                value: pos,
                                label: tt(`settings.launcher.sidebarPosition.${pos}`),
                              }))}
                              onChange={(pos) => updateSettings({ sidebar_position: pos })}
                            />
                          </SettingsRow>
                        )}
                        {showSetting("launcher.sidebarOrder") && (
                          <SettingsRow label={tt("settings.launcher.sidebarOrder.label")} stacked>
                            <div className="glass-inset flex flex-col gap-0.5 p-1 sm:max-w-sm">
                              {sidebarOrder.map((id, index) => (
                                <div
                                  key={id}
                                  className="flex items-center justify-between gap-3 rounded-xl py-1 pl-3 pr-1 text-sm text-white/85 hover:bg-white/[0.035]"
                                >
                                  <span className="flex items-center gap-2.5">
                                    <span className="ui-caption w-3 text-right">{index + 1}</span>
                                    {sidebarItemLabel(id)}
                                  </span>
                                  <span className="flex items-center">
                                    <button
                                      type="button"
                                      disabled={index === 0}
                                      onClick={() => moveSidebarItem(id, "up")}
                                      className="icon-btn disabled:opacity-30"
                                      aria-label={tt("settings.launcher.sidebarOrder.moveUp")}
                                      title={tt("settings.launcher.sidebarOrder.moveUp")}
                                    >
                                      <AssetIcon name="arrow_down" className="h-4 w-4 rotate-180" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={index === sidebarOrder.length - 1}
                                      onClick={() => moveSidebarItem(id, "down")}
                                      className="icon-btn disabled:opacity-30"
                                      aria-label={tt("settings.launcher.sidebarOrder.moveDown")}
                                      title={tt("settings.launcher.sidebarOrder.moveDown")}
                                    >
                                      <AssetIcon name="arrow_down" />
                                    </button>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </SettingsRow>
                        )}
                      </SettingsSection>
                    )}

                    {(anyVisible(
                      "launcher.accentColor",
                      "launcher.backgroundImage",
                      "launcher.backgroundBlur",
                      "launcher.backgroundAnimation",
                      "launcher.disableAnimations",
                      "launcher.hideBanners",
                    ) ||
                      (seasonalThemeActive &&
                        showSetting("launcher.disableThematicDecorations"))) && (
                      <SettingsSection
                        title={tt("settings.section.appearance")}
                        icon={<AssetIcon name="palette" />}
                      >
                        {showSetting("launcher.accentColor") && (
                          <SettingsRow label={tt("settings.launcher.accentColor.label")}>
                            <div ref={accentPickerRef} className="relative">
                              <button
                                type="button"
                                aria-expanded={isAccentPickerOpen}
                                onClick={() => setIsAccentPickerOpen((v) => !v)}
                                className="interactive-press glass-control flex h-9 items-center gap-2.5 pl-1.5 pr-3"
                              >
                                <span
                                  className="h-6 w-6 rounded-md ring-1 ring-inset ring-white/15"
                                  style={{ background: accentColor }}
                                />
                                <span className="font-mono text-[0.8125rem] text-white/80">
                                  {accentColor}
                                </span>
                              </button>
                              {isAccentPickerOpen && (
                                <div className="glass-popover absolute right-0 top-full z-40 mt-2 w-80 p-3 text-xs text-white">
                                  <div className="mb-3 text-[0.8125rem] font-semibold text-white/80">
                                    {tt("settings.launcher.accentColor.popupTitle")}
                                    </div>
                                  <div className="mb-3 flex flex-wrap gap-1.5">
                                    {ACCENT_PRESETS.map((preset) => (
                                      <button
                                        key={preset}
                                        type="button"
                                        onClick={() => applyAccentColor(preset)}
                                        aria-label={preset}
                                        title={preset}
                                        className={`interactive-press h-7 w-7 rounded-md ring-inset ${
                                          accentColor.toLowerCase() === preset
                                            ? "ring-2 ring-white"
                                            : "ring-1 ring-white/15 hover:ring-white/40"
                                        }`}
                                        style={{ background: preset }}
                                      />
                                    ))}
                                  </div>
                                  <div className="mb-3 flex items-center gap-3">
                                    <div
                                      ref={accentHueWheelRef}
                                      role="slider"
                                      tabIndex={0}
                                      aria-label={tt("settings.launcher.accentColor.pickColorAria")}
                                      aria-valuemin={0}
                                      aria-valuemax={360}
                                      aria-valuenow={Math.round(accentColorHsv.h)}
                                      className="relative h-14 w-14 shrink-0 cursor-crosshair touch-none select-none rounded-full"
                                      style={{
                                        boxShadow:
                                          "0 0 0 1px rgba(255,255,255,0.12), 0 0 0 1px rgba(0,0,0,0.45) inset, 0 8px 28px rgba(0,0,0,0.55)",
                                      }}
                                      onPointerDown={handleAccentWheelPointerDown}
                                      onPointerMove={handleAccentWheelPointerMove}
                                      onPointerUp={handleAccentWheelPointerEnd}
                                      onPointerCancel={handleAccentWheelPointerEnd}
                                      onKeyDown={(e) => {
                                        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                                        e.preventDefault();
                                        const rgb = hexToRgb(accentColor);
                                        if (!rgb) return;
                                        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                                        const delta = e.key === "ArrowRight" ? 3 : -3;
                                        const next = hsvToRgb((hsv.h + delta + 360) % 360, hsv.s, hsv.v);
                                        applyAccentColor(rgbToHex(next.r, next.g, next.b));
                                      }}
                                    >
                                      <div
                                        className="pointer-events-none absolute inset-0 overflow-hidden rounded-full [backface-visibility:hidden] [transform:translateZ(0)]"
                                        style={ACCENT_HUE_RING_STYLE}
                                      />
                                      <div className="pointer-events-none absolute inset-[10px] rounded-full ring-1 ring-black/50">
                                        <div
                                          className="h-full w-full rounded-full"
                                          style={{ backgroundColor: accentColor }}
                                        />
                                      </div>
                                      <div
                                        className="pointer-events-none absolute left-1/2 top-1/2 z-10"
                                        style={{ width: 0, height: 0 }}
                                      >
                                        <div
                                          style={{
                                            transform: `rotate(${accentColorHsv.h}deg) translateY(-23px)`,
                                          }}
                                        >
                                          <div
                                            className="h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow-[0_2px_8px_rgba(0,0,0,0.55)] ring-1 ring-black/40"
                                            aria-hidden
                                          />
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                                      <span className="ui-caption">
                                        {tt("settings.launcher.accentColor.currentLabel")}
                                      </span>
                                      <div className="relative">
                                        <input
                                          type="text"
                                          maxLength={7}
                                          value={accentInput}
                                          onChange={(e) => setAccentInput(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") e.currentTarget.blur();
                                          }}
                                          onBlur={(e) => {
                                            const raw = e.target.value.trim();
                                            const withHash = raw.startsWith("#") ? raw : `#${raw}`;
                                            if (!raw || !/^#[0-9a-fA-F]{6}$/.test(withHash)) {
                                              setAccentInput(accentColor);
                                              return;
                                            }
                                            applyAccentColor(withHash.toLowerCase());
                                          }}
                                          className={`glass-control h-8 w-full px-2.5 font-mono text-[0.8125rem] text-white/85 outline-none ${
                                            accentInput ? "pr-8" : ""
                                          }`}
                                        />
                                        <InputClearButton
                                          value={accentInput}
                                          onClear={() => setAccentInput("")}
                                          className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                                          aria-label={tt("common.clear")}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div className="ui-caption mb-1.5">
                                    {tt("settings.launcher.accentColor.svPadLabel")}
                                  </div>
                                  <div
                                    ref={accentSvPadRef}
                                    className="relative h-24 w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl ring-1 ring-white/10"
                                    style={{
                                      backgroundImage: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, hsl(${accentColorHsv.h} 100% 50%))`,
                                    }}
                                    aria-label={tt("settings.launcher.accentColor.svPadAria")}
                                    onPointerDown={handleAccentSvPointerDown}
                                    onPointerMove={handleAccentSvPointerMove}
                                    onPointerUp={handleAccentSvPointerEnd}
                                    onPointerCancel={handleAccentSvPointerEnd}
                                  >
                                    <div
                                      className="pointer-events-none absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white/95 shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-black/35"
                                      style={{
                                        left: `${accentColorHsv.s}%`,
                                        top: `${100 - accentColorHsv.v}%`,
                                      }}
                                      aria-hidden
                                    />
                                  </div>
                                  <p className="ui-caption mt-2">
                                    {tt("settings.launcher.accentColor.helpText")}
                                  </p>
                                </div>
                              )}
                            </div>
                          </SettingsRow>
                        )}
                        {showSetting("launcher.backgroundImage") && (
                          <SettingsRow
                            label={tt("settings.launcher.backgroundImage.label")}
                            hint={tt("settings.launcher.backgroundImage.hint")}
                          >
                            <button
                              type="button"
                              onClick={() => void chooseBackgroundImage()}
                              className="btn btn-sm btn-soft"
                            >
                              {tt("settings.launcher.backgroundImage.choose")}
                            </button>
                            {settings?.background_image_url && (
                              <button
                                type="button"
                                onClick={() => void resetBackgroundImage()}
                                className="btn btn-sm btn-ghost"
                              >
                                {tt("settings.common.reset")}
                              </button>
                            )}
                          </SettingsRow>
                        )}
                        {showSetting("launcher.backgroundBlur") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.backgroundBlur.label")}
                            value={settings?.background_blur_enabled ?? true}
                            onChange={(v) => updateSettings({ background_blur_enabled: v })}
                          />
                        )}
                        {showSetting("launcher.backgroundAnimation") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.backgroundAnimation.label")}
                            hint={tt("settings.launcher.backgroundAnimation.hint")}
                            value={!(settings?.background_animation_disabled ?? false)}
                            onChange={(v) => updateSettings({ background_animation_disabled: !v })}
                          />
                        )}
                        {showSetting("launcher.disableAnimations") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.disableAnimations.label")}
                            value={settings?.animations_disabled ?? false}
                            onChange={(v) => updateSettings({ animations_disabled: v })}
                          />
                        )}
                        {showSetting("launcher.hideBanners") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.hideBanners.label")}
                            hint={tt("settings.launcher.hideBanners.hint")}
                            value={!(settings?.show_launcher_banners ?? true)}
                            onChange={(v) => updateSettings({ show_launcher_banners: !v })}
                          />
                        )}
                        {seasonalThemeActive && showSetting("launcher.disableThematicDecorations") && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.disableThematicDecorations.label")}
                            hint={tt("settings.launcher.disableThematicDecorations.hint") || undefined}
                            value={settings?.thematic_decorations_disabled ?? false}
                            onChange={(v) => updateSettings({ thematic_decorations_disabled: v })}
                          />
                        )}
                      </SettingsSection>
                    )}

                    {showSetting("launcher.customThemes") && (
                      <SettingsSection
                        title={tt("settings.section.themes")}
                        icon={<AssetIcon name="brush" />}
                        actions={
                          <button
                            type="button"
                            disabled={themesLoading}
                            onClick={() => void refreshThemes()}
                            className="btn btn-sm btn-ghost"
                          >
                            <AssetIcon
                              name="updates"
                              className={`h-3.5 w-3.5 ${themesLoading ? "animate-spin" : ""}`}
                              />
                            {tt("settings.launcher.customThemes.refresh")}
                          </button>
                        }
                      >
                        <div className="flex flex-col gap-3 py-3.5">
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
                            <ThemeCard
                              name={tt("settings.launcher.customThemes.default")}
                              subtitle="16Launcher"
                              selected={!activeThemeId}
                              disabled={editingThemeId != null}
                              accentColor={accentColor}
                              onClick={() => updateSettings({ custom_theme_id: null })}
                            />
                            {installedThemes.map((theme) => (
                              <ThemeCard
                                key={theme.id}
                                name={theme.name}
                                subtitle={[
                                  theme.author
                                    ? tt("settings.launcher.customThemes.byAuthor", {
                                        author: theme.author,
                                      })
                                    : "",
                                  theme.version ? `v${theme.version}` : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                                title={theme.description || undefined}
                                selected={activeThemeId === theme.id}
                                disabled={editingThemeId != null}
                                preview={theme.preview}
                                variables={theme.variables}
                                accentColor={accentColor}
                                onClick={() => updateSettings({ custom_theme_id: theme.id })}
                              />
                            ))}
                          </div>
                          {themesLoading && installedThemes.length === 0 && (
                            <p className="ui-meta">{tt("settings.launcher.customThemes.loading")}</p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void createTheme()}
                              className="btn btn-sm btn-soft"
                            >
                              {tt("settings.launcher.customThemes.create")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void importThemeZip()}
                              className="btn btn-sm btn-soft"
                            >
                              {tt("settings.launcher.customThemes.importZip")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void openThemesFolder()}
                              className="btn btn-sm btn-ghost"
                            >
                              <AssetIcon name="folder" className="h-3.5 w-3.5" />
                              {tt("settings.launcher.customThemes.openFolder")}
                            </button>
                          </div>
                        </div>
                        {activeThemeId && (
                          <div className="flex flex-col gap-3 py-3.5">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white/90">
                                {activeTheme?.name ?? activeThemeId}
                              </div>
                              {activeTheme?.description ? (
                                <p className="ui-meta mt-0.5">{activeTheme.description}</p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingThemeId(activeThemeId)}
                                disabled={editingThemeId != null}
                                className="btn btn-sm btn-tint"
                              >
                                {tt("settings.launcher.customThemes.openEditor")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void openActiveThemeCss()}
                                className="btn btn-sm btn-soft"
                              >
                                {tt("settings.launcher.customThemes.editCss")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void duplicateActiveTheme()}
                                disabled={editingThemeId != null}
                                className="btn btn-sm btn-soft"
                              >
                                {tt("settings.launcher.customThemes.duplicate")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void exportActiveTheme()}
                                className="btn btn-sm btn-soft"
                              >
                                {tt("settings.launcher.customThemes.exportZip")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteActiveTheme()}
                                className="btn btn-sm btn-danger"
                              >
                                {tt("settings.launcher.customThemes.delete")}
                              </button>
                            </div>
                          </div>
                        )}
                        {activeThemeId && (
                          <SettingsSwitchRow
                            label={tt("settings.launcher.customThemes.hotReload.label")}
                            hint={tt("settings.launcher.customThemes.hotReload.hint")}
                            value={settings?.custom_theme_hot_reload ?? false}
                            onChange={(v) => updateSettings({ custom_theme_hot_reload: v })}
                          />
                        )}
                        {editingThemeId && (
                          <ThemeEditorPanel
                            themeId={editingThemeId}
                            tt={tt}
                            onClose={() => setEditingThemeId(null)}
                            onSaved={() => void refreshThemes()}
                            showNotification={showNotification}
                          />
                        )}
                      </SettingsSection>
                    )}

                    {anyVisible("launcher.cache", "launcher.backup", "launcher.resetSettings") && (
                      <SettingsSection
                        title={tt("settings.section.data")}
                        icon={<AssetIcon name="storage" />}
                      >
                        {showSetting("launcher.cache") && (
                          <SettingsRow
                            label={tt("settings.launcher.cache.label")}
                            hint={
                              <>
                                {tt("settings.launcher.cache.description")}{" "}
                                <span className="text-white/70">
                                  {isCacheLoading
                                    ? tt("settings.launcher.cache.loading")
                                    : tt("settings.launcher.cache.sizeLabel", {
                                        size: formatCacheSize(cacheSizeBytes),
                                      })}
                                </span>
                              </>
                            }
                          >
                            <button
                              type="button"
                              onClick={() => void handleClearCache()}
                              disabled={isCacheLoading}
                              className="btn btn-sm btn-soft"
                            >
                              <AssetIcon name="delete" className="h-3.5 w-3.5" />
                              {tt("settings.launcher.cache.clearButton")}
                            </button>
                          </SettingsRow>
                        )}
                        {showSetting("launcher.backup") && (
                          <SettingsRow
                            label={tt("settings.launcher.backup.title")}
                            hint={tt("settings.launcher.backup.hint")}
                          >
                            <button
                              type="button"
                              onClick={() => void handleExportSettings()}
                              disabled={isExportingSettings}
                              className="btn btn-sm btn-soft"
                            >
                              {isExportingSettings
                                ? tt("settings.launcher.backup.exporting").trim()
                                : tt("settings.launcher.backup.exportButton")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleImportSettings()}
                              disabled={isImportingSettings}
                              className="btn btn-sm btn-soft"
                            >
                              {isImportingSettings
                                ? tt("settings.launcher.backup.importing")
                                : tt("settings.launcher.backup.importButton")}
                            </button>
                          </SettingsRow>
                        )}
                        {showSetting("launcher.resetSettings") && (
                          <SettingsRow
                            label={tt("settings.launcher.resetSettings.button")}
                            hint={tt("settings.launcher.resetSettings.hint")}
                          >
                            <button
                              type="button"
                              onClick={() => void handleResetSettings()}
                              disabled={isResettingSettings}
                              className="btn btn-sm btn-danger"
                            >
                              {tt("settings.common.reset")}
                            </button>
                          </SettingsRow>
                        )}
                      </SettingsSection>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
