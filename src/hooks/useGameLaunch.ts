import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { reportStats } from "../api/stats";
import type { LaunchPresenceContext } from "../lib/socialActivity";
import type { NotificationKind, ShowNotificationOptions } from "../app/notifications";
import { isForgeVersion, isNeoForgeVersion } from "../app/versions";
import type {
  InstanceProfileCard,
  InstanceProfileSummary,
  LoaderId,
  Profile,
  Settings,
  Tt,
  VersionItem,
  VersionSummary,
} from "../app/types";
import type { GameRunState } from "./useGameRunState";

type GameConsoleApi = {
  setRunningConsoleProfile: (profileId: string | null) => void;
  runningConsoleProfileIdRef: MutableRefObject<string | null>;
  archiveCurrentConsoleAndClear: (profileId: string) => void;
  restoreHiddenConsoleBuffer: (profileId: string) => void;
  flushPendingConsoleLines: () => void;
  resolveLaunchConsoleProfileId: () => Promise<string | null>;
  lastConsoleLineTextRef: MutableRefObject<string>;
  setIsConsoleVisible: Dispatch<SetStateAction<boolean>>;
};

type VersionStateApi = {
  selectedVersion: VersionItem | null;
  loader: LoaderId;
  fabricProfileId: string | null;
  quiltProfileId: string | null;
  isInstalled: boolean;
  isInstalling: boolean;
  runVersionInstall: (options?: { resume?: boolean }) => Promise<void>;
};

type UseGameLaunchOptions = {
  settings: Settings | null;
  profile: Profile;
  activeAccountKind: string;
  activeInstanceProfile: InstanceProfileSummary | null;
  setActiveInstanceProfile: Dispatch<SetStateAction<InstanceProfileSummary | null>>;
  knownProfiles: InstanceProfileCard[];
  profilesHydrated: boolean;
  run: GameRunState;
  gameConsole: GameConsoleApi;
  versionState: VersionStateApi;
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  tt: Tt;
};

