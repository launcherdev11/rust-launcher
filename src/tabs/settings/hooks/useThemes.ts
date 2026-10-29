import type { NotificationKind } from "../../../app/notifications";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { confirmDialog } from "../../../lib/confirmDialog";
import { promptDialog } from "../../../lib/promptDialog";
import { errorMessage, type ThemeInfo } from "../../../lib/customTheme";
import { invoke } from "@tauri-apps/api/core";
import { isSeasonalThemePeriod } from "../../../lib/seasonalTheme";
import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { type Settings, type SettingsTabId } from "../../../app/types";

type ThemesDeps = {
  settingsTab: SettingsTabId;
  settings: Settings | null;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  updateSettings: (patch: Partial<Settings>) => void;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
};

export function useThemes(deps: ThemesDeps) {
  const {
    settingsTab,
    settings,
    tt,
    updateSettings,
    showNotification,
  } = deps;

  const [installedThemes, setInstalledThemes] = useState<ThemeInfo[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);

  const refreshThemes = useCallback(async () => {
    setThemesLoading(true);
    try {
      const list = await invoke<ThemeInfo[]>("list_themes");
      setInstalledThemes(list);
    } catch (e) {
      console.error(e);
    } finally {
      setThemesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settingsTab === "launcher") {
      void refreshThemes();
    }
  }, [settingsTab, refreshThemes]);

  const activeThemeId = settings?.custom_theme_id ?? null;

  const activeTheme = useMemo(
    () => installedThemes.find((theme) => theme.id === activeThemeId) ?? null,
    [installedThemes, activeThemeId],
  );

  const seasonalThemeActive = isSeasonalThemePeriod();

  const importThemeZip = async () => {
    try {
      const path = await openFile({
        multiple: false,
        directory: false,
        filters: [{ name: tt("settings.launcher.customThemes.zipFilterName"), extensions: ["zip"] }],
      });
      if (!path) return;
      const imported = await invoke<ThemeInfo>("import_theme_zip", { sourcePath: path });
      await refreshThemes();
      updateSettings({ custom_theme_id: imported.id });
      showNotification(
        "success",
        tt("settings.launcher.customThemes.imported", { name: imported.name }),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.importFailed")),
      );
    }
  };

  const createTheme = async () => {
    const name = await promptDialog({
      title: tt("settings.launcher.customThemes.create"),
      label: tt("settings.launcher.customThemes.createPrompt"),
      confirmLabel: tt("settings.launcher.customThemes.create"),
    });
    if (!name) return;
    try {
      const created = await invoke<ThemeInfo>("create_empty_theme", { name });
      await refreshThemes();
      updateSettings({ custom_theme_id: created.id });
      setEditingThemeId(created.id);
      showNotification(
        "success",
        tt("settings.launcher.customThemes.created", { name: created.name }),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.createFailed")),
      );
    }
  };

  const openThemesFolder = async () => {
    try {
      await invoke("open_themes_folder");
    } catch (e) {
      console.error(e);
      showNotification("error", tt("settings.launcher.customThemes.openFolderFailed"));
    }
  };

  const openActiveThemeCss = async () => {
    if (!activeThemeId) return;
    try {
      await invoke("open_theme_css_file", { themeId: activeThemeId });
    } catch (e) {
      console.error(e);
      showNotification("error", tt("settings.launcher.customThemes.editCssFailed"));
    }
  };

  const duplicateActiveTheme = async () => {
    if (!activeThemeId) return;
    const name = await promptDialog({
      title: tt("settings.launcher.customThemes.duplicateTitle"),
      label: tt("settings.launcher.customThemes.duplicatePrompt"),
      defaultValue: tt("settings.launcher.customThemes.duplicateDefault", {
        name: activeTheme?.name ?? activeThemeId,
      }),
      confirmLabel: tt("settings.launcher.customThemes.duplicate"),
    });
    if (!name) return;
    try {
      const copy = await invoke<ThemeInfo>("duplicate_theme", {
        themeId: activeThemeId,
        name,
      });
      await refreshThemes();
      updateSettings({ custom_theme_id: copy.id });
      showNotification(
        "success",
        tt("settings.launcher.customThemes.duplicated", { name: copy.name }),
      );
    } catch (e) {
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.duplicateFailed")),
      );
    }
  };

  const exportActiveTheme = async () => {
    if (!activeThemeId) return;
    try {
      const dest = await saveFile({
        defaultPath: `${activeThemeId}.zip`,
        filters: [{ name: tt("settings.launcher.customThemes.zipFilterName"), extensions: ["zip"] }],
      });
      if (!dest) return;
      await invoke("export_theme_zip", { themeId: activeThemeId, destPath: dest });
      showNotification("success", tt("settings.launcher.customThemes.exported"));
    } catch (e) {
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.exportFailed")),
      );
    }
  };

  const deleteActiveTheme = async () => {
    if (!activeThemeId) return;
    const themeName = activeTheme?.name ?? activeThemeId;
    const ok = await confirmDialog({
      message: tt("settings.launcher.customThemes.deleteConfirm", { name: themeName }),
      confirmLabel: tt("common.delete"),
    });
    if (!ok) return;
    try {
      setEditingThemeId(null);
      await invoke("delete_theme", { themeId: activeThemeId });
      await refreshThemes();
      updateSettings({ custom_theme_id: null });
      showNotification(
        "success",
        tt("settings.launcher.customThemes.deleted", { name: themeName }),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        errorMessage(e, tt("settings.launcher.customThemes.deleteFailed")),
      );
    }
  };

  return {
    installedThemes,
    themesLoading,
    editingThemeId,
    setEditingThemeId,
    refreshThemes,
    activeThemeId,
    activeTheme,
    seasonalThemeActive,
    importThemeZip,
    createTheme,
    openThemesFolder,
    openActiveThemeCss,
    duplicateActiveTheme,
    exportActiveTheme,
    deleteActiveTheme,
  };
}
