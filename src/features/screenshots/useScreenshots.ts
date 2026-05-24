import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteScreenshot,
  getScreenshotDataUri,
  listScreenshots,
  openScreenshot,
  openScreenshotsFolder,
} from "./api";
import type { ScreenshotInfo } from "./types";

export function useScreenshots(enabled: boolean) {
  const [items, setItems] = useState<ScreenshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const thumbLoadingRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listScreenshots();
      setItems(list);
      setThumbnails({});
      thumbLoadingRef.current.clear();
      setSelectedName((prev) => {
        if (prev && list.some((s) => s.name === prev)) return prev;
        return list[0]?.name ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || items.length === 0) return;

    let cancelled = false;
    const loadThumbs = async () => {
      for (const item of items) {
        if (cancelled) return;
        if (thumbnails[item.name] || thumbLoadingRef.current.has(item.name)) continue;
        thumbLoadingRef.current.add(item.name);
        try {
          const uri = await getScreenshotDataUri(item.name);
          if (cancelled || !uri) continue;
          setThumbnails((prev) =>
            prev[item.name] ? prev : { ...prev, [item.name]: uri },
          );
        } catch {
          //skip broken thumbnails
        } finally {
          thumbLoadingRef.current.delete(item.name);
        }
      }
    };

    void loadThumbs();
    return () => {
      cancelled = true;
    };
  }, [enabled, items]);

  useEffect(() => {
    if (!enabled || !selectedName) {
      setPreviewUri(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const cached = thumbnails[selectedName];
        if (cached) {
          if (!cancelled) setPreviewUri(cached);
          return;
        }
        const uri = await getScreenshotDataUri(selectedName);
        if (!cancelled) {
          setPreviewUri(uri);
          if (uri) {
            setThumbnails((prev) =>
              prev[selectedName] ? prev : { ...prev, [selectedName]: uri },
            );
          }
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, selectedName, thumbnails]);

  const remove = useCallback(
    async (name: string) => {
      await deleteScreenshot(name);
      setThumbnails((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setItems((prev) => prev.filter((s) => s.name !== name));
      setSelectedName((prev) => (prev === name ? null : prev));
    },
    [],
  );

  return {
    items,
    loading,
    thumbnails,
    selectedName,
    setSelectedName,
    previewUri,
    previewLoading,
    refresh,
    remove,
    openFolder: openScreenshotsFolder,
    openInSystem: openScreenshot,
  };
}
