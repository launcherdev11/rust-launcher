import { useEffect } from "react";
import { WS_EVENT, type WsEvent } from "../api/ws";
import { t, type Language } from "../i18n";

type ShowNotification = (
  kind: "info" | "success" | "error" | "warning",
  message: string,
  options?: { sound?: boolean },
) => void;

function formatNotificationMessage(
  language: Language,
  event: Extract<WsEvent, { type: "notification" }>,
): string {
  const nType = event.payload.notification_type;
  const p = (event.payload.payload ?? {}) as Record<string, unknown>;
  if (nType === "friend_request") {
    return t(language, "notifications.friendRequest", {
      nick: String(p.from_nickname ?? ""),
    });
  }
  if (nType === "friend_accept") {
    return t(language, "notifications.friendAccept", {
      nick: String(p.friend_nickname ?? ""),
    });
  }
  if (nType === "room_invite") {
    return t(language, "notifications.roomInvite", {
      nick: String(p.from_nickname ?? ""),
    });
  }
  if (nType === "achievement") {
    return t(language, "notifications.achievement", {
      title: String(p.title ?? p.code ?? ""),
    });
  }
  return t(language, "notifications.system");
}

export function usePlatformNotificationToasts(
  showNotification: ShowNotification,
  language: Language,
) {
  useEffect(() => {
    const onWs = (ev: Event) => {
      const detail = (ev as CustomEvent<WsEvent>).detail;
      if (!detail || detail.type !== "notification") return;
      showNotification("info", formatNotificationMessage(language, detail), { sound: true });
    };
    window.addEventListener(WS_EVENT, onWs);
    return () => window.removeEventListener(WS_EVENT, onWs);
  }, [showNotification, language]);
}
