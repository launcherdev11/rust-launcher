import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

type Profile = {
  nickname: string;
  avatar_path: string | null;
  ely_username: string | null;
  ely_uuid: string | null;
};

type SidebarItemId = "play" | "settings" | "mods" | "modpacks" | "accounts";
type LoaderId = "vanilla" | "fabric" | "forge" | "quilt";

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

function versionDisplayName(v: VersionItem): string {
  if (isForgeVersion(v)) return `${v.mc_version} (Forge ${v.forge_build})`;
  return v.id;
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

function AccountsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 fill-current"
      aria-hidden="true"
    >
      <path d="M9 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.23 0-6 1.12-6 3.33V19h9v-2.67C20 14.12 16.23 13 17 13Zm-8 1c-2.67 0-8 1.34-8 4v2h10v-2c0-2.66-5.33-4-8-4Z" />
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

const loaderLabels: Record<LoaderId, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  quilt: "Quilt",
};

function App() {
  const [activeItem, setActiveItem] = useState<SidebarItemId>("play");
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

  const showNotification = useCallback((kind: NotificationKind, message: string) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4500);
  }, []);

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
          const result = await invoke<VersionSummary[]>("fetch_vanilla_releases");
          setVersions(result);
          setSelectedVersion(result.length > 0 ? result[0] : null);
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
  }, [loader]);

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

  // Сохраняем никнейм при уходе с вкладки «Аккаунты», чтобы не потерять ввод при переключении вкладки
  useEffect(() => {
    const prev = prevActiveItemRef.current;
    prevActiveItemRef.current = activeItem;
    if (prev === "accounts" && activeItem !== "accounts" && profile.nickname.trim()) {
      invoke("set_profile", { nickname: profile.nickname.trim(), avatar_path: profile.avatar_path }).catch(console.error);
    }
  }, [activeItem, profile.nickname, profile.avatar_path]);

  // Автосохранение никнейма с задержкой, чтобы отображался в игре и не пропадал при смене вкладки
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
    } catch (e) {
      console.error(e);
      showNotification("error", "Не удалось сохранить никнейм.");
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
      showNotification("error", "Не удалось загрузить аватар.");
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
    } catch (e) {
      console.error(e);
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
    return isInstalled ? "ИГРАТЬ" : "Установить";
  }, [isInstalled]);

  const handleOpenGameFolder = async () => {
    try {
      await invoke("open_game_folder");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Не удалось открыть папку игры:", error);
      showNotification("error", `Не удалось открыть папку: ${msg}`);
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
        showNotification("error", `Ошибка запуска: ${msg}`);
      }
      return;
    }

    setInstallPaused(false);
    setIsInstalling(true);
    setProgress(null);
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
        setIsInstalling(false);
        return;
      } else if (loader === "quilt" && !isForgeVersion(selectedVersion)) {
        const v = selectedVersion as VersionSummary;
        const profileId = await invoke<string>("install_quilt", {
          gameVersion: v.id,
        });
        setInstalledIds((prev) => new Set(prev).add(profileId));
        setQuiltProfileId(profileId);
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

      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.add(selectedVersion.id);
        return next;
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Ошибка установки версии:", error);
      showNotification("error", `Ошибка установки: ${msg}`);
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
            "pointer-events-auto flex max-w-xl items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium shadow-soft";
          let bgClasses = "";
          let iconSrc = "";

          if (n.kind === "info") {
            bgClasses = "bg-white/10 border border-white/25 text-white";
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
              className={`${baseClasses} ${bgClasses} animate-notification-slide`}
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
            className="flex h-7 w-7 items-center justify-center rounded-md bg-black/30 text-gray-300 hover:bg-black/50 hover:text-white"
            data-no-drag
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-black/30 text-gray-300 hover:bg-black/50 hover:text-white"
            data-no-drag
          >
            <MaximizeIcon />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-black/30 text-gray-300 hover:bg-black/50 hover:text-white"
            data-no-drag
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex h-[calc(100vh-2.25rem)]">
        <aside className="flex w-20 flex-col justify-between bg-black/40 px-3 py-6 backdrop-blur-lg">
          <div className="flex flex-col gap-3">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveItem(item.id)}
                className="group relative flex items-center"
              >
                {activeItem === item.id && (
                  <span className="absolute left-0 h-8 w-1 rounded-full bg-accentGreen" />
                )}
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
              className="group relative flex items-center justify-center w-full"
            >
              {activeItem === "accounts" && (
                <span className="absolute left-0 h-8 w-1 rounded-full bg-accentGreen" />
              )}
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

        <main className="flex flex-1 flex-col items-center justify-center px-6">
          {activeItem === "accounts" ? (
            <div className="flex w-full max-w-lg flex-col items-center gap-6">
              <div
                className="flex w-full items-center gap-6 rounded-2xl border border-white/10 bg-gradient-to-br from-[#1e3a5f]/95 to-[#0f2744]/95 px-6 py-5 shadow-xl backdrop-blur-sm"
                style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
              >
                <button
                  type="button"
                  onClick={handleChooseAvatar}
                  className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/90 bg-[#0f2744] text-white/90 transition hover:border-white hover:bg-[#1e3a5f]"
                  title="Выбрать аватар"
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
                      Вход: {profile.ely_username}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-center text-sm text-white/80">
                Настройте профиль и внешний вид под себя, войдя в систему.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-xl border border-white/20 bg-[#0078d4]/90 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#106ebe]"
                  title="Скоро"
                >
                  <MicrosoftIcon />
                  <span>Microsoft</span>
                </button>
                {profile.ely_username ? (
                  <button
                    type="button"
                    onClick={handleElyLogout}
                    className="flex items-center gap-2 rounded-xl border border-white/20 bg-black/40 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <ElyByIcon />
                    <span>Выйти из Ely.by</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleElyLogin}
                    disabled={elyLoading}
                    className="flex items-center gap-2 rounded-xl bg-[#2d7d46] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60"
                  >
                    <ElyByIcon />
                    <span>{elyLoading ? "Ожидание входа…" : "Ely.by"}</span>
                  </button>
                )}
              </div>
              {elyAuthUrl && (
                <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left">
                  <p className="mb-1.5 text-xs font-medium text-amber-200">
                    Если страница в браузере бесконечно грузится:
                  </p>
                  <p className="break-all text-xs text-white/90">
                    {elyAuthUrl}
                  </p>
                  <p className="mt-1.5 text-[11px] text-white/60">
                    Лучше открыть в новой вкладке того же браузера. В другом браузере Ely.by может показать «Invalid request».
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="glass-panel flex h-[260px] w-full max-w-1xl items-center justify-center">
                <span className="text-sm font-medium tracking-wide text-white/70">
                  Новости лаунчера и баннер игры
                </span>
              </div>

      <div className="pointer-events-none relative mt-auto mb-10 flex w-full max-w-[95vw] justify-center px-2">
      <div className="pointer-events-auto relative w-full max-w-2xl">
              <div className="glass-chip flex flex-wrap items-center justify-center gap-4 px-6 py-4 sm:gap-6 sm:px-8">
                <div className="relative flex flex-col text-left">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-gray-400">
                    Версия
                  </span>
                  <button
                    type="button"
                    disabled={versions.length === 0 || versionsLoading}
                    onClick={() =>
                      setIsVersionDropdownOpen((current) => !current)
                    }
                    className="mt-1 inline-flex max-w-[200px] items-center gap-2 truncate text-left text-sm font-semibold text-white/90 disabled:cursor-not-allowed disabled:text-white/40 sm:max-w-[240px]"
                  >
                    <span className="min-w-0 truncate">
                      {selectedVersion
                        ? versionDisplayName(selectedVersion)
                        : versionsLoading
                          ? "Загрузка..."
                          : "Выберите версию"}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">▾</span>
                  </button>

                  {isVersionDropdownOpen && versions.length > 0 && (
                    <div className="absolute left-0 bottom-full mb-2 z-30 max-h-[min(70vh,320px)] w-56 overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                      {versions.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setSelectedVersion(v);
                            setIsVersionDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                            selectedVersion && selectedVersion.id === v.id
                              ? "bg-white/90 text-black"
                              : "text-white/80 hover:bg-white/10"
                          }`}
                        >
                          <span>{versionDisplayName(v)}</span>
                          {!isForgeVersion(v) && (
                            <span className="ml-2 text-[10px] uppercase text-gray-400">
                              {(v as VersionSummary).version_type}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col items-center justify-center gap-3">
                  {isInstalling || installPaused ? (
                    <>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={installPaused ? handleResumeInstall : handlePauseInstall}
                          className="rounded-xl bg-accentBlue px-6 py-2 text-sm font-semibold text-white shadow-soft hover:bg-sky-500"
                        >
                          {installPaused ? "Продолжить" : "Пауза"}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelInstall}
                          className="rounded-xl bg-red-600 px-6 py-2 text-sm font-semibold text-white shadow-soft hover:bg-red-500"
                        >
                          Отменить
                        </button>
                      </div>
                      <div className="mt-1 w-full max-w-md">
                        <div className="h-3 w-full overflow-hidden rounded-full bg-black/40">
                          <div
                            className="h-full rounded-full bg-accentGreen transition-[width] duration-200"
                            style={{ width: `${Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)))}%` }}
                          />
                        </div>
                        <div className="mt-1 text-center text-xs text-white/70">
                          {progress && progress.total > 0
                            ? `${Math.round(progress.percent)}%`
                            : "Подготовка файлов..."}
                        </div>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePrimaryClick}
                      className={`rounded-full px-12 py-3 text-sm font-semibold tracking-wide text-white shadow-soft transition-colors sm:px-16 ${primaryColorClasses}`}
                    >
                      {primaryLabel}
                    </button>
                  )}
                </div>

                <div className="relative flex flex-col items-end text-right">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-gray-400">
                    Загрузчик
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setIsLoaderDropdownOpen((current) => !current)
                      }
                      className="inline-flex items-center gap-2 rounded-full bg-white/6 px-3 py-1 text-xs font-semibold text-white/90 hover:bg-white/15"
                    >
                      {loaderLabels[loader]}
                      <span className="text-[10px] text-gray-400">▾</span>
                    </button>
                  </div>

                  {isLoaderDropdownOpen && (
                    <div className="absolute right-0 bottom-full mb-2 z-30 max-h-[min(50vh,240px)] overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                      {(["vanilla", "fabric", "forge", "quilt"] as LoaderId[]).map((id) => {
                        const isActive = loader === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setLoader(id);
                              setIsLoaderDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                              isActive
                                ? "bg-white/90 text-black"
                                : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            <span>{loaderLabels[id]}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenGameFolder}
                title="Открыть папку игры"
                className="pointer-events-auto absolute -right-14 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-gray-200 shadow-soft hover:border-white/40 hover:bg-black/80 hover:text-white"
              >
                <img
                  src="/launcher-assets/folder.png"
                  alt="Папка игры"
                  className="h-6 w-6 object-contain"
                />
              </button>
            </div>
              </div>
          </>
          )}
        </main>

      </div>
    </div>
  );
}

export default App;
