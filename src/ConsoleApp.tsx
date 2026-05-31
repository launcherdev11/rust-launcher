import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GameConsolePanel } from "./components/GameConsolePanel";
import {
  emitGameConsoleAction,
  listenGameConsoleSync,
  requestGameConsoleSync,
  type GameConsoleSyncPayload,
  type GameStatus,
} from "./lib/gameConsoleWindow";

const EMPTY_SYNC: GameConsoleSyncPayload = {
  lines: [],
  isVisible: true,
  gameStatus: "idle",
  profileName: null,
  language: "ru",
};

export function ConsoleApp() {
  const [sync, setSync] = useState<GameConsoleSyncPayload>(EMPTY_SYNC);

  useEffect(() => {
    let cancelled = false;
    let unlistenSync: (() => void) | undefined;

    void (async () => {
      try {
        unlistenSync = await listenGameConsoleSync((payload) => {
          if (!cancelled) setSync(payload);
        });
        await requestGameConsoleSync();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
      unlistenSync?.();
    };
  }, []);

  const sendAction = useCallback(
    (type: "clear" | "toggle-visible" | "attach") => {
      void emitGameConsoleAction({ type });
    },
    [],
  );

  const handleClearConsole = useCallback(() => {
    sendAction("clear");
  }, [sendAction]);

  const handleToggleConsole = useCallback(() => {
    sendAction("toggle-visible");
  }, [sendAction]);

  const handleAttach = useCallback(() => {
    sendAction("attach");
    void getCurrentWindow().close();
  }, [sendAction]);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0c0c0c] p-3">
      <GameConsolePanel
        className="min-h-0 flex-1 border-white/10"
        consoleLines={sync.lines}
        isConsoleVisible={sync.isVisible}
        gameStatus={sync.gameStatus as GameStatus}
        language={sync.language}
        isDetached
        onClearConsole={handleClearConsole}
        onToggleConsole={handleToggleConsole}
        onToggleDetached={handleAttach}
        showHint={false}
      />
    </div>
  );
}
