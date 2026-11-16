import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { reportStats } from "../api/stats";
import { confirmLaunchPreflight } from "../features/launch-preflight/preflight";
import { launchErrorMessage } from "../lib/launchErrors";
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

export type ProfileJoinTarget = {
  serverAddress?: string | null;
  worldName?: string | null;
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
  const [profileLaunchRequestTick, setProfileLaunchRequestTick] = useState(0);
  const handlePlayPinnedProfileRef = useRef<
    (profile: InstanceProfileCard, join?: ProfileJoinTarget) => Promise<void>
  >(async () => {});

  const installedLoaderVersionId = async (gameVersion: string, loaderId: "forge" | "neoforge") => {
    const prefix = `${gameVersion}-${loaderId}-`;
    const installed = await invoke<string[]>("list_installed_versions");
    return (
      installed
        .filter((id) => id.startsWith(prefix))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? null
    );
  };

  const resolveProfileVersionId = async (
    target: Pick<InstanceProfileSummary, "game_version" | "loader" | "loader_version">,
  ): Promise<string> => {
    const gameVersion = target.game_version;
    const loaderVersion = target.loader_version?.trim() || null;
    if (target.loader === "fabric" || target.loader === "quilt") {
      const command =
        target.loader === "fabric" ? "get_installed_fabric_profile_id" : "get_installed_quilt_profile_id";
      const id =
        (await invoke<string | null>(command, { gameVersion, loaderVersion })) ??
        (loaderVersion ? await invoke<string | null>(command, { gameVersion, loaderVersion: null }) : null);
      if (!id) {
        throw new Error(
          tt(target.loader === "fabric" ? "app.pinnedProfiles.fabricNotInstalled" : "app.pinnedProfiles.quiltNotInstalled"),
        );
      }
      return id;
    }
    if (target.loader === "forge" || target.loader === "neoforge") {
      if (loaderVersion) return `${gameVersion}-${target.loader}-${loaderVersion}`;
      const id = await installedLoaderVersionId(gameVersion, target.loader);
      if (!id) {
        throw new Error(
          tt(target.loader === "forge" ? "app.pinnedProfiles.forgeNotInstalled" : "app.pinnedProfiles.neoforgeNotInstalled"),
        );
      }
      return id;
    }
    return gameVersion;
  };

  const passLaunchPreflight = async (
    target: Pick<InstanceProfileSummary, "id" | "loader" | "game_version"> | null,
    versionId: string,
  ): Promise<boolean> => {
    if (settings?.launch_preflight === false) return true;
    setIsLaunching(true);
    try {
      return await confirmLaunchPreflight(
        {
          profileId: target?.id ?? null,
          loader: target?.loader,
          gameVersion: target?.game_version,
          versionId,
        },
        tt,
      );
    } finally {
      setIsLaunching(false);
    }
  };

  const handlePlayPinnedProfile = async (profile: InstanceProfileCard, join?: ProfileJoinTarget) => {
    try {
      await invoke("set_selected_profile", { id: profile.id });
      setActiveInstanceProfile({
        id: profile.id,
        name: profile.name,
        game_version: profile.game_version,
        loader: profile.loader,
        loader_version: profile.loader_version ?? null,
      });
      const launchVersionId = await resolveProfileVersionId(profile);
      if (!(await passLaunchPreflight(profile, launchVersionId))) return;
      const consoleProfileId = profile.id;
      setRunningConsoleProfile(consoleProfileId);
      archiveCurrentConsoleAndClear(consoleProfileId);
      if (settings?.show_console_on_launch) {
        setIsConsoleVisible(true);
      }
      setIsLaunching(true);
      try {
        const serverAddress = join?.serverAddress?.trim() || null;
        await invoke("launch_game", {
          versionId: launchVersionId,
          versionUrl: null,
          serverAddress,
          worldName: serverAddress ? null : join?.worldName?.trim() || null,
        });
        lastRunningRef.current = true;
        gameLaunchStartedAtRef.current = Date.now();
        setLaunchPresenceContext(
          serverAddress
            ? { kind: "server", serverAddress, startedAt: new Date().toISOString() }
            : { kind: "modpack", startedAt: new Date().toISOString() },
        );
        setGameStatus("running");
        void reportStats({ launched: true }).catch(() => {});
      } finally {
        setIsLaunching(false);
      }
    } catch (error) {
      setRunningConsoleProfile(null);
      const msg = launchErrorMessage(error, tt);
      showNotification("error", tt("app.errors.launchError", { msg }), {
        action: {
          label: tt("app.launchActions.retry"),
          onClick: () => void handlePlayPinnedProfileRef.current(profile, join),
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
    let cancelled = false;
    void (async () => {
      try {
        const session = await invoke<{
          profile_id: string | null;
          started_at_ms: number;
        } | null>("get_running_game_session");
        if (cancelled || !session || lastRunningRef.current) return;
        lastRunningRef.current = true;
        gameLaunchStartedAtRef.current = session.started_at_ms;
        if (session.profile_id) setRunningConsoleProfile(session.profile_id);
        setLaunchPresenceContext({
          kind: "modpack",
          startedAt: new Date(session.started_at_ms).toISOString(),
        });
        setGameStatus("running");
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const pending = await invoke<string | null>("take_pending_profile_launch");
        if (pending?.trim()) {
          pendingProfileLaunchIdRef.current = pending.trim();
          setProfileLaunchRequestTick((n) => n + 1);
        }
      } catch {
      }
      try {
        unlisten = await listen<{ profile_id: string }>("profile-launch-request", (event) => {
          const id = event.payload.profile_id?.trim();
          if (!id) return;
          pendingProfileLaunchIdRef.current = id;
          setProfileLaunchRequestTick((n) => n + 1);
        });
      } catch {
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
  }, [profilesHydrated, knownProfiles, profileLaunchRequestTick]);

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
        const versionId = activeInstanceProfile
          ? await resolveProfileVersionId(activeInstanceProfile)
          : loader === "fabric" && fabricProfileId
            ? fabricProfileId
            : loader === "quilt" && quiltProfileId
              ? quiltProfileId
              : selectedVersion.id;
        const versionUrl =
          vanillaSummary &&
          vanillaSummary.id === versionId &&
          vanillaSummary.version_type !== "custom" &&
          vanillaSummary.url
            ? vanillaSummary.url
            : undefined;
        if (!(await passLaunchPreflight(activeInstanceProfile, versionId))) return;
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
        const msg = launchErrorMessage(error, tt);
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
        throw launchErrorMessage(error, tt);
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

  const primaryColorClasses =
    isLaunching
      ? "accent-bg opacity-60 cursor-not-allowed"
      : gameStatus === "running" || isStopping
        ? "bg-danger-strong hover:bg-danger"
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
    primaryColorClasses,
    primaryLabel,
  };
}
