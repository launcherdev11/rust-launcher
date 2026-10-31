import { useEffect } from "react";
import type { ShowNotificationOptions, NotificationKind } from "../app/notifications";
import { PRODUCT_TOUR_COMPLETED_STORAGE_KEY } from "../product-tour";
import { modKeyLabel } from "../lib/hotkeyKey";

const HINT_SEEN_KEY = "launcher_palette_hint_seen_v1";
const HINT_DELAY_MS = 8000;

type Tt = (key: string, vars?: Record<string, string | number>) => string;

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(HINT_SEEN_KEY, "1");
  } catch {
  }
}

// для тех, кто прошёл тур до появления палитры; новые узнают о ней из тура
export function useCommandPaletteHint({
  ready,
  paletteOpen,
  tt,
  showNotification,
  openPalette,
}: {
  ready: boolean;
  paletteOpen: boolean;
  tt: Tt;
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  openPalette: () => void;
}) {
  useEffect(() => {
    if (paletteOpen) markSeen();
  }, [paletteOpen]);

  useEffect(() => {
    if (!ready || readFlag(HINT_SEEN_KEY) || !readFlag(PRODUCT_TOUR_COMPLETED_STORAGE_KEY)) return;
    const timer = window.setTimeout(() => {
      if (readFlag(HINT_SEEN_KEY)) return;
      markSeen();
      showNotification("info", tt("commandPalette.discoverHint", { keys: `${modKeyLabel()}+K` }), {
        action: { label: tt("commandPalette.tryIt"), onClick: openPalette },
      });
    }, HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, tt, showNotification, openPalette]);
}
