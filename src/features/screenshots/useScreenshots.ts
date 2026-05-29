import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteScreenshot,
  getScreenshotThumbnail,
  listScreenshots,
  openScreenshot,
  openScreenshotsFolder,
} from "./api";
import type { ScreenshotInfo } from "./types";

const THUMB_MAX_PX = 256;
const PREVIEW_MAX_PX = 1280;
const THUMB_CACHE_LIMIT = 48;
const LOAD_CONCURRENCY = 3;

function trimCache(
  prev: Record<string, string>,
  order: string[],
  name: string,
  uri: string,
): { map: Record<string, string>; order: string[] } {
  const next = { ...prev, [name]: uri };
  const nextOrder = order.includes(name) ? order : [...order, name];
  while (nextOrder.length > THUMB_CACHE_LIMIT) {
    const evict = nextOrder.shift();
    if (evict) delete next[evict];
  }
  return { map: next, order: nextOrder };
}

export function useScreenshots(enabled: boolean, profileId: string | null) {
  const [items, setItems] = useState<ScreenshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const thumbOrderRef = useRef<string[]>([]);
  const thumbQueueRef = useRef<string[]>([]);
  const thumbActiveRef = useRef(0);
  const thumbPendingRef = useRef(new Set<string>());
  const thumbCacheRef = useRef<Record<string, string>>({});

  const resetState = useCallback(() => {
    setItems([]);
    setThumbnails({});
    setSelectedName(null);
    setPreviewUri(null);
    setPreviewLoading(false);
    thumbOrderRef.current = [];
    thumbQueueRef.current = [];
    thumbActiveRef.current = 0;
    thumbPendingRef.current.clear();
    thumbCacheRef.current = {};
  }, []);

  const refresh = useCallback(async () => {
    if (!profileId) {
      resetState();
      return;
    }
    setLoading(true);
    try {
      const list = await listScreenshots(profileId);
      setItems(list);
      setThumbnails({});
      thumbOrderRef.current = [];
      thumbQueueRef.current = [];
      thumbActiveRef.current = 0;
      thumbPendingRef.current.clear();
      thumbCacheRef.current = {};
      setSelectedName((prev) => {
        if (prev && list.some((s) => s.name === prev)) return prev;
        return list[0]?.name ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, [profileId, resetState]);

  useEffect(() => {
    resetState();
    if (!enabled || !profileId) return;
    void refresh();
  }, [enabled, profileId, refresh, resetState]);

  const pumpThumbQueue = useCallback(() => {
    if (!profileId) return;
    while (
      thumbActiveRef.current < LOAD_CONCURRENCY &&
      thumbQueueRef.current.length > 0
    ) {
      const name = thumbQueueRef.current.shift();
      if (!name) break;
      thumbActiveRef.current += 1;
      void getScreenshotThumbnail(profileId, name, THUMB_MAX_PX)
        .then((uri) => {
          if (!uri) return;
          thumbCacheRef.current[name] = uri;
          const trimmed = trimCache(
            thumbCacheRef.current,
            thumbOrderRef.current,
            name,
            uri,
          );
          thumbCacheRef.current = trimmed.map;
          thumbOrderRef.current = trimmed.order;
          setThumbnails({ ...thumbCacheRef.current });
        })
        .catch(() => {
          //skip broken thumbnails
        })
        .finally(() => {
          thumbPendingRef.current.delete(name);
          thumbActiveRef.current = Math.max(0, thumbActiveRef.current - 1);
          pumpThumbQueue();
        });
    }
  }, [profileId]);

  const requestThumbnail = useCallback(
    (name: string) => {
      if (!profileId || !enabled) return;
      if (thumbCacheRef.current[name] || thumbPendingRef.current.has(name)) return;
      thumbPendingRef.current.add(name);
      thumbQueueRef.current.push(name);
      pumpThumbQueue();
    },
    [enabled, profileId, pumpThumbQueue],
  );

  useEffect(() => {
    if (selectedName) requestThumbnail(selectedName);
  }, [selectedName, requestThumbnail]);

  useEffect(() => {
    if (!enabled || !profileId || !selectedName) {
      setPreviewUri(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewUri(null);
    void getScreenshotThumbnail(profileId, selectedName, PREVIEW_MAX_PX)
      .then((uri) => {
        if (!cancelled) setPreviewUri(uri);
      })
      .catch(() => {
        if (!cancelled) setPreviewUri(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, profileId, selectedName]);

  const remove = useCallback(
    async (name: string) => {
      if (!profileId) return;
      await deleteScreenshot(profileId, name);
      delete thumbCacheRef.current[name];
      thumbOrderRef.current = thumbOrderRef.current.filter((n) => n !== name);
      thumbPendingRef.current.delete(name);
      setThumbnails({ ...thumbCacheRef.current });
      setItems((prev) => prev.filter((s) => s.name !== name));
      setSelectedName((prev) => (prev === name ? null : prev));
      if (selectedName === name) setPreviewUri(null);
    },
    [profileId, selectedName],
  );

  const openFolder = useCallback(() => {
    if (!profileId) return Promise.reject(new Error("No profile selected"));
    return openScreenshotsFolder(profileId);
  }, [profileId]);

  const openInSystem = useCallback(
    (name: string) => {
      if (!profileId) return Promise.reject(new Error("No profile selected"));
      return openScreenshot(profileId, name);
    },
    [profileId],
  );

  return {
    items,
    loading,
    thumbnails,
    selectedName,
    setSelectedName,
    previewUri,
    previewLoading,
    requestThumbnail,
    refresh,
    remove,
    openFolder,
    openInSystem,
  };
}
