import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeGameConsoleWindow,
  emitGameConsoleSync,
  formatGameConsoleWindowTitle,
  getGameConsoleWebview,
  listenGameConsoleAction,
  listenGameConsoleRequestSync,
  openGameConsoleWindow,
  type GameConsoleLine,
  type GameStatus,
} from "../lib/gameConsoleWindow";

type Language = "ru" | "en";

type UseGameConsoleWindowOptions = {
  enabled: boolean;
  profileName: string | null;
  language: Language;
  consoleLines: GameConsoleLine[];
  isConsoleVisible: boolean;
  gameStatus: GameStatus;
  onClearConsole: () => void;
  onToggleConsole: () => void;
};

export function useGameConsoleWindow({
  enabled,
  profileName,
  language,
  consoleLines,
  isConsoleVisible,
  gameStatus,
  onClearConsole,
  onToggleConsole,
}: UseGameConsoleWindowOptions) {
  const [isConsoleDetached, setIsConsoleDetached] = useState(false);
  const isConsoleDetachedRef = useRef(isConsoleDetached);
  isConsoleDetachedRef.current = isConsoleDetached;

  const syncPayload = useCallback(
    () => ({
      lines: consoleLines,
      isVisible: isConsoleVisible,
      gameStatus,
      profileName,
      language,
    }),
    [
      consoleLines,
      gameStatus,
      isConsoleVisible,
      language,
      profileName,
    ],
  );

  const pushSync = useCallback(async () => {
    if (!isConsoleDetachedRef.current) return;
    await emitGameConsoleSync(syncPayload());
  }, [syncPayload]);

  useEffect(() => {
    if (!isConsoleDetached) return;
    void pushSync();
  }, [isConsoleDetached, pushSync]);

  useEffect(() => {
    if (!enabled || !isConsoleDetached) return;

    let cancelled = false;
    let unlistenAction: (() => void) | undefined;
    let unlistenRequest: (() => void) | undefined;
    let unlistenDestroyed: (() => void) | undefined;

    void (async () => {
      try {
        unlistenAction = await listenGameConsoleAction((action) => {
          if (cancelled) return;
          switch (action.type) {
            case "clear":
              onClearConsole();
              break;
            case "toggle-visible":
              onToggleConsole();
              break;
            case "attach":
              void closeGameConsoleWindow().finally(() => {
                if (!cancelled) setIsConsoleDetached(false);
              });
              break;
          }
        });

        unlistenRequest = await listenGameConsoleRequestSync(() => {
          if (!cancelled) void pushSync();
        });

        const win = await getGameConsoleWebview();
        if (win && !cancelled) {
          unlistenDestroyed = await win.listen("tauri://destroyed", () => {
            if (!cancelled) setIsConsoleDetached(false);
          });
        }
      } catch {
      }
    })();

    return () => {
      cancelled = true;
      unlistenAction?.();
      unlistenRequest?.();
      unlistenDestroyed?.();
    };
  }, [
    enabled,
    isConsoleDetached,
    onClearConsole,
    onToggleConsole,
    pushSync,
  ]);

  useEffect(() => {
    if (!isConsoleDetached) return;

    void (async () => {
      try {
        const win = await getGameConsoleWebview();
        if (!win) return;
        await win.setTitle(
          formatGameConsoleWindowTitle(profileName, language),
        );
      } catch {
        // ignore
      }
    })();
  }, [isConsoleDetached, language, profileName]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      void closeGameConsoleWindow();
    };
  }, [enabled]);

  const toggleConsoleDetached = useCallback(async () => {
    if (isConsoleDetachedRef.current) {
      await closeGameConsoleWindow();
      setIsConsoleDetached(false);
      return;
    }

    try {
      await openGameConsoleWindow(profileName, language);
      setIsConsoleDetached(true);
      await emitGameConsoleSync(syncPayload());
    } catch {
      setIsConsoleDetached(false);
    }
  }, [language, profileName, syncPayload]);

  return {
    isConsoleDetached,
    toggleConsoleDetached,
  };
}
