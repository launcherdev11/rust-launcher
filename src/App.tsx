import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";
import {
  SettingsToggle,
  SettingsSlider,
  SettingsCard,
} from "./settings-ui/SettingsComponents";
import { ModsTab } from "./tabs/ModsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { ModpackTab } from "./tabs/ModpackTab";
import { PlayTab } from "./tabs/PlayTab";
import { useT, t } from "./i18n";

type Profile = {
  nickname: string;
  ely_username: string | null;
  ely_uuid: string | null;
  ms_id_token: string | null;
  mc_uuid: string | null;
};

type SidebarItemId = "play" | "settings" | "mods" | "modpacks" | "accounts";
type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";

type SettingsTabId = "directories" | "game" | "versions" | "launcher";

type Language = "ru" | "en";

type Settings = {
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
  open_launcher_on_profiles_tab: boolean;
  interface_language?: string;
  background_accent_color: string;
  background_image_url: string | null;
  background_blur_enabled: boolean;
};

type InstanceProfileSummary = {
  id: string;
  name: string;
  game_version: string;
  loader: string;
};

const SIDEBAR_ICON_PATHS: Partial<Record<SidebarItemId, string>> = {
  play: "/launcher-assets/play64.png",
  settings: "/launcher-assets/settings.png",
  mods: "/launcher-assets/mods.png",
  modpacks: "/launcher-assets/modpack_icon.png",
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

type VersionItem = VersionSummary | ForgeVersionSummary | NeoForgeVersionSummary;

function isForgeVersion(v: VersionItem): v is ForgeVersionSummary {
  return "forge_build" in v && "installer_url" in v;
}

function isNeoForgeVersion(v: VersionItem): v is NeoForgeVersionSummary {
  return "neoforge_build" in v && "installer_url" in v;
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

type GameStatus = "idle" | "running" | "stopped" | "crashed";

type NotificationKind = "info" | "success" | "error" | "warning";

type Notification = {
  id: number;
  kind?: NotificationKind;
  message: string;
  leaving?: boolean;
  colorMsg?: string;
  iconMsg?: string;
};

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

function App() {
  const [activeItem, setActiveItem] = useState<SidebarItemId>("play");
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
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarButtonRefs = useRef<
    Partial<Record<SidebarItemId, HTMLButtonElement | null>>
  >({});
  const [sidebarIndicator, setSidebarIndicator] = useState<{
    top: number;
    height: number;
    ready: boolean;
  }>({ top: 0, height: 32, ready: false });

  const updateSidebarIndicator = useCallback(() => {
    const container = sidebarRef.current;
    const btn = sidebarButtonRefs.current[activeItem];
    if (!container || !btn) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const height = 32;
    const top = btnRect.top - containerRect.top + (btnRect.height - height) / 2;

    setSidebarIndicator({ top, height, ready: true });
  }, [activeItem]);

  useLayoutEffect(() => {
    updateSidebarIndicator();
  }, [updateSidebarIndicator]);

  useEffect(() => {
    window.addEventListener("resize", updateSidebarIndicator);
    return () => window.removeEventListener("resize", updateSidebarIndicator);
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
  const [profileSaving, setProfileSaving] = useState(false);
  const [installPaused, setInstallPaused] = useState(false);
  const prevActiveItemRef = useRef<SidebarItemId>(activeItem);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [bottomSocialNotifications, setBottomSocialNotifications] = useState<BottomSocialNotification[]>([]);
  const didLoadedRemoteNotificationsRef = useRef(false);
  const didLoadedBottomSocialRef = useRef(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("game");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "downloading" | "installing" | "up-to-date" | "error"
  >("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateDownloadPercent, setUpdateDownloadPercent] = useState<number | null>(null);
  const [systemMemoryGb, setSystemMemoryGb] = useState<number>(16);
  const [language, setLanguage] = useState<Language>("ru");
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [launcherVersion, setLauncherVersion] = useState<string | null>(null);
  const tt = useT(language);

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
  const [consoleLines, setConsoleLines] = useState<GameConsoleLine[]>([]);
  const [isConsoleVisible, setIsConsoleVisible] = useState(false);
  const [gameStatus, setGameStatus] = useState<GameStatus>("idle");
  const [isStopping, setIsStopping] = useState(false);
  const lastRunningRef = useRef(false);
  const [activeInstanceProfile, setActiveInstanceProfile] =
    useState<InstanceProfileSummary | null>(null);
  const [discordModsTitle, setDiscordModsTitle] = useState<string | null>(null);
  const [backgroundDataUri, setBackgroundDataUri] = useState<string | null>(null);
  const didApplyStartPageRef = useRef(false);

  const skinHeadSrc = useMemo(() => {
    const mcUuid = profile.mc_uuid?.trim().replace(/-/g, "");
    const elyUuid = profile.ely_uuid?.trim().replace(/-/g, "");
    const uuid = mcUuid || elyUuid || "00000000000000000000000000000000";
    return `https://crafatar.com/renders/head/${uuid}?scale=6&default=MHF_Steve`;
  }, [profile.mc_uuid, profile.ely_uuid]);

  const stevePlaceholderSrc = useMemo(() => {
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="32" fill="#0f2744"/>
  <circle cx="32" cy="28" r="16" fill="#8b6b4f"/>
  <rect x="14" y="38" width="36" height="24" rx="14" fill="#7a5a41"/>
  <rect x="24" y="27" width="5" height="5" rx="1.2" fill="#2b2b2b"/>
  <rect x="35" y="27" width="5" height="5" rx="1.2" fill="#2b2b2b"/>
  <path d="M25 36 C28 39 36 39 39 36" stroke="#2b2b2b" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>
`.trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  const [headImgSrc, setHeadImgSrc] = useState<string>(skinHeadSrc);
  useEffect(() => {
    setHeadImgSrc(skinHeadSrc);
  }, [skinHeadSrc]);

  const handleHeadImgError = useCallback(() => {
    if (headImgSrc !== stevePlaceholderSrc) {
      setHeadImgSrc(stevePlaceholderSrc);
    }
  }, [headImgSrc, stevePlaceholderSrc]);

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
            }
          : null,
      );
    },
    [],
  );

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("launcher_language");
      if (saved === "ru" || saved === "en") {
        setLanguage(saved);
        return;
      }
      const browserLang =
        typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "ru";
      if (browserLang.startsWith("en")) {
        setLanguage("en");
      } else {
        setLanguage("ru");
      }
    } catch {
      setLanguage("ru");
    }
  }, []);

  useEffect(() => {
    if (!settings) return;
    let lang = settings.interface_language;
    if (lang !== "ru" && lang !== "en") {
      try {
        const saved = window.localStorage.getItem("launcher_language");
        if (saved === "ru" || saved === "en") {
          lang = saved;
          invoke("set_settings", {
            settings: { ...settings, interface_language: lang },
          }).catch(() => {});
        }
      } catch {
      }
    }
    if (lang === "ru" || lang === "en") {
      setLanguage(lang);
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
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("launcher_language", language);
      } catch {
      }
    }
  }, [language]);

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
          setConsoleLines((prev) => {
            const next: GameConsoleLine[] = [
              ...prev,
              {
                id: Date.now() + Math.random(),
                line: text,
                source,
              },
            ];
            return next.length > 1000 ? next.slice(next.length - 1000) : next;
          });
        });
      } catch (e) {
        console.error("Не удалось подписаться на консоль игры:", e);
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const showNotification = useCallback(
    (kind: NotificationKind, message: string) => {
      const id = Date.now() + Math.random();

      setNotifications((prev) => {
        if (settings && !settings.notify_new_message && kind === "info") {
          return prev;
        }
        return [...prev, { id, kind, message }];
      });

      setTimeout(() => {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, leaving: true } : n)),
        );
        setTimeout(() => {
          setNotifications((prev) => prev.filter((n) => n.id !== id));
        }, 200);
      }, 4300);
    },
    [settings],
  );

  const showSettingsSavedNotification = useCallback(() => {
    setNotifications((prev) =>
      prev.filter(
        (n) => !(n.kind === "success"),
      ),
    );
    showNotification(
      "success",
      tt("app.toast.settingsSaved"),
    );
  }, [tt, showNotification]);

  const defaultSettings: Settings = {
    ram_mb: 4096,
    show_console_on_launch: false,
    close_launcher_on_game_start: false,
    check_game_processes: true,
    resolution_width: null,
    resolution_height: null,
    show_snapshots: false,
    show_alpha_versions: false,
    notify_new_update: true,
    notify_new_message: true,
    notify_system_message: true,
    check_updates_on_start: true,
    auto_install_updates: false,
    open_launcher_on_profiles_tab: false,
    background_accent_color: "#0b1530",
    background_image_url: null,
    background_blur_enabled: true,
  };

  const refreshSettings = useCallback(async (profileId?: string | null) => {
    try {
      const s =
        profileId != null && profileId !== ""
          ? await invoke<Settings>("get_effective_settings", { profileId })
          : await invoke<Settings>("get_settings");
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

      setSettings((prev) => {
        const current = prev ?? defaultSettings;
        const next: Settings = { ...current, ...patch };
        if (patch.open_launcher_on_profiles_tab !== undefined) {
          setActiveItem(patch.open_launcher_on_profiles_tab ? "modpacks" : "play");
        }
        if (useProfile) {
          const profilePatch: Record<string, unknown> = {};
          if (patch.ram_mb !== undefined) profilePatch.ram_mb = patch.ram_mb;
          if (patch.show_console_on_launch !== undefined)
            profilePatch.show_console_on_launch = patch.show_console_on_launch;
          if (patch.close_launcher_on_game_start !== undefined)
            profilePatch.close_launcher_on_game_start = patch.close_launcher_on_game_start;
          if (patch.check_game_processes !== undefined)
            profilePatch.check_game_processes = patch.check_game_processes;
          invoke("update_profile_settings", { id: profileId, patch: profilePatch })
            .then(() => {
              showSettingsSavedNotification();
            })
            .catch((e) => {
              console.error("Не удалось сохранить настройки профиля:", e);
            });
          const nonGamePatch = { ...patch };
          gameFields.forEach((k) => delete nonGamePatch[k]);
          if (Object.keys(nonGamePatch).length > 0) {
            invoke("set_settings", { settings: { ...current, ...nonGamePatch } }).catch((e) =>
              console.error("Не удалось сохранить настройки:", e),
            );
          }
        } else {
          invoke("set_settings", { settings: next })
            .then(() => showSettingsSavedNotification())
            .catch((e) => console.error("Не удалось сохранить настройки:", e));
        }
        return next;
      });
    },
    [showSettingsSavedNotification],
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

        for (const s of system) {
          const id = Date.now() + Math.random();

          setNotifications((prev) => [...prev, { id, ...s }]);

          setTimeout(() => {
            setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, leaving: true } : n)));
            setTimeout(() => {
              setNotifications((prev) => prev.filter((n) => n.id !== id));
            }, 200);
          }, 4300);
        }

      } catch (e) {
        if (controller.signal.aborted) return;
        console.error("Failed to load remote notifications:", e);
      }
    })();

    return () => controller.abort();
  }, [settings]);

  useEffect(() => {
    if (didLoadedBottomSocialRef.current) return;
    didLoadedBottomSocialRef.current = true;

    const showDiscordInitial = Math.random() < 0.5;
    const showTelegramInitial = Math.random() < 0.5;
    const showDiscord =
      showDiscordInitial || (!showDiscordInitial && !showTelegramInitial)
        ? showDiscordInitial || Math.random() < 0.5
        : false;
    const showTelegram = !showDiscord && (showTelegramInitial || Math.random() < 0.5);

    const cards: BottomSocialNotification[] = [];

    if (showDiscord) {
      cards.push({
        id: Date.now() + Math.random(),
        kind: "discord",
        colorMsg: "#5865F2",
        iconMsg: undefined,
        messageKey: "app.social.discord",
      });
    }

    if (showTelegram) {
      cards.push({
        id: Date.now() + Math.random(),
        kind: "telegram",
        colorMsg: "#229ED9",
        iconMsg: undefined,
        messageKey: "app.social.telegram",
      });
    }

    if (cards.length > 0) setBottomSocialNotifications(cards);
  }, []);

  const checkForUpdate = useCallback(async (silent = false) => {
    try {
      setUpdateStatus("checking");
      setUpdateVersion(null);
      const update = await check();
      if (update) {
        setUpdateVersion(update.version);
        setUpdateStatus("available");
        if (!silent && settings?.notify_new_update) {
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
  }, [settings?.notify_new_update, settings?.auto_install_updates, showNotification, tt]);

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

  useEffect(() => {
    if (settings?.check_updates_on_start === false) return;
    const t = setTimeout(() => {
      void checkForUpdate(true);
    }, 2000);
    return () => clearTimeout(t);
  }, [settings?.check_updates_on_start, checkForUpdate]);

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
          });
        }
      } catch {
        // ignore
      }
    })();
  }, []);

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
          const all = await invoke<VersionSummary[]>("fetch_all_versions");
          const showSnapshots = settings?.show_snapshots ?? false;
          const showAlpha = settings?.show_alpha_versions ?? false;
          const filtered = all.filter((v) => {
            if (v.version_type === "release") return true;
            if (v.version_type === "snapshot") return showSnapshots;
            if (v.version_type === "old_alpha" || v.version_type === "alpha") return showAlpha;
            return false;
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
          });
          setFabricProfileId(id);
          setQuiltProfileId(null);
        } else if (loader === "quilt") {
          const id = await invoke<string | null>("get_installed_quilt_profile_id", {
            gameVersion: selectedVersion.id,
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

  const loadProfile = useCallback(async () => {
    try {
      const p = await invoke<Profile>("get_profile");
      setProfile({
        nickname: p.nickname ?? "",
        ely_username: p.ely_username ?? null,
        ely_uuid: p.ely_uuid ?? null,
        ms_id_token: p.ms_id_token ?? null,
        mc_uuid: p.mc_uuid ?? null,
      });
    } catch {
      setProfile({
        nickname: "",
        ely_username: null,
        ely_uuid: null,
        ms_id_token: null,
        mc_uuid: null,
      });
    }
  }, []);

  useEffect(() => {
    if (activeItem === "accounts") {
      loadProfile();
    }
  }, [activeItem, loadProfile]);

  useEffect(() => {
    const prev = prevActiveItemRef.current;
    prevActiveItemRef.current = activeItem;
    if (prev === "accounts" && activeItem !== "accounts" && profile.nickname.trim()) {
      invoke("set_profile", { nickname: profile.nickname.trim() }).catch(console.error);
    }
  }, [activeItem, profile.nickname]);

  useEffect(() => {
    const t = setTimeout(() => {
      const nick = profile.nickname.trim();
      if (nick) {
        setProfileSaving(true);
        invoke("set_profile", { nickname: nick })
          .then(() => setProfile((prev) => ({ ...prev, nickname: nick })))
          .catch(console.error)
          .finally(() => setProfileSaving(false));
      }
    }, 700);
    return () => clearTimeout(t);
  }, [profile.nickname]);

  const handleSaveNickname = async (nickname: string) => {
    setProfileSaving(true);
    try {
      await invoke("set_profile", { nickname });
      setProfile((prev) => ({ ...prev, nickname }));
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
    showNotification("warning", tt("app.accounts.toast.msAuthUnavailable"));
  };

  const handleMicrosoftLogout = async () => {
    try {
      await invoke("ms_logout");
      await loadProfile();
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
    gameStatus === "running" || isStopping
      ? "bg-red-600 hover:bg-red-500"
      : "accent-bg hover:opacity-90";

  const primaryLabel = useMemo(() => {
    if (gameStatus === "running" || isStopping) {
      return tt("app.playAction.stop");
    }
    if (isInstalled) {
      return tt("app.playAction.play");
    }
    return tt("app.playAction.install");
  }, [gameStatus, isStopping, isInstalled, tt]);

  const handleToggleConsole = () => {
    setIsConsoleVisible((prev) => !prev);
  };

  const handleClearConsole = () => {
    setConsoleLines([]);
  };

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
    const match = versions.find((v) => {
      if (isForgeVersion(v)) {
        return v.mc_version === versionId;
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
    setInstallPaused(true);
    setIsInstalling(false);
    try {
      await invoke("cancel_download");
    } catch (error) {
      console.error("Не удалось поставить загрузку на паузу:", error);
    }
  };

  const handleCancelInstall = async () => {
    setInstallPaused(false);
    setIsInstalling(false);
    try {
      await invoke("cancel_download");
    } catch (error) {
      console.error("Не удалось отменить загрузку:", error);
    } finally {
      setProgress(null);
    }
  };

  const handleResumeInstall = () => {
    if (isInstalled || !selectedVersion) return;
    setInstallPaused(false);
    void handlePrimaryClick();
  };

  const handlePrimaryClick = async () => {
    if (!selectedVersion || isInstalling || isStopping) return;

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
        const versionUrl =
          loader === "vanilla" && !isForgeVersion(selectedVersion)
            ? (selectedVersion as VersionSummary).url
            : undefined;
        const versionId =
          loader === "fabric" && fabricProfileId
            ? fabricProfileId
            : loader === "quilt" && quiltProfileId
              ? quiltProfileId
              : selectedVersion.id;
        setConsoleLines([]);
        if (settings?.show_console_on_launch) {
          setIsConsoleVisible(true);
        }
        setGameStatus("running");
        await invoke("launch_game", {
          versionId,
          versionUrl: versionUrl ?? null,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Ошибка запуска игры:", error);
        showNotification(
          "error",
          tt("app.errors.launchError", { msg }),
        );
      }
      return;
    }

    setInstallPaused(false);
    setIsInstalling(true);
    setProgress(null);
    showNotification("info", tt("app.toast.downloadStarted"));
    try {
      try {
        await invoke("reset_download_cancel");
      } catch (e) {
        console.error("Не удалось сбросить состояние загрузки:", e);
      }
      if (loader === "vanilla" && !isForgeVersion(selectedVersion) && !isNeoForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        await invoke("install_version", {
          versionId: v.id,
          versionUrl: v.url,
        });
      } else if (loader === "fabric" && !isForgeVersion(selectedVersion) && !isNeoForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        const loaders = await invoke<string[]>("fetch_fabric_loaders", {
          gameVersion: v.id,
        });
        const loaderVersion = loaders[0];
        if (!loaderVersion) throw new Error("Нет подходящего Fabric Loader для этой версии");
        const profileId = await invoke<string>("install_fabric", {
          gameVersion: v.id,
          loaderVersion,
        });
        setInstalledIds((prev) => new Set(prev).add(profileId));
        setFabricProfileId(profileId);
        showNotification("success", tt("app.toast.downloadFinished"));
        setIsInstalling(false);
        return;
      } else if (loader === "quilt" && !isForgeVersion(selectedVersion) && !isNeoForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        const profileId = await invoke<string>("install_quilt", {
          gameVersion: v.id,
        });
        setInstalledIds((prev) => new Set(prev).add(profileId));
        setQuiltProfileId(profileId);
        showNotification("success", tt("app.toast.downloadFinished"));
        setIsInstalling(false);
        return;
      } else if (loader === "forge" && isForgeVersion(selectedVersion)) {
        await invoke("install_forge", {
          versionId: selectedVersion.id,
          installerUrl: selectedVersion.installer_url,
        });
      } else if (loader === "neoforge" && isNeoForgeVersion(selectedVersion)) {
        await invoke("install_neoforge", {
          version_id: selectedVersion.id,
        });
      } else {
        throw new Error("Неизвестный тип версии");
      }

      showNotification("success", tt("app.toast.downloadFinished"));
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.add(selectedVersion.id);
        return next;
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Ошибка установки версии:", error);
        showNotification(
          "error",
          tt("app.errors.installError", { msg }),
        );
    } finally {
      setIsInstalling(false);
    }
  };

  const accentColor = settings?.background_accent_color ?? "#0b1530";
  const rawBackgroundImage =
    settings?.background_image_url && settings.background_image_url.trim().length > 0
      ? settings.background_image_url.trim()
      : "/launcher-assets/background.jpg";

  useEffect(() => {
    (async () => {
      if (!settings?.background_image_url) {
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

  const backgroundImageUrl =
    backgroundDataUri ??
    (rawBackgroundImage.startsWith("http://") ||
    rawBackgroundImage.startsWith("https://") ||
    rawBackgroundImage.startsWith("data:") ||
    rawBackgroundImage.startsWith("/launcher-assets/")
      ? rawBackgroundImage
      : convertFileSrc(rawBackgroundImage));

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
        <div
          className="absolute inset-0 bg-center will-change-transform"
          style={{
            backgroundImage: `url(${backgroundImageUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            ...(settings?.background_blur_enabled ?? true
              ? {
                  filter: "blur(22px)",
                  transform: "scale(1.08)",
                }
              : {}),
          }}
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

      <div className="pointer-events-none absolute top-4 left-0 right-0 z-30 flex flex-col items-center gap-2 px-4">
        {notifications.map((n) => {
          const baseClasses =
            "pointer-events-auto group flex max-w-xl items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium shadow-soft";
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
              className={`${baseClasses} ${bgClasses} ${
                n.leaving
                  ? "animate-notification-slide-out"
                  : "animate-notification-slide-in"
              }`}
              style={style}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black/15">
                <img src={iconSrc} alt="" className="h-4 w-4 object-contain" />
              </div>
              <span className="whitespace-pre-line flex-1 break-words">
                {n.message}
              </span>
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

      <div
        className="relative z-20 flex h-9 items-center justify-between px-4 select-none"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/40 select-none">
          <span>16Launcher</span>
          {launcherVersion ? (
            <span
              className="font-mono text-[11px] font-medium normal-case tracking-normal text-white/35"
              title={tt("app.launcherVersionTitle", { version: launcherVersion })}
            >
              v{launcherVersion}
            </span>
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

      <div className="relative z-10 flex h-[calc(100vh-2.25rem)]">
        <aside
          ref={sidebarRef}
          className="relative m-3 flex w-20 flex-col justify-between rounded-3xl bg-black/40 px-3 py-6 backdrop-blur-lg"
        >
          <span
            className="pointer-events-none absolute left-3 top-0 w-1 rounded-full accent-bg transition-transform duration-200 ease-out"
            style={{
              height: `${sidebarIndicator.height}px`,
              transform: `translateY(${sidebarIndicator.top}px)`,
              opacity: sidebarIndicator.ready ? 1 : 0,
              willChange: "transform",
            }}
          />
          <div className="flex flex-col gap-3">
            {orderedSidebarItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveItem(item.id)}
                title={tt(item.labelKey)}
                ref={(el) => {
                  sidebarButtonRefs.current[item.id] = el;
                }}
                className="interactive-press group relative flex items-center"
              >
                <div
                  className={`sidebar-icon ml-2 flex items-center justify-center ${
                    activeItem === item.id ? "sidebar-icon-active" : ""
                  }`}
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
            ))}
          </div>

          <div className="border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setActiveItem("accounts")}
              ref={(el) => {
                sidebarButtonRefs.current.accounts = el;
              }}
              className="interactive-press group relative flex items-center justify-center w-full"
            >
              <div
                className={`sidebar-icon ml-2 flex items-center justify-center rounded-full ${
                  activeItem === "accounts" ? "sidebar-icon-active" : "bg-black/40 hover:bg-black/70"
                }`}
              >
                <ProfileIcon />
              </div>
            </button>
          </div>
        </aside>

        <main key={activeItem} className="tab-animate flex flex-1 flex-col items-center justify-center px-6">
          {activeItem === "accounts" ? (
            <div className="flex w-full max-w-lg flex-col items-center gap-6">
              <div
                className="flex w-full items-center gap-6 rounded-2xl border border-white/10 glass-panel px-6 py-5 shadow-xl backdrop-blur-md bg-black/50"
              >
                <button
                  type="button"
                  className="interactive-press relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/90 bg-[#0f2744] text-white/90 transition hover:border-white hover:bg-[#1e3a5f]"
                >
                  <img
                    src={headImgSrc}
                    alt=""
                    draggable={false}
                    className="aspect-square h-full w-full object-cover object-center"
                    onError={handleHeadImgError}
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
                <p className="text-center text-sm text-white/80">
                  {tt("app.accounts.hint")}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-3">
                {profile.ms_id_token ? (
                  <button
                    type="button"
                    onClick={handleMicrosoftLogout}
                    className="interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-black/40 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <MicrosoftIcon />
                    <span>
                      {tt("app.accounts.microsoftLogout")}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleMicrosoftLogin}
                    disabled={elyLoading}
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
                      {elyLoading
                        ? tt("app.accounts.elyWaiting")
                        : "Ely.by"}
                    </span>
                  </button>
                )}
              </div>
              {elyAuthUrl && (
                <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left">
                  <p className="mb-1.5 text-xs font-medium text-amber-200">
                    {tt("app.accounts.elyDialogTitle")}
                  </p>
                  <p className="break-all text-xs text-white/90">
                    {elyAuthUrl}
                  </p>
                  <p className="mt-1.5 text-[11px] text-white/60">
                    {tt("app.accounts.elyDialogTip")}
                  </p>
                </div>
              )}
            </div>
          ) : activeItem === "mods" ? (
            <div className="flex w-full flex-1 flex-col gap-4 overflow-auto py-4 items-center">
              <ModsTab
                showNotification={showNotification}
                language={language}
                activeProfileId={activeInstanceProfile?.id ?? null}
                activeProfileGameVersion={activeInstanceProfile?.game_version}
                activeProfileLoader={activeInstanceProfile?.loader}
                onOpenModpacksTab={() => setActiveItem("modpacks")}
                onSelectedModTitleChange={setDiscordModsTitle}
              />
            </div>
          ) : activeItem === "modpacks" ? (
          <div className="flex w-full flex-1 flex-col gap-4 overflow-auto py-4 items-start self-stretch">
            <ModpackTab
              language={language}
              showNotification={showNotification}
              onProfileSelectionChange={handleModpackProfileSelectionChange}
              initialSelectedProfileId={activeInstanceProfile?.id ?? null}
              onOpenModsTab={() => setActiveItem("mods")}
              onPlaySelectedProfile={() => {
                if (!activeInstanceProfile) {
                  showNotification(
                    "warning",
                    tt("app.warnings.selectProfileFirst"),
                  );
                  return;
                }
                void handlePrimaryClick();
              }}
            />
          </div>
          ) : activeItem === "settings" ? (
            <SettingsTab
              settings={settings}
              settingsTab={settingsTab}
              setSettingsTab={setSettingsTab}
              systemMemoryGb={systemMemoryGb}
              updateSettings={(patch) => updateSettings(patch, activeInstanceProfile?.id ?? undefined)}
              showNotification={showNotification}
              SettingsCard={SettingsCard}
              SettingsSlider={SettingsSlider}
              SettingsToggle={SettingsToggle}
              language={language}
              setLanguage={setLanguage}
              sidebarOrder={sidebarOrder.filter((id) =>
                id === "play" ||
                id === "settings" ||
                id === "mods" ||
                id === "modpacks"
              ) as ("play" | "settings" | "mods" | "modpacks")[]}
              setSidebarOrder={(order) => setSidebarOrder(order)}
              updateStatus={updateStatus}
              updateVersion={updateVersion}
              updateDownloadPercent={updateDownloadPercent}
              onCheckUpdate={() => void checkForUpdate(false)}
              onInstallUpdate={() => void installUpdate()}
            />
          ) : (
            <PlayTab
              gameStatus={gameStatus}
              consoleLines={consoleLines}
              isConsoleVisible={isConsoleVisible}
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
            />
          )}
        </main>

      </div>
    </div>
  );
}

export default App;
