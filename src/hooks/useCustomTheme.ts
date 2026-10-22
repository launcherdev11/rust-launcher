import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import {
  THEME_CHANGED_EVENT,
  THEME_RELOAD_EVENT,
  applySavedTheme,
  buildThemeStylesheet,
  type ThemeDetails,
} from "../lib/customTheme";
import { subscribeTauriEvent } from "../lib/tauriEvents";

export function useCustomTheme(themeId: string | null, hotReload: boolean) {
  useEffect(() => {
    let cancelled = false;
    let seq = 0;

    const load = async () => {
      const mySeq = ++seq;
      if (!themeId) {
        applySavedTheme(null, null);
        return;
      }
      try {
        const theme = await invoke<ThemeDetails>("get_theme", { themeId });
        if (cancelled || mySeq !== seq) return;
        applySavedTheme(buildThemeStylesheet(theme), themeId);
      } catch (err) {
        if (cancelled || mySeq !== seq) return;
        console.error("Не удалось применить тему:", err);
        applySavedTheme(null, null);
      }
    };

    void load();
    const onReload = () => void load();
    window.addEventListener(THEME_RELOAD_EVENT, onReload);
    const unlisten = subscribeTauriEvent<string>(THEME_CHANGED_EVENT, (e) => {
      if (e.payload === themeId) void load();
    });

    return () => {
      cancelled = true;
      window.removeEventListener(THEME_RELOAD_EVENT, onReload);
      unlisten();
    };
  }, [themeId]);

  useEffect(() => {
    if (!themeId || !hotReload) return;
    invoke("watch_theme", { themeId }).catch((e) =>
      console.error("Не удалось включить автообновление темы:", e),
    );
    return () => {
      invoke("watch_theme", { themeId: null }).catch(() => {});
    };
  }, [themeId, hotReload]);
}
