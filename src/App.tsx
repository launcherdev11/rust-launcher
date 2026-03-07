import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
//import { check } from "@tauri-apps/plugin-updater";
import "./App.css";
import {
  SettingsToggle,
  SettingsSlider,
  SettingsCard,
} from "./settings-ui/SettingsComponents";
import { ModsTab } from "./tabs/ModsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import ModpackTab from "./tabs/ModpackTab";
import { PlayTab } from "./tabs/PlayTab";

type Profile = {
  nickname: string;
  avatar_path: string | null;
  ely_username: string | null;
  ely_uuid: string | null;
};

type SidebarItemId = "play" | "settings" | "mods" | "modpacks" | "accounts";
type LoaderId = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";

type SettingsTabId = "directories" | "game" | "versions" | "launcher" | "updates";

type Language = "ru" | "en";

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

type VersionItem = VersionSummary | ForgeVersionSummary;

function isForgeVersion(v: VersionItem): v is ForgeVersionSummary {
  return "forge_build" in v && "installer_url" in v;
}

type DownloadProgressPayload = {
  version_id: string;
  downloaded: number;
  total: number;
  percent: number;
};

type NotificationKind = "info" | "success" | "error" | "warning";

type Notification = {
  id: number;
  kind: NotificationKind;
  message: string;
  leaving?: boolean;
};

