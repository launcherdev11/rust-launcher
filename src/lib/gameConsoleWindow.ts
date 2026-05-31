import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const GAME_CONSOLE_WINDOW_LABEL = "game-console";

export const GAME_CONSOLE_SYNC_EVENT = "game-console-sync";
export const GAME_CONSOLE_ACTION_EVENT = "game-console-action";
export const GAME_CONSOLE_REQUEST_SYNC_EVENT = "game-console-request-sync";

export type GameConsoleLine = {
  id: number;
  line: string;
  source: "stdout" | "stderr";
};

export type GameStatus = "idle" | "running" | "stopped" | "crashed";

export type GameConsoleSyncPayload = {
  lines: GameConsoleLine[];
  isVisible: boolean;
  gameStatus: GameStatus;
  profileName: string | null;
  language: "ru" | "en";
};

export type GameConsoleAction =
  | { type: "clear" }
  | { type: "toggle-visible" }
  | { type: "attach" };

export function isGameConsoleWindowView(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("view") === "game-console"
  );
}

export function buildGameConsoleWindowUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "game-console");
  return url.toString();
}

export function formatGameConsoleWindowTitle(
  profileName: string | null,
  language: "ru" | "en",
): string {
  const name = profileName?.trim() || (language === "ru" ? "игра" : "game");
  return language === "ru" ? `Консоль "${name}"` : `Console "${name}"`;
}

export async function getGameConsoleWebview(): Promise<WebviewWindow | null> {
  return (await WebviewWindow.getByLabel(GAME_CONSOLE_WINDOW_LABEL)) ?? null;
}

export async function openGameConsoleWindow(
  profileName: string | null,
  language: "ru" | "en",
): Promise<WebviewWindow | null> {
  const existing = await getGameConsoleWebview();
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  return new WebviewWindow(GAME_CONSOLE_WINDOW_LABEL, {
    url: buildGameConsoleWindowUrl(),
    title: formatGameConsoleWindowTitle(profileName, language),
    width: 720,
    height: 420,
    minWidth: 420,
    minHeight: 220,
    resizable: true,
    decorations: true,
    center: true,
    focus: true,
  });
}

export async function closeGameConsoleWindow(): Promise<void> {
  const win = await getGameConsoleWebview();
  if (win) {
    await win.close();
  }
}

export async function emitGameConsoleSync(
  payload: GameConsoleSyncPayload,
): Promise<void> {
  await emit(GAME_CONSOLE_SYNC_EVENT, payload);
}

export function listenGameConsoleSync(
  handler: (payload: GameConsoleSyncPayload) => void,
): Promise<UnlistenFn> {
  return listen<GameConsoleSyncPayload>(GAME_CONSOLE_SYNC_EVENT, (event) => {
    handler(event.payload);
  });
}

export async function emitGameConsoleAction(
  action: GameConsoleAction,
): Promise<void> {
  await emit(GAME_CONSOLE_ACTION_EVENT, action);
}

export function listenGameConsoleAction(
  handler: (action: GameConsoleAction) => void,
): Promise<UnlistenFn> {
  return listen<GameConsoleAction>(GAME_CONSOLE_ACTION_EVENT, (event) => {
    handler(event.payload);
  });
}

export function listenGameConsoleRequestSync(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen(GAME_CONSOLE_REQUEST_SYNC_EVENT, () => {
    handler();
  });
}

export async function requestGameConsoleSync(): Promise<void> {
  await emit(GAME_CONSOLE_REQUEST_SYNC_EVENT);
}
