import { convertFileSrc } from "@tauri-apps/api/core";

export const DEFAULT_LAUNCHER_BACKGROUND = "/launcher-assets/background.jpg";

export function isAnimatedBackgroundPath(pathOrUrl: string): boolean {
  const lower = pathOrUrl.toLowerCase();
  if (lower.startsWith("data:image/gif")) {
    return true;
  }
  return /\.gif(?:[?#]|$)/i.test(lower);
}

export function shouldLoadBackgroundDataUri(
  backgroundImageUrl: string | null | undefined,
): boolean {
  const trimmed = backgroundImageUrl?.trim();
  if (!trimmed) {
    return false;
  }
  return !isAnimatedBackgroundPath(trimmed);
}

export function resolveLauncherBackgroundUrl(
  backgroundImageUrl: string | null | undefined,
  backgroundDataUri: string | null,
): string {
  const raw =
    backgroundImageUrl && backgroundImageUrl.trim().length > 0
      ? backgroundImageUrl.trim()
      : DEFAULT_LAUNCHER_BACKGROUND;

  if (backgroundDataUri) {
    return backgroundDataUri;
  }

  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("data:") ||
    raw.startsWith("/launcher-assets/")
  ) {
    return raw;
  }

  return convertFileSrc(raw);
}