const sidebarItems: { id: SidebarItemId; label: string }[] = [
  { id: "play", label: "Играть" },
  { id: "settings", label: "Настройки" },
  { id: "mods", label: "Моды" },
  { id: "modpacks", label: "Сборки" },
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
  const [loader, setLoader] = useState<LoaderId>("vanilla");
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<VersionItem | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false);
  const [isLoaderDropdownOpen, setIsLoaderDropdownOpen] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<DownloadProgressPayload | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [fabricProfileId, setFabricProfileId] = useState<string | null>(null);
  const [quiltProfileId, setQuiltProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>({ nickname: "", avatar_path: null, ely_username: null, ely_uuid: null });
  const [elyLoading, setElyLoading] = useState(false);
  const [elyAuthUrl, setElyAuthUrl] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [installPaused, setInstallPaused] = useState(false);
  const prevActiveItemRef = useRef<SidebarItemId>(activeItem);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("game");
  const [systemMemoryGb, setSystemMemoryGb] = useState<number>(16);
  const [language, setLanguage] = useState<Language>("ru");

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
    try {
      window.localStorage.setItem("launcher_language", language);
    } catch {
      // ignore
    }
  }, [language]);

  const showNotification = useCallback((kind: NotificationKind, message: string) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [...prev, { id, kind, message }]);

    // Анимация ухода вверх перед удалением
    setTimeout(() => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, leaving: true } : n)),
      );
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 200);
    }, 4300);
  }, []);

  const showSettingsSavedNotification = useCallback(() => {
    setNotifications((prev) =>
      prev.filter(
        (n) => !(n.kind === "success"),
      ),
    );
    showNotification(
      "success",
      language === "ru" ? "Настройки сохранены!" : "Settings saved!",
    );
  }, [language, showNotification]);

  const refreshSettings = useCallback(async () => {
    try {
      const s = await invoke<Settings>("get_settings");
      setSettings(s);
    } catch (e) {
      console.error("Не удалось загрузить настройки:", e);
      setSettings({
        ram_mb: 4096,
        show_console_on_launch: false,
        close_launcher_on_game_start: false,
        check_game_processes: true,
        show_snapshots: false,
        show_alpha_versions: false,
        notify_new_update: true,
        notify_new_message: true,
        notify_system_message: true,
        check_updates_on_start: true,
        auto_install_updates: false,
      });
    }
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const current =
          prev ??
          ({
            ram_mb: 4096,
            show_console_on_launch: false,
            close_launcher_on_game_start: false,
            check_game_processes: true,
            show_snapshots: false,
            show_alpha_versions: false,
            notify_new_update: true,
            notify_new_message: true,
            notify_system_message: true,
            check_updates_on_start: true,
            auto_install_updates: false,
          } satisfies Settings);
        const next: Settings = { ...current, ...patch };
        invoke("set_settings", { settings: next })
          .then(() => {
            showSettingsSavedNotification();
          })
          .catch((e) => {
            console.error("Не удалось сохранить настройки:", e);
          });
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
    if (activeItem === "settings") {
      void refreshSettings();
    }
  }, [activeItem, refreshSettings]);

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
          setSelectedVersion(result.length > 0 ? result[0] : null);
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
          setSelectedVersion(filtered.length > 0 ? filtered[0] : null);
        }
      } catch (error) {
        console.error("Не удалось загрузить список версий:", error);
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
  }, [loader, settings?.show_snapshots, settings?.show_alpha_versions]);

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
        avatar_path: p.avatar_path ?? null,
        ely_username: p.ely_username ?? null,
        ely_uuid: p.ely_uuid ?? null,
      });
    } catch {
      setProfile({ nickname: "", avatar_path: null, ely_username: null, ely_uuid: null });
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
      invoke("set_profile", { nickname: profile.nickname.trim(), avatar_path: profile.avatar_path }).catch(console.error);
    }
  }, [activeItem, profile.nickname, profile.avatar_path]);

  useEffect(() => {
    const t = setTimeout(() => {
      const nick = profile.nickname.trim();
      if (nick) {
        setProfileSaving(true);
        invoke("set_profile", { nickname: nick, avatar_path: profile.avatar_path })
          .then(() => setProfile((prev) => ({ ...prev, nickname: nick })))
          .catch(console.error)
          .finally(() => setProfileSaving(false));
      }
    }, 700);
    return () => clearTimeout(t);
  }, [profile.nickname, profile.avatar_path]);

  const handleSaveNickname = async (nickname: string) => {
    setProfileSaving(true);
    try {
      await invoke("set_profile", { nickname, avatar_path: profile.avatar_path });
      setProfile((prev) => ({ ...prev, nickname }));
      showNotification(
        "success",
        language === "ru" ? "Изменения сохранены!" : "Changes saved!",
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru" ? "Не удалось сохранить никнейм." : "Failed to save nickname.",
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChooseAvatar = async () => {
    try {
      const path = await openFile({
        multiple: false,
        directory: false,
        filters: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (path) {
        const stored = await invoke<string>("save_avatar", { sourcePath: path });
        setProfile((prev) => ({ ...prev, avatar_path: stored }));
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru" ? "Не удалось загрузить аватар." : "Failed to upload avatar.",
      );
    }
  };

  const handleElyLogin = async () => {
    setElyLoading(true);
    setElyAuthUrl(null);
    try {
      const unlisten = await listen<Profile>("ely-login-complete", (e) => {
        const p = e.payload;
        setProfile({
          nickname: p.nickname ?? "",
          avatar_path: p.avatar_path ?? null,
          ely_username: p.ely_username ?? null,
          ely_uuid: p.ely_uuid ?? null,
        });
        setElyLoading(false);
        setElyAuthUrl(null);
        unlisten();
      });

      const url = await invoke<string>("start_ely_oauth");
      setElyAuthUrl(url);
      try {
        await openUrl(url);
      } catch (e) {
        console.error("Не удалось открыть браузер для Ely.by OAuth:", e);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", msg);
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
        language === "ru" ? "Вы вышли из аккаунта Ely.by." : "You have logged out of Ely.by.",
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru" ? "Не удалось выйти из аккаунта Ely.by." : "Failed to log out from Ely.by.",
      );
    }
  };

  const isInstalled = useMemo(() => {
    if (!selectedVersion) return false;
    if (loader === "fabric" && !isForgeVersion(selectedVersion)) return !!fabricProfileId;
    if (loader === "quilt" && !isForgeVersion(selectedVersion)) return !!quiltProfileId;
    return installedIds.has(selectedVersion.id);
  }, [installedIds, selectedVersion, loader, fabricProfileId, quiltProfileId]);

  const primaryColorClasses = isInstalled
    ? "bg-accentGreen hover:bg-emerald-500"
    : "bg-accentBlue hover:bg-sky-500";

  const primaryLabel = useMemo(() => {
    if (isInstalled) {
      return language === "ru" ? "ИГРАТЬ" : "PLAY";
    }
    return language === "ru" ? "Установить" : "Install";
  }, [isInstalled, language]);

  const handleOpenGameFolder = async () => {
    try {
      await invoke("open_game_folder");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Не удалось открыть папку игры:", error);
      showNotification(
        "error",
        language === "ru"
          ? `Не удалось открыть папку: ${msg}`
          : `Failed to open folder: ${msg}`,
      );
    }
  };

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
    if (!selectedVersion || isInstalling) return;

    if (isInstalled) {
      try {
        await invoke("set_profile", {
          nickname: profile.nickname,
          avatar_path: profile.avatar_path,
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
        await invoke("launch_game", {
          versionId,
          versionUrl: versionUrl ?? null,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Ошибка запуска игры:", error);
        showNotification(
          "error",
          language === "ru" ? `Ошибка запуска: ${msg}` : `Launch error: ${msg}`,
        );
      }
      return;
    }

    setInstallPaused(false);
    setIsInstalling(true);
    setProgress(null);
    showNotification("info", "Загрузка началась!");
    try {
      try {
        await invoke("reset_download_cancel");
      } catch (e) {
        console.error("Не удалось сбросить состояние загрузки:", e);
      }
      if (loader === "vanilla" && !isForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        await invoke("install_version", {
          versionId: v.id,
          versionUrl: v.url,
        });
      } else if (loader === "fabric" && !isForgeVersion(selectedVersion)) {
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
        showNotification("success", "Загрузка завершена!");
        setIsInstalling(false);
        return;
      } else if (loader === "quilt" && !isForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        const profileId = await invoke<string>("install_quilt", {
          gameVersion: v.id,
        });
        setInstalledIds((prev) => new Set(prev).add(profileId));
        setQuiltProfileId(profileId);
        showNotification("success", "Загрузка завершена!");
        setIsInstalling(false);
        return;
      } else if (loader === "forge" && isForgeVersion(selectedVersion)) {
        await invoke("install_forge", {
          versionId: selectedVersion.id,
          installerUrl: selectedVersion.installer_url,
        });
      } else {
        throw new Error("Неизвестный тип версии");
      }

      showNotification("success", "Загрузка завершена!");
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
          language === "ru" ? `Ошибка установки: ${msg}` : `Installation error: ${msg}`,
        );
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-white">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/launcher-assets/background.jpg)" }}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/55" />

      <div className="pointer-events-none absolute top-4 left-0 right-0 z-30 flex flex-col items-center gap-2 px-4">
        {notifications.map((n) => {
          const baseClasses =
            "pointer-events-auto flex max-w-xl items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium shadow-soft";
          let bgClasses = "";
          let iconSrc = "";

          if (n.kind === "info") {
            bgClasses = "bg-neutral-800/90 border border-white/35 text-white";
            iconSrc = "/launcher-assets/info.png";
          } else if (n.kind === "success") {
            bgClasses = "bg-emerald-600/95 border border-emerald-300/60 text-white";
            iconSrc = "/launcher-assets/success.png";
          } else if (n.kind === "error") {
            bgClasses = "bg-red-700/95 border border-red-400/70 text-white";
            iconSrc = "/launcher-assets/errorIcon.png";
          } else {
            bgClasses = "bg-amber-500/95 border border-amber-300/70 text-black";
            iconSrc = "/launcher-assets/warn.png";
          }

          return (
            <div
              key={n.id}
              className={`${baseClasses} ${bgClasses} ${
                n.leaving
                  ? "animate-notification-slide-out"
                  : "animate-notification-slide-in"
              }`}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black/15">
                <img src={iconSrc} alt="" className="h-4 w-4 object-contain" />
              </div>
              <span className="whitespace-pre-line">{n.message}</span>
            </div>
          );
        })}
      </div>

      <div
        className="relative z-20 flex h-9 items-center justify-between px-4 select-none"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/40 select-none">
          <span>16Launcher</span>
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
          className="relative flex w-20 flex-col justify-between bg-black/40 px-3 py-6 backdrop-blur-lg"
        >
          <span
            className="pointer-events-none absolute left-3 top-0 w-1 rounded-full bg-accentGreen transition-transform duration-200 ease-out"
            style={{
              height: `${sidebarIndicator.height}px`,
              transform: `translateY(${sidebarIndicator.top}px)`,
              opacity: sidebarIndicator.ready ? 1 : 0,
              willChange: "transform",
            }}
          />
          <div className="flex flex-col gap-3">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveItem(item.id)}
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
                className="flex w-full items-center gap-6 rounded-2xl border border-white/10 bg-gradient-to-br from-[#1e3a5f]/95 to-[#0f2744]/95 px-6 py-5 shadow-xl backdrop-blur-sm"
                style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
              >
                <button
                  type="button"
                  onClick={handleChooseAvatar}
                  className="interactive-press relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/90 bg-[#0f2744] text-white/90 transition hover:border-white hover:bg-[#1e3a5f]"
                  title={language === "ru" ? "Выбрать аватар" : "Choose avatar"}
                >
                  {profile.avatar_path ? (
                    <img
                      src={convertFileSrc(profile.avatar_path)}
                      alt=""
                      className="aspect-square h-full w-full object-cover object-center"
                    />
                  ) : (
                    <span className="text-3xl font-light text-white/70">?</span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={profile.nickname}
                      onChange={(e) => setProfile((p) => ({ ...p, nickname: e.target.value }))}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== profile.nickname) handleSaveNickname(v);
                      }}
                      placeholder="Player"
                      className="w-full min-w-0 bg-transparent text-xl font-semibold text-white placeholder:text-white/50 focus:outline-none disabled:opacity-60"
                      disabled={profileSaving}
                    />
                    <span className="text-white/50" title="Редактировать никнейм">
                      <PencilIcon />
                    </span>
                  </div>
                  {profile.ely_username && (
                    <p className="mt-0.5 text-xs text-white/60">
                    {(language === "ru" ? "Вход: " : "Signed in as: ") +
                      profile.ely_username}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-center text-sm text-white/80">
                {language === "ru"
                  ? "Настройте профиль и внешний вид под себя, войдя в систему."
                  : "Configure your profile and appearance after you sign in."}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  className="interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-[#0078d4]/90 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#106ebe]"
                  title={language === "ru" ? "Скоро" : "Coming soon"}
                >
                  <MicrosoftIcon />
                  <span>Microsoft</span>
                </button>
                {profile.ely_username ? (
                  <button
                    type="button"
                    onClick={handleElyLogout}
                    className="interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-black/40 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <ElyByIcon />
                    <span>{language === "ru" ? "Выйти из Ely.by" : "Log out of Ely.by"}</span>
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
                        ? language === "ru"
                          ? "Ожидание входа…"
                          : "Waiting for login…"
                        : "Ely.by"}
                    </span>
                  </button>
                )}
              </div>
              {elyAuthUrl && (
                <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left">
                  <p className="mb-1.5 text-xs font-medium text-amber-200">
                    {language === "ru"
                      ? "Если страница в браузере бесконечно грузится:"
                      : "If the page in your browser is loading forever:"}
                  </p>
                  <p className="break-all text-xs text-white/90">
                    {elyAuthUrl}
                  </p>
                  <p className="mt-1.5 text-[11px] text-white/60">
                    {language === "ru"
                      ? "Лучше открыть в новой вкладке того же браузера. В другом браузере Ely.by может показать «Invalid request»."
                      : "It is better to open it in a new tab of the same browser. In another browser Ely.by may show “Invalid request”."}
                  </p>
                </div>
              )}
            </div>
          ) : activeItem === "mods" ? (
            <div className="flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-auto py-4 items-start self-stretch">
              <ModsTab showNotification={showNotification} language={language} />
            </div>
          ) : activeItem === "modpacks" ? (
            <div className="flex w-full flex-1 flex-col gap-4 overflow-auto py-4 items-start self-stretch">
              <ModpackTab />
            </div>
          ) : activeItem === "settings" ? (
            <SettingsTab
              settings={settings}
              settingsTab={settingsTab}
              setSettingsTab={setSettingsTab}
              systemMemoryGb={systemMemoryGb}
              updateSettings={updateSettings}
              showNotification={showNotification}
              SettingsCard={SettingsCard}
              SettingsSlider={SettingsSlider}
              SettingsToggle={SettingsToggle}
              language={language}
              setLanguage={setLanguage}
            />
          ) : (
            <PlayTab
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
              setLoader={(l) => setLoader(l)}
              isLoaderDropdownOpen={isLoaderDropdownOpen}
              setIsLoaderDropdownOpen={setIsLoaderDropdownOpen}
              handleOpenGameFolder={handleOpenGameFolder}
              language={language}
            />
          )}
        </main>

      </div>
    </div>
  );
}

export default App;
