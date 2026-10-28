import type { NotificationKind } from "../../../app/notifications";
import type { Language } from "../../../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearLauncherAvatarCache } from "../../../lib/avatar";
import { confirmDialog } from "../../../lib/confirmDialog";
import { type Settings, type SettingsTabId } from "../../../app/types";
import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { type LauncherSettingsBackupV1, type SidebarItemId } from "../types";
import { ONBOARDING_COMPLETED_STORAGE_KEY, ONBOARDING_LEGACY_MIGRATED_KEY } from "../../../onboarding/constants";
import { PRODUCT_TOUR_COMPLETED_STORAGE_KEY } from "../../../product-tour/constants";

type SettingsMaintenanceDeps = {
  settingsTab: SettingsTabId;
  language: Language;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setSidebarOrder: (order: SidebarItemId[]) => void;
  sidebarOrder: ("settings" | "play" | "mods" | "modpacks")[];
};

export function useSettingsMaintenance(deps: SettingsMaintenanceDeps) {
  const {
    settingsTab,
    language,
    tt,
    showNotification,
    updateSettings,
    setSidebarOrder,
    sidebarOrder,
  } = deps;

  const [cacheSizeBytes, setCacheSizeBytes] = useState<number | null>(null);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [isResettingSettings, setIsResettingSettings] = useState(false);

  useEffect(() => {
    if (settingsTab !== "launcher") return;
    let cancelled = false;
    setIsCacheLoading(true);
    invoke<number>("get_launcher_cache_size")
      .then((bytes) => {
        if (!cancelled) {
          setCacheSizeBytes(bytes);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCacheSizeBytes(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCacheLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settingsTab, language]);

  const formatCacheSize = (bytes: number | null): string => {
    if (bytes == null) {
      return tt("settings.launcher.cache.sizeUnknown");
    }
    if (bytes < 1024) {
      return tt("settings.launcher.cache.bytes", { value: bytes });
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
      return tt("settings.launcher.cache.kb", { value: Math.round(kb) });
    }
    const mb = kb / 1024;
    if (mb < 1024) {
      return tt("settings.launcher.cache.mb", { value: Math.round(mb * 10) / 10 });
    }
    const gb = mb / 1024;
    return tt("settings.launcher.cache.gb", { value: Math.round(gb * 10) / 10 });
  };

  const handleClearCache = async () => {
    setIsCacheLoading(true);
    try {
      await invoke("clear_launcher_cache");
      clearLauncherAvatarCache();
      const next = await invoke<number>("get_launcher_cache_size").catch(() => null);
      setCacheSizeBytes(next ?? 0);
      showNotification(
        "success",
        tt("settings.launcher.cache.cleared"),
      );
    } catch {
      showNotification(
        "error",
        tt("settings.launcher.cache.clearFailed"),
      );
    } finally {
      setIsCacheLoading(false);
    }
  };

  const handleResetSettings = async () => {
    const ok = await confirmDialog({
      message: tt("settings.launcher.resetSettings.confirm"),
      confirmLabel: tt("settings.launcher.resetSettings.button"),
    });
    if (!ok) return;
    setIsResettingSettings(true);
    try {
      try {
        await invoke("set_background_image", { sourcePath: null as string | null });
      } catch {
      }
      const defaults = await invoke<Settings>("reset_settings_to_default");
      updateSettings(defaults);
      setSidebarOrder(["play", "settings", "mods", "modpacks"]);
      try {
        window.localStorage.removeItem("sidebar_order");
        window.localStorage.removeItem(ONBOARDING_COMPLETED_STORAGE_KEY);
        window.localStorage.removeItem(ONBOARDING_LEGACY_MIGRATED_KEY);
        window.localStorage.removeItem(PRODUCT_TOUR_COMPLETED_STORAGE_KEY);
      } catch {
      }
      showNotification(
        "success",
        tt("settings.launcher.resetSettings.success"),
      );
    } catch {
      showNotification(
        "error",
        tt("settings.launcher.resetSettings.failed"),
      );
    } finally {
      setIsResettingSettings(false);
    }
  };

  const [isImportingSettings, setIsImportingSettings] = useState(false);
  const [isExportingSettings, setIsExportingSettings] = useState(false);

  const handleExportSettings = async () => {
    setIsExportingSettings(true);
    try {
      const path = await saveFile({
        title: tt("settings.launcher.backup.exportDialogTitle"),
        defaultPath: "16launcher-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      await invoke<string>("export_launcher_settings_backup", {
        path,
        sidebarOrder: sidebarOrder,
      });
      showNotification("success", tt("settings.launcher.backup.exportSuccess"), { sound: true });
    } catch (e) {
      console.error(e);
      showNotification("error", tt("settings.launcher.backup.exportFailed"));
    } finally {
      setIsExportingSettings(false);
    }
  };

  const handleImportSettings = async () => {
    setIsImportingSettings(true);
    try {
      const path = await openFile({
        title: tt("settings.launcher.backup.importDialogTitle"),
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      const backup = await invoke<LauncherSettingsBackupV1>("import_launcher_settings_backup", {
        path,
      });
      if (backup?.settings) {
        updateSettings(backup.settings);
      }
      const so = backup?.sidebar_order ?? null;
      if (Array.isArray(so) && so.length > 0) {
        const normalized = so
          .filter(
            (x): x is SidebarItemId =>
              x === "play" ||
              x === "settings" ||
              x === "mods" ||
              x === "modpacks",
          );
        if (normalized.length > 0) {
          setSidebarOrder(normalized);
          try {
            window.localStorage.setItem("sidebar_order", JSON.stringify(normalized));
          } catch {
          }
        }
      }
      showNotification("success", tt("settings.launcher.backup.importSuccess"), { sound: true });
    } catch (e) {
      console.error(e);
      showNotification("error", tt("settings.launcher.backup.importFailed"));
    } finally {
      setIsImportingSettings(false);
    }
  };

  return {
    cacheSizeBytes,
    isCacheLoading,
    isResettingSettings,
    formatCacheSize,
    handleClearCache,
    handleResetSettings,
    isImportingSettings,
    isExportingSettings,
    handleExportSettings,
    handleImportSettings,
  };
}
