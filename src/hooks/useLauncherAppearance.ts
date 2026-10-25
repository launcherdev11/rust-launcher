import { useEffect, useLayoutEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { extractBackgroundAccent } from "../lib/backgroundAccent";
import { applyAccentColor } from "../lib/customTheme";
import {
  isAnimatedBackgroundPath,
  resolveLauncherBackgroundUrl,
  shouldLoadBackgroundDataUri,
} from "../lib/launcherBackground";
import type { Settings, SidebarItemId } from "../app/types";
import { useCustomTheme } from "./useCustomTheme";

export function useLauncherAppearance(settings: Settings | null, activeItem: SidebarItemId) {
  const [backgroundDataUri, setBackgroundDataUri] = useState<string | null>(null);

  const [adaptiveAccent, setAdaptiveAccent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBackgroundDataUri(null);
    (async () => {
      if (!shouldLoadBackgroundDataUri(settings?.background_image_url)) return;
      try {
        const uri = await invoke<string | null>("get_background_data_uri");
        if (!cancelled) setBackgroundDataUri(uri ?? null);
      } catch {
        if (!cancelled) setBackgroundDataUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings?.background_image_url]);

  const backgroundImageUrl = resolveLauncherBackgroundUrl(
    settings?.background_image_url,
    backgroundDataUri,
  );
  const backgroundIsAnimated = isAnimatedBackgroundPath(
    settings?.background_image_url ?? "",
  );

  const adaptiveSource =
    settings?.adaptive_accent_enabled && settings.background_image_url?.trim()
      ? backgroundImageUrl
      : null;

  useEffect(() => {
    if (!adaptiveSource) {
      setAdaptiveAccent(null);
      return;
    }
    let cancelled = false;
    void extractBackgroundAccent(adaptiveSource).then((hex) => {
      if (!cancelled) setAdaptiveAccent(hex);
    });
    return () => {
      cancelled = true;
    };
  }, [adaptiveSource]);

  const accentColor =
    adaptiveAccent ?? settings?.background_accent_color ?? "#4a22a8";

  useLayoutEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);

  const adaptiveActive = adaptiveAccent !== null;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (adaptiveActive) root.dataset.adaptiveAccent = "";
    else delete root.dataset.adaptiveAccent;
    return () => {
      delete root.dataset.adaptiveAccent;
    };
  }, [adaptiveActive]);

  useCustomTheme(
    settings?.custom_theme_id ?? null,
    settings?.custom_theme_hot_reload ?? false,
  );

  useEffect(() => {
    document.documentElement.dataset.launcherTab = activeItem;
  }, [activeItem]);

  return { accentColor, backgroundImageUrl, backgroundIsAnimated };
}
