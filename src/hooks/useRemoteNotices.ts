import { useCallback, useEffect, useRef, useState } from "react";
import { playNotificationSound } from "../uiSounds";
import { buildLauncherNewsUrls, fetchFirstAvailableMirror } from "../lib/remoteMirrors";
import {
  getRemoteItemField,
  normalizeOptionalString,
  resolveRemoteNotificationKindFromColorMsg,
  type BottomSocialKind,
  type BottomSocialNotification,
  type Notification,
  type NotificationIdentity,
  type RemoteNewsPopupNotice,
  type RemoteNotificationsJsonItem,
} from "../app/notifications";
import type { Settings } from "../app/types";

const NEWS_POPUP_SEEN_KEY = "mc16launcher:newsPopupSeen";

function readSeenPopupFingerprints(): Set<string> {
  try {
    const raw = localStorage.getItem(NEWS_POPUP_SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string" && v.length > 0));
  } catch {
    return new Set();
  }
}

function writeSeenPopupFingerprints(seen: Set<string>) {
  try {
    localStorage.setItem(NEWS_POPUP_SEEN_KEY, JSON.stringify([...seen].slice(-40)));
  } catch {
  }
}

function popupFingerprint(image: string | undefined, msg: string): string {
  return `${image ?? ""}\n${msg}`;
}

function extractPopupNotice(item: RemoteNotificationsJsonItem): RemoteNewsPopupNotice | null {
  const image =
    normalizeOptionalString(item.image) ?? normalizeOptionalString(item.Image);
  const msg =
    normalizeOptionalString(item.msg) ?? normalizeOptionalString(item.Msg) ?? "";
  if (!image && !msg) return null;

  const toastText =
    normalizeOptionalString(getRemoteItemField(item, "text-msg", "textMsg")) ?? "";
  if (toastText) return null;

  return {
    image,
    msg,
    fingerprint: popupFingerprint(image, msg),
  };
}

export function useRemoteNotices(
  settings: Settings | null,
  pushNotification: (entry: NotificationIdentity) => { merged: boolean },
) {
  const [bottomSocialNotifications, setBottomSocialNotifications] = useState<BottomSocialNotification[]>([]);
  const [newsPopupNotice, setNewsPopupNotice] = useState<RemoteNewsPopupNotice | null>(null);
  const didLoadedRemoteNotificationsRef = useRef(false);
  const didLoadedBottomSocialRef = useRef(false);

  const dismissNewsPopupNotice = useCallback(() => {
    setNewsPopupNotice((current) => {
      if (current) {
        const seen = readSeenPopupFingerprints();
        seen.add(current.fingerprint);
        writeSeenPopupFingerprints(seen);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (didLoadedRemoteNotificationsRef.current) return;

    const controller = new AbortController();
    (async () => {
      try {
        let raw: unknown = null;
        try {
          const response = await fetchFirstAvailableMirror(
            buildLauncherNewsUrls("notifications.json"),
            { signal: controller.signal },
          );
          const text = await response.text();
          const sanitized = text.replace(/,\s*([}\]])/g, "$1");
          raw = JSON.parse(sanitized) as unknown;
        } catch (e) {
          if (!controller.signal.aborted) {
            console.warn("Remote notifications failed to load:", e);
          }
          return;
        }

        let items: RemoteNotificationsJsonItem[] = [];
        if (Array.isArray(raw)) {
          items = raw as RemoteNotificationsJsonItem[];
        } else if (raw && typeof raw === "object") {
          const obj = raw as Record<string, unknown>;
          if (Array.isArray(obj.notifications)) {
            items = obj.notifications as RemoteNotificationsJsonItem[];
          } else if (Array.isArray(obj.items)) {
            items = obj.items as RemoteNotificationsJsonItem[];
          }
        }

        const toastItems = items
          .map((item) => {
            const colorMsg = getRemoteItemField(item, "color-msg", "colorMsg");
            const iconMsg = getRemoteItemField(item, "icon-msg", "iconMsg");
            const textMsg = getRemoteItemField(item, "text-msg", "textMsg");

            const color = normalizeOptionalString(colorMsg);
            const icon = normalizeOptionalString(iconMsg);
            const text = normalizeOptionalString(textMsg) ?? "";
            return {
              colorMsg: color,
              iconMsg: icon,
              textMsg: text,
            };
          })
          .filter((x) => x.textMsg.length > 0);

        const seenPopups = readSeenPopupFingerprints();
        const popupItems = items
          .map(extractPopupNotice)
          .filter((x): x is RemoteNewsPopupNotice => Boolean(x))
          .filter((x) => !seenPopups.has(x.fingerprint));

        didLoadedRemoteNotificationsRef.current = true;

        if (popupItems.length > 0) {
          setNewsPopupNotice(popupItems[0]);
        }

        if (toastItems.length === 0) return;
        if (!settings.notify_system_message) return;

        const system: Array<
          Pick<Notification, "colorMsg" | "iconMsg" | "message" | "kind">
        > = [];

        for (const n of toastItems) {
          const kindFromColor = resolveRemoteNotificationKindFromColorMsg(n.colorMsg);
          system.push({
            message: n.textMsg,
            colorMsg: n.colorMsg,
            iconMsg: n.iconMsg,
            kind: kindFromColor ?? undefined,
          });
        }

        if (settings.ui_sounds_enabled) {
          const hasNoisyKind = system.some((s) => s.kind === "info" || s.kind === "error");
          if (hasNoisyKind) playNotificationSound();
        }

        for (const s of system) {
          pushNotification(s);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error("Failed to load remote notifications:", e);
      }
    })();

    return () => controller.abort();
  }, [settings, pushNotification]);

  useEffect(() => {
    if (didLoadedBottomSocialRef.current) return;
    didLoadedBottomSocialRef.current = true;

    const STORAGE_LAUNCHES_KEY = "mc16launcher:socialPromptLaunches";
    const STORAGE_LAST_SHOWN_AT_KEY = "mc16launcher:socialPromptLastShownAt";

    const MIN_LAUNCHES_BETWEEN = 6;
    const MIN_DAYS_BETWEEN = 5;
    const CHANCE_PER_ELIGIBLE_LAUNCH = 0.22;

    let launches = 0;
    let lastShownAt = 0;
    try {
      launches = Number.parseInt(localStorage.getItem(STORAGE_LAUNCHES_KEY) ?? "0", 10) || 0;
      lastShownAt = Number.parseInt(localStorage.getItem(STORAGE_LAST_SHOWN_AT_KEY) ?? "0", 10) || 0;
    } catch {
    }

    launches += 1;
    try {
      localStorage.setItem(STORAGE_LAUNCHES_KEY, String(launches));
    } catch {
    }

    const now = Date.now();
    const minMs = MIN_DAYS_BETWEEN * 24 * 60 * 60 * 1000;
    const eligible =
      launches >= MIN_LAUNCHES_BETWEEN &&
      (lastShownAt <= 0 || now - lastShownAt >= minMs) &&
      Math.random() < CHANCE_PER_ELIGIBLE_LAUNCH;

    if (!eligible) return;

    const kind: BottomSocialKind = Math.random() < 0.5 ? "discord" : "telegram";
    const card: BottomSocialNotification = {
      id: Date.now() + Math.random(),
      kind,
      colorMsg: kind === "discord" ? "#5865F2" : "#229ED9",
      iconMsg: undefined,
      messageKey: kind === "discord" ? "app.social.discord" : "app.social.telegram",
    };

    setBottomSocialNotifications([card]);
    try {
      localStorage.setItem(STORAGE_LAST_SHOWN_AT_KEY, String(now));
      localStorage.setItem(STORAGE_LAUNCHES_KEY, "0");
    } catch {
    }
  }, []);

  return {
    bottomSocialNotifications,
    setBottomSocialNotifications,
    newsPopupNotice,
    dismissNewsPopupNotice,
  };
}
