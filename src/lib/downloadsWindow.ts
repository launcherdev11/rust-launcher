import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DownloadJob } from "../hooks/useDownloadJobs";
import type { Language } from "../i18n";

export const DOWNLOADS_WINDOW_LABEL = "downloads";

const DOWNLOADS_SYNC_EVENT = "downloads-window-sync";
const DOWNLOADS_REQUEST_SYNC_EVENT = "downloads-window-request-sync";

export type DownloadsSyncPayload = {
  jobs: DownloadJob[];
  language: Language;
  accentColor: string;
};

export function isDownloadsWindowView(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("view") === "downloads";
}

export async function getDownloadsWebview(): Promise<WebviewWindow | null> {
  return (await WebviewWindow.getByLabel(DOWNLOADS_WINDOW_LABEL)) ?? null;
}

export async function openDownloadsWindow(title: string): Promise<void> {
  const existing = await getDownloadsWebview();
  if (existing) {
    await existing.setFocus();
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("view", "downloads");
  await new Promise<void>((resolve, reject) => {
    const win = new WebviewWindow(DOWNLOADS_WINDOW_LABEL, {
      url: url.toString(),
      title,
      width: 420,
      height: 520,
      minWidth: 320,
      minHeight: 240,
      resizable: true,
      decorations: true,
      center: true,
      focus: true,
    });
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (event) => reject(new Error(String(event.payload))));
  });
}

export async function emitDownloadsSync(payload: DownloadsSyncPayload): Promise<void> {
  await emit(DOWNLOADS_SYNC_EVENT, payload);
}

export function listenDownloadsSync(
  handler: (payload: DownloadsSyncPayload) => void,
): Promise<UnlistenFn> {
  return listen<DownloadsSyncPayload>(DOWNLOADS_SYNC_EVENT, (event) => handler(event.payload));
}

export async function requestDownloadsSync(): Promise<void> {
  await emit(DOWNLOADS_REQUEST_SYNC_EVENT);
}

export function listenDownloadsRequestSync(handler: () => void): Promise<UnlistenFn> {
  return listen(DOWNLOADS_REQUEST_SYNC_EVENT, () => handler());
}
