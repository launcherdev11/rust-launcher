import { useEffect, useLayoutEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

  const accentColor = settings?.background_accent_color ?? "#4a22a8";

  useEffect(() => {
    (async () => {
      if (!shouldLoadBackgroundDataUri(settings?.background_image_url)) {
        setBackgroundDataUri(null);
        return;
      }
      try {
        const uri = await invoke<string | null>("get_background_data_uri");
        setBackgroundDataUri(uri ?? null);
      } catch {
        setBackgroundDataUri(null);
      }
    })();
  }, [settings?.background_image_url]);

  useLayoutEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);

  useCustomTheme(
    settings?.custom_theme_id ?? null,
    settings?.custom_theme_hot_reload ?? false,
  );

  useEffect(() => {
    document.documentElement.dataset.launcherTab = activeItem;
  }, [activeItem]);

  const backgroundImageUrl = resolveLauncherBackgroundUrl(
    settings?.background_image_url,
    backgroundDataUri,
  );
  const backgroundIsAnimated = isAnimatedBackgroundPath(
    settings?.background_image_url ?? "",
  );

  return { accentColor, backgroundImageUrl, backgroundIsAnimated };
}
