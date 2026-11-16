import { useCallback, useEffect, useRef, useState } from "react";
import {
  emitDownloadsSync,
  getDownloadsWebview,
  listenDownloadsRequestSync,
  openDownloadsWindow,
  type DownloadsSyncPayload,
} from "../lib/downloadsWindow";
import { t } from "../i18n";

export function useDownloadsWindow(payload: DownloadsSyncPayload) {
  const [isDownloadsDetached, setIsDownloadsDetached] = useState(false);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenDownloadsRequestSync(() => {
      setIsDownloadsDetached(true);
      void emitDownloadsSync(payloadRef.current);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const { jobs, language, accentColor } = payload;
  useEffect(() => {
    if (!isDownloadsDetached) return;
    void emitDownloadsSync(payloadRef.current);
  }, [isDownloadsDetached, jobs, language, accentColor]);

  useEffect(() => {
    if (!isDownloadsDetached) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const win = await getDownloadsWebview();
        if (disposed) return;
        if (!win) {
          setIsDownloadsDetached(false);
          return;
        }
        const fn = await win.listen("tauri://destroyed", () => setIsDownloadsDetached(false));
        if (disposed) fn();
        else unlisten = fn;
      } catch {
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDownloadsDetached]);

  const openWindow = useCallback(async () => {
    try {
      await openDownloadsWindow(t(payloadRef.current.language, "app.downloads.windowTitle"));
      setIsDownloadsDetached(true);
    } catch (error) {
      console.error("Не удалось открыть окно установок:", error);
    }
  }, []);

  return { isDownloadsDetached, openDownloadsWindow: openWindow };
}