export function useGameLaunch({
  settings,
  profile,
  activeAccountKind,
  activeInstanceProfile,
  setActiveInstanceProfile,
  knownProfiles,
  profilesHydrated,
  run,
  gameConsole,
  versionState,
  showNotification,
  tt,
}: UseGameLaunchOptions) {
  const {
    gameStatus,
    setGameStatus,
    isLaunching,
    setIsLaunching,
    isStopping,
    setIsStopping,
    lastRunningRef,
    gameLaunchStartedAtRef,
    setLaunchPresenceContext,
  } = run;
  const {
    setRunningConsoleProfile,
    runningConsoleProfileIdRef,
    archiveCurrentConsoleAndClear,
    restoreHiddenConsoleBuffer,
    flushPendingConsoleLines,
    resolveLaunchConsoleProfileId,
    lastConsoleLineTextRef,
    setIsConsoleVisible,
  } = gameConsole;
  const {
    selectedVersion,
    loader,
    fabricProfileId,
    quiltProfileId,
    isInstalled,
    isInstalling,
    runVersionInstall,
  } = versionState;

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
      setRunningConsoleProfile(consoleProfileId);
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
        gameLaunchStartedAtRef.current = Date.now();
        setLaunchPresenceContext({
          kind: "modpack",
          startedAt: new Date().toISOString(),
        });
        setGameStatus("running");
        void reportStats({ launched: true }).catch(() => {});
      } finally {
        setIsLaunching(false);
      }
    } catch (error) {
      setRunningConsoleProfile(null);
      const msg = error instanceof Error ? error.message : String(error);
      showNotification("error", tt("app.errors.launchError", { msg }), {
        action: {
          label: tt("app.launchActions.retry"),
          onClick: () => void handlePlayPinnedProfileRef.current(profile),
        },
      });
    }
  };

  handlePlayPinnedProfileRef.current = handlePlayPinnedProfile;

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<{ exit_code?: number | null }>("game-process-exited", (event) => {
      if (!lastRunningRef.current) return;
      const profileId =
        runningConsoleProfileIdRef.current ?? activeInstanceProfile?.id ?? null;
      if (profileId) restoreHiddenConsoleBuffer(profileId);
      lastRunningRef.current = false;
      flushPendingConsoleLines();
      setRunningConsoleProfile(null);
      const exitCode = event.payload.exit_code;
      const elapsedMs =
        gameLaunchStartedAtRef.current != null
          ? Date.now() - gameLaunchStartedAtRef.current
          : null;
      gameLaunchStartedAtRef.current = null;
      setLaunchPresenceContext(null);
      if (exitCode != null && exitCode !== 0) {
        showNotification(
          "error",
          tt("app.toast.gameExitedEarly", { code: exitCode }),
        );
      } else if (elapsedMs != null && elapsedMs < 5000) {
        showNotification(
          "warning",
          tt("app.toast.gameExitedEarly", { code: exitCode ?? 0 }),
        );
      }
      setGameStatus((prev) => {
        if (prev !== "running") return prev;
        const lastLine = lastConsoleLineTextRef.current;
        const lower = lastLine.toLowerCase();
        const looksCrash =
          lower.includes("exception") ||
          lower.includes("fatal") ||
          lower.includes("crash") ||
          lower.includes("ошибка");
        return looksCrash ? "crashed" : "stopped";
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [activeInstanceProfile?.id, flushPendingConsoleLines, restoreHiddenConsoleBuffer, showNotification, tt]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const pending = await invoke<string | null>("take_pending_profile_launch");
        if (pending?.trim()) {
          pendingProfileLaunchIdRef.current = pending.trim();
        }
      } catch {
        //ignore
      }
      try {
        unlisten = await listen<{ profile_id: string }>("profile-launch-request", (event) => {
          const id = event.payload.profile_id?.trim();
          if (id) pendingProfileLaunchIdRef.current = id;
        });
      } catch {
        //ignore
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const profileId = pendingProfileLaunchIdRef.current;
    if (!profileId || !profilesHydrated) return;
    const profile = knownProfiles.find((p) => p.id === profileId);
    if (!profile) return;
    pendingProfileLaunchIdRef.current = null;
    void handlePlayPinnedProfileRef.current(profile);
  }, [profilesHydrated, knownProfiles]);

  const handleOpenGameFolder = async (subdir?: "mods" | "logs") => {
    try {
      await invoke("open_game_folder", {
        profileId: activeInstanceProfile?.id ?? null,
        subdir: subdir ?? null,
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

  const handleStopGame = async () => {
    if (isStopping || gameStatus !== "running") return;
    setIsStopping(true);
    try {
      await invoke("stop_game");
      lastRunningRef.current = false;
      setLaunchPresenceContext(null);
      setGameStatus("stopped");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Ошибка остановки игры:", error);
      showNotification("error", tt("app.errors.stopError", { msg }));
    } finally {
      setIsStopping(false);
    }
  };

  const handleTitleBarProfilePlay = () => {
    if (!activeInstanceProfile) {
      showNotification("warning", tt("app.warnings.selectProfileFirst"));
      return;
    }
    void handlePrimaryClick();
  };

  const handlePrimaryClick = async () => {
    if (!selectedVersion || isInstalling || isLaunching || isStopping) return;

    if (isInstalled) {
      if (gameStatus === "running") {
        await handleStopGame();
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
          setRunningConsoleProfile(consoleProfileId);
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
          gameLaunchStartedAtRef.current = Date.now();
          setLaunchPresenceContext({
            kind: "modpack",
            startedAt: new Date().toISOString(),
          });
          setGameStatus("running");
          void reportStats({ launched: true }).catch(() => {});
        } finally {
          setIsLaunching(false);
        }
      } catch (error) {
        setRunningConsoleProfile(null);
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Ошибка запуска игры:", error);
        showNotification("error", tt("app.errors.launchError", { msg }), {
          action: {
            label: tt("app.launchActions.retry"),
            onClick: () => void handlePrimaryClick(),
          },
        });
      }
      return;
    }

    await runVersionInstall();
  };

  const handleLaunchToServer = useCallback(
    async (
      serverAddress: string,
      options?: {
        requireOnlineAccount?: boolean;
        presenceContext?: LaunchPresenceContext | null;
      },
    ) => {
      if (!selectedVersion) {
        throw new Error(tt("app.warnings.needMinecraftVersion"));
      }
      if (!isInstalled) {
        throw new Error(tt("app.warnings.needInstalledVersion"));
      }
      if (gameStatus === "running" || isLaunching) {
        throw new Error(tt("app.warnings.closeGameFirst"));
      }
      if (options?.requireOnlineAccount && activeAccountKind === "offline") {
        throw new Error(
          "Войти в мир друга нельзя в офлайн-режиме. Войдите через Microsoft или Ely на вкладке Аккаунты.",
        );
      }

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
          : null;
      const versionId =
        loader === "fabric" && fabricProfileId
          ? fabricProfileId
          : loader === "quilt" && quiltProfileId
            ? quiltProfileId
            : selectedVersion.id;

      const consoleProfileId = await resolveLaunchConsoleProfileId();
      if (consoleProfileId) {
        setRunningConsoleProfile(consoleProfileId);
        archiveCurrentConsoleAndClear(consoleProfileId);
      }
      if (settings?.show_console_on_launch) {
        setIsConsoleVisible(true);
      }

      setIsLaunching(true);
      try {
        console.info("[LaunchToServer]", {
          versionId,
          versionUrl,
          serverAddress,
          activeAccountKind,
        });
        await invoke("launch_game", {
          versionId,
          versionUrl,
          serverAddress,
        });
        lastRunningRef.current = true;
        gameLaunchStartedAtRef.current = Date.now();
        setLaunchPresenceContext(
          options?.presenceContext ?? {
            kind: "server",
            serverAddress,
            startedAt: new Date().toISOString(),
          },
        );
        setGameStatus("running");
        void reportStats({ launched: true }).catch(() => {});
      } catch (error) {
        setRunningConsoleProfile(null);
        throw error;
      } finally {
        setIsLaunching(false);
      }
    },
    [
      selectedVersion,
      isInstalled,
      gameStatus,
      isLaunching,
      activeAccountKind,
      profile.nickname,
      loader,
      fabricProfileId,
      quiltProfileId,
      resolveLaunchConsoleProfileId,
      archiveCurrentConsoleAndClear,
      settings?.show_console_on_launch,
      tt,
    ],
  );

  const handleBannerPlay = useCallback(
    async (serverAddress: string) => {
      try {
        await handleLaunchToServer(serverAddress);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        showNotification("error", tt("app.errors.launchError", { msg }));
      }
    },
    [handleLaunchToServer, showNotification, tt],
  );

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

  return {
    handlePlayPinnedProfile,
    handleOpenGameFolder,
    handleStopGame,
    handleTitleBarProfilePlay,
    handlePrimaryClick,
    handleLaunchToServer,
    handleBannerPlay,
    primaryColorClasses,
    primaryLabel,
  };
}
