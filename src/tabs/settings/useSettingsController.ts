import { useT } from "../../i18n";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type SidebarItemId,
} from "./types";
import {
  type SettingsTabId,
} from "../../app/types";
import { invoke } from "@tauri-apps/api/core";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { useSettingsSearch } from "./hooks/useSettingsSearch";
import { useRamResolution } from "./hooks/useRamResolution";
import { useAccentPicker } from "./hooks/useAccentPicker";
import { useThemes } from "./hooks/useThemes";
import { useSettingsMaintenance } from "./hooks/useSettingsMaintenance";
import { useVersionsManager } from "./hooks/useVersionsManager";
import type { SettingsTabProps } from "./types";

export function useSettingsController(props: SettingsTabProps) {
  const {
  settings,
  settingsTab,
  setSettingsTab,
  systemMemoryGb,
  updateSettings,
  showNotification,
  language,
  setLanguage,
  sidebarOrder,
  setSidebarOrder,
  updateStatus = "idle",
  updateVersion = null,
  updateDownloadPercent = null,
  onCheckUpdate,
  onPreviewUpdatePopup,
  onInstallUpdate,
  fillPane = false,
  } = props;

  const {
    accentInput,
    setAccentInput,
    isAccentPickerOpen,
    setIsAccentPickerOpen,
    accentHueWheelRef,
    accentSvPadRef,
    accentPickerRef,
    accentColorHsv,
    handleAccentWheelPointerDown,
    handleAccentWheelPointerMove,
    handleAccentWheelPointerEnd,
    handleAccentSvPointerDown,
    handleAccentSvPointerMove,
    handleAccentSvPointerEnd,
    accentColor,
    applyAccentColor,
  } = useAccentPicker({
    settings,
    updateSettings,
  });
  const tt = useT(language);

  const {
    settingsSearch,
    setSettingsSearch,
    settingsSearchActive,
    showSetting,
    searchHasAnyMatches,
    searchHasMatchesOnTab,
    tabMatchCounts,
    anyVisible,
  } = useSettingsSearch({
    tt,
    language,
    settingsTab,
    setSettingsTab,
  });

  const {
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
  } = useThemes({
    settingsTab,
    settings,
    tt,
    updateSettings,
    showNotification,
  });

  const {
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
  } = useSettingsMaintenance({
    settingsTab,
    language,
    tt,
    showNotification,
    updateSettings,
    setSidebarOrder,
    sidebarOrder,
  });

  const {
    availableVersions,
    isLoadingVersions,
    installingVersionId,
    checkingVersionId,
    versionsLoader,
    setVersionsLoader,
    isVersionFilterDropdownOpen,
    setIsVersionFilterDropdownOpen,
    versionFilterQuery,
    setVersionFilterQuery,
    selectedVersionFilterId,
    setSelectedVersionFilterId,
    repairPrompt,
    setRepairPrompt,
    reinstallDialog,
    setReinstallDialog,
    deleteDialog,
    setDeleteDialog,
    simpleDeleteDialog,
    setSimpleDeleteDialog,
    reinstallLoaderOptions,
    reinstallLoaderLoading,
    deletingVersionId,
    skipRepairPrompt,
    downloadProgress,
    installLogLines,
    installLogEndRef,
    versionsFilterDropdownRef,
    versionFilterInputRef,
    versionFilterListRef,
    selectedVersionFilterButtonRef,
    versionFilterOptions,
    selectedVersionFilterLabel,
    filteredAvailableVersions,
    handleImportCustomVersion,
    handleInstallVersion,
    handleCheckVersionFiles,
    openReinstallDialog,
    confirmReinstall,
    performDelete,
    openDeleteFlow,
    isVersionInstalled,
    handleSkipRepairPromptToggle,
    refreshVersionsList,
  } = useVersionsManager({
    tt,
    settings,
    settingsTab,
    showNotification,
    language,
  });

  const settingsTabRefs = useRef<
    Partial<Record<SettingsTabId, HTMLButtonElement | null>>
  >({});

  const [settingsIndicator, setSettingsIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    let raf = 0;
    let cancelled = false;

    const updateIndicator = () => {
      if (cancelled) return;
      const el = settingsTabRefs.current[settingsTab];
      if (el) {
        setSettingsIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateIndicator);
    };

    updateIndicator();
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [settingsTab, settingsSearch, language]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        versionsFilterDropdownRef.current &&
        !versionsFilterDropdownRef.current.contains(target)
      ) {
        setIsVersionFilterDropdownOpen(false);
      }
      if (accentPickerRef.current && !accentPickerRef.current.contains(target)) {
        setIsAccentPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const moveSidebarItem = (id: SidebarItemId, direction: "up" | "down") => {
    const current = sidebarOrder;
    const idx = current.indexOf(id);
    if (idx === -1) return;
    const next = current.slice();
    if (direction === "up" && idx > 0) {
      const tmp = next[idx - 1];
      next[idx - 1] = next[idx];
      next[idx] = tmp;
    } else if (direction === "down" && idx < next.length - 1) {
      const tmp = next[idx + 1];
      next[idx + 1] = next[idx];
      next[idx] = tmp;
    } else {
      return;
    }
    setSidebarOrder(next);
    try {
      window.localStorage.setItem("sidebar_order", JSON.stringify(next));
    } catch {
      //ignore
    }
  };

  const label = (key: string) => tt(key).replace(/\s*:\s*$/, "");

  const {
    isRamEditing,
    setIsRamEditing,
    ramInputMb,
    setRamInputMb,
    ramInputRef,
    currentRamGbRounded,
    ramMinMb,
    ramMaxMb,
    ramSliderMaxGb,
    ramSliderLocal,
    setRamSliderLocal,
    displayRamGb,
    commitRamMb,
    cancelRamEditing,
    resolutionWidthInput,
    setResolutionWidthInput,
    resolutionHeightInput,
    setResolutionHeightInput,
    commitResolution,
    resetResolutionInputs,
    graphicsAdapterOptions,
  } = useRamResolution({
    settings,
    systemMemoryGb,
    updateSettings,
    label,
    tt,
  });

  const chooseGameDirectory = async () => {
    try {
      const path = await openFile({ multiple: false, directory: true });
      if (typeof path === "string" && path.trim()) {
        updateSettings({ game_directory: path });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const chooseBackgroundImage = async () => {
    try {
      const path = await openFile({
        multiple: false,
        directory: false,
        filters: [
          {
            name: tt("settings.common.imagesFilterName"),
            extensions: ["png", "jpg", "jpeg", "webp", "gif"],
          },
        ],
      });
      if (!path) return;
      const stored = await invoke<string | null>("set_background_image", { sourcePath: path });
      updateSettings({ background_image_url: stored });
    } catch (e) {
      console.error(e);
    }
  };

  const resetBackgroundImage = async () => {
    try {
      await invoke("set_background_image", { sourcePath: null });
      updateSettings({ background_image_url: null });
    } catch (e) {
      console.error(e);
    }
  };

  const updateStatusText = (() => {
    switch (updateStatus) {
      case "checking":
        return tt("settings.updates.checking");
      case "downloading":
        return tt("settings.updates.downloading", { percent: updateDownloadPercent ?? 0 });
      case "installing":
        return tt("settings.updates.installing");
      case "available":
        return updateVersion
          ? tt("settings.updates.available", { version: updateVersion })
          : tt("settings.updates.idle");
      case "up-to-date":
        return tt("settings.updates.upToDate");
      case "error":
        return tt("settings.updates.checkFailed");
      default:
        return tt("settings.updates.idle");
    }
  })();

  const sidebarItemLabel = (id: SidebarItemId) =>
    tt(
      id === "play"
        ? "app.sidebar.play"
        : id === "settings"
          ? "app.sidebar.settings"
          : id === "mods"
            ? "app.sidebar.mods"
            : "app.sidebar.modpacks",
    );

  const settingsTabs: { id: SettingsTabId; label: string; icon: string }[] = [
    { id: "game", label: tt("settings.tab.game"), icon: "play" },
    { id: "versions", label: tt("settings.tab.versions"), icon: "versions" },
    { id: "launcher", label: tt("settings.tab.launcher"), icon: "settings" },
  ];

  const numberInputClass =
    "glass-control no-number-spin h-9 w-24 px-3 text-sm text-white/90 outline-none placeholder:text-white/35";

  return {
    settings,
    settingsTab,
    setSettingsTab,
    systemMemoryGb,
    updateSettings,
    showNotification,
    language,
    setLanguage,
    sidebarOrder,
    updateStatus,
    updateDownloadPercent,
    onCheckUpdate,
    onPreviewUpdatePopup,
    onInstallUpdate,
    fillPane,
    tt,
    settingsSearch,
    setSettingsSearch,
    installedThemes,
    themesLoading,
    editingThemeId,
    setEditingThemeId,
    isRamEditing,
    setIsRamEditing,
    ramInputMb,
    setRamInputMb,
    ramInputRef,
    availableVersions,
    isLoadingVersions,
    installingVersionId,
    checkingVersionId,
    versionsLoader,
    setVersionsLoader,
    isVersionFilterDropdownOpen,
    setIsVersionFilterDropdownOpen,
    versionFilterQuery,
    setVersionFilterQuery,
    selectedVersionFilterId,
    setSelectedVersionFilterId,
    repairPrompt,
    setRepairPrompt,
    reinstallDialog,
    setReinstallDialog,
    deleteDialog,
    setDeleteDialog,
    simpleDeleteDialog,
    setSimpleDeleteDialog,
    reinstallLoaderOptions,
    reinstallLoaderLoading,
    deletingVersionId,
    skipRepairPrompt,
    downloadProgress,
    installLogLines,
    installLogEndRef,
    settingsTabRefs,
    settingsIndicator,
    accentInput,
    setAccentInput,
    isAccentPickerOpen,
    setIsAccentPickerOpen,
    accentHueWheelRef,
    accentSvPadRef,
    cacheSizeBytes,
    isCacheLoading,
    isResettingSettings,
    accentPickerRef,
    versionsFilterDropdownRef,
    versionFilterInputRef,
    versionFilterListRef,
    selectedVersionFilterButtonRef,
    versionFilterOptions,
    selectedVersionFilterLabel,
    filteredAvailableVersions,
    refreshThemes,
    activeThemeId,
    activeTheme,
    accentColorHsv,
    handleAccentWheelPointerDown,
    handleAccentWheelPointerMove,
    handleAccentWheelPointerEnd,
    handleAccentSvPointerDown,
    handleAccentSvPointerMove,
    handleAccentSvPointerEnd,
    currentRamGbRounded,
    ramMinMb,
    ramMaxMb,
    ramSliderMaxGb,
    ramSliderLocal,
    setRamSliderLocal,
    displayRamGb,
    handleImportCustomVersion,
    handleInstallVersion,
    handleCheckVersionFiles,
    openReinstallDialog,
    confirmReinstall,
    performDelete,
    openDeleteFlow,
    isVersionInstalled,
    handleSkipRepairPromptToggle,
    commitRamMb,
    cancelRamEditing,
    resolutionWidthInput,
    setResolutionWidthInput,
    resolutionHeightInput,
    setResolutionHeightInput,
    commitResolution,
    formatCacheSize,
    handleClearCache,
    handleResetSettings,
    isImportingSettings,
    isExportingSettings,
    handleExportSettings,
    handleImportSettings,
    moveSidebarItem,
    settingsSearchActive,
    showSetting,
    searchHasAnyMatches,
    searchHasMatchesOnTab,
    tabMatchCounts,
    anyVisible,
    label,
    accentColor,
    seasonalThemeActive,
    applyAccentColor,
    resetResolutionInputs,
    refreshVersionsList,
    chooseGameDirectory,
    chooseBackgroundImage,
    resetBackgroundImage,
    importThemeZip,
    createTheme,
    openThemesFolder,
    openActiveThemeCss,
    duplicateActiveTheme,
    exportActiveTheme,
    deleteActiveTheme,
    updateStatusText,
    graphicsAdapterOptions,
    sidebarItemLabel,
    settingsTabs,
    numberInputClass,
  };
}

export type SettingsController = ReturnType<typeof useSettingsController>;
