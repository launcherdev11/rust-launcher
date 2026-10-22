import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { playNotificationSound } from "../uiSounds";
import type { SessionNotification } from "../components/SessionNotificationsBell";
import {
  MAX_SESSION_NOTIFICATIONS,
  MAX_VISIBLE_NOTIFICATIONS,
  NOTIFICATION_EXIT_MS,
  notificationsMatch,
  type Notification,
  type NotificationIdentity,
  type NotificationKind,
  type ShowNotificationOptions,
} from "../app/notifications";
import type { Settings } from "../app/types";

export function useNotifications(settings: Settings | null) {
  const [sessionNotificationsOpen, setSessionNotificationsOpen] = useState(false);
  const sessionNotificationsRef = useRef<HTMLDivElement | null>(null);
  const sessionNotificationsOpenRef = useRef(false);
  const [sessionNotifications, setSessionNotifications] = useState<SessionNotification[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationTimersRef = useRef(
    new Map<
      number,
      {
        fade?: ReturnType<typeof setTimeout>;
        remove?: ReturnType<typeof setTimeout>;
      }
    >(),
  );

  const clearNotificationDismissTimers = useCallback((id: number) => {
    const t = notificationTimersRef.current.get(id);
    if (!t) return;
    if (t.fade !== undefined) clearTimeout(t.fade);
    if (t.remove !== undefined) clearTimeout(t.remove);
    notificationTimersRef.current.delete(id);
  }, []);

  const scheduleNotificationRemoval = useCallback(
    (id: number, delayMs = NOTIFICATION_EXIT_MS) => {
      clearNotificationDismissTimers(id);
      const remove = window.setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        notificationTimersRef.current.delete(id);
      }, delayMs);
      notificationTimersRef.current.set(id, { remove });
    },
    [clearNotificationDismissTimers],
  );

  const beginDismissNotification = useCallback(
    (id: number) => {
      clearNotificationDismissTimers(id);
      let shouldAnimateOut = false;
      setNotifications((prev) => {
        const target = prev.find((n) => n.id === id);
        if (!target || target.leaving) return prev;
        shouldAnimateOut = true;
        return prev.map((n) => (n.id === id ? { ...n, leaving: true } : n));
      });
      if (!shouldAnimateOut) return;

      scheduleNotificationRemoval(id);
    },
    [clearNotificationDismissTimers, scheduleNotificationRemoval],
  );

  const scheduleNotificationDismiss = useCallback(
    (id: number) => {
      if (!id) return;
      clearNotificationDismissTimers(id);
      const fade = window.setTimeout(() => beginDismissNotification(id), 4300);
      notificationTimersRef.current.set(id, { fade });
    },
    [clearNotificationDismissTimers, beginDismissNotification],
  );

  useEffect(() => {
    return () => {
      for (const t of notificationTimersRef.current.values()) {
        if (t.fade !== undefined) clearTimeout(t.fade);
        if (t.remove !== undefined) clearTimeout(t.remove);
      }
      notificationTimersRef.current.clear();
    };
  }, []);

  const pushNotification = useCallback(
    (entry: NotificationIdentity): { merged: boolean } => {
      let targetId = 0;
      let merged = false;
      const autoDismissIds: number[] = [];
      const sessionId = Date.now() + Math.random();

      setSessionNotifications((prev) => {
        const next: SessionNotification[] = [
          {
            id: sessionId,
            kind: entry.kind,
            message: entry.message,
            colorMsg: entry.colorMsg,
            iconMsg: entry.iconMsg,
            at: Date.now(),
            seen: sessionNotificationsOpenRef.current,
          },
          ...prev,
        ];
        return next.length > MAX_SESSION_NOTIFICATIONS
          ? next.slice(0, MAX_SESSION_NOTIFICATIONS)
          : next;
      });

      flushSync(() => {
        setNotifications((prev) => {
          const existing = prev.find((n) => !n.leaving && notificationsMatch(n, entry));
          if (existing) {
            targetId = existing.id;
            merged = true;
            return prev.map((n) =>
              n.id === existing.id
                ? { ...n, ...entry, count: (n.count ?? 1) + 1, leaving: false }
                : n,
            );
          }
          let next = [...prev];
          const active = next.filter((n) => !n.leaving);
          if (active.length >= MAX_VISIBLE_NOTIFICATIONS) {
            const oldest = active[0];
            next = next.map((n) =>
              n.id === oldest.id ? { ...n, leaving: true } : n,
            );
            autoDismissIds.push(oldest.id);
          }
          targetId = Date.now() + Math.random();
          merged = false;
          return [...next, { id: targetId, ...entry, count: 1, entered: false }];
        });
      });

      for (const id of autoDismissIds) {
        clearNotificationDismissTimers(id);
        scheduleNotificationRemoval(id);
      }

      scheduleNotificationDismiss(targetId);
      return { merged };
    },
    [scheduleNotificationDismiss, clearNotificationDismissTimers, scheduleNotificationRemoval],
  );

  const showNotification = useCallback(
    (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => {
      const shouldShow =
        !(settings && !settings.notify_new_message && kind === "info");
      if (!shouldShow) return;

      const { merged } = pushNotification({ kind, message });

      const uiSoundsEnabled = settings?.ui_sounds_enabled ?? true;
      const shouldSound =
        !merged &&
        uiSoundsEnabled &&
        (kind === "info" || kind === "error" || options?.sound === true);

      if (shouldSound) playNotificationSound();
    },
    [settings, pushNotification],
  );

  useEffect(() => {
    if (!sessionNotificationsOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = sessionNotificationsRef.current;
      if (el && !el.contains(e.target as Node)) setSessionNotificationsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [sessionNotificationsOpen]);

  useEffect(() => {
    sessionNotificationsOpenRef.current = sessionNotificationsOpen;
  }, [sessionNotificationsOpen]);

  useEffect(() => {
    if (!sessionNotificationsOpen) return;
    setSessionNotifications((prev) => {
      if (prev.every((n) => n.seen)) return prev;
      return prev.map((n) => (n.seen ? n : { ...n, seen: true }));
    });
  }, [sessionNotificationsOpen]);

  return {
    notifications,
    setNotifications,
    beginDismissNotification,
    pushNotification,
    showNotification,
    sessionNotifications,
    setSessionNotifications,
    sessionNotificationsOpen,
    setSessionNotificationsOpen,
    sessionNotificationsRef,
  };
}
