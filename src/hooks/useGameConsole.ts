import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isGameConsoleLineImportant,
  isVersionInstallConsoleLine,
  resetGameConsoleFilter,
} from "../lib/gameConsoleFilter";
import { INSTALL_CONSOLE_PROFILE_ID } from "../lib/gameConsoleWindow";
import {
  GAME_CONSOLE_BATCH_FLUSH_MS,
  GAME_CONSOLE_PERSIST_DEBOUNCE_MS,
  GAME_CONSOLE_STORAGE_KEY,
  GAME_CONSOLE_STORAGE_KEY_V1,
  HIDDEN_CONSOLE_BUFFER_MAX,
  MAX_ARCHIVED_SESSIONS,
  MAX_CONSOLE_LINES,
  loadPersistedGameConsoleByProfile,
} from "../app/gameConsoleStorage";
import type {
  GameConsoleLine,
  GameConsoleLinePayload,
  GameConsoleSession,
  GameStatus,
  InstanceProfileSummary,
  ProfileConsoleData,
} from "../app/types";

type UseGameConsoleOptions = {
  activeInstanceProfileId: string | null;
  gameStatus: GameStatus;
  isLaunching: boolean;
};

export function useGameConsole({
  activeInstanceProfileId,
  gameStatus,
  isLaunching,
}: UseGameConsoleOptions) {
  const initialPersistedConsoleByProfile = useMemo(
    () => loadPersistedGameConsoleByProfile(),
    [],
  );
  const [consoleByProfile, setConsoleByProfile] = useState<
    Record<string, ProfileConsoleData>
  >(initialPersistedConsoleByProfile);
  const pendingConsoleLinesRef = useRef<Record<string, GameConsoleLine[]>>({});
  const hiddenConsoleBufferRef = useRef<Record<string, GameConsoleLine[]>>({});
  const consoleFlushTimerRef = useRef<number | null>(null);
  const nextConsoleLineIdRef = useRef(Date.now());
  const lastConsoleLineTextRef = useRef("");
  const manageConsoleExpandedRef = useRef(false);
  const isConsoleDetachedRef = useRef(false);
  const consoleUiActiveRef = useRef(false);
  const gameStatusRef = useRef<GameStatus>("idle");
  const isLaunchingRef = useRef(false);
  const runningConsoleProfileIdRef = useRef<string | null>(null);
  const [runningConsoleProfileId, setRunningConsoleProfileId] = useState<string | null>(null);
  const setRunningConsoleProfile = useCallback((profileId: string | null) => {
    runningConsoleProfileIdRef.current = profileId;
    setRunningConsoleProfileId(profileId);
  }, []);
  const [isConsoleVisible, setIsConsoleVisible] = useState(false);
  gameStatusRef.current = gameStatus;
  isLaunchingRef.current = isLaunching;

  const consoleProfileId =
    activeInstanceProfileId ?? runningConsoleProfileId ?? null;

  const consoleLines = useMemo(() => {
    if (!consoleProfileId) return [];
    return consoleByProfile[consoleProfileId]?.lines ?? [];
  }, [consoleProfileId, consoleByProfile]);

  const installConsoleLines = useMemo(
    () => consoleByProfile[INSTALL_CONSOLE_PROFILE_ID]?.lines ?? [],
    [consoleByProfile],
  );

  const playConsoleLines = useMemo(() => {
    if (!consoleProfileId) return installConsoleLines;
    return consoleLines;
  }, [consoleProfileId, consoleLines, installConsoleLines]);

  const consoleHistorySessions = useMemo(() => {
    if (!consoleProfileId) return [];
    return consoleByProfile[consoleProfileId]?.sessions ?? [];
  }, [consoleProfileId, consoleByProfile]);

  const archiveCurrentConsoleAndClear = useCallback((profileId: string) => {
    resetGameConsoleFilter();
    pendingConsoleLinesRef.current[profileId] = [];
    delete hiddenConsoleBufferRef.current[profileId];
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

  const flushPendingConsoleLines = useCallback(() => {
    if (consoleFlushTimerRef.current !== null) {
      window.clearTimeout(consoleFlushTimerRef.current);
      consoleFlushTimerRef.current = null;
    }

    const pendingEntries = Object.entries(pendingConsoleLinesRef.current).filter(
      ([, lines]) => lines.length > 0,
    );
    if (pendingEntries.length === 0) return;

    pendingConsoleLinesRef.current = {};
    setConsoleByProfile((prev) => {
      const next = { ...prev };
      for (const [profileId, queuedLines] of pendingEntries) {
        const current = next[profileId] ?? { lines: [], sessions: [] };
        const mergedLines =
          current.lines.length > 0 ? [...current.lines, ...queuedLines] : queuedLines.slice();
        next[profileId] = {
          ...current,
          lines:
            mergedLines.length > MAX_CONSOLE_LINES
              ? mergedLines.slice(mergedLines.length - MAX_CONSOLE_LINES)
              : mergedLines,
        };
      }
      return next;
    });
  }, []);

  const scheduleConsoleFlush = useCallback(() => {
    if (consoleFlushTimerRef.current !== null) return;
    consoleFlushTimerRef.current = window.setTimeout(() => {
      flushPendingConsoleLines();
    }, GAME_CONSOLE_BATCH_FLUSH_MS);
  }, [flushPendingConsoleLines]);

  const restoreHiddenConsoleBuffer = useCallback(
    (profileId: string) => {
      const buffered = hiddenConsoleBufferRef.current[profileId];
      if (!buffered || buffered.length === 0) return;
      delete hiddenConsoleBufferRef.current[profileId];
      pendingConsoleLinesRef.current[profileId] = [
        ...(pendingConsoleLinesRef.current[profileId] ?? []),
        ...buffered,
      ];
      flushPendingConsoleLines();
    },
    [flushPendingConsoleLines],
  );

  const handleManageConsoleExpandedChange = useCallback(
    (expanded: boolean) => {
      manageConsoleExpandedRef.current = expanded;
      if (!expanded) return;
      const profileId =
        activeInstanceProfileId ?? runningConsoleProfileIdRef.current ?? null;
      if (profileId) restoreHiddenConsoleBuffer(profileId);
    },
    [activeInstanceProfileId, restoreHiddenConsoleBuffer],
  );

  const appendConsoleLine = useCallback(
    (profileId: string, text: string, source: "stdout" | "stderr") => {
      if (!isGameConsoleLineImportant(text, source)) return;
      lastConsoleLineTextRef.current = text;
      const queued = pendingConsoleLinesRef.current[profileId] ?? [];
      queued.push({
        id: nextConsoleLineIdRef.current++,
        line: text,
        source,
      });
      pendingConsoleLinesRef.current[profileId] = queued;
      scheduleConsoleFlush();
    },
    [scheduleConsoleFlush],
  );

  const prepareInstallConsole = useCallback(
    (profileId?: string | null) => {
      resetGameConsoleFilter();
      const targetId = profileId ?? activeInstanceProfileId ?? INSTALL_CONSOLE_PROFILE_ID;
      pendingConsoleLinesRef.current[targetId] = [];
      delete hiddenConsoleBufferRef.current[targetId];
      setConsoleByProfile((prev) => ({
        ...prev,
        [targetId]: {
          lines: [],
          sessions: prev[targetId]?.sessions ?? [],
        },
      }));
      return targetId;
    },
    [activeInstanceProfileId],
  );

  const resolveLaunchConsoleProfileId = useCallback(async (): Promise<string | null> => {
    if (activeInstanceProfileId) return activeInstanceProfileId;
    try {
      const selected = await invoke<InstanceProfileSummary | null>("get_selected_profile");
      return selected?.id ?? null;
    } catch {
      return null;
    }
  }, [activeInstanceProfileId]);

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
          lastConsoleLineTextRef.current = text;
          const source: "stdout" | "stderr" =
            typeof payload === "string"
              ? "stdout"
              : payload.source === "stderr"
                ? "stderr"
                : "stdout";
          if (!isGameConsoleLineImportant(text, source)) return;
          const runningId = runningConsoleProfileIdRef.current;
          let profileId: string | null = runningId;
          if (!profileId) {
            if (isVersionInstallConsoleLine(text)) {
              profileId = activeInstanceProfileId ?? INSTALL_CONSOLE_PROFILE_ID;
            } else {
              profileId = activeInstanceProfileId ?? null;
            }
          }
          if (!profileId) return;

          const capturePaused =
            gameStatusRef.current === "running" &&
            !isLaunchingRef.current &&
            !consoleUiActiveRef.current;
          if (capturePaused) {
            const buffered = hiddenConsoleBufferRef.current[profileId] ?? [];
            buffered.push({
              id: nextConsoleLineIdRef.current++,
              line: text,
              source,
            });
            if (buffered.length > HIDDEN_CONSOLE_BUFFER_MAX) {
              buffered.splice(0, buffered.length - HIDDEN_CONSOLE_BUFFER_MAX);
            }
            hiddenConsoleBufferRef.current[profileId] = buffered;
            return;
          }

          appendConsoleLine(profileId, text, source);
        });
      } catch (e) {
        console.error("Не удалось подписаться на консоль игры:", e);
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [activeInstanceProfileId, appendConsoleLine]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isLaunching || gameStatus === "running") return;
    const t = window.setTimeout(() => {
      flushPendingConsoleLines();
      const writeConsole = (byProfile: Record<string, ProfileConsoleData>) => {
        window.localStorage.setItem(
          GAME_CONSOLE_STORAGE_KEY,
          JSON.stringify({ byProfile }),
        );
      };
      try {
        writeConsole(consoleByProfile);
      } catch {
        try {
          const pruned: Record<string, ProfileConsoleData> = {};
          for (const [profileId, data] of Object.entries(consoleByProfile)) {
            pruned[profileId] = {
              lines: data.lines.slice(-200),
              sessions: data.sessions.slice(0, 3).map((s) => ({
                ...s,
                lines: s.lines.slice(-100),
              })),
            };
          }
          writeConsole(pruned);
        } catch {
          try {
            window.localStorage.removeItem(GAME_CONSOLE_STORAGE_KEY);
            window.localStorage.removeItem(GAME_CONSOLE_STORAGE_KEY_V1);
          } catch {
          }
        }
      }
    }, GAME_CONSOLE_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [consoleByProfile, flushPendingConsoleLines, gameStatus, isLaunching]);

  useEffect(() => {
    return () => {
      flushPendingConsoleLines();
    };
  }, [flushPendingConsoleLines]);

  const handleToggleConsole = () => {
    setIsConsoleVisible((prev) => !prev);
  };

  const handleClearConsole = () => {
    resetGameConsoleFilter();
    const profileId =
      activeInstanceProfileId ?? runningConsoleProfileId ?? INSTALL_CONSOLE_PROFILE_ID;
    pendingConsoleLinesRef.current[profileId] = [];
    delete hiddenConsoleBufferRef.current[profileId];
    setConsoleByProfile((prev) => ({
      ...prev,
      [profileId]: {
        lines: [],
        sessions: prev[profileId]?.sessions ?? [],
      },
    }));
  };

  return {
    runningConsoleProfileId,
    runningConsoleProfileIdRef,
    setRunningConsoleProfile,
    isConsoleVisible,
    setIsConsoleVisible,
    consoleLines,
    installConsoleLines,
    playConsoleLines,
    consoleHistorySessions,
    lastConsoleLineTextRef,
    manageConsoleExpandedRef,
    isConsoleDetachedRef,
    consoleUiActiveRef,
    archiveCurrentConsoleAndClear,
    flushPendingConsoleLines,
    restoreHiddenConsoleBuffer,
    handleManageConsoleExpandedChange,
    prepareInstallConsole,
    resolveLaunchConsoleProfileId,
    handleToggleConsole,
    handleClearConsole,
  };
}
