import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";
import { playNotificationSound, playTabSwitchSound, primeUiSounds } from "./uiSounds";
import {
  SettingsToggle,
  SettingsSlider,
  SettingsCard,
} from "./settings-ui/SettingsComponents";
import { ModsTab } from "./tabs/ModsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { ModpackTab } from "./tabs/ModpackTab";
import { PlayTab } from "./tabs/PlayTab";
import { TabSplitDropOverlay } from "./components/tab_split_drop_overlay";
import { LauncherBackgroundImage } from "./components/LauncherBackgroundImage";
import { AccountAvatar } from "./components/account_avatar";
import { DeleteIcon } from "./components/delete_icon";
import {
  ProfileInfoIcon,
  ProfileInfoModal,
  type ProfileInfoData,
} from "./components/profile_info_modal";
import { ProfileInstanceIcon } from "./components/profile_instance_icon";
import { ActiveDownloadsPanel } from "./components/ActiveDownloadsPanel";
import { useDownloadJobs } from "./hooks/useDownloadJobs";
import {
  useHotkeys,
  type ModpackHotkeyActions,
  type ModpackNavigationActions,
  type ModpackViewId,
  type PlayConsoleHotkeyActions,
} from "./hooks/useHotkeys";
import { useGameConsoleWindow } from "./hooks/useGameConsoleWindow";
import {
  isAnimatedBackgroundPath,
  resolveLauncherBackgroundUrl,
  shouldLoadBackgroundDataUri,
} from "./lib/launcherBackground";
import type { ProfileAvatarInput } from "./lib/avatar";
import {
  isGameConsoleLineImportant,
  resetGameConsoleFilter,
} from "./lib/gameConsoleFilter";
import { useT, t, isLanguage, readStoredLanguage, type Language } from "./i18n";
import {
  OnboardingFlow,
  ONBOARDING_COMPLETED_STORAGE_KEY,
  ONBOARDING_FORCE_STORAGE_KEY,
  ONBOARDING_LEGACY_MIGRATED_KEY,
} from "./onboarding";
import {
  applyTabDrop,
  detectDropZone,
  isSplittableTab,
  loadTabSplitLayout,
  saveTabSplitLayout,
  tabAfterClosingSplitPane,
  tabPaneRole,
  TAB_DRAG_THRESHOLD_PX,
  TAB_SPLIT_RATIO_MAX,
  TAB_SPLIT_RATIO_MIN,
  type SplittableTabId,
  type TabDropZone,
  type TabSplitLayout,
} from "./splitView";

type Profile = {
  nickname: string;
  ely_username: string | null;
  ely_uuid: string | null;
  ms_id_token: string | null;
  mc_uuid: string | null;
};

type LauncherAccountSummary = {
  id: string;
  label: string;
  kind: string;
  is_active: boolean;
};

type SidebarItemId = "play" | "settings" | "mods" | "modpacks" | "accounts";
type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";

type SettingsTabId = "game" | "versions" | "launcher";

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
  forge_ipv6_download: boolean;
  forge_proxy_fallback: boolean;
  notify_new_update: boolean;
  notify_new_message: boolean;
  notify_system_message: boolean;
  check_updates_on_start: boolean;
  auto_install_updates: boolean;
  open_launcher_on_profiles_tab: boolean;
  ui_sounds_enabled: boolean;
  interface_language?: string;
  background_accent_color: string;
  background_image_url: string | null;
  background_blur_enabled: boolean;
  split_view_enabled: boolean;
  sidebar_position?: string;
  onboarding_completed?: boolean;
};

const SIDEBAR_POSITIONS = ["left", "right", "top", "bottom"] as const;
type SidebarPosition = (typeof SIDEBAR_POSITIONS)[number];

function parseSidebarPosition(value: string | undefined | null): SidebarPosition {
  if (value && SIDEBAR_POSITIONS.includes(value as SidebarPosition)) {
    return value as SidebarPosition;
  }
  return "left";
}

function isSidebarHorizontal(position: SidebarPosition): boolean {
  return position === "top" || position === "bottom";
}

type InstanceProfileSummary = {
  id: string;
  name: string;
  game_version: string;
  loader: string;
  loader_version?: string | null;
};

type InstanceProfileCard = InstanceProfileSummary & {
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

const SIDEBAR_ICON_PATHS: Partial<Record<SidebarItemId, string>> = {
  play: "/launcher-assets/play64.png",
  settings: "/launcher-assets/settings.png",
  mods: "/launcher-assets/mods.png",
  modpacks: "/launcher-assets/modpack_icon.png",
};

const NECO_ARC_SECRET_SOUND_SRC =
  "/launcher-assets/sounds/" + encodeURIComponent("secret (shhh...).mp3");
const NECO_ARC_SECRET_SOUND_VOLUME = 0.05;

function normalizeNicknameForSecretCheck(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function accountKindAvatarClass(kind: string): string {
  if (kind === "microsoft") return "bg-sky-600/35 text-sky-100 ring-1 ring-sky-400/25";
  if (kind === "ely") return "bg-emerald-700/40 text-emerald-100 ring-1 ring-emerald-400/20";
  return "bg-white/10 text-white/80 ring-1 ring-white/10";
}

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

type VersionItem = VersionSummary | ForgeVersionSummary | NeoForgeVersionSummary;

function isForgeVersion(v: VersionItem): v is ForgeVersionSummary {
  return "forge_build" in v && "installer_url" in v;
}

function isNeoForgeVersion(v: VersionItem): v is NeoForgeVersionSummary {
  return "neoforge_build" in v && "installer_url" in v;
}

function versionInstallJobId(versionId: string) {
  return `version:${versionId}`;
}

function getVersionLabel(v: VersionItem): string {
  if (isForgeVersion(v)) {
    return `Forge ${v.mc_version}-${v.forge_build}`;
  }
  if (isNeoForgeVersion(v)) {
    return `NeoForge ${v.mc_version}-${v.neoforge_build}`;
  }
  return v.id;
}

type DownloadProgressPayload = {
  version_id: string;
  downloaded: number;
  total: number;
  percent: number;
};

type GameConsoleLinePayload = {
  line: string;
  source: "stdout" | "stderr";
};

type GameConsoleLine = GameConsoleLinePayload & {
  id: number;
};

type GameConsoleSession = {
  id: string;
  startedAt: number;
  endedAt?: number;
  lines: GameConsoleLine[];
};

type ProfileConsoleData = {
  lines: GameConsoleLine[];
  sessions: GameConsoleSession[];
};

const GAME_CONSOLE_STORAGE_KEY = "game_console_persist_v2";
const GAME_CONSOLE_STORAGE_KEY_V1 = "game_console_persist_v1";
const MAX_CONSOLE_LINES = 2000;
const MAX_ARCHIVED_SESSIONS = 25;

function normalizeConsoleLine(l: unknown, i: number): GameConsoleLine | null {
  if (!l || typeof l !== "object") return null;
  const o = l as Record<string, unknown>;
  const line = typeof o.line === "string" ? o.line : "";
  const source = o.source === "stderr" ? "stderr" : "stdout";
  const id =
    typeof o.id === "number" && Number.isFinite(o.id)
      ? o.id
      : Date.now() + i + Math.random();
  return { id, line, source };
}

function normalizeConsoleSessions(sessionsRaw: unknown): GameConsoleSession[] {
  if (!Array.isArray(sessionsRaw)) return [];
  return sessionsRaw
    .flatMap((s, si): GameConsoleSession[] => {
      if (!s || typeof s !== "object") return [];
      const o = s as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : `${Date.now()}-${si}`;
      const startedAt =
        typeof o.startedAt === "number" && Number.isFinite(o.startedAt)
          ? o.startedAt
          : Date.now();
      const endedAt =
        typeof o.endedAt === "number" && Number.isFinite(o.endedAt) ? o.endedAt : undefined;
      const lr = Array.isArray(o.lines) ? o.lines : [];
      const slines = lr
        .map((l, i) => normalizeConsoleLine(l, i + si * 1000))
        .filter((x): x is GameConsoleLine => x !== null)
        .slice(-MAX_CONSOLE_LINES);
      const session: GameConsoleSession = { id, startedAt, lines: slines };
      if (endedAt !== undefined) session.endedAt = endedAt;
      return [session];
    })
    .slice(0, MAX_ARCHIVED_SESSIONS);
}

function normalizeProfileConsoleData(raw: unknown): ProfileConsoleData {
  if (!raw || typeof raw !== "object") {
    return { lines: [], sessions: [] };
  }
  const o = raw as Record<string, unknown>;
  const linesRaw = Array.isArray(o.lines) ? o.lines : [];
  const lines = linesRaw
    .map((l, i) => normalizeConsoleLine(l, i))
    .filter((x): x is GameConsoleLine => x !== null)
    .slice(-MAX_CONSOLE_LINES);
  return { lines, sessions: normalizeConsoleSessions(o.sessions) };
}

function loadPersistedGameConsoleByProfile(): Record<string, ProfileConsoleData> {
  if (typeof window === "undefined") return {};
  try {
    const rawV2 = window.localStorage.getItem(GAME_CONSOLE_STORAGE_KEY);
    if (rawV2) {
      const data = JSON.parse(rawV2) as { byProfile?: unknown };
      const byProfileRaw =
        data.byProfile && typeof data.byProfile === "object"
          ? (data.byProfile as Record<string, unknown>)
          : {};
      const out: Record<string, ProfileConsoleData> = {};
      for (const [profileId, value] of Object.entries(byProfileRaw)) {
        if (typeof profileId !== "string" || !profileId.trim()) continue;
        out[profileId] = normalizeProfileConsoleData(value);
      }
      return out;
    }

    const rawV1 = window.localStorage.getItem(GAME_CONSOLE_STORAGE_KEY_V1);
    if (!rawV1) return {};
    const data = JSON.parse(rawV1) as { lines?: unknown; sessions?: unknown };
    const migrated = normalizeProfileConsoleData(data);
    if (migrated.lines.length === 0 && migrated.sessions.length === 0) return {};

    let migrateProfileId: string | null = null;
    try {
      migrateProfileId = window.localStorage.getItem("modpacks_selected_profile_id");
    } catch {
    }
    if (!migrateProfileId?.trim()) return {};
    return { [migrateProfileId]: migrated };
  } catch {
    return {};
  }
}

type GameStatus = "idle" | "running" | "stopped" | "crashed";

type NotificationKind = "info" | "success" | "error" | "warning";

type Notification = {
  id: number;
  kind?: NotificationKind;
  message: string;
  leaving?: boolean;
  count?: number;
  colorMsg?: string;
  iconMsg?: string;
};

type ShowNotificationOptions = {
  sound?: boolean;
};

type NotificationIdentity = Pick<Notification, "kind" | "message" | "colorMsg" | "iconMsg">;

function notificationsMatch(a: NotificationIdentity, b: NotificationIdentity): boolean {
  return (
    a.kind === b.kind &&
    a.message === b.message &&
    (a.colorMsg ?? "") === (b.colorMsg ?? "") &&
    (a.iconMsg ?? "") === (b.iconMsg ?? "")
  );
}

function appendAlphaToHex(hex: string, alpha01: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha01)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`.toUpperCase();
}

function isHexColor(value: string): value is `#${string}` {
  return /^#([0-9a-fA-F]{6})$/.test(value.trim());
}

function getTextColorForHexBg(hex: string): "black" | "white" {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "white";
  const raw = m[1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 160 ? "black" : "white";
}

function resolveRemoteNotificationIconSrc(iconMsg?: string): string | null {
  if (!iconMsg) return null;
  const v = iconMsg.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || v.startsWith("/")) return v;

  if (/^[a-zA-Z0-9_-]+\.(png|webp|gif)$/i.test(v)) {
    return `/launcher-assets/${v}`;
  }

  const lower = v.toLowerCase();
  if (lower === "info") return "/launcher-assets/info.png";
  if (lower === "success") return "/launcher-assets/success.png";
  if (lower === "error") return "/launcher-assets/errorIcon.png";
  if (lower === "warning" || lower === "warn") return "/launcher-assets/warn.png";

  return null;
}

function normalizeOptionalString(value?: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

function resolveRemoteNotificationKindFromColorMsg(colorMsg?: string): NotificationKind | null {
  const c = normalizeOptionalString(colorMsg)?.toLowerCase();
  if (!c) return null;

  if (c === "red") return "error";
  if (c === "green") return "success";
  if (c === "yellow") return "warning";
  if (c === "gray" || c === "grey") return "info";

  if (c === "info") return "info";
  if (c === "success") return "success";
  if (c === "error") return "error";
  if (c === "warning") return "warning";

  return null;
}

function resolveRemoteNotificationBgStyle(
  colorMsg?: string,
): { background: string; border: string; textColor: "black" | "white" } | null {
  if (!colorMsg) return null;
  const v = colorMsg.trim();
  if (!v) return null;

  if (isHexColor(v)) {
    const background = appendAlphaToHex(v.toUpperCase(), 0.95);
    const border = appendAlphaToHex(v.toUpperCase(), 0.45);
    const textColor = getTextColorForHexBg(v);
    return { background, border, textColor };
  }

  return {
    background: v,
    border: "rgba(255, 255, 255, 0.35)",
    textColor: "white",
  };
}

type RemoteNotificationsJsonItem = {
  "color-msg"?: string;
  "icon-msg"?: string;
  "text-msg"?: string;

  colorMsg?: string;
  iconMsg?: string;
  textMsg?: string;

  type?: string;
};

type RemoteNotificationHyphenKey = "color-msg" | "icon-msg" | "text-msg";
type RemoteNotificationCamelKey = "colorMsg" | "iconMsg" | "textMsg";

type BottomSocialKind = "discord" | "telegram";

type BottomSocialNotification = {
  id: number;
  kind: BottomSocialKind;
  colorMsg?: string;
  iconMsg?: string;
  textMsg?: string;
  messageKey?: "app.social.discord" | "app.social.telegram";
  leaving?: boolean;
};

function SocialIcon({ kind }: { kind: BottomSocialKind }) {
  const src = kind === "discord" ? "/launcher-assets/discord.png" : "/launcher-assets/telegram.png";
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span className="text-sm font-extrabold text-white">
        {kind === "discord" ? "D" : "T"}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="h-5 w-5 object-contain"
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

function getRemoteItemField(
  item: RemoteNotificationsJsonItem,
  hyphenKey: RemoteNotificationHyphenKey,
  camelKey: RemoteNotificationCamelKey,
) {
  return item[hyphenKey] ?? item[camelKey];
}

function splitTitleAndSubtitle(textMsg: string): { title: string; subtitle?: string } {
  const normalized = (textMsg ?? "").trim();
  if (!normalized) return { title: "" };
  const parts = normalized.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) return { title: parts[0] };
  return { title: parts[0], subtitle: parts.slice(1).join("\n") };
}

const NOTIFICATIONS_CACHE_BUST = `?t=${Date.now()}`;
const REMOTE_NOTIFICATIONS_URLS = [
  `https://raw.githubusercontent.com/16steyy/16Launcher-News/main/notifications.json${NOTIFICATIONS_CACHE_BUST}`,
  `https://cdn.jsdelivr.net/gh/16steyy/16Launcher-News@main/notifications.json${NOTIFICATIONS_CACHE_BUST}`,
];

const DISCORD_LINK = "https://discord.gg/cpW2AnW9Vy";
const TELEGRAM_LINK = "https://t.me/of16launcher";

const DEFAULT_SIDEBAR_ORDER: SidebarItemId[] = ["play", "settings", "mods", "modpacks"];

const sidebarItems: { id: SidebarItemId; labelKey: string }[] = [
  { id: "play", labelKey: "app.sidebar.play" },
  { id: "settings", labelKey: "app.sidebar.settings" },
  { id: "mods", labelKey: "app.sidebar.mods" },
  { id: "modpacks", labelKey: "app.sidebar.modpacks" },
];

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 fill-current"
      aria-hidden="true"
    >
      <path d="M8 6.5v11l9-5.5-9-5.5z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 fill-current"
      aria-hidden="true"
    >
      <path d="M12 8.5a3.5 3.5 0 1 0 .001 7.001A3.5 3.5 0 0 0 12 8.5Zm9 3.25-1.8-1.04.16-2.08-2.12-.84-.84-2.12-2.08.16L12 2.75l-1.32 1.88-2.08-.16-.84 2.12-2.12.84.16 2.08L3 11.75v2.5l1.8 1.04-.16 2.08 2.12.84.84 2.12 2.08-.16L12 21.25l1.32-1.88 2.08.16.84-2.12 2.12-.84-.16-2.08L21 14.25v-2.5Z" />
    </svg>
  );
}

function ModsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 fill-current"
      aria-hidden="true"
    >
      <path d="M11.2 3.1a2 2 0 0 1 1.6 0l6.1 2.7a1.5 1.5 0 0 1 .9 1.37V16.8a1.5 1.5 0 0 1-.9 1.37l-6.1 2.73a2 2 0 0 1-1.6 0L5.1 18.17A1.5 1.5 0 0 1 4.2 16.8V7.17A1.5 1.5 0 0 1 5.1 5.8l6.1-2.7Z" />
    </svg>
  );
}

function ModpackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 fill-current"
      aria-hidden="true"
    >
      <path d="M4 4h16v4h-2V6H6v12h4v2H4V4zm14 6v10H8V10h10zm-2 2h-6v6h6v-6z" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-8 w-8 fill-current"
      aria-hidden="true"
    >
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3 0-8 1.5-8 4.5V21h16v-2.5C20 15.5 15 14 12 14Z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true">
      <path d="M16.84 2.73a2.5 2.5 0 0 1 3.54 3.54l-1.06 1.06-3.54-3.54 1.06-1.06ZM4.92 14.49l9.19-9.19 3.54 3.54-9.19 9.19-3.82.42.42-3.96Z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M11 5v6H5v2h6v6h2v-6h6v-2h-6V5h-2Z"
      />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 shrink-0 fill-current transition-transform ${className ?? ""}`}
      aria-hidden="true"
    >
      <path d="M7 10l5 5 5-5H7z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path fill="#f25022" d="M2 2h9.5v9.5H2V2z" />
      <path fill="#00a4ef" d="M12.5 2H22v9.5h-9.5V2z" />
      <path fill="#7fba00" d="M2 12.5H11.5V22H2v-9.5z" />
      <path fill="#ffb900" d="M12.5 12.5H22V22h-9.5v-9.5z" />
    </svg>
  );
}

function ElyByIcon() {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#2d7d46] text-[10px] font-bold text-white">
      E
    </span>
  );
}

function MinimizeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 fill-current"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="2" rx="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 fill-current"
      aria-hidden="true"
    >
      <path d="M6.7 6.7a1 1 0 0 1 1.4 0L12 10.6l3.9-3.9a1 1 0 0 1 1.4 1.4L13.4 12l3.9 3.9a1 1 0 0 1-1.4 1.4L12 13.4l-3.9 3.9a1 1 0 0 1-1.4-1.4L10.6 12 6.7 8.1a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect
        x="5"
        y="5"
        width="14"
        height="14"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

const LAUNCHER_UPDATE_BADGE_STORAGE_KEY = "mc16launcher:lastLauncherUpdateBadge";

function App() {
  const [activeItem, setActiveItem] = useState<SidebarItemId>("play");
  const [tabSplitLayout, setTabSplitLayout] = useState<TabSplitLayout | null>(() =>
    loadTabSplitLayout(),
  );
  const [tabDrag, setTabDrag] = useState<{
    tab: SplittableTabId;
    x: number;
    y: number;
  } | null>(null);
  const [tabDropZone, setTabDropZone] = useState<TabDropZone | null>(null);
  const tabDropZoneRef = useRef<TabDropZone | null>(null);
  const [isTabSplitDividerDragging, setIsTabSplitDividerDragging] = useState(false);
  const mainSplitRef = useRef<HTMLElement | null>(null);
  const sidebarTabDragRef = useRef<{
    tab: SplittableTabId;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const sidebarTabDragListenersRef = useRef<(() => void) | null>(null);
  const sidebarDragConsumedRef = useRef(false);
  const tabSplitDividerDragRef = useRef<{
    startCoord: number;
    startRatio: number;
    direction: TabSplitLayout["direction"];
  } | null>(null);
  const [sidebarOrder, setSidebarOrder] = useState<SidebarItemId[]>(() => {
    if (typeof window === "undefined") return DEFAULT_SIDEBAR_ORDER;
    try {
      const raw = window.localStorage.getItem("sidebar_order");
      if (!raw) return DEFAULT_SIDEBAR_ORDER;
      const parsed = JSON.parse(raw);
      const allowed: SidebarItemId[] = ["play", "settings", "mods", "modpacks"];
      if (
        Array.isArray(parsed) &&
        parsed.every((id) => allowed.includes(id))
      ) {
        return parsed as SidebarItemId[];
      }
    } catch {
    }
    return DEFAULT_SIDEBAR_ORDER;
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const sidebarPosition = parseSidebarPosition(settings?.sidebar_position);
  const sidebarHorizontal = isSidebarHorizontal(sidebarPosition);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarButtonRefs = useRef<
    Partial<Record<SidebarItemId, HTMLButtonElement | null>>
  >({});
  const [sidebarIndicator, setSidebarIndicator] = useState<{
    offset: number;
    span: number;
    ready: boolean;
  }>({ offset: 0, span: 32, ready: false });

  const updateSidebarIndicator = useCallback(() => {
    const container = sidebarRef.current;
    const btn = sidebarButtonRefs.current[activeItem];
    if (!container || !btn) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const horizontal = isSidebarHorizontal(parseSidebarPosition(settings?.sidebar_position));

    if (horizontal) {
      const span = Math.max(24, btnRect.width);
      const offset = btnRect.left - containerRect.left;
      setSidebarIndicator({ offset, span, ready: true });
      return;
    }

    const span = 32;
    const offset = btnRect.top - containerRect.top + (btnRect.height - span) / 2;
    setSidebarIndicator({ offset, span, ready: true });
  }, [activeItem, settings?.sidebar_position]);

  useLayoutEffect(() => {
    updateSidebarIndicator();
  }, [updateSidebarIndicator, sidebarPosition]);

  useEffect(() => {
    let raf = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateSidebarIndicator);
    };
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [updateSidebarIndicator]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

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
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<VersionItem | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false);
  const [isLoaderDropdownOpen, setIsLoaderDropdownOpen] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<DownloadProgressPayload | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installedGameVersions, setInstalledGameVersions] = useState<Set<string>>(new Set());
  const [fabricProfileId, setFabricProfileId] = useState<string | null>(null);
  const [quiltProfileId, setQuiltProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>({
    nickname: "",
    ely_username: null,
    ely_uuid: null,
    ms_id_token: null,
    mc_uuid: null,
  });
  const [elyLoading, setElyLoading] = useState(false);
  const [elyAuthUrl, setElyAuthUrl] = useState<string | null>(null);
  const [msLoading, setMsLoading] = useState(false);
  const [msAuthUrl, setMsAuthUrl] = useState<string | null>(null);
  const [launcherAccounts, setLauncherAccounts] = useState<LauncherAccountSummary[]>([]);
  const [addingAccount, setAddingAccount] = useState(false);
  const [pendingRemoveAccountId, setPendingRemoveAccountId] = useState<string | null>(null);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const accountSwitcherRef = useRef<HTMLDivElement | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [installPaused, setInstallPaused] = useState(false);
  const installStopReasonRef = useRef<"pause" | "cancel" | null>(null);
  const versionInstallJobIdRef = useRef<string | null>(null);
  const {
    jobs: activeDownloadJobs,
    startJob: startDownloadJob,
    updateJobProgress: updateDownloadJobProgress,
    setJobPaused: setDownloadJobPaused,
    finishJob: finishDownloadJob,
    makeJobId: makeDownloadJobId,
  } = useDownloadJobs();
  const prevActiveItemRef = useRef<SidebarItemId>(activeItem);
  const lastPersistedNickNormRef = useRef<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationTimersRef = useRef(
    new Map<
      number,
      {
        fade?: ReturnType<typeof setTimeout>;
        remove?: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const [bottomSocialNotifications, setBottomSocialNotifications] = useState<BottomSocialNotification[]>([]);
  const didLoadedRemoteNotificationsRef = useRef(false);
  const didLoadedBottomSocialRef = useRef(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("game");
  const [modpackView, setModpackView] = useState<ModpackViewId>("list");
  const [requestedModpackView, setRequestedModpackView] = useState<ModpackViewId | null>(
    null,
  );
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "downloading" | "installing" | "up-to-date" | "error"
  >("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateDownloadPercent, setUpdateDownloadPercent] = useState<number | null>(null);
  const [systemMemoryGb, setSystemMemoryGb] = useState<number>(16);
  const [language, setLanguage] = useState<Language>(
    () => readStoredLanguage() ?? "ru",
  );
  const [onboardingVisible, setOnboardingVisible] = useState<boolean | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [launcherVersion, setLauncherVersion] = useState<string | null>(null);
  const [launcherUpdateBadge, setLauncherUpdateBadge] = useState<"latest" | "outdated" | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = sessionStorage.getItem(LAUNCHER_UPDATE_BADGE_STORAGE_KEY);
      if (v === "latest" || v === "outdated") return v;
    } catch {
    }
    return null;
  });
  const persistLauncherUpdateBadge = useCallback((v: "latest" | "outdated") => {
    setLauncherUpdateBadge(v);
    try {
      sessionStorage.setItem(LAUNCHER_UPDATE_BADGE_STORAGE_KEY, v);
    } catch {
    }
  }, []);
  const tt = useT(language);

  const refreshLauncherAccounts = useCallback(async () => {
    try {
      const list = await invoke<LauncherAccountSummary[]>("list_launcher_accounts");
      setLauncherAccounts(list);
    } catch {
      setLauncherAccounts([]);
    }
  }, []);

  useEffect(() => {
    void refreshLauncherAccounts();
  }, [refreshLauncherAccounts]);

  useEffect(() => {
    if (!accountSwitcherOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = accountSwitcherRef.current;
      if (el && !el.contains(e.target as Node)) setAccountSwitcherOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [accountSwitcherOpen]);

  const accountKindShortLabel = useCallback(
    (kind: string) => {
      if (kind === "microsoft") return tt("app.accounts.kindMicrosoft");
      if (kind === "ely") return tt("app.accounts.kindEly");
      return tt("app.accounts.kindOffline");
    },
    [tt],
  );

  useEffect(() => {
    const onFirstGesture = () => primeUiSounds();
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, []);

  const splitViewEnabled = settings?.split_view_enabled ?? false;
  const effectiveTabSplit =
    splitViewEnabled && tabSplitLayout ? tabSplitLayout : null;

  const playConsoleHotkeysRef = useRef<PlayConsoleHotkeyActions | null>(null);
  const modpackHotkeysRef = useRef<ModpackHotkeyActions | null>(null);
  const modpackNavRef = useRef<ModpackNavigationActions | null>(null);

  const registerPlayConsoleHotkeys = useCallback(
    (actions: PlayConsoleHotkeyActions | null) => {
      playConsoleHotkeysRef.current = actions;
    },
    [],
  );

  const registerModpackHotkeys = useCallback(
    (actions: ModpackHotkeyActions | null) => {
      modpackHotkeysRef.current = actions;
    },
    [],
  );

  const registerModpackNavigation = useCallback(
    (actions: ModpackNavigationActions | null) => {
      modpackNavRef.current = actions;
    },
    [],
  );

  const clearRequestedModpackView = useCallback(() => {
    setRequestedModpackView(null);
  }, []);

  const splitDropZoneLabels = useMemo(
    () => ({
      left: tt("app.splitView.zones.left"),
      right: tt("app.splitView.zones.right"),
      top: tt("app.splitView.zones.top"),
      bottom: tt("app.splitView.zones.bottom"),
      center: tt("app.splitView.zones.center"),
    }),
    [tt],
  );

  useEffect(() => {
    if (splitViewEnabled) {
      saveTabSplitLayout(tabSplitLayout);
    } else {
      saveTabSplitLayout(null);
    }
  }, [splitViewEnabled, tabSplitLayout]);

  useEffect(() => {
    if (!splitViewEnabled) return;
    if (tabSplitLayout) return;
    const saved = loadTabSplitLayout();
    if (saved) setTabSplitLayout(saved);
  }, [splitViewEnabled, tabSplitLayout]);

  const setActiveItemWithSound = useCallback(
    (next: SidebarItemId) => {
      const uiSoundsEnabled = settings?.ui_sounds_enabled ?? true;
      if (uiSoundsEnabled && next !== activeItem) playTabSwitchSound();
      setActiveItem(next);
    },
    [activeItem, settings?.ui_sounds_enabled],
  );

  const activateSidebarTab = useCallback(
    (next: SplittableTabId) => {
      if (!effectiveTabSplit) {
        setActiveItemWithSound(next);
        return;
      }
      const role = tabPaneRole(next, effectiveTabSplit);
      if (role) {
        if (effectiveTabSplit.focused !== role) {
          setTabSplitLayout({ ...effectiveTabSplit, focused: role });
        }
        setActiveItemWithSound(next);
        return;
      }
      const updated: TabSplitLayout =
        effectiveTabSplit.focused === "primary"
          ? { ...effectiveTabSplit, primary: next }
          : { ...effectiveTabSplit, secondary: next };
      setTabSplitLayout(updated);
      setActiveItemWithSound(next);
    },
    [effectiveTabSplit, setActiveItemWithSound],
  );

  const dismissTabSplitPane = useCallback(
    (role: "primary" | "secondary") => {
      if (!effectiveTabSplit) return;
      const keepTab = tabAfterClosingSplitPane(effectiveTabSplit, role);
      setTabSplitLayout(null);
      setActiveItemWithSound(keepTab);
    },
    [effectiveTabSplit, setActiveItemWithSound],
  );

  const finishTabDrag = useCallback(
    (clientX: number, clientY: number, draggedTab: SplittableTabId) => {
      sidebarTabDragRef.current = null;
      setTabDrag(null);
      setTabDropZone(null);

      if (!splitViewEnabled) {
        tabDropZoneRef.current = null;
        return;
      }

      sidebarDragConsumedRef.current = true;
      const mainEl = mainSplitRef.current;
      if (!mainEl) {
        tabDropZoneRef.current = null;
        return;
      }

      const rect = mainEl.getBoundingClientRect();
      const zone =
        tabDropZoneRef.current ?? detectDropZone(clientX, clientY, rect);
      tabDropZoneRef.current = null;

      const currentTab = isSplittableTab(activeItem) ? activeItem : "play";
      const { layout, focusedTab } = applyTabDrop(
        draggedTab,
        zone,
        currentTab,
        effectiveTabSplit,
      );
      setTabSplitLayout(layout);
      setActiveItemWithSound(focusedTab);
    },
    [activeItem, effectiveTabSplit, setActiveItemWithSound, splitViewEnabled],
  );

  const cleanupSidebarTabDragListeners = useCallback(() => {
    sidebarTabDragListenersRef.current?.();
    sidebarTabDragListenersRef.current = null;
  }, []);

  const updateTabDragPointer = useCallback((clientX: number, clientY: number, tab: SplittableTabId) => {
    setTabDrag({ tab, x: clientX, y: clientY });
    const mainEl = mainSplitRef.current;
    if (mainEl) {
      const zone = detectDropZone(clientX, clientY, mainEl.getBoundingClientRect());
      tabDropZoneRef.current = zone;
      setTabDropZone(zone);
    }
  }, []);

  const handleSidebarTabPointerDown = useCallback(
    (tab: SplittableTabId, e: ReactPointerEvent<HTMLDivElement>) => {
      if (!splitViewEnabled || e.button !== 0) return;
      e.preventDefault();
      cleanupSidebarTabDragListeners();

      const pointerId = e.pointerId;
      sidebarTabDragRef.current = {
        tab,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const drag = sidebarTabDragRef.current;
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (
          !drag.active &&
          (Math.abs(dx) > TAB_DRAG_THRESHOLD_PX || Math.abs(dy) > TAB_DRAG_THRESHOLD_PX)
        ) {
          drag.active = true;
        }
        if (!drag.active) return;
        updateTabDragPointer(ev.clientX, ev.clientY, drag.tab);
      };

      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanupSidebarTabDragListeners();
        const drag = sidebarTabDragRef.current;
        if (drag?.active) {
          finishTabDrag(ev.clientX, ev.clientY, drag.tab);
        } else {
          sidebarTabDragRef.current = null;
          tabDropZoneRef.current = null;
          setTabDrag(null);
          setTabDropZone(null);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      sidebarTabDragListenersRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
    },
    [cleanupSidebarTabDragListeners, finishTabDrag, splitViewEnabled, updateTabDragPointer],
  );

  useEffect(() => () => cleanupSidebarTabDragListeners(), [cleanupSidebarTabDragListeners]);

  const sidebarIconClass = useCallback(
    (tab: SplittableTabId) => {
      if (activeItem === tab) return "sidebar-icon-active";
      if (effectiveTabSplit && tabPaneRole(tab, effectiveTabSplit)) {
        return "sidebar-icon-split-pane";
      }
      return "";
    },
    [activeItem, effectiveTabSplit],
  );

  const onTabSplitDividerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!effectiveTabSplit || e.button !== 0) return;
      e.preventDefault();
      const row = mainSplitRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const horizontal = effectiveTabSplit.direction === "horizontal";
      const size = horizontal ? rect.width : rect.height;
      const origin = horizontal ? rect.left : rect.top;
      const coord = horizontal ? e.clientX : e.clientY;
      const startRel = size > 0 ? (coord - origin) / size : effectiveTabSplit.ratio;
      tabSplitDividerDragRef.current = {
        startCoord: startRel,
        startRatio: effectiveTabSplit.ratio,
        direction: effectiveTabSplit.direction,
      };
      setIsTabSplitDividerDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [effectiveTabSplit],
  );

  useEffect(() => {
    if (!isTabSplitDividerDragging) return;
    const onMove = (e: PointerEvent) => {
      const d = tabSplitDividerDragRef.current;
      const row = mainSplitRef.current;
      if (!d || !row) return;
      const rect = row.getBoundingClientRect();
      const size = d.direction === "horizontal" ? rect.width : rect.height;
      if (size <= 0) return;
      const coord = d.direction === "horizontal" ? e.clientX : e.clientY;
      const origin = d.direction === "horizontal" ? rect.left : rect.top;
      const rel = size > 0 ? (coord - origin) / size : d.startRatio;
      const delta = rel - d.startCoord;
      let next = d.startRatio + delta;
      next = Math.min(TAB_SPLIT_RATIO_MAX, Math.max(TAB_SPLIT_RATIO_MIN, next));
      setTabSplitLayout((prev) => (prev ? { ...prev, ratio: next } : prev));
    };
    const onUp = () => {
      tabSplitDividerDragRef.current = null;
      setIsTabSplitDividerDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isTabSplitDividerDragging]);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setLauncherVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const isAuthorized = !!profile.ms_id_token || !!profile.ely_username;
  const displayedNickname =
    profile.nickname.trim() !== ""
      ? profile.nickname
      : profile.ely_username ?? "";
  const activeAccountFromList = launcherAccounts.find((a) => a.is_active);
  const activeAccountLabel =
    activeAccountFromList?.label ?? (displayedNickname.trim() || "—");
  const activeAccountKind = activeAccountFromList?.kind ?? "offline";
  const initialPersistedConsoleByProfile = useMemo(
    () => loadPersistedGameConsoleByProfile(),
    [],
  );
  const [consoleByProfile, setConsoleByProfile] = useState<
    Record<string, ProfileConsoleData>
  >(initialPersistedConsoleByProfile);
  const runningConsoleProfileIdRef = useRef<string | null>(null);
  const [isConsoleVisible, setIsConsoleVisible] = useState(false);

  const { handleModpackSidebarClick } = useHotkeys({
    activeTab: activeItem,
    effectiveTabSplit,
    isConsoleVisible,
    playConsoleActionsRef: playConsoleHotkeysRef,
    modpackActionsRef: modpackHotkeysRef,
    settingsTab,
    modpackView,
    modpackNavRef,
    setActiveItem: setActiveItemWithSound,
    setSettingsTab,
    setModpackView,
    setRequestedModpackView,
  });

  const [gameStatus, setGameStatus] = useState<GameStatus>("idle");
  const [isLaunching, setIsLaunching] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const lastRunningRef = useRef(false);
  const [activeInstanceProfile, setActiveInstanceProfile] =
    useState<InstanceProfileSummary | null>(null);

  const consoleLines = useMemo(() => {
    const profileId = activeInstanceProfile?.id;
    if (!profileId) return [];
    return consoleByProfile[profileId]?.lines ?? [];
  }, [activeInstanceProfile?.id, consoleByProfile]);

  const consoleHistorySessions = useMemo(() => {
    const profileId = activeInstanceProfile?.id;
    if (!profileId) return [];
    return consoleByProfile[profileId]?.sessions ?? [];
  }, [activeInstanceProfile?.id, consoleByProfile]);

  const [knownProfiles, setKnownProfiles] = useState<InstanceProfileCard[]>([]);
  const [profilesHydrated, setProfilesHydrated] = useState(false);
  const [pinnedProfileIds, setPinnedProfileIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("modpacks_sidebar_pins");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        return parsed
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .slice(0, 3);
      }
    } catch {
    }
    return [];
  });
  const [pinnedContextMenu, setPinnedContextMenu] = useState<{
    profileId: string;
    x: number;
    y: number;
  } | null>(null);
  const [profileInfoProfile, setProfileInfoProfile] = useState<ProfileInfoData | null>(null);
  const [discordModsTitle, setDiscordModsTitle] = useState<string | null>(null);
  const [backgroundDataUri, setBackgroundDataUri] = useState<string | null>(null);
  const didApplyStartPageRef = useRef(false);
  const languageHydratedRef = useRef(false);

  const profileAvatarInput = useMemo<ProfileAvatarInput>(
    () => ({
      nickname: profile.nickname,
      ely_username: profile.ely_username,
      ely_uuid: profile.ely_uuid,
      mc_uuid: profile.mc_uuid,
    }),
    [profile.nickname, profile.ely_username, profile.ely_uuid, profile.mc_uuid],
  );

  const archiveCurrentConsoleAndClear = useCallback((profileId: string) => {
    resetGameConsoleFilter();
    setConsoleByProfile((prev) => {
      const current = prev[profileId] ?? { lines: [], sessions: [] };
      if (current.lines.length === 0) {
        return { ...prev, [profileId]: { lines: [], sessions: current.sessions } };
      }
      const session: GameConsoleSession = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        startedAt: Date.now(),
        endedAt: Date.now(),
        lines: current.lines.slice(-MAX_CONSOLE_LINES),
      };
      return {
        ...prev,
        [profileId]: {
          lines: [],
          sessions: [session, ...current.sessions].slice(0, MAX_ARCHIVED_SESSIONS),
        },
      };
    });
  }, []);

  const appendConsoleLine = useCallback(
    (profileId: string, text: string, source: "stdout" | "stderr") => {
      if (!isGameConsoleLineImportant(text, source)) return;
      setConsoleByProfile((prev) => {
        const current = prev[profileId] ?? { lines: [], sessions: [] };
        const nextLines: GameConsoleLine[] = [
          ...current.lines,
          { id: Date.now() + Math.random(), line: text, source },
        ];
        const trimmed =
          nextLines.length > MAX_CONSOLE_LINES
            ? nextLines.slice(nextLines.length - MAX_CONSOLE_LINES)
            : nextLines;
        return { ...prev, [profileId]: { ...current, lines: trimmed } };
      });
    },
    [],
  );

  const resolveLaunchConsoleProfileId = useCallback(async (): Promise<string | null> => {
    if (activeInstanceProfile?.id) return activeInstanceProfile.id;
    try {
      const selected = await invoke<InstanceProfileSummary | null>("get_selected_profile");
      return selected?.id ?? null;
    } catch {
      return null;
    }
  }, [activeInstanceProfile?.id]);

  const orderedSidebarItems = useMemo(() => {
    const byId = new Map(sidebarItems.map((i) => [i.id, i]));
    const result: { id: SidebarItemId; labelKey: string }[] = [];
    for (const id of sidebarOrder) {
      const item = byId.get(id);
      if (item && item.id !== "accounts") {
        result.push(item);
      }
    }
    for (const item of sidebarItems) {
      if (item.id !== "accounts" && !result.find((x) => x.id === item.id)) {
        result.push(item);
      }
    }
    return result;
  }, [sidebarOrder]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("modpacks_sidebar_pins", JSON.stringify(pinnedProfileIds.slice(0, 3)));
    } catch {
    }
  }, [pinnedProfileIds]);

  const pinnedProfiles = useMemo(() => {
    const byId = new Map(knownProfiles.map((p) => [p.id, p]));
    return pinnedProfileIds.map((id) => byId.get(id)).filter((p): p is InstanceProfileCard => !!p).slice(0, 3);
  }, [knownProfiles, pinnedProfileIds]);

  useEffect(() => {
    if (!profilesHydrated) return;
    const knownIds = new Set(knownProfiles.map((p) => p.id));
    setPinnedProfileIds((prev) => prev.filter((id) => knownIds.has(id)).slice(0, 3));
  }, [knownProfiles, profilesHydrated]);

  const handleToggleSidebarPin = (profile: InstanceProfileCard) => {
    let pinLimitReached = false;
    setPinnedProfileIds((prev) => {
      if (prev.includes(profile.id)) return prev.filter((id) => id !== profile.id);
      if (prev.length >= 3) {
        pinLimitReached = true;
        return prev;
      }
      return [...prev, profile.id];
    });
    if (pinLimitReached) {
      showNotification("warning", tt("app.pinnedProfiles.pinLimit"));
    }
  };

  const [openedMrpackPath, setOpenedMrpackPath] = useState<string | null>(null);
  const pendingProfileLaunchIdRef = useRef<string | null>(null);
  const handlePlayPinnedProfileRef = useRef<(profile: InstanceProfileCard) => Promise<void>>(
    async () => {},
  );

  const handlePlayPinnedProfile = async (profile: InstanceProfileCard) => {
    try {
      await invoke("set_selected_profile", { id: profile.id });
      setActiveInstanceProfile({
        id: profile.id,
        name: profile.name,
        game_version: profile.game_version,
        loader: profile.loader,
        loader_version: profile.loader_version ?? null,
      });
      let launchVersionId = profile.game_version;
      const profileLoaderVersion = profile.loader_version?.trim() || null;
      if (profile.loader === "fabric") {
        const installedFabricId = await invoke<string | null>("get_installed_fabric_profile_id", {
          gameVersion: profile.game_version,
          loaderVersion: profileLoaderVersion,
        });
        if (!installedFabricId) {
          throw new Error(tt("app.pinnedProfiles.fabricNotInstalled"));
        }
        launchVersionId = installedFabricId;
      } else if (profile.loader === "quilt") {
        const installedQuiltId = await invoke<string | null>("get_installed_quilt_profile_id", {
          gameVersion: profile.game_version,
          loaderVersion: profileLoaderVersion,
        });
        if (!installedQuiltId) {
          throw new Error(tt("app.pinnedProfiles.quiltNotInstalled"));
        }
        launchVersionId = installedQuiltId;
      } else if (profile.loader === "forge" && profileLoaderVersion) {
        launchVersionId = `${profile.game_version}-forge-${profileLoaderVersion}`;
      } else if (profile.loader === "neoforge" && profileLoaderVersion) {
        launchVersionId = `${profile.game_version}-neoforge-${profileLoaderVersion}`;
      }
      const consoleProfileId = profile.id;
      runningConsoleProfileIdRef.current = consoleProfileId;
      archiveCurrentConsoleAndClear(consoleProfileId);
      if (settings?.show_console_on_launch) {
        setIsConsoleVisible(true);
      }
      setIsLaunching(true);
      try {
        await invoke("launch_game", {
          versionId: launchVersionId,
          versionUrl: null,
        });
        lastRunningRef.current = true;
        setGameStatus("running");
      } finally {
        setIsLaunching(false);
      }
    } catch (error) {
      runningConsoleProfileIdRef.current = null;
      const msg = error instanceof Error ? error.message : String(error);
      showNotification("error", tt("app.errors.launchError", { msg }));
    }
  };

  handlePlayPinnedProfileRef.current = handlePlayPinnedProfile;

  const handleOpenProfileInModpacks = async (profileId: string) => {
    const profile = knownProfiles.find((p) => p.id === profileId);
    if (profile) {
      setActiveInstanceProfile({
        id: profile.id,
        name: profile.name,
        game_version: profile.game_version,
        loader: profile.loader,
        loader_version: profile.loader_version ?? null,
      });
    }
    try {
      await invoke("set_selected_profile", { id: profileId });
    } catch {
    }
    setActiveItemWithSound("modpacks");
  };

  const handleDeleteProfileFromSidebar = async (profileId: string) => {
    try {
      await invoke("delete_profile", { id: profileId });
      setKnownProfiles((prev) => prev.filter((p) => p.id !== profileId));
      setPinnedProfileIds((prev) => prev.filter((id) => id !== profileId));
      if (activeInstanceProfile?.id === profileId) {
        setActiveInstanceProfile(null);
      }
      showNotification("success", tt("modpacks.toast.profileDeleted"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("modpacks.toast.deleteProfileFailedWithMsg", { msg }));
    }
  };

  const handleModpackProfileSelectionChange = useCallback(
    (
      p: InstanceProfileSummary | (InstanceProfileSummary & { game_version: string; loader: string }) | null,
    ) => {
      setActiveInstanceProfile(
        p
          ? {
              id: p.id,
              name: p.name,
              game_version: p.game_version,
              loader: p.loader,
              loader_version: p.loader_version ?? null,
            }
          : null,
      );
    },
    [],
  );

  useEffect(() => {
    if (!settings || languageHydratedRef.current) return;
    languageHydratedRef.current = true;

    let lang: Language | null = readStoredLanguage();

    if (!lang && settings.interface_language && isLanguage(settings.interface_language)) {
      lang = settings.interface_language;
    }

    if (!lang) {
      const browserLang =
        typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "ru";
      if (browserLang.startsWith("de")) lang = "de";
      else if (browserLang.startsWith("es")) lang = "es";
      else if (browserLang.startsWith("en")) lang = "en";
      else lang = "ru";
    }

    setLanguage(lang);
    try {
      window.localStorage.setItem("launcher_language", lang);
    } catch {
    }

    if (settings.interface_language !== lang) {
      const synced = { ...settings, interface_language: lang };
      setSettings(synced);
      void invoke("set_settings", { settings: synced }).catch(() => {});
    }
  }, [settings]);

  useEffect(() => {
    let cancelled = false;

    const checkStatus = async () => {
      try {
        const running = await invoke<boolean>("is_game_running_now");
        if (cancelled) return;

        if (running) {
          lastRunningRef.current = true;
          setGameStatus("running");
        } else {
          if (lastRunningRef.current) {
            lastRunningRef.current = false;
            runningConsoleProfileIdRef.current = null;
            setGameStatus((prev) => {
              const lastLine = consoleLines[consoleLines.length - 1]?.line ?? "";
              const lower = lastLine.toLowerCase();
              const looksCrash =
                lower.includes("exception") ||
                lower.includes("fatal") ||
                lower.includes("crash") ||
                lower.includes("ошибка");
              if (looksCrash) return "crashed";
              if (prev === "running") return "stopped";
              return prev;
            });
          } else {
            setGameStatus((prev) => (prev === "running" ? "stopped" : prev));
          }
        }
      } catch {
      }
    };

    const id = window.setInterval(checkStatus, 4000);
    void checkStatus();

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [consoleLines]);

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
      try {
        unlisten = await listen<GameConsoleLinePayload>("game-console-line", (event) => {
          const payload = event.payload;
          const text =
            typeof payload === "string"
              ? payload
              : typeof payload.line === "string"
                ? payload.line
                : "";
          if (!text) return;
          const source: "stdout" | "stderr" =
            typeof payload === "string"
              ? "stdout"
              : payload.source === "stderr"
                ? "stderr"
                : "stdout";
          const profileId =
            runningConsoleProfileIdRef.current ?? activeInstanceProfile?.id;
          if (!profileId) return;
          appendConsoleLine(profileId, text, source);
        });
      } catch (e) {
        console.error("Не удалось подписаться на консоль игры:", e);
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [activeInstanceProfile?.id, appendConsoleLine]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          GAME_CONSOLE_STORAGE_KEY,
          JSON.stringify({ byProfile: consoleByProfile }),
        );
      } catch {
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [consoleByProfile]);

  const clearNotificationDismissTimers = useCallback((id: number) => {
    const t = notificationTimersRef.current.get(id);
    if (!t) return;
    if (t.fade !== undefined) clearTimeout(t.fade);
    if (t.remove !== undefined) clearTimeout(t.remove);
    notificationTimersRef.current.delete(id);
  }, []);

  const beginDismissNotification = useCallback(
    (id: number) => {
      clearNotificationDismissTimers(id);
      let shouldAnimateOut = false;
      setNotifications((prev) => {
        const target = prev.find((n) => n.id === id);
        if (!target || target.leaving) return prev;
        shouldAnimateOut = true;
        return prev.map((n) => (n.id === id ? { ...n, leaving: true } : n));
      });
      if (!shouldAnimateOut) return;

      const remove = window.setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        notificationTimersRef.current.delete(id);
      }, 200);
      notificationTimersRef.current.set(id, { remove });
    },
    [clearNotificationDismissTimers],
  );

  const scheduleNotificationDismiss = useCallback(
    (id: number) => {
      if (!id) return;
      clearNotificationDismissTimers(id);
      const fade = window.setTimeout(() => beginDismissNotification(id), 4300);
      notificationTimersRef.current.set(id, { fade });
    },
    [clearNotificationDismissTimers, beginDismissNotification],
  );

  useEffect(() => {
    return () => {
      for (const t of notificationTimersRef.current.values()) {
        if (t.fade !== undefined) clearTimeout(t.fade);
        if (t.remove !== undefined) clearTimeout(t.remove);
      }
      notificationTimersRef.current.clear();
    };
  }, []);

  const pushNotification = useCallback(
    (entry: NotificationIdentity): { merged: boolean } => {
      let targetId = 0;
      let merged = false;

      flushSync(() => {
        setNotifications((prev) => {
          const existing = prev.find((n) => !n.leaving && notificationsMatch(n, entry));
          if (existing) {
            targetId = existing.id;
            merged = true;
            return prev.map((n) =>
              n.id === existing.id
                ? { ...n, ...entry, count: (n.count ?? 1) + 1, leaving: false }
                : n,
            );
          }
          targetId = Date.now() + Math.random();
          merged = false;
          return [...prev, { id: targetId, ...entry, count: 1 }];
        });
      });

      scheduleNotificationDismiss(targetId);
      return { merged };
    },
    [scheduleNotificationDismiss],
  );

  const showNotification = useCallback(
    (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => {
      const shouldShow =
        !(settings && !settings.notify_new_message && kind === "info");
      if (!shouldShow) return;

      const { merged } = pushNotification({ kind, message });

      const uiSoundsEnabled = settings?.ui_sounds_enabled ?? true;
      const shouldSound =
        !merged &&
        uiSoundsEnabled &&
        (kind === "info" || kind === "error" || options?.sound === true);

      if (shouldSound) playNotificationSound();
    },
    [settings, pushNotification],
  );

  const showSettingsSavedNotification = useCallback(() => {
    showNotification("success", tt("app.toast.settingsSaved"));
  }, [tt, showNotification]);

  const defaultSettings: Settings = {
    game_directory: null,
    ram_mb: 4096,
    show_console_on_launch: false,
    close_launcher_on_game_start: false,
    check_game_processes: true,
    resolution_width: null,
    resolution_height: null,
    show_snapshots: false,
    show_alpha_versions: false,
    forge_ipv6_download: false,
    forge_proxy_fallback: true,
    notify_new_update: true,
    notify_new_message: true,
    notify_system_message: true,
    check_updates_on_start: true,
    auto_install_updates: false,
    open_launcher_on_profiles_tab: false,
    ui_sounds_enabled: true,
    background_accent_color: "#0b1530",
    background_image_url: null,
    background_blur_enabled: true,
    split_view_enabled: false,
    sidebar_position: "left",
    onboarding_completed: false,
    interface_language: "ru",
  };

  const refreshSettings = useCallback(async (profileId?: string | null) => {
    try {
      const s =
        profileId != null && profileId !== ""
          ? await invoke<Settings>("get_effective_settings", { profileId })
          : await invoke<Settings>("get_settings");
      const storedLang = readStoredLanguage();
      if (storedLang && storedLang !== s.interface_language) {
        const synced = { ...s, interface_language: storedLang };
        setSettings(synced);
        void invoke("set_settings", { settings: synced }).catch(() => {});
        return;
      }
      setSettings(s);
    } catch (e) {
      console.error("Не удалось загрузить настройки:", e);
      setSettings(defaultSettings);
    }
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (didApplyStartPageRef.current) return;
    setActiveItem(settings.open_launcher_on_profiles_tab ? "modpacks" : "play");
    didApplyStartPageRef.current = true;
  }, [settings]);

  useEffect(() => {
    if (!settings) return;

    try {
      if (window.localStorage.getItem(ONBOARDING_FORCE_STORAGE_KEY) === "1") {
        setOnboardingVisible(true);
        return;
      }
    } catch {
    }

    if (settings.onboarding_completed) {
      setOnboardingVisible(false);
      return;
    }

    try {
      if (window.localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "1") {
        setOnboardingVisible(false);
        void invoke("set_settings", {
          settings: { ...settings, onboarding_completed: true },
        }).catch(() => {});
        return;
      }

      const legacyMigrated =
        window.localStorage.getItem(ONBOARDING_LEGACY_MIGRATED_KEY) === "1";
      const storedLang = readStoredLanguage();
      if (!legacyMigrated && storedLang) {
        window.localStorage.setItem(ONBOARDING_LEGACY_MIGRATED_KEY, "1");
        window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "1");
        void invoke("set_settings", {
          settings: {
            ...settings,
            onboarding_completed: true,
            interface_language: storedLang,
          },
        }).catch(() => {});
        setOnboardingVisible(false);
        return;
      }
    } catch {
    }

    setOnboardingVisible(true);
  }, [settings]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>, profileId?: string | null) => {
      const gameFields = [
        "ram_mb",
        "show_console_on_launch",
        "close_launcher_on_game_start",
        "check_game_processes",
      ] as const;
      const hasGameField = gameFields.some((k) => k in patch && patch[k] !== undefined);
      const useProfile = profileId != null && profileId !== "" && hasGameField;

      let snapshotCurrent = defaultSettings;
      let snapshotNext = defaultSettings;

      setSettings((prev) => {
        snapshotCurrent = prev ?? defaultSettings;
        snapshotNext = { ...snapshotCurrent, ...patch };
        return snapshotNext;
      });

      if (patch.open_launcher_on_profiles_tab !== undefined) {
        setActiveItemWithSound(patch.open_launcher_on_profiles_tab ? "modpacks" : "play");
      }

      try {
        if (useProfile) {
          const profilePatch: Record<string, unknown> = {};
          if (patch.ram_mb !== undefined) profilePatch.ram_mb = patch.ram_mb;
          if (patch.show_console_on_launch !== undefined)
            profilePatch.show_console_on_launch = patch.show_console_on_launch;
          if (patch.close_launcher_on_game_start !== undefined)
            profilePatch.close_launcher_on_game_start = patch.close_launcher_on_game_start;
          if (patch.check_game_processes !== undefined)
            profilePatch.check_game_processes = patch.check_game_processes;

          await invoke("update_profile_settings", { id: profileId, patch: profilePatch });

          const nonGamePatch = { ...patch };
          gameFields.forEach((k) => delete nonGamePatch[k]);
          if (Object.keys(nonGamePatch).length > 0) {
            await invoke("set_settings", {
              settings: { ...snapshotCurrent, ...nonGamePatch },
            });
          }
        } else {
          await invoke("set_settings", { settings: snapshotNext });
        }
        const languageOnly =
          Object.keys(patch).length === 1 && patch.interface_language !== undefined;
        if (!languageOnly) {
          showSettingsSavedNotification();
        }
      } catch (e) {
        console.error("Не удалось сохранить настройки:", e);
      }
    },
    [showSettingsSavedNotification, setActiveItemWithSound],
  );

  const persistInterfaceLanguage = useCallback(
    (lang: Language) => {
      setLanguage(lang);
      try {
        window.localStorage.setItem("launcher_language", lang);
      } catch {
      }
      setSettings((prev) => (prev ? { ...prev, interface_language: lang } : prev));
      void updateSettings({ interface_language: lang });
    },
    [updateSettings],
  );

  useEffect(() => {
    (async () => {
      await refreshSettings();
      try {
        const totalGb = await invoke<number>("get_system_memory_gb");
        if (typeof totalGb === "number" && Number.isFinite(totalGb) && totalGb >= 1) {
          setSystemMemoryGb(Math.max(1, Math.min(64, Math.round(totalGb))));
        } else {
          setSystemMemoryGb(16);
        }
      } catch {
        setSystemMemoryGb(16);
      }
    })();
  }, [refreshSettings]);

  useEffect(() => {
    if (!settings) return;
    if (didLoadedRemoteNotificationsRef.current) return;

    const controller = new AbortController();
    (async () => {
      try {
        let raw: unknown = null;
        let lastError: unknown = null;

        for (const url of REMOTE_NOTIFICATIONS_URLS) {
          const requestController = new AbortController();
          const timeoutId = window.setTimeout(() => requestController.abort(), 6500);

          try {
            const response = await fetch(url, {
              signal: requestController.signal,
              cache: "no-store",
            });

            if (!response.ok) {
              throw new Error(`Failed to load notifications: ${response.status}`);
            }

            const text = await response.text();
            const sanitized = text.replace(/,\s*([}\]])/g, "$1");
            raw = JSON.parse(sanitized) as unknown;
            break;
          } catch (e) {
            lastError = e;
          } finally {
            window.clearTimeout(timeoutId);
          }
        }

        if (!raw) {
          console.warn("Remote notifications failed to load:", lastError);
          return;
        }

        let items: RemoteNotificationsJsonItem[] = [];
        if (Array.isArray(raw)) {
          items = raw as RemoteNotificationsJsonItem[];
        } else if (raw && typeof raw === "object") {
          const obj = raw as any;
          if (Array.isArray(obj.notifications)) {
            items = obj.notifications as RemoteNotificationsJsonItem[];
          } else if (Array.isArray(obj.items)) {
            items = obj.items as RemoteNotificationsJsonItem[];
          }
        }

        const normalized = items
          .map((item) => {
            const colorMsg = getRemoteItemField(item, "color-msg", "colorMsg");
            const iconMsg = getRemoteItemField(item, "icon-msg", "iconMsg");
            const textMsg = getRemoteItemField(item, "text-msg", "textMsg");

            const color = normalizeOptionalString(colorMsg);
            const icon = normalizeOptionalString(iconMsg);
            const text = normalizeOptionalString(textMsg) ?? "";
            return {
              item,
              colorMsg: color,
              iconMsg: icon,
              textMsg: text,
            };
          })
          .filter((x) => x.textMsg.length > 0);

        const system: Array<
          Pick<Notification, "colorMsg" | "iconMsg" | "message" | "kind">
        > = [];

        for (const n of normalized) {
          const kindFromColor = resolveRemoteNotificationKindFromColorMsg(n.colorMsg);
          system.push({
            message: n.textMsg,
            colorMsg: n.colorMsg,
            iconMsg: n.iconMsg,
            kind: kindFromColor ?? undefined,
          });
        }

        didLoadedRemoteNotificationsRef.current = true;

        if (system.length === 0) return;
        if (!settings.notify_system_message) return;

        if (settings.ui_sounds_enabled) {
          const hasNoisyKind = system.some((s) => s.kind === "info" || s.kind === "error");
          if (hasNoisyKind) playNotificationSound();
        }

        for (const s of system) {
          pushNotification(s);
        }

      } catch (e) {
        if (controller.signal.aborted) return;
        console.error("Failed to load remote notifications:", e);
      }
    })();

    return () => controller.abort();
  }, [settings, pushNotification]);

  useEffect(() => {
    if (didLoadedBottomSocialRef.current) return;
    didLoadedBottomSocialRef.current = true;

    const STORAGE_LAUNCHES_KEY = "mc16launcher:socialPromptLaunches";
    const STORAGE_LAST_SHOWN_AT_KEY = "mc16launcher:socialPromptLastShownAt";

    const MIN_LAUNCHES_BETWEEN = 6;
    const MIN_DAYS_BETWEEN = 5;
    const CHANCE_PER_ELIGIBLE_LAUNCH = 0.22;

    let launches = 0;
    let lastShownAt = 0;
    try {
      launches = Number.parseInt(localStorage.getItem(STORAGE_LAUNCHES_KEY) ?? "0", 10) || 0;
      lastShownAt = Number.parseInt(localStorage.getItem(STORAGE_LAST_SHOWN_AT_KEY) ?? "0", 10) || 0;
    } catch {
    }

    launches += 1;
    try {
      localStorage.setItem(STORAGE_LAUNCHES_KEY, String(launches));
    } catch {
    }

    const now = Date.now();
    const minMs = MIN_DAYS_BETWEEN * 24 * 60 * 60 * 1000;
    const eligible =
      launches >= MIN_LAUNCHES_BETWEEN &&
      (lastShownAt <= 0 || now - lastShownAt >= minMs) &&
      Math.random() < CHANCE_PER_ELIGIBLE_LAUNCH;

    if (!eligible) return;

    const kind: BottomSocialKind = Math.random() < 0.5 ? "discord" : "telegram";
    const card: BottomSocialNotification = {
      id: Date.now() + Math.random(),
      kind,
      colorMsg: kind === "discord" ? "#5865F2" : "#229ED9",
      iconMsg: undefined,
      messageKey: kind === "discord" ? "app.social.discord" : "app.social.telegram",
    };

    setBottomSocialNotifications([card]);
    try {
      localStorage.setItem(STORAGE_LAST_SHOWN_AT_KEY, String(now));
      localStorage.setItem(STORAGE_LAUNCHES_KEY, "0");
    } catch {
    }
  }, []);

  const installUpdate = useCallback(
    async (
      upd?: import("@tauri-apps/plugin-updater").Update | null,
    ) => {
      let update = upd;
      if (!update && updateVersion) {
        setUpdateStatus("checking");
        const u = await check();
        if (!u) {
          setUpdateStatus("available");
          return;
        }
        update = u;
      }
      if (!update) return;
      try {
        setUpdateStatus("downloading");
        setUpdateDownloadPercent(0);
        let downloaded = 0;
        let total = 0;
        await update.download((event) => {
          if (event.event === "Started" && event.data?.contentLength) {
            total = event.data.contentLength;
            downloaded = 0;
          } else if (event.event === "Progress" && event.data?.chunkLength) {
            downloaded += event.data.chunkLength;
            if (total > 0) {
              setUpdateDownloadPercent(Math.min(99, Math.round((downloaded / total) * 100)));
            }
          }
        });
        setUpdateStatus("installing");
        setUpdateDownloadPercent(100);
        await update.install();
        showNotification("success", tt("settings.updates.installedRestart"));
        await relaunch();
      } catch (e) {
        console.error("Update install failed:", e);
        setUpdateStatus("available");
        setUpdateDownloadPercent(null);
        showNotification("error", tt("settings.updates.checkFailed"));
      }
    },
    [updateVersion, showNotification, tt],
  );

  const checkForUpdate = useCallback(
    async (options?: { silent?: boolean; source?: "startup" | "manual" }) => {
      const silent = options?.silent ?? false;
      const source = options?.source ?? "manual";
      try {
        setUpdateStatus("checking");
        setUpdateVersion(null);
        const update = await check();
        if (update) {
          setUpdateVersion(update.version);
          setUpdateStatus("available");
          persistLauncherUpdateBadge("outdated");

          const notifyEnabled = settings?.notify_new_update !== false;
          const shouldNotifyManual = !silent && notifyEnabled;
          const shouldNotifyStartup = source === "startup" && notifyEnabled;

          if (shouldNotifyStartup) {
            const key = "mc16launcher:lastShownUpdateVersion";
            let lastShown: string | null = null;
            try {
              lastShown = localStorage.getItem(key);
            } catch {
              lastShown = null;
            }
            if (lastShown !== update.version) {
              showNotification(
                "info",
                tt("settings.updates.released", { version: update.version }),
              );
              try {
                localStorage.setItem(key, update.version);
              } catch {
                // ignore
              }
            }
          } else if (shouldNotifyManual) {
            showNotification(
              "info",
              tt("settings.updates.available", { version: update.version }),
            );
          }

          if (settings?.auto_install_updates) {
            void installUpdate(update);
          }
        } else {
          setUpdateStatus("up-to-date");
          persistLauncherUpdateBadge("latest");
          if (!silent) {
            showNotification("info", tt("settings.updates.noneFound"));
          }
        }
      } catch (e) {
        console.error("Update check failed:", e);
        setUpdateStatus("error");
        if (!silent) {
          showNotification("info", tt("settings.updates.checkFailed"));
        }
      }
    },
    [
      settings?.notify_new_update,
      settings?.auto_install_updates,
      showNotification,
      tt,
      installUpdate,
      persistLauncherUpdateBadge,
    ],
  );

  const checkForUpdateRef = useRef(checkForUpdate);
  checkForUpdateRef.current = checkForUpdate;
  const didStartupUpdateCheckRef = useRef(false);

  useEffect(() => {
    if (settings == null) return;
    if (settings.check_updates_on_start === false) return;
    if (didStartupUpdateCheckRef.current) return;
    const t = setTimeout(() => {
      didStartupUpdateCheckRef.current = true;
      void checkForUpdateRef.current({ silent: true, source: "startup" });
    }, 2000);
    return () => clearTimeout(t);
  }, [settings?.check_updates_on_start]);

  const launcherVersionBadgeKind = useMemo(() => {
    if (updateStatus === "available") return "outdated" as const;
    if (updateStatus === "up-to-date") return "latest" as const;
    if (launcherUpdateBadge === "outdated") return "outdated" as const;
    if (launcherUpdateBadge === "latest") return "latest" as const;
    return "unknown" as const;
  }, [updateStatus, launcherUpdateBadge]);

  useEffect(() => {
    (async () => {
      try {
        const current = await invoke<InstanceProfileSummary | null>("get_selected_profile");
        if (current) {
          setActiveInstanceProfile({
            id: current.id,
            name: current.name,
            game_version: current.game_version,
            loader: current.loader,
            loader_version: current.loader_version ?? null,
          });
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await invoke<InstanceProfileCard[]>("get_profiles");
        setKnownProfiles(
          list.map((p) => ({
            id: p.id,
            name: p.name,
            game_version: p.game_version,
            loader: p.loader,
            loader_version: p.loader_version ?? null,
            icon_path: p.icon_path,
            created_at: p.created_at,
            play_time_seconds: p.play_time_seconds,
            last_played_at: p.last_played_at ?? null,
            mods_count: p.mods_count,
            resourcepacks_count: p.resourcepacks_count,
            shaderpacks_count: p.shaderpacks_count,
            total_size_bytes: p.total_size_bytes,
            directory: p.directory,
          })),
        );
      } catch {
      } finally {
        setProfilesHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const pending = await invoke<string | null>("take_pending_profile_launch");
        if (pending?.trim()) {
          pendingProfileLaunchIdRef.current = pending.trim();
        }
      } catch {
        // ignore
      }
      try {
        unlisten = await listen<{ profile_id: string }>("profile-launch-request", (event) => {
          const id = event.payload.profile_id?.trim();
          if (id) pendingProfileLaunchIdRef.current = id;
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const pending = await invoke<string | null>("take_pending_mrpack_open");
        const p = pending?.trim();
        if (p) {
          activateSidebarTab("modpacks");
          setOpenedMrpackPath(p);
        }
      } catch {
        // ignore
      }

      try {
        unlisten = await listen<{ path: string }>("mrpack-open-request", (event) => {
          const p = event.payload.path?.trim();
          if (!p) return;
          activateSidebarTab("modpacks");
          setOpenedMrpackPath(p);
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [activateSidebarTab]);

  useEffect(() => {
    const profileId = pendingProfileLaunchIdRef.current;
    if (!profileId || !profilesHydrated) return;
    const profile = knownProfiles.find((p) => p.id === profileId);
    if (!profile) return;
    pendingProfileLaunchIdRef.current = null;
    void handlePlayPinnedProfileRef.current(profile);
  }, [profilesHydrated, knownProfiles]);

  const handleCreateProfileDesktopShortcut = async (profile: InstanceProfileCard) => {
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
  };

  useEffect(() => {
    if (activeItem === "settings") {
      void refreshSettings(activeInstanceProfile?.id ?? undefined);
    }
  }, [activeItem, activeInstanceProfile?.id, refreshSettings]);

  useEffect(() => {
    let details: string;
    let state: string | null = null;
    switch (activeItem) {
      case "play":
        details = t(language, "app.discord.play");
        break;
      case "settings":
        details = t(language, "app.discord.settings");
        break;
      case "mods":
        details = t(language, "app.discord.mods");
        if (discordModsTitle) state = discordModsTitle;
        break;
      case "modpacks":
        details = t(language, "app.discord.modpacks");
        if (activeInstanceProfile?.name) state = activeInstanceProfile.name;
        break;
      case "accounts":
        details = t(language, "app.discord.accounts");
        break;
      default:
        details = t(language, "app.discord.play");
    }
    invoke("discord_presence_update", { details, state }).catch(() => {});
  }, [activeItem, language, discordModsTitle, activeInstanceProfile?.name]);

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
          const savedId =
            typeof window !== "undefined"
              ? window.localStorage.getItem("selected_version_id_forge")
              : null;
          const match = savedId ? result.find((v) => v.id === savedId) : undefined;
          setSelectedVersion(match ?? (result.length > 0 ? result[0] : null));
          setInstalledGameVersions(new Set());
        } else if (loader === "neoforge") {
          const result = await invoke<NeoForgeVersionSummary[]>("fetch_neoforge_versions");
          setVersions(result);
          const savedId =
            typeof window !== "undefined"
              ? window.localStorage.getItem("selected_version_id_neoforge")
              : null;
          const match = savedId ? result.find((v) => v.id === savedId) : undefined;
          setSelectedVersion(match ?? (result.length > 0 ? result[0] : null));
          setInstalledGameVersions(new Set());
        } else {
          const filtered = await invoke<VersionSummary[]>("fetch_versions_for_loader", {
            loader,
            showSnapshots: settings?.show_snapshots ?? false,
            showAlpha: settings?.show_alpha_versions ?? false,
          });
          setVersions(filtered);
          const savedKey =
            loader === "fabric"
              ? "selected_version_id_fabric"
              : loader === "quilt"
                ? "selected_version_id_quilt"
                : "selected_version_id_vanilla";
          const savedId =
            typeof window !== "undefined" ? window.localStorage.getItem(savedKey) : null;
          const match = savedId ? filtered.find((v) => v.id === savedId) : undefined;
          setSelectedVersion(match ?? (filtered.length > 0 ? filtered[0] : null));

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
        } else if (loader === "quilt") {
          const id = await invoke<string | null>("get_installed_quilt_profile_id", {
            gameVersion: selectedVersion.id,
            loaderVersion: null,
          });
          setQuiltProfileId(id);
          setFabricProfileId(null);
        }
      } catch {
        setFabricProfileId(null);
        setQuiltProfileId(null);
      }
    })();
  }, [loader, selectedVersion]);

  const maybePlayNecoArcSecret = useCallback((trimmedNickname: string) => {
    const norm = normalizeNicknameForSecretCheck(trimmedNickname);
    const prev = lastPersistedNickNormRef.current;
    lastPersistedNickNormRef.current = norm;
    if (norm !== "neco arc" || prev === "neco arc") return;
    try {
      const audio = new Audio(NECO_ARC_SECRET_SOUND_SRC);
      audio.volume = Math.min(1, Math.max(0, NECO_ARC_SECRET_SOUND_VOLUME));
      void audio.play().catch(() => {});
    } catch {
      // ignore
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const p = await invoke<Profile>("get_profile");
      const nick = p.nickname ?? "";
      setProfile({
        nickname: nick,
        ely_username: p.ely_username ?? null,
        ely_uuid: p.ely_uuid ?? null,
        ms_id_token: p.ms_id_token ?? null,
        mc_uuid: p.mc_uuid ?? null,
      });
      lastPersistedNickNormRef.current = normalizeNicknameForSecretCheck(nick);
    } catch {
      setProfile({
        nickname: "",
        ely_username: null,
        ely_uuid: null,
        ms_id_token: null,
        mc_uuid: null,
      });
      lastPersistedNickNormRef.current = "";
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (activeItem === "accounts") {
      loadProfile();
      void refreshLauncherAccounts();
    }
  }, [activeItem, loadProfile, refreshLauncherAccounts]);

  useEffect(() => {
    const prev = prevActiveItemRef.current;
    prevActiveItemRef.current = activeItem;
    const trimmed = profile.nickname.trim();
    if (prev === "accounts" && activeItem !== "accounts" && trimmed) {
      invoke("set_profile", { nickname: trimmed })
        .then(() => maybePlayNecoArcSecret(trimmed))
        .catch(console.error);
    }
  }, [activeItem, profile.nickname, maybePlayNecoArcSecret]);

  useEffect(() => {
    const t = setTimeout(() => {
      const nick = profile.nickname.trim();
      if (nick) {
        setProfileSaving(true);
        invoke("set_profile", { nickname: nick })
          .then(() => {
            setProfile((prev) => ({ ...prev, nickname: nick }));
            maybePlayNecoArcSecret(nick);
          })
          .catch(console.error)
          .finally(() => setProfileSaving(false));
      }
    }, 700);
    return () => clearTimeout(t);
  }, [profile.nickname, maybePlayNecoArcSecret]);

  const handleSaveNickname = async (nickname: string) => {
    setProfileSaving(true);
    try {
      await invoke("set_profile", { nickname });
      setProfile((prev) => ({ ...prev, nickname }));
      maybePlayNecoArcSecret(nickname);
      showNotification(
        "success",
        tt("app.accounts.toast.nicknameSaved"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("app.accounts.toast.nicknameSaveFailed"),
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const handleElyLogin = async () => {
    setElyLoading(true);
    setElyAuthUrl(null);
    let unlistenOk: (() => void) | undefined;
    let unlistenFail: (() => void) | undefined;
    const cleanupElyListeners = () => {
      unlistenOk?.();
      unlistenFail?.();
    };
    try {
      unlistenOk = await listen<Profile>("ely-login-complete", (e) => {
        const p = e.payload;
        setProfile({
          nickname: p.nickname ?? "",
          ely_username: p.ely_username ?? null,
          ely_uuid: p.ely_uuid ?? null,
          ms_id_token: p.ms_id_token ?? null,
          mc_uuid: p.mc_uuid ?? null,
        });
        void refreshLauncherAccounts();
        setElyLoading(false);
        setElyAuthUrl(null);
        cleanupElyListeners();
      });

      unlistenFail = await listen<string>("ely-login-failed", (e) => {
        showNotification("error", e.payload);
        setElyLoading(false);
        setElyAuthUrl(null);
        cleanupElyListeners();
      });

      const url = await invoke<string>("start_ely_oauth");
      setElyAuthUrl(url);
      try {
        await openUrl(url);
      } catch (e) {
        console.error("Не удалось открыть браузер для Ely.by OAuth:", e);
        cleanupElyListeners();
        setElyLoading(false);
        setElyAuthUrl(null);
        showNotification(
          "error",
          tt("app.accounts.toast.elyOpenBrowserFailed"),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", msg);
      cleanupElyListeners();
      setElyLoading(false);
      setElyAuthUrl(null);
    }
  };

  const handleElyLogout = async () => {
    try {
      await invoke("ely_logout");
      await loadProfile();
      void refreshLauncherAccounts();
      showNotification(
        "info",
        tt("app.accounts.toast.elyLoggedOut"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("app.accounts.toast.elyLogoutFailed"),
      );
    }
  };

  const handleMicrosoftLogin = async () => {
    if (msLoading) return;
    setMsLoading(true);
    setMsAuthUrl(null);

    let unlistenComplete: (() => void) | null = null;
    try {
      unlistenComplete = await listen("ms-login-complete", async () => {
        unlistenComplete?.();
        unlistenComplete = null;
        setMsLoading(false);
        setMsAuthUrl(null);
        await loadProfile();
        void refreshLauncherAccounts();
        showNotification("success", tt("app.accounts.toast.msLoggedIn"));
      });

      const url = await invoke<string>("start_ms_oauth");
      setMsAuthUrl(url);
      try {
        await openUrl(url);
      } catch (e) {
        console.error("Не удалось открыть браузер для Microsoft OAuth:", e);
        unlistenComplete?.();
        unlistenComplete = null;
        setMsLoading(false);
        setMsAuthUrl(null);
        showNotification("error", tt("app.accounts.toast.msOpenBrowserFailed"));
      }
    } catch (e) {
      console.error(e);
      unlistenComplete?.();
      unlistenComplete = null;
      setMsLoading(false);
      setMsAuthUrl(null);
      showNotification("error", tt("app.accounts.toast.msLoginFailed"));
    }
  };

  const handleMicrosoftLogout = async () => {
    try {
      await invoke("ms_logout");
      await loadProfile();
      void refreshLauncherAccounts();
      showNotification(
        "info",
        tt("app.accounts.toast.msLoggedOut"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("app.accounts.toast.msLogoutFailed"),
      );
    }
  };

  const handleSwitchLauncherAccount = async (accountId: string) => {
    try {
      await invoke("switch_launcher_account", { accountId });
      await loadProfile();
      await refreshLauncherAccounts();
      setAccountSwitcherOpen(false);
      showNotification("success", tt("app.accounts.toast.switched"));
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    }
  };

  const requestRemoveLauncherAccount = (accountId: string) => {
    setAccountSwitcherOpen(false);
    setPendingRemoveAccountId(accountId);
  };

  const confirmRemoveLauncherAccount = async () => {
    const accountId = pendingRemoveAccountId;
    if (!accountId) return;
    setPendingRemoveAccountId(null);
    try {
      await invoke("remove_launcher_account", { accountId });
      await loadProfile();
      await refreshLauncherAccounts();
      setAccountSwitcherOpen(false);
      showNotification("info", tt("app.accounts.toast.removed"));
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    }
  };

  const handleAddLauncherAccount = async () => {
    if (addingAccount) return;
    setAddingAccount(true);
    try {
      const nick = `${tt("app.accounts.newAccountNameBase")} ${launcherAccounts.length + 1}`;
      await invoke("add_launcher_account", { nickname: nick });
      await loadProfile();
      await refreshLauncherAccounts();
      setAccountSwitcherOpen(false);
      showNotification("success", tt("app.accounts.toast.added"));
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setAddingAccount(false);
    }
  };

  const isInstalled = useMemo(() => {
    if (!selectedVersion) return false;
    if (loader === "fabric" && !isForgeVersion(selectedVersion)) return !!fabricProfileId;
    if (loader === "quilt" && !isForgeVersion(selectedVersion)) return !!quiltProfileId;
    return installedIds.has(selectedVersion.id);
  }, [installedIds, selectedVersion, loader, fabricProfileId, quiltProfileId]);

  const installedVersionIdsForDropdown = useMemo(() => {
    if (loader === "fabric" || loader === "quilt") {
      return installedGameVersions;
    }
    return installedIds;
  }, [installedGameVersions, installedIds, loader]);

  const primaryColorClasses =
    isLaunching
      ? "accent-bg opacity-60 cursor-not-allowed"
      : gameStatus === "running" || isStopping
        ? "bg-red-600 hover:bg-red-500"
        : "accent-bg hover:opacity-90";

  const primaryLabel = useMemo(() => {
    if (isLaunching) {
      return tt("app.playAction.launching");
    }
    if (gameStatus === "running" || isStopping) {
      return tt("app.playAction.stop");
    }
    if (isInstalled) {
      return tt("app.playAction.play");
    }
    return tt("app.playAction.install");
  }, [gameStatus, isLaunching, isStopping, isInstalled, tt]);

  const handleToggleConsole = () => {
    setIsConsoleVisible((prev) => !prev);
  };

  const handleClearConsole = () => {
    const profileId = activeInstanceProfile?.id;
    if (!profileId) return;
    resetGameConsoleFilter();
    setConsoleByProfile((prev) => ({
      ...prev,
      [profileId]: {
        lines: [],
        sessions: prev[profileId]?.sessions ?? [],
      },
    }));
  };

  const { isConsoleDetached, toggleConsoleDetached } = useGameConsoleWindow({
    enabled: settings?.show_console_on_launch ?? false,
    profileName: activeInstanceProfile?.name ?? null,
    language,
    consoleLines,
    isConsoleVisible,
    gameStatus,
    onClearConsole: handleClearConsole,
    onToggleConsole: handleToggleConsole,
  });

  const handleOpenGameFolder = async () => {
    try {
      await invoke("open_game_folder", {
        profileId: activeInstanceProfile?.id ?? null,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Не удалось открыть папку игры:", error);
      showNotification(
        "error",
        tt("app.errors.openFolderFailed", { msg }),
      );
    }
  };

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

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleToggleMaximize = () => {
    getCurrentWindow().toggleMaximize();
  };

  const handleTitleBarMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

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

    const jobId = versionInstallJobId(selectedVersion.id);
    versionInstallJobIdRef.current = jobId;

    setInstallPaused(false);
    setIsInstalling(true);
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
        showNotification("success", tt("app.toast.downloadFinished"), { sound: true });
        return;
      } else if (loader === "forge" && isForgeVersion(selectedVersion)) {
        await invoke("install_forge", {
          versionId: selectedVersion.id,
          installerUrl: selectedVersion.installer_url,
        });
      } else if (loader === "neoforge" && isNeoForgeVersion(selectedVersion)) {
        await invoke("install_neoforge", {
          versionId: selectedVersion.id,
        });
      } else {
        throw new Error(tt("app.install.unknownVersionType"));
      }

      showNotification("success", tt("app.toast.downloadFinished"), { sound: true });
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.add(selectedVersion.id);
        return next;
      });
    } catch (error) {
      if (installStopReasonRef.current === "pause") {
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
        }
        installStopReasonRef.current = null;
      }
    }
  };

  const handlePrimaryClick = async () => {
    if (!selectedVersion || isInstalling || isLaunching || isStopping) return;

    if (isInstalled) {
      if (gameStatus === "running") {
        setIsStopping(true);
        try {
          await invoke("stop_game");
          lastRunningRef.current = false;
          setGameStatus("stopped");
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error("Ошибка остановки игры:", error);
          showNotification("error", tt("app.errors.stopError", { msg }));
        } finally {
          setIsStopping(false);
        }
        return;
      }

      try {
        await invoke("set_profile", {
          nickname: profile.nickname,
        });
        const vanillaSummary =
          loader === "vanilla" && !isForgeVersion(selectedVersion) && !isNeoForgeVersion(selectedVersion)
            ? (selectedVersion as VersionSummary)
            : null;
        const versionUrl =
          vanillaSummary && vanillaSummary.version_type !== "custom" && vanillaSummary.url
            ? vanillaSummary.url
            : undefined;
        const versionId =
          loader === "fabric" && fabricProfileId
            ? fabricProfileId
            : loader === "quilt" && quiltProfileId
              ? quiltProfileId
              : selectedVersion.id;
        const consoleProfileId = await resolveLaunchConsoleProfileId();
        if (consoleProfileId) {
          runningConsoleProfileIdRef.current = consoleProfileId;
          archiveCurrentConsoleAndClear(consoleProfileId);
        }
        if (settings?.show_console_on_launch) {
          setIsConsoleVisible(true);
        }
        setIsLaunching(true);
        try {
          await invoke("launch_game", {
            versionId,
            versionUrl: versionUrl ?? null,
          });
          lastRunningRef.current = true;
          setGameStatus("running");
        } finally {
          setIsLaunching(false);
        }
      } catch (error) {
        runningConsoleProfileIdRef.current = null;
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Ошибка запуска игры:", error);
        showNotification(
          "error",
          tt("app.errors.launchError", { msg }),
        );
      }
      return;
    }

    await runVersionInstall();
  };

  const accentColor = settings?.background_accent_color ?? "#0b1530";

  useEffect(() => {
    (async () => {
      if (!shouldLoadBackgroundDataUri(settings?.background_image_url)) {
        setBackgroundDataUri(null);
        return;
      }
      try {
        const uri = await invoke<string | null>("get_background_data_uri");
        setBackgroundDataUri(uri ?? null);
      } catch {
        setBackgroundDataUri(null);
      }
    })();
  }, [settings?.background_image_url]);

  const backgroundImageUrl = resolveLauncherBackgroundUrl(
    settings?.background_image_url,
    backgroundDataUri,
  );
  const backgroundIsAnimated = isAnimatedBackgroundPath(
    settings?.background_image_url ?? "",
  );

  const renderMainTabContent = useCallback(
    (tab: SplittableTabId, inSplitPane = false) => {
      switch (tab) {
        case "mods":
          return (
            <div
              className={
                inSplitPane
                  ? "tab-pane-fill px-2 py-2"
                  : "flex w-full flex-1 flex-col gap-4 overflow-auto py-4 items-center"
              }
            >
              <ModsTab
                fillPane={inSplitPane}
                showNotification={showNotification}
                language={language}
                activeProfileId={activeInstanceProfile?.id ?? null}
                activeProfileGameVersion={activeInstanceProfile?.game_version}
                activeProfileLoader={activeInstanceProfile?.loader}
                onOpenModpacksTab={() => activateSidebarTab("modpacks")}
                onSelectedModTitleChange={setDiscordModsTitle}
                registerDownloadJob={startDownloadJob}
                updateDownloadJob={updateDownloadJobProgress}
                finishDownloadJob={finishDownloadJob}
                makeDownloadJobId={makeDownloadJobId}
              />
            </div>
          );
        case "modpacks":
          return (
            <div
              className={
                inSplitPane
                  ? "tab-pane-fill py-2"
                  : "flex min-h-0 w-full flex-1 flex-col gap-4 overflow-auto self-stretch py-4"
              }
            >
              <ModpackTab
                fillPane={inSplitPane}
                language={language}
                onRegisterModpackHotkeys={registerModpackHotkeys}
                onRegisterModpackNavigation={registerModpackNavigation}
                onActiveViewChange={setModpackView}
                requestedModpackView={requestedModpackView}
                onRequestedModpackViewApplied={clearRequestedModpackView}
                showNotification={showNotification}
                registerDownloadJob={startDownloadJob}
                updateDownloadJob={updateDownloadJobProgress}
                finishDownloadJob={finishDownloadJob}
                makeDownloadJobId={makeDownloadJobId}
                onProfileSelectionChange={handleModpackProfileSelectionChange}
                initialSelectedProfileId={activeInstanceProfile?.id ?? null}
                openedMrpackPath={openedMrpackPath}
                onOpenedMrpackPathConsumed={() => setOpenedMrpackPath(null)}
                onProfilesChange={(profiles) => {
                  setKnownProfiles(
                    profiles.map((p) => ({
                      id: p.id,
                      name: p.name,
                      game_version: p.game_version,
                      loader: p.loader,
                      loader_version: p.loader_version ?? null,
                      icon_path: p.icon_path,
                      created_at: p.created_at,
                      play_time_seconds: p.play_time_seconds ?? 0,
                      last_played_at: p.last_played_at ?? null,
                      mods_count: p.mods_count,
                      resourcepacks_count: p.resourcepacks_count,
                      shaderpacks_count: p.shaderpacks_count,
                      total_size_bytes: p.total_size_bytes,
                      directory: p.directory,
                    })),
                  );
                  setProfilesHydrated(true);
                }}
                onTogglePinInSidebar={(profile) =>
                  handleToggleSidebarPin({
                    id: profile.id,
                    name: profile.name,
                    game_version: profile.game_version,
                    loader: profile.loader,
                    loader_version: profile.loader_version ?? null,
                    icon_path: profile.icon_path,
                    created_at: profile.created_at,
                    play_time_seconds: profile.play_time_seconds ?? 0,
                    last_played_at: profile.last_played_at ?? null,
                    mods_count: profile.mods_count,
                    resourcepacks_count: profile.resourcepacks_count,
                    shaderpacks_count: profile.shaderpacks_count,
                    total_size_bytes: profile.total_size_bytes,
                    directory: profile.directory,
                  })
                }
                isPinnedInSidebar={(profileId) => pinnedProfileIds.includes(profileId)}
                onOpenModsTab={() => activateSidebarTab("mods")}
                onPlaySelectedProfile={() => {
                  if (!activeInstanceProfile) {
                    showNotification("warning", tt("app.warnings.selectProfileFirst"));
                    return;
                  }
                  void handlePrimaryClick();
                }}
                gameStatus={gameStatus}
                consoleLines={consoleLines}
                consoleHistorySessions={consoleHistorySessions}
                onClearConsole={handleClearConsole}
              />
            </div>
          );
        case "settings":
          return (
            <div className={inSplitPane ? "tab-pane-fill" : "flex min-h-0 w-full flex-1 flex-col"}>
            <SettingsTab
              fillPane={inSplitPane}
              settings={settings}
              settingsTab={settingsTab}
              setSettingsTab={setSettingsTab}
              systemMemoryGb={systemMemoryGb}
              updateSettings={(patch) =>
                updateSettings(patch, activeInstanceProfile?.id ?? undefined)
              }
              showNotification={showNotification}
              SettingsCard={SettingsCard}
              SettingsSlider={SettingsSlider}
              SettingsToggle={SettingsToggle}
              language={language}
              setLanguage={persistInterfaceLanguage}
              sidebarOrder={
                sidebarOrder.filter(
                  (id) =>
                    id === "play" ||
                    id === "settings" ||
                    id === "mods" ||
                    id === "modpacks",
                ) as ("play" | "settings" | "mods" | "modpacks")[]
              }
              setSidebarOrder={(order) =>
                setSidebarOrder(
                  order.filter(
                    (id) =>
                      id === "play" ||
                      id === "settings" ||
                      id === "mods" ||
                      id === "modpacks",
                  ) as SidebarItemId[],
                )
              }
              updateStatus={updateStatus}
              updateVersion={updateVersion}
              updateDownloadPercent={updateDownloadPercent}
              onCheckUpdate={() => void checkForUpdate({ silent: false, source: "manual" })}
              onInstallUpdate={() => void installUpdate()}
            />
            </div>
          );
        case "play":
        default:
          return (
            <div
              className={
                inSplitPane
                  ? "tab-pane-fill items-center justify-center overflow-auto py-2"
                  : "flex min-h-0 w-full flex-1 flex-col items-center justify-center"
              }
            >
            <PlayTab
              fillPane={inSplitPane}
              gameStatus={gameStatus}
              consoleLines={consoleLines}
              isConsoleVisible={isConsoleVisible}
              onRegisterConsoleHotkeys={registerPlayConsoleHotkeys}
              onToggleConsole={handleToggleConsole}
              onClearConsole={handleClearConsole}
              showConsoleOnLaunch={settings?.show_console_on_launch ?? false}
              versions={versions}
              selectedVersion={selectedVersion}
              setSelectedVersion={setSelectedVersion}
              versionsLoading={versionsLoading}
              isVersionDropdownOpen={isVersionDropdownOpen}
              setIsVersionDropdownOpen={setIsVersionDropdownOpen}
              installPaused={installPaused}
              isInstalling={isInstalling}
              handleResumeInstall={handleResumeInstall}
              handlePauseInstall={handlePauseInstall}
              handleCancelInstall={handleCancelInstall}
              handlePrimaryClick={handlePrimaryClick}
              isLaunching={isLaunching}
              primaryColorClasses={primaryColorClasses}
              primaryLabel={primaryLabel}
              progress={progress}
              loader={loader}
              setLoader={setLoader}
              isLoaderDropdownOpen={isLoaderDropdownOpen}
              setIsLoaderDropdownOpen={setIsLoaderDropdownOpen}
              handleOpenGameFolder={handleOpenGameFolder}
              language={language}
              installedVersionIds={installedVersionIdsForDropdown}
              showSnapshots={settings?.show_snapshots ?? false}
              activeProfileName={activeInstanceProfile?.name ?? null}
              isConsoleDetached={isConsoleDetached}
              onToggleConsoleDetached={toggleConsoleDetached}
            />
            </div>
          );
      }
    },
    [
      activateSidebarTab,
      activeInstanceProfile,
      checkForUpdate,
      consoleHistorySessions,
      consoleLines,
      gameStatus,
      handleCancelInstall,
      handleClearConsole,
      handleModpackProfileSelectionChange,
      registerModpackHotkeys,
      registerPlayConsoleHotkeys,
      handleOpenGameFolder,
      handlePauseInstall,
      handlePrimaryClick,
      handleResumeInstall,
      handleToggleConsole,
      isConsoleDetached,
      toggleConsoleDetached,
      handleToggleSidebarPin,
      installPaused,
      installUpdate,
      installedVersionIdsForDropdown,
      isConsoleVisible,
      isInstalling,
      isLaunching,
      isLoaderDropdownOpen,
      isVersionDropdownOpen,
      language,
      loader,
      pinnedProfileIds,
      primaryColorClasses,
      primaryLabel,
      progress,
      selectedVersion,
      setDiscordModsTitle,
      setIsLoaderDropdownOpen,
      setIsVersionDropdownOpen,
      persistInterfaceLanguage,
      setLoader,
      setSelectedVersion,
      setSettingsTab,
      settings,
      settingsTab,
      showNotification,
      sidebarOrder,
      systemMemoryGb,
      tt,
      updateDownloadPercent,
      updateSettings,
      updateStatus,
      updateVersion,
      versions,
      versionsLoading,
    ],
  );

  const singleMainTab: SplittableTabId = isSplittableTab(activeItem) ? activeItem : "play";

  if (onboardingVisible === null) {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#050609] text-white">
        <p className="text-sm text-white/45">{tt("common.loading")}</p>
      </div>
    );
  }

  if (onboardingVisible) {
    return (
      <OnboardingFlow
        language={language}
        accentColor={settings?.background_accent_color ?? "#0b1530"}
        backgroundImageUrl={backgroundImageUrl}
        backgroundAnimated={backgroundIsAnimated}
        onLanguagePersist={persistInterfaceLanguage}
        onProfileUpdated={loadProfile}
        onComplete={async () => {
          try {
            window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "1");
            window.localStorage.removeItem(ONBOARDING_FORCE_STORAGE_KEY);
          } catch {
          }
          await updateSettings({ onboarding_completed: true });
          setOnboardingVisible(false);
        }}
      />
    );
  }

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden text-white"
      style={
        {
          "--accent-color": accentColor,
        } as React.CSSProperties
      }
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <LauncherBackgroundImage
          imageUrl={backgroundImageUrl}
          blurEnabled={settings?.background_blur_enabled ?? true}
          animated={backgroundIsAnimated}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-black/55" />
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-24 -left-24 h-72 w-72 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${accentColor}80, transparent 70%)`,
          }}
        />
        <div
          className="absolute top-1/3 -right-32 h-80 w-80 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle at 70% 30%, ${accentColor}70, transparent 75%)`,
          }}
        />
        <div
          className="absolute bottom-[-6rem] left-1/4 h-64 w-64 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${accentColor}75, transparent 75%)`,
          }}
        />
      </div>

      <div className="pointer-events-none fixed top-11 left-0 right-0 z-30 flex flex-col items-center gap-2 px-4">
        {notifications.map((n) => {
          const baseClasses =
            "pointer-events-auto group inline-flex w-max max-w-[min(36rem,calc(100vw-2rem))] cursor-pointer items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium leading-snug shadow-soft transition-opacity hover:opacity-90 active:opacity-80 outline-none focus-visible:ring-2 focus-visible:ring-white/35";
          let bgClasses = "";
          let iconSrc = "";
          let style: React.CSSProperties | undefined;

          if (n.kind === "info") {
            bgClasses = "bg-neutral-800/90 border border-white/35 text-white";
            iconSrc = "/launcher-assets/info.png";
          } else if (n.kind === "success") {
            bgClasses = "bg-emerald-600/95 border border-emerald-300/60 text-white";
            iconSrc = "/launcher-assets/success.png";
          } else if (n.kind === "error") {
            bgClasses = "bg-red-700/95 border border-red-400/70 text-white";
            iconSrc = "/launcher-assets/errorIcon.png";
          } else if (n.kind === "warning") {
            bgClasses = "bg-amber-500/95 border border-amber-300/70 text-black";
            iconSrc = "/launcher-assets/warn.png";
          } else {
            const resolvedIcon = resolveRemoteNotificationIconSrc(n.iconMsg);
            iconSrc = resolvedIcon ?? "/launcher-assets/icon.png";
            const resolvedBg = resolveRemoteNotificationBgStyle(n.colorMsg);
            if (resolvedBg) {
              style = {
                backgroundColor: resolvedBg.background,
                border: `1px solid ${resolvedBg.border}`,
                color: resolvedBg.textColor === "black" ? "#000" : "#fff",
              };
            } else {
              bgClasses = "bg-neutral-800/90 border border-white/35 text-white";
            }
          }

          if (n.iconMsg) {
            const resolvedIcon = resolveRemoteNotificationIconSrc(n.iconMsg);
            if (resolvedIcon) iconSrc = resolvedIcon;
          }

          return (
            <div
              key={n.id}
              className={`flex w-full justify-center ${
                n.leaving
                  ? "animate-notification-slide-out"
                  : "animate-notification-slide-in"
              }`}
            >
              <div
                role="button"
                tabIndex={0}
                className={`${baseClasses} ${bgClasses}`}
                style={style}
                onClick={() => beginDismissNotification(n.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    beginDismissNotification(n.id);
                  }
                }}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/15">
                  <img src={iconSrc} alt="" className="h-4 w-4 object-contain" />
                </div>
                <span className="whitespace-pre-line break-words">{n.message}</span>
                {(n.count ?? 1) > 1 ? (
                  <span className="shrink-0 pl-0.5 tabular-nums text-xs font-semibold leading-none opacity-85">
                    ×{n.count}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pointer-events-auto fixed bottom-6 right-6 z-50 flex w-[360px] flex-col gap-3">
        {bottomSocialNotifications.map((n) => {
          const text = n.messageKey ? tt(n.messageKey) : (n.textMsg ?? "");
          const { title, subtitle } = splitTitleAndSubtitle(text);
          const colorFallback = n.kind === "discord" ? "#5865F2" : "#229ED9";
          const hexForShadow =
            typeof n.colorMsg === "string" && n.colorMsg.trim().startsWith("#")
              ? n.colorMsg.trim()
              : null;

          const primaryLabel =
            n.kind === "discord" ? tt("app.social.joinButton") : tt("app.social.subscribeButton");
          const laterLabel = tt("app.social.laterButton");
          const link = n.kind === "discord" ? DISCORD_LINK : TELEGRAM_LINK;

          return (
            <div
              key={n.id}
              className={`relative rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-lg shadow-[0_0_12px_rgba(0,0,0,0.25)] ${
                n.leaving ? "animate-notification-slide-out" : "animate-notification-slide-in"
              }`}
              style={{
                borderColor: hexForShadow ? `${hexForShadow}33` : undefined,
                boxShadow: hexForShadow ? `0 0 14px ${hexForShadow}33` : undefined,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: n.colorMsg ?? colorFallback }}
                >
                  <SocialIcon kind={n.kind} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-tight">{title}</div>
                  {subtitle && (
                    <div className="mt-1 whitespace-pre-line text-xs leading-snug text-white/70">
                      {subtitle}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="interactive-press flex-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setBottomSocialNotifications((prev) =>
                      prev.map((x) => (x.id === n.id ? { ...x, leaving: true } : x)),
                    );
                    window.setTimeout(() => {
                      setBottomSocialNotifications((prev) => prev.filter((x) => x.id !== n.id));
                    }, 180);
                    try {
                      await openUrl(link);
                    } catch (err) {
                      console.error("Failed to open link:", err);
                    }
                  }}
                >
                  {primaryLabel}
                </button>

                <button
                  type="button"
                  className="interactive-press flex-1 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setBottomSocialNotifications((prev) =>
                      prev.map((x) => (x.id === n.id ? { ...x, leaving: true } : x)),
                    );
                    window.setTimeout(() => {
                      setBottomSocialNotifications((prev) => prev.filter((x) => x.id !== n.id));
                    }, 180);
                  }}
                >
                  {laterLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showHelpModal && (
        <div
          className="pointer-events-auto fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className="glass-panel w-[min(90vw,28rem)] max-h-[85vh] overflow-y-auto rounded-2xl border border-white/15 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <img src="/launcher-assets/help.png" alt="" className="h-8 w-8 object-contain opacity-90" />
              <h2 className="text-base font-semibold text-white">{tt("app.help.title")}</h2>
            </div>
            <div className="space-y-4 text-sm text-white/90 leading-relaxed">
              <p>{tt("app.help.mainInfo")}</p>
              <p>
                {tt("app.help.icons")}{" "}
                <button
                  type="button"
                  className="text-amber-400 hover:text-amber-300 underline bg-transparent border-none cursor-pointer p-0 font-inherit text-inherit"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await openUrl("https://icons8.ru/icons");
                    } catch (err) {
                      console.error("Failed to open link:", err);
                    }
                  }}
                >
                  icons8.ru
                </button>
              </p>
              <p className="text-xs text-white/70 whitespace-pre-line">
                {tt("app.help.mojangDisclaimer")}
              </p>
              <p className="text-white/80">
                {tt("app.help.apis")}
              </p>
              <p>
                <button
                  type="button"
                  className="text-amber-400 hover:text-amber-300 underline bg-transparent border-none cursor-pointer p-0 font-inherit text-inherit"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await openUrl(DISCORD_LINK);
                    } catch (err) {
                      console.error("Failed to open link:", err);
                    }
                  }}
                >
                  {tt("app.help.reportBug")}
                </button>
              </p>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="interactive-press rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
              >
                {tt("app.help.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoveAccountId !== null && (
        <div
          className="pointer-events-auto fixed inset-0 z-[340] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPendingRemoveAccountId(null)}
        >
          <div
            className="glass-panel pointer-events-auto w-[min(90vw,24rem)] rounded-[22px] border border-white/15 bg-[#14141c]/95 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-remove-confirm-title"
          >
            <p
              id="account-remove-confirm-title"
              className="mb-5 text-sm leading-relaxed text-white/90"
            >
              {tt("app.accounts.removeConfirm")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRemoveAccountId(null)}
                className="interactive-press rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/18"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void confirmRemoveLauncherAccount()}
                className="interactive-press rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-amber-400"
              >
                {tt("common.delete")}
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

      {pinnedContextMenu && (
        <div
          className="fixed inset-0 z-[320]"
          onClick={() => setPinnedContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setPinnedContextMenu(null);
          }}
        >
          <div
            className="absolute z-[330] w-56 rounded-2xl bg-black/90 p-1 text-xs text-white shadow-soft backdrop-blur-lg"
            style={{ top: pinnedContextMenu.y, left: pinnedContextMenu.x }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={() => {
                const profile = knownProfiles.find((p) => p.id === pinnedContextMenu.profileId);
                setPinnedContextMenu(null);
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
                const profile = knownProfiles.find((p) => p.id === pinnedContextMenu.profileId);
                setPinnedContextMenu(null);
                if (!profile) return;
                void handleOpenProfileInModpacks(profile.id);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <img src="/launcher-assets/settings.png" alt="" className="h-3.5 w-3.5 object-contain" />
              <span>{tt("modpacks.contextMenu.settings")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = knownProfiles.find((p) => p.id === pinnedContextMenu.profileId);
                setPinnedContextMenu(null);
                if (!profile) return;
                void handleCreateProfileDesktopShortcut(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <img src="/launcher-assets/export.png" alt="" className="h-3.5 w-3.5 object-contain" />
              <span>{tt("modpacks.actions.createShortcut")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = knownProfiles.find((p) => p.id === pinnedContextMenu.profileId);
                setPinnedContextMenu(null);
                if (!profile) return;
                handleToggleSidebarPin(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <img src="/launcher-assets/favorite.png" alt="" className="h-3.5 w-3.5 object-contain" />
              <span>{tt("modpacks.contextMenu.unpinFromSidebar")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = knownProfiles.find((p) => p.id === pinnedContextMenu.profileId);
                setPinnedContextMenu(null);
                if (!profile) return;
                void handleDeleteProfileFromSidebar(profile.id);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-red-300 hover:bg-red-600/20"
            >
              <DeleteIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.contextMenu.deleteProfile")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPinnedContextMenu(null);
                void handleOpenProfileInModpacks(pinnedContextMenu.profileId);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <img src="/launcher-assets/edit.png" alt="" className="h-3.5 w-3.5 object-contain" />
              <span>{tt("modpacks.contextMenu.editProfile")}</span>
            </button>
          </div>
        </div>
      )}

      <div
        className="relative z-20 flex h-9 items-center justify-between px-4 select-none"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/40 select-none">
          <span>16Launcher</span>
          {launcherVersion ? (
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-[11px] font-medium normal-case tracking-normal text-white/35"
                title={tt("app.launcherVersionTitle", { version: launcherVersion })}
              >
                v{launcherVersion}
              </span>
              {launcherVersionBadgeKind === "latest" ? (
                <span
                  className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold normal-case tracking-normal text-emerald-200"
                  title={tt("app.versionBadge.latest")}
                >
                  LAST
                </span>
              ) : launcherVersionBadgeKind === "outdated" ? (
                <span
                  className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold normal-case tracking-normal text-amber-100"
                  title={
                    updateVersion
                      ? tt("app.versionBadge.outdatedWithVersion", { version: updateVersion })
                      : tt("app.versionBadge.outdated")
                  }
                >
                  OUTDATED
                </span>
              ) : (
                <span
                  className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[10px] font-semibold normal-case tracking-normal text-white/45"
                  title={tt("app.versionBadge.unknown")}
                >
                  LAST
                </span>
              )}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="interactive-press flex h-6 w-6 items-center justify-center rounded-md bg-black/20 text-white/60 hover:bg-black/40 hover:text-white/90 transition-colors"
            title={tt("app.help.title")}
            data-no-drag
          >
            <img src="/launcher-assets/help.png" alt="" className="h-3.5 w-3.5 object-contain" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative mr-1" ref={accountSwitcherRef} data-no-drag>
            <button
              type="button"
              onClick={() => {
                void refreshLauncherAccounts();
                setAccountSwitcherOpen((o) => !o);
              }}
              className="interactive-press flex max-w-[200px] items-center gap-2 rounded-lg border border-white/15 bg-black/25 py-1 pl-1.5 pr-2 text-left text-[11px] font-semibold text-white/88 hover:bg-black/40"
              title={tt("app.accounts.switcherTitle")}
            >
              <AccountAvatar
                username={activeAccountLabel}
                profile={profileAvatarInput}
                kind={activeAccountKind}
                size={56}
                className={`h-7 w-7 shrink-0 rounded-full ${accountKindAvatarClass(activeAccountKind)}`}
              />
              <span className="min-w-0 flex-1 truncate">{activeAccountLabel}</span>
              <ChevronDownIcon
                className={accountSwitcherOpen ? "rotate-180 opacity-100" : "opacity-70"}
              />
            </button>
            {accountSwitcherOpen ? (
              <div className="absolute right-0 top-full z-[100] mt-1.5 min-w-[240px] max-w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-white/15 bg-[#14141c]/96 py-1 shadow-2xl backdrop-blur-lg">
                <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                  {tt("app.accounts.switcherHeading")}
                </p>
                <div className="max-h-[min(280px,45vh)] overflow-y-auto">
                  {launcherAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      className={`flex items-center gap-2 border-t border-white/5 px-2 py-1.5 first:border-t-0 ${
                        acc.is_active ? "bg-emerald-500/10" : "hover:bg-white/5"
                      }`}
                    >
                      <AccountAvatar
                        username={acc.label}
                        profile={acc.is_active ? profileAvatarInput : undefined}
                        kind={acc.kind}
                        size={64}
                        className={`h-8 w-8 shrink-0 rounded-full ${accountKindAvatarClass(acc.kind)}`}
                      />
                      <button
                        type="button"
                        disabled={acc.is_active}
                        onClick={() => {
                          if (!acc.is_active) void handleSwitchLauncherAccount(acc.id);
                        }}
                        className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left transition enabled:cursor-pointer enabled:hover:bg-white/10 enabled:active:scale-[0.99] disabled:cursor-default"
                      >
                        <span className="block truncate text-sm font-medium text-white/95">
                          {acc.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-white/45">
                          {accountKindShortLabel(acc.kind)}
                          {acc.is_active
                            ? ` · ${tt("app.accounts.activeBadge")}`
                            : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => requestRemoveLauncherAccount(acc.id)}
                        className="interactive-press shrink-0 rounded-lg p-2 text-white/35 hover:bg-red-500/15 hover:text-red-300"
                        title={tt("app.accounts.removeTitle")}
                      >
                        <DeleteIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-white/10" />
                <button
                  type="button"
                  disabled={addingAccount}
                  onClick={() => void handleAddLauncherAccount()}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-emerald-200/95 hover:bg-white/10 disabled:opacity-50"
                >
                  <PlusIcon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                  {tt("app.accounts.addAccount")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAccountSwitcherOpen(false);
                    setActiveItemWithSound("accounts");
                  }}
                  className="w-full border-t border-white/10 px-3 py-2.5 text-left text-xs font-medium text-sky-300/95 hover:bg-white/10"
                >
                  {tt("app.accounts.manageAll")}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleMinimize}
            className="interactive-press flex h-7 w-7 items-center justify-center rounded-md bg-black/30 text-gray-300 hover:bg-black/50 hover:text-white"
            data-no-drag
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            className="interactive-press flex h-7 w-7 items-center justify-center rounded-md bg-black/30 text-gray-300 hover:bg-black/50 hover:text-white"
            data-no-drag
          >
            <MaximizeIcon />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="interactive-press flex h-7 w-7 items-center justify-center rounded-md bg-black/30 text-gray-300 hover:bg-black/50 hover:text-white"
            data-no-drag
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div
        className={`relative z-10 flex h-[calc(100vh-2.25rem)] ${
          sidebarPosition === "top"
            ? "flex-col"
            : sidebarPosition === "bottom"
              ? "flex-col-reverse"
              : sidebarPosition === "right"
                ? "flex-row-reverse"
                : "flex-row"
        }`}
      >
        <aside
          ref={sidebarRef}
          className={
            sidebarHorizontal
              ? `relative mx-3 flex h-[5.25rem] shrink-0 flex-row items-center justify-between gap-4 rounded-3xl bg-black/40 px-4 py-3 backdrop-blur-lg ${
                  sidebarPosition === "top" ? "mt-3 w-[calc(100%-1.5rem)]" : "mb-3 w-[calc(100%-1.5rem)]"
                }`
              : "relative m-3 flex w-20 shrink-0 flex-col justify-between rounded-3xl bg-black/40 px-3 py-6 backdrop-blur-lg"
          }
        >
          <span
            className={`pointer-events-none absolute rounded-full accent-bg transition-transform duration-200 ease-out ${
              sidebarHorizontal
                ? sidebarPosition === "bottom"
                  ? "bottom-3 left-0 h-1"
                  : "top-3 left-0 h-1"
                : sidebarPosition === "right"
                  ? "right-3 top-0 w-1"
                  : "left-3 top-0 w-1"
            }`}
            style={
              sidebarHorizontal
                ? {
                    width: `${sidebarIndicator.span}px`,
                    transform: `translateX(${sidebarIndicator.offset}px)`,
                    opacity: sidebarIndicator.ready ? 1 : 0,
                    willChange: "transform",
                  }
                : {
                    height: `${sidebarIndicator.span}px`,
                    transform: `translateY(${sidebarIndicator.offset}px)`,
                    opacity: sidebarIndicator.ready ? 1 : 0,
                    willChange: "transform",
                  }
            }
          />
          <div
            className={
              sidebarHorizontal ? "flex flex-row items-center gap-3" : "flex flex-col gap-3"
            }
          >
            {orderedSidebarItems.map((item) => {
              const tabId = item.id as SplittableTabId;
              const splitRole =
                effectiveTabSplit && tabPaneRole(tabId, effectiveTabSplit);
              return (
              <div
                key={item.id}
                className="interactive-press group relative flex items-center"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (sidebarDragConsumedRef.current) {
                      sidebarDragConsumedRef.current = false;
                      return;
                    }
                    if (tabId === "modpacks") {
                      const modpacksPaneVisible =
                        effectiveTabSplit != null
                          ? effectiveTabSplit.primary === "modpacks" ||
                            effectiveTabSplit.secondary === "modpacks"
                          : activeItem === "modpacks";
                      if (modpacksPaneVisible && handleModpackSidebarClick()) {
                        activateSidebarTab(tabId);
                        return;
                      }
                    }
                    activateSidebarTab(tabId);
                  }}
                  title={tt(item.labelKey)}
                  ref={(el) => {
                    sidebarButtonRefs.current[item.id] = el;
                  }}
                  className="relative flex items-center"
                >
                  <div
                    className={`sidebar-icon flex items-center justify-center ${
                      sidebarHorizontal ? "" : "ml-2"
                    } ${sidebarIconClass(tabId)}`}
                    onPointerDown={(e) => handleSidebarTabPointerDown(tabId, e)}
                  >
                    {SIDEBAR_ICON_PATHS[item.id] ? (
                      <img
                        src={SIDEBAR_ICON_PATHS[item.id]}
                        alt=""
                        className="h-7 w-7 object-contain"
                      />
                    ) : (
                      <>
                        {item.id === "play" && <PlayIcon />}
                        {item.id === "settings" && <SettingsIcon />}
                        {item.id === "mods" && <ModsIcon />}
                        {item.id === "modpacks" && <ModpackIcon />}
                      </>
                    )}
                  </div>
                </button>
                {splitRole ? (
                  <button
                    type="button"
                    className={[
                      "tab-split-sidebar-close interactive-press no-shift",
                      sidebarHorizontal
                        ? "tab-split-sidebar-close-horizontal"
                        : "tab-split-sidebar-close-vertical",
                    ].join(" ")}
                    title={tt("app.splitView.closePane")}
                    aria-label={tt("app.splitView.closePane")}
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissTabSplitPane(splitRole);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <CloseIcon />
                  </button>
                ) : null}
              </div>
            );
            })}
          </div>

          <div
            className={
              sidebarHorizontal
                ? "flex flex-row items-center gap-2"
                : "mt-40 flex flex-col items-center gap-2"
            }
          >
            {pinnedProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  void handlePlayPinnedProfile(profile);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPinnedContextMenu({
                    profileId: profile.id,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                title={profile.name}
                className="interactive-press group relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-black/40 hover:bg-black/60"
              >
                <ProfileInstanceIcon
                  profile={{ id: profile.id, name: profile.name }}
                  className="absolute inset-0 size-full rounded-xl"
                  initialClassName="text-xs"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
                  <img
                    src="/launcher-assets/play.png"
                    alt=""
                    className="h-4 w-4 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      const fallback = e.currentTarget.parentElement?.querySelector(
                        '[data-sidebar-play-fallback="1"]',
                      ) as HTMLElement | null;
                      if (fallback) fallback.style.display = "block";
                    }}
                  />
                  <svg
                    data-sidebar-play-fallback="1"
                    viewBox="0 0 24 24"
                    className="h-4 w-4 fill-current"
                    style={{ display: "none" }}
                    aria-hidden="true"
                  >
                    <path d="M8 6.5v11l9-5.5-9-5.5z" />
                  </svg>
                </div>
              </button>
            ))}
          </div>

          <div
            className={
              sidebarHorizontal
                ? "flex shrink-0 items-center border-l border-white/10 pl-4"
                : "border-t border-white/10 pt-4"
            }
          >
            <button
              type="button"
              onClick={() => setActiveItemWithSound("accounts")}
              title={tt("app.accounts.sidebarTooltip")}
              ref={(el) => {
                sidebarButtonRefs.current.accounts = el;
              }}
              className={`interactive-press group relative flex items-center justify-center ${
                sidebarHorizontal ? "" : "w-full"
              }`}
            >
              <div
                className={`sidebar-icon flex items-center justify-center rounded-full ${
                  sidebarHorizontal ? "" : "ml-2"
                } ${
                  activeItem === "accounts" ? "sidebar-icon-active" : "bg-black/40 hover:bg-black/70"
                }`}
              >
                <ProfileIcon />
              </div>
            </button>
          </div>
        </aside>

        <main
          ref={mainSplitRef}
          className={`relative flex min-h-0 flex-1 flex-col self-stretch overflow-hidden px-6 py-3 ${
            tabDrag ? "select-none" : ""
          }`}
        >
          {tabDrag ? (
            <div
              className="tab-drag-ghost"
              style={{ left: tabDrag.x, top: tabDrag.y }}
              aria-hidden
            >
              {SIDEBAR_ICON_PATHS[tabDrag.tab] ? (
                <img
                  src={SIDEBAR_ICON_PATHS[tabDrag.tab]}
                  alt=""
                  className="h-7 w-7 object-contain"
                />
              ) : (
                <>
                  {tabDrag.tab === "play" && <PlayIcon />}
                  {tabDrag.tab === "settings" && <SettingsIcon />}
                </>
              )}
            </div>
          ) : null}
          {activeItem === "accounts" ? (
            <div className="flex w-full max-w-xl flex-col items-center gap-6">
              <div className="w-full text-center">
                <h1 className="text-lg font-bold tracking-tight text-white/95">
                  {tt("app.accounts.managerTitle")}
                </h1>
                <p className="mt-1.5 text-sm text-white/50">{tt("app.accounts.managerSubtitle")}</p>
              </div>

              <div className="w-full rounded-2xl border border-white/10 glass-panel px-4 py-4 shadow-xl backdrop-blur-md bg-black/40">
                <div className="mb-3 flex items-start justify-between gap-3 px-1">
                  <div>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-white/45">
                      {tt("app.accounts.savedListTitle")}
                    </h2>
                    <p className="mt-1 text-[11px] leading-snug text-white/45">
                      {tt("app.accounts.savedListHint")}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={addingAccount}
                    onClick={() => void handleAddLauncherAccount()}
                    className="interactive-press flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    {tt("app.accounts.addAccount")}
                  </button>
                </div>
                {launcherAccounts.length === 0 ? (
                  <p className="px-1 py-6 text-center text-sm text-white/45">—</p>
                ) : (
                  <ul className="flex max-h-[min(360px,42vh)] flex-col gap-2 overflow-y-auto pr-0.5">
                    {launcherAccounts.map((acc) => (
                      <li
                        key={acc.id}
                        className={`flex items-stretch gap-2 rounded-xl border px-2 py-2 transition ${
                          acc.is_active
                            ? "border-emerald-400/35 bg-emerald-500/10"
                            : "border-white/10 bg-black/30 hover:bg-black/50"
                        }`}
                      >
                        <AccountAvatar
                          username={acc.label}
                          profile={acc.is_active ? profileAvatarInput : undefined}
                          kind={acc.kind}
                          size={88}
                          className={`h-11 w-11 shrink-0 self-center rounded-full ${accountKindAvatarClass(acc.kind)}`}
                        />
                        <button
                          type="button"
                          disabled={acc.is_active}
                          onClick={() => {
                            if (!acc.is_active) void handleSwitchLauncherAccount(acc.id);
                          }}
                          className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left transition enabled:cursor-pointer enabled:hover:bg-white/5 enabled:active:scale-[0.99] disabled:cursor-default"
                        >
                          <span className="block truncate text-sm font-semibold text-white/95">
                            {acc.label}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                                acc.kind === "microsoft"
                                  ? "bg-sky-500/25 text-sky-100"
                                  : acc.kind === "ely"
                                    ? "bg-[#2d7d46]/35 text-emerald-100"
                                    : "bg-white/10 text-white/55"
                              }`}
                            >
                              {accountKindShortLabel(acc.kind)}
                            </span>
                            {acc.is_active ? (
                              <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-300/90">
                                {tt("app.accounts.activeBadge")}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => requestRemoveLauncherAccount(acc.id)}
                          className="interactive-press shrink-0 self-center rounded-lg p-2.5 text-white/35 hover:bg-red-500/15 hover:text-red-300"
                          title={tt("app.accounts.removeTitle")}
                        >
                          <DeleteIcon className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="w-full">
                <h2 className="mb-3 px-1 text-center text-xs font-bold uppercase tracking-wider text-white/40">
                  {tt("app.accounts.currentProfileSection")}
                </h2>
                <div
                  className="flex w-full items-center gap-6 rounded-2xl border border-white/10 glass-panel px-6 py-5 shadow-xl backdrop-blur-md bg-black/50"
                >
                  <button
                    type="button"
                    className="interactive-press relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/90 bg-[#0f2744] transition hover:border-white hover:bg-[#1e3a5f]"
                  >
                    <AccountAvatar
                      username={displayedNickname}
                      profile={profileAvatarInput}
                      kind={activeAccountKind}
                      size={80}
                      className="h-full w-full rounded-full"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={displayedNickname}
                        onChange={(e) => setProfile((p) => ({ ...p, nickname: e.target.value }))}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (!isAuthorized && v !== profile.nickname) handleSaveNickname(v);
                        }}
                        placeholder={tt("app.accounts.nicknamePlaceholder")}
                        className="w-full min-w-0 bg-transparent text-xl font-semibold text-white placeholder:text-white/50 focus:outline-none disabled:opacity-60"
                        disabled={profileSaving || isAuthorized}
                      />
                      {!isAuthorized && (
                        <span className="text-white/50" title={tt("app.accounts.editNickname")}>
                          <PencilIcon />
                        </span>
                      )}
                    </div>
                    {profile.ely_username && (
                      <p className="mt-0.5 text-xs text-white/60">{profile.ely_username}</p>
                    )}
                  </div>
                </div>
                {!isAuthorized && (
                  <p className="mt-4 text-center text-sm text-white/80">{tt("app.accounts.hint")}</p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  {profile.ms_id_token ? (
                    <button
                      type="button"
                      onClick={handleMicrosoftLogout}
                      className="interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-black/40 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
                    >
                      <MicrosoftIcon />
                      <span>{tt("app.accounts.microsoftLogout")}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleMicrosoftLogin}
                      disabled={elyLoading || msLoading}
                      className="interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-[#0078d4]/90 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#106ebe] disabled:opacity-60"
                    >
                      <MicrosoftIcon />
                      <span>{tt("app.accounts.microsoftSignIn")}</span>
                    </button>
                  )}
                  {profile.ely_username ? (
                    <button
                      type="button"
                      onClick={handleElyLogout}
                      className="interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-black/40 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
                    >
                      <ElyByIcon />
                      <span>{tt("app.accounts.elyLogout")}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleElyLogin}
                      disabled={elyLoading}
                      className="interactive-press flex items-center gap-2 rounded-xl bg-[#2d7d46] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60"
                    >
                      <ElyByIcon />
                      <span>
                        {elyLoading ? tt("app.accounts.elyWaiting") : "Ely.by"}
                      </span>
                    </button>
                  )}
                </div>
                {elyAuthUrl && (
                  <div className="mt-4 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left">
                    <p className="mb-1.5 text-xs font-medium text-amber-200">
                      {tt("app.accounts.elyDialogTitle")}
                    </p>
                    <p className="break-all text-xs text-white/90">{elyAuthUrl}</p>
                    <p className="mt-1.5 text-[11px] text-white/60">{tt("app.accounts.elyDialogTip")}</p>
                  </div>
                )}
                {msAuthUrl && (
                  <div className="mt-4 w-full rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-left">
                    <p className="mb-1.5 text-xs font-medium text-blue-200">
                      {tt("app.accounts.microsoftSignIn")}
                    </p>
                    <p className="break-all text-xs text-white/90">{msAuthUrl}</p>
                  </div>
                )}
              </div>
            </div>
          ) : effectiveTabSplit ? (
            <div
              className={`tab-split-main tab-animate min-h-0 w-full flex-1 ${
                effectiveTabSplit.direction === "horizontal"
                  ? "tab-split-main-horizontal"
                  : "tab-split-main-vertical"
              }`}
            >
              <div
                key={effectiveTabSplit.primary}
                className={`tab-split-pane ${
                  effectiveTabSplit.focused !== "primary" ? "tab-split-pane-inactive" : ""
                }`}
                style={{ flexGrow: effectiveTabSplit.ratio, flexBasis: 0 }}
                onPointerDown={() => {
                  if (effectiveTabSplit.focused !== "primary") {
                    setTabSplitLayout({ ...effectiveTabSplit, focused: "primary" });
                    setActiveItemWithSound(effectiveTabSplit.primary);
                  }
                }}
              >
                <button
                  type="button"
                  className="tab-split-pane-close interactive-press no-shift"
                  title={tt("app.splitView.closePane")}
                  aria-label={tt("app.splitView.closePane")}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissTabSplitPane("primary");
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <CloseIcon />
                </button>
                <div className="tab-split-pane-inner">
                  {renderMainTabContent(effectiveTabSplit.primary, true)}
                </div>
              </div>
              <div
                role="separator"
                aria-orientation={
                  effectiveTabSplit.direction === "horizontal" ? "vertical" : "horizontal"
                }
                aria-valuenow={Math.round(effectiveTabSplit.ratio * 100)}
                className={[
                  "tab-split-divider",
                  effectiveTabSplit.direction === "horizontal"
                    ? "tab-split-divider-horizontal"
                    : "tab-split-divider-vertical",
                  isTabSplitDividerDragging ? "tab-split-divider-dragging" : "",
                ].join(" ")}
                onPointerDown={onTabSplitDividerPointerDown}
              />
              <div
                key={effectiveTabSplit.secondary}
                className={`tab-split-pane ${
                  effectiveTabSplit.focused !== "secondary" ? "tab-split-pane-inactive" : ""
                }`}
                style={{ flexGrow: 1 - effectiveTabSplit.ratio, flexBasis: 0 }}
                onPointerDown={() => {
                  if (effectiveTabSplit.focused !== "secondary") {
                    setTabSplitLayout({ ...effectiveTabSplit, focused: "secondary" });
                    setActiveItemWithSound(effectiveTabSplit.secondary);
                  }
                }}
              >
                <button
                  type="button"
                  className="tab-split-pane-close interactive-press no-shift"
                  title={tt("app.splitView.closePane")}
                  aria-label={tt("app.splitView.closePane")}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissTabSplitPane("secondary");
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <CloseIcon />
                </button>
                <div className="tab-split-pane-inner">
                  {renderMainTabContent(effectiveTabSplit.secondary, true)}
                </div>
              </div>
            </div>
          ) : (
            <div
              key={singleMainTab}
              className="tab-animate flex min-h-0 w-full flex-1 flex-col items-center justify-center"
            >
              {renderMainTabContent(singleMainTab)}
            </div>
          )}
          {tabDrag && splitViewEnabled ? (
            <TabSplitDropOverlay zone={tabDropZone} labels={splitDropZoneLabels} />
          ) : null}
        </main>

        <ActiveDownloadsPanel jobs={activeDownloadJobs} language={language} />
      </div>
    </div>
  );
}

export default App;
