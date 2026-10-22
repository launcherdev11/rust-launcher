export type NotificationKind = "info" | "success" | "error" | "warning";

export const MAX_VISIBLE_NOTIFICATIONS = 2;
export const MAX_SESSION_NOTIFICATIONS = 80;
export const NOTIFICATION_EXIT_MS = 200;

export type Notification = {
  id: number;
  kind?: NotificationKind;
  message: string;
  leaving?: boolean;
  entered?: boolean;
  count?: number;
  colorMsg?: string;
  iconMsg?: string;
};

export type ShowNotificationOptions = {
  sound?: boolean;
};

export type NotificationIdentity = Pick<Notification, "kind" | "message" | "colorMsg" | "iconMsg">;

export function notificationsMatch(a: NotificationIdentity, b: NotificationIdentity): boolean {
  return (
    a.kind === b.kind &&
    a.message === b.message &&
    (a.colorMsg ?? "") === (b.colorMsg ?? "") &&
    (a.iconMsg ?? "") === (b.iconMsg ?? "")
  );
}

export function appendAlphaToHex(hex: string, alpha01: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha01)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`.toUpperCase();
}

export function isHexColor(value: string): value is `#${string}` {
  return /^#([0-9a-fA-F]{6})$/.test(value.trim());
}

export function getTextColorForHexBg(hex: string): "black" | "white" {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "white";
  const raw = m[1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 160 ? "black" : "white";
}

export function resolveRemoteNotificationIconSrc(iconMsg?: string): string | null {
  if (!iconMsg) return null;
  const v = iconMsg.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || v.startsWith("/")) return v;

  if (/^[a-zA-Z0-9_-]+\.(png|webp|gif)$/i.test(v)) {
    return `/launcher-assets/${v}`;
  }

  const lower = v.toLowerCase();
  if (lower === "info") return "/launcher-assets/info.png";
  if (lower === "success") return "/launcher-assets/success.png";
  if (lower === "error") return "/launcher-assets/errorIcon.png";
  if (lower === "warning" || lower === "warn") return "/launcher-assets/warn.png";

  return null;
}

export function normalizeOptionalString(value?: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

export function resolveRemoteNotificationKindFromColorMsg(colorMsg?: string): NotificationKind | null {
  const c = normalizeOptionalString(colorMsg)?.toLowerCase();
  if (!c) return null;

  if (c === "red") return "error";
  if (c === "green") return "success";
  if (c === "yellow") return "warning";
  if (c === "gray" || c === "grey") return "info";

  if (c === "info") return "info";
  if (c === "success") return "success";
  if (c === "error") return "error";
  if (c === "warning") return "warning";

  return null;
}

export function resolveRemoteNotificationBgStyle(
  colorMsg?: string,
): { background: string; border: string; textColor: "black" | "white" } | null {
  if (!colorMsg) return null;
  const v = colorMsg.trim();
  if (!v) return null;

  if (isHexColor(v)) {
    const background = appendAlphaToHex(v.toUpperCase(), 0.95);
    const border = appendAlphaToHex(v.toUpperCase(), 0.45);
    const textColor = getTextColorForHexBg(v);
    return { background, border, textColor };
  }

  return {
    background: v,
    border: "rgba(255, 255, 255, 0.35)",
    textColor: "white",
  };
}

export type RemoteNotificationsJsonItem = {
  "color-msg"?: string;
  "icon-msg"?: string;
  "text-msg"?: string;

  colorMsg?: string;
  iconMsg?: string;
  textMsg?: string;

  type?: string;
};

export type RemoteNotificationHyphenKey = "color-msg" | "icon-msg" | "text-msg";
export type RemoteNotificationCamelKey = "colorMsg" | "iconMsg" | "textMsg";

export type BottomSocialKind = "discord" | "telegram";

export type BottomSocialNotification = {
  id: number;
  kind: BottomSocialKind;
  colorMsg?: string;
  iconMsg?: string;
  textMsg?: string;
  messageKey?: "app.social.discord" | "app.social.telegram";
  leaving?: boolean;
};

export function getRemoteItemField(
  item: RemoteNotificationsJsonItem,
  hyphenKey: RemoteNotificationHyphenKey,
  camelKey: RemoteNotificationCamelKey,
) {
  return item[hyphenKey] ?? item[camelKey];
}

export function splitTitleAndSubtitle(textMsg: string): { title: string; subtitle?: string } {
  const normalized = (textMsg ?? "").trim();
  if (!normalized) return { title: "" };
  const parts = normalized.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) return { title: parts[0] };
  return { title: parts[0], subtitle: parts.slice(1).join("\n") };
}

export const DISCORD_LINK = "https://discord.gg/cpW2AnW9Vy";
export const TELEGRAM_LINK = "https://t.me/of16launcher";
