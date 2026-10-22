import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../onboarding";
import { isLanguage, readStoredLanguage, type Language } from "../i18n";
import { DEFAULT_SETTINGS } from "../app/defaultSettings";
import type { NotificationKind } from "../app/notifications";
import type { Settings, SidebarItemId, Tt } from "../app/types";

type UseLauncherSettingsOptions = {
  settings: Settings | null;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  setLanguage: Dispatch<SetStateAction<Language>>;
  setActiveItem: Dispatch<SetStateAction<SidebarItemId>>;
  setActiveItemWithSound: (next: SidebarItemId) => void;
  showNotification: (kind: NotificationKind, message: string) => void;
  tt: Tt;
};

export function useLauncherSettings({
  settings,
  setSettings,
  setLanguage,
  setActiveItem,
  setActiveItemWithSound,
  showNotification,
  tt,
}: UseLauncherSettingsOptions) {
  const [systemMemoryGb, setSystemMemoryGb] = useState<number>(16);
  const didApplyStartPageRef = useRef(false);
  const languageHydratedRef = useRef(false);
  const settingsRef = useRef<Settings | null>(null);
  const settingsSaveGenRef = useRef(0);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSavePendingRef = useRef(false);

  useEffect(() => {
    if (!settings || languageHydratedRef.current) return;
    languageHydratedRef.current = true;

    let lang: Language | null = readStoredLanguage();

    if (!lang && settings.interface_language && isLanguage(settings.interface_language)) {
      lang = settings.interface_language;
    }

    if (!lang) {
      const browserLang =
        typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "ru";
      if (browserLang.startsWith("de")) lang = "de";
      else if (browserLang.startsWith("es")) lang = "es";
      else if (browserLang.startsWith("en")) lang = "en";
      else lang = "ru";
    }

    setLanguage(lang);

    let onboardingAlreadyDone = !!settings.onboarding_completed;
    try {
      if (window.localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "1") {
        onboardingAlreadyDone = true;
      }
    } catch {
    }

    if (onboardingAlreadyDone) {
      try {
        window.localStorage.setItem("launcher_language", lang);
      } catch {
      }
    }

    if (settings.interface_language !== lang) {
      const synced = { ...settings, interface_language: lang };
      setSettings(synced);
      void invoke("set_settings", { settings: synced }).catch(() => {});
    }
  }, [settings]);

  const showSettingsSavedNotification = useCallback(() => {
    showNotification("success", tt("app.toast.settingsSaved"));
  }, [tt, showNotification]);

  const refreshSettings = useCallback(async (profileId?: string | null) => {
    if (settingsSavePendingRef.current) return;
    try {
      const loaded =
        profileId != null && profileId !== ""
          ? await invoke<Settings>("get_effective_settings", { profileId })
          : await invoke<Settings>("get_settings");
      if (settingsSavePendingRef.current) return;
      const s =
        loaded.background_accent_color?.trim().toLowerCase() === "#0b1530"
          ? { ...loaded, background_accent_color: "#4a22a8" }
          : loaded;
      const storedLang = readStoredLanguage();
      if (storedLang && storedLang !== s.interface_language) {
        const synced = { ...s, interface_language: storedLang };
        settingsRef.current = synced;
        setSettings(synced);
        void invoke("set_settings", { settings: synced }).catch(() => {});
        return;
      }
      settingsRef.current = s;
      setSettings(s);
    } catch (e) {
      console.error("Не удалось загрузить настройки:", e);
      settingsRef.current = DEFAULT_SETTINGS;
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (didApplyStartPageRef.current) return;
    setActiveItem(settings.open_launcher_on_profiles_tab ? "modpacks" : "play");
    didApplyStartPageRef.current = true;
  }, [settings]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>, profileId?: string | null) => {
      const gameFields = [
        "ram_mb",
        "show_console_on_launch",
        "close_launcher_on_game_start",
        "check_game_processes",
      ] as const;
      const hasGameField = gameFields.some((k) => k in patch && patch[k] !== undefined);
      const useProfile = profileId != null && profileId !== "" && hasGameField;

      let snapshotCurrent = DEFAULT_SETTINGS;
      let snapshotNext = DEFAULT_SETTINGS;

      setSettings((prev) => {
        snapshotCurrent = prev ?? DEFAULT_SETTINGS;
        snapshotNext = { ...snapshotCurrent, ...patch };
        settingsRef.current = snapshotNext;
        return snapshotNext;
      });

      if (patch.open_launcher_on_profiles_tab !== undefined) {
        setActiveItemWithSound(patch.open_launcher_on_profiles_tab ? "modpacks" : "play");
      }

      const languageOnly =
        Object.keys(patch).length === 1 && patch.interface_language !== undefined;

      try {
        if (useProfile) {
          const profilePatch: Record<string, unknown> = {};
          if (patch.ram_mb !== undefined) profilePatch.ram_mb = patch.ram_mb;
          if (patch.show_console_on_launch !== undefined)
            profilePatch.show_console_on_launch = patch.show_console_on_launch;
          if (patch.close_launcher_on_game_start !== undefined)
            profilePatch.close_launcher_on_game_start = patch.close_launcher_on_game_start;
          if (patch.check_game_processes !== undefined)
            profilePatch.check_game_processes = patch.check_game_processes;

          await invoke("update_profile_settings", { id: profileId, patch: profilePatch });

          const nonGamePatch = { ...patch };
          gameFields.forEach((k) => delete nonGamePatch[k]);
          if (Object.keys(nonGamePatch).length > 0) {
            settingsSavePendingRef.current = true;
            const gen = ++settingsSaveGenRef.current;
            const base = settingsRef.current ?? snapshotCurrent;
            await invoke("set_settings", {
              settings: { ...base, ...nonGamePatch },
            });
            if (gen === settingsSaveGenRef.current) {
              settingsSavePendingRef.current = false;
            }
          }
        } else {
          settingsSavePendingRef.current = true;
          const gen = ++settingsSaveGenRef.current;
          if (settingsSaveTimerRef.current != null) {
            clearTimeout(settingsSaveTimerRef.current);
          }
          await new Promise<void>((resolve) => {
            settingsSaveTimerRef.current = setTimeout(() => resolve(), 200);
          });
          if (gen !== settingsSaveGenRef.current) return;
          const toSave = settingsRef.current ?? snapshotNext;
          await invoke("set_settings", { settings: toSave });
          if (gen === settingsSaveGenRef.current) {
            settingsSavePendingRef.current = false;
          }
        }
        if (!languageOnly) {
          showSettingsSavedNotification();
        }
      } catch (e) {
        settingsSavePendingRef.current = false;
        console.error("Не удалось сохранить настройки:", e);
      }
    },
    [showSettingsSavedNotification, setActiveItemWithSound],
  );

  const persistInterfaceLanguage = useCallback(
    (lang: Language) => {
      setLanguage(lang);
      try {
        window.localStorage.setItem("launcher_language", lang);
      } catch {
      }
      setSettings((prev) => (prev ? { ...prev, interface_language: lang } : prev));
      void updateSettings({ interface_language: lang });
    },
    [updateSettings],
  );

  useEffect(() => {
    (async () => {
      await refreshSettings();
      try {
        const totalGb = await invoke<number>("get_system_memory_gb");
        if (typeof totalGb === "number" && Number.isFinite(totalGb) && totalGb >= 1) {
          setSystemMemoryGb(Math.max(1, Math.min(64, Math.round(totalGb))));
        } else {
          setSystemMemoryGb(16);
        }
      } catch {
        setSystemMemoryGb(16);
      }
    })();
  }, [refreshSettings]);

  return { systemMemoryGb, refreshSettings, updateSettings, persistInterfaceLanguage };
}
