import {
  t,
  useT,
} from "../../i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ContentTab,
  type EditorSection,
  type InstanceProfile,
  type LastPlayedUpdatedPayload,
  type PlaytimeUpdatedPayload,
  type ViewId,
} from "./types";
import { type ProfileInfoData } from "../../components/profile_info_modal";
import { useMarqueeSelection } from "../../hooks/useMarqueeSelection";
import {
  CONTENT_TAB_KEYS,
} from "./helpers";
import { invoke } from "@tauri-apps/api/core";
import { readDataCache, scheduleIdleWork, writeDataCache } from "../../lib/launcherDataCache";
import { listen } from "@tauri-apps/api/event";
import { HOTKEY_REFRESH_EVENT } from "../../hooks/useHotkeys";
import { useManageLayout } from "./hooks/useManageLayout";
import { useManageConsole } from "./hooks/useManageConsole";
import { useCreateProfileForm } from "./hooks/useCreateProfileForm";
import { useProfileSettings } from "./hooks/useProfileSettings";
import { useProfileItems } from "./hooks/useProfileItems";
import { useContentUpdates } from "./hooks/useContentUpdates";
import { useExportFlow } from "./hooks/useExportFlow";
import { useProfileBackups } from "./hooks/useProfileBackups";
import { useVersionMigration } from "./hooks/useVersionMigration";
import { useExternalImport } from "./hooks/useExternalImport";
import { useBuildPresets } from "./hooks/useBuildPresets";
import { useLazyMods } from "./hooks/useLazyMods";
import { useProfileWorldsDisk } from "./hooks/useProfileWorldsDisk";
import { useResourcePackReorder } from "./hooks/useResourcePackReorder";
import { useMrpackImport } from "./hooks/useMrpackImport";
import { useProfileConflicts } from "./hooks/useProfileConflicts";
import { useProfileGroups } from "./hooks/useProfileGroups";
import { useProfileActions } from "./hooks/useProfileActions";
import type { ModpackTabProps } from "./types";

export function useModpackController(props: ModpackTabProps) {
  const {
  language,
  showNotification,
  onProfileSelectionChange,
  initialSelectedProfileId,
  initialProfiles,
  onOpenModsTab,
  onPlaySelectedProfile,
  primaryLabel,
  primaryColorClasses = "accent-bg hover:opacity-90",
  isLaunching = false,
  isStopping = false,
  onProfilesChange,
  onTogglePinInSidebar,
  isPinnedInSidebar,
  gameStatus = "idle",
  consoleLines = [],
  consoleHistorySessions = [],
  onClearConsole,
  prepareInstallConsole,
  openedMrpackPath = null,
  onOpenedMrpackPathConsumed,
  fillPane = false,
  registerDownloadJob,
  updateDownloadJob,
  finishDownloadJob,
  makeDownloadJobId,
  onRegisterModpackHotkeys,
  onActiveViewChange,
  onRegisterModpackNavigation,
  requestedModpackView,
  onRequestedModpackViewApplied,
  requestedProfileSettingsId,
  onRequestedProfileSettingsApplied,
  onManageConsoleExpandedChange,
  } = props;

  const tt = useT(language);

  const [profiles, setProfiles] = useState<InstanceProfile[]>(() => initialProfiles ?? []);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(() => {
    if (typeof window === "undefined") return initialSelectedProfileId ?? null;
    try {
      const saved = window.localStorage.getItem("modpacks_selected_profile_id");
      if (saved && saved.trim().length > 0) {
        return saved;
      }
    } catch {
    }
    return initialSelectedProfileId ?? null;
  });

  const [activeView, setActiveView] = useState<ViewId>("list");

  const {
    uiScale,
    manageZoomed,
    scaledRootRef,
    scaledHostSize,
    manageMainWidthFrac,
    isManageSplitDragging,
    manageSplitRowRef,
    manageSplitHandleRef,
    onManageSplitPointerDown,
  } = useManageLayout({
    activeView,
  });

  const {
    manageConsoleExpanded,
    setManageConsoleExpanded,
    selectedLogSessionId,
    setSelectedLogSessionId,
    isCopyingConsole,
    isConsoleCopied,
    displayedConsoleLines,
    consoleFilters,
    toggleConsoleFilter,
    visibleConsoleLines,
    consoleFilterCounts,
    manageConsoleStatusDotClass,
    handleCopyManageConsole,
    formatLogSessionOptionLabel,
  } = useManageConsole({
    activeView,
    onManageConsoleExpandedChange,
    consoleHistorySessions,
    consoleLines,
    gameStatus,
    language,
  });

  const {
    createName,
    setCreateName,
    createNameUserEdited,
    createLoader,
    setCreateLoader,
    createGameVersion,
    setCreateGameVersion,
    createLoaderVersion,
    setCreateLoaderVersion,
    loaderVersionOptions,
    setLoaderVersionOptions,
    loaderVersionsLoading,
    isLoaderVersionDropdownOpen,
    setIsLoaderVersionDropdownOpen,
    createAllVersions,
    setCreateAllVersions,
    createIconPath,
    setCreateIconPath,
    createBusy,
    setCreateBusy,
    versionOptions,
    setVersionOptions,
    versionsLoading,
    isVersionDropdownOpen,
    setIsVersionDropdownOpen,
    ensureVersionsLoaded,
    loadCreateLoaderVersions,
    selectedLoaderVersionOption,
    loaderChannelLabel,
    handleChooseIcon,
  } = useCreateProfileForm({
    showNotification,
    language,
    tt,
    activeView,
  });

  const [contentTab, setContentTab] = useState<ContentTab>("mods");
  const [loadingProfiles, setLoadingProfiles] = useState(() => !(initialProfiles && initialProfiles.length > 0));
  const profilesLoadedRef = useRef(false);
  const onProfilesChangeRef = useRef(onProfilesChange);

  onProfilesChangeRef.current = onProfilesChange;

  const [search, setSearch] = useState("");

  const {
    buildPresets,
    buildPresetsLoading,
    createSelectedPresetId,
    isPresetsModalOpen,
    setIsPresetsModalOpen,
    presetIconUris,
    selectedCreatePreset,
    refreshBuildPresets,
    applyBuildPresetToCreateForm,
    clearCreatePresetSelection,
    handleSaveBuildPresetFromForm,
    handleSaveBuildPresetFromProfile,
    handleDeleteBuildPreset,
  } = useBuildPresets({
    setCreateLoader,
    setCreateGameVersion,
    setCreateLoaderVersion,
    setLoaderVersionOptions,
    tt,
    createName,
    createLoader,
    createLoaderVersion,
    showNotification,
    createGameVersion,
    createIconPath,
  });

  const lazy = useLazyMods({ showNotification, tt });

  const [profileIconRevisions, setProfileIconRevisions] = useState<Record<string, number>>({});

  const [contentUpdatesAvailableFilenames, setContentUpdatesAvailableFilenames] = useState<
    Set<string>

  >(new Set());

  const [contentUpdatesAvailabilityLoading, setContentUpdatesAvailabilityLoading] =
    useState(false);

  const [profilesLayout, setProfilesLayout] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    try {
      const saved = window.localStorage.getItem("modpacks_profiles_layout");
      return saved === "grid" || saved === "list" ? saved : "list";
    } catch {
      return "list";
    }
  });

  const [contextMenu, setContextMenu] = useState<{
    profileId: string;
    x: number;
    y: number;
  } | null>(null);

  const [listContextMenu, setListContextMenu] = useState<{ x: number; y: number } | null>(null);

  const [groupContextMenu, setGroupContextMenu] = useState<{
    groupId: string;
    x: number;
    y: number;
  } | null>(null);

  const [multiSelectedProfileIds, setMultiSelectedProfileIds] = useState<Set<string>>(new Set());
  const profilesScrollRef = useRef<HTMLDivElement | null>(null);
  const [profileConflictsRefreshToken, setProfileConflictsRefreshToken] = useState(0);
  const [editorSection, setEditorSection] = useState<EditorSection>("content");

  const {
    isProfileSettingsOpen,
    profileSettingsTab,
    setProfileSettingsTab,
    profileEffectiveSettings,
    setProfileEffectiveSettings,
    profileResolutionWidth,
    setProfileResolutionWidth,
    profileResolutionHeight,
    setProfileResolutionHeight,
    systemMemoryGb,
    loadProfileLaunchSettings,
    openProfileSettings,
    patchProfileGameSettings,
    commitProfileResolution,
    scheduleProfileRamSave,
    commitProfileRamSaveNow,
    closeProfileSettingsModal,
  } = useProfileSettings({
    setSelectedProfileId,
    setActiveView,
    setEditorSection,
    showNotification,
    tt,
  });

  const {
    backupsModalProfileId,
    setBackupsModalProfileId,
    backupsList,
    backupsLoading,
    backupCreating,
    backupRestoringId,
    loadBackupsList,
    openBackupsModal,
    handleCreateBackup,
    handleRestoreBackup,
    handleDeleteBackup,
  } = useProfileBackups({
    showNotification,
    tt,
    editorSection,
    selectedProfileId,
    refreshProfiles,
    setSelectedProfileId,
    setActiveView,
  });

  const [isManageMoreOpen, setIsManageMoreOpen] = useState(false);
  const [isScreenshotsOpen, setIsScreenshotsOpen] = useState(false);
  const [profileInfoProfile, setProfileInfoProfile] = useState<ProfileInfoData | null>(null);

  const handleProfilesMarqueePointerDown = useMarqueeSelection({
    containerRef: profilesScrollRef,
    selected: multiSelectedProfileIds,
    onChange: setMultiSelectedProfileIds,
  });

  useEffect(() => {
    setSelectedLogSessionId("live");
  }, [selectedProfileId]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const {
    items,
    setItems,
    itemsLoading,
    itemMetadataByFilename,
    isAddMenuOpen,
    setIsAddMenuOpen,
    itemsSearch,
    setItemsSearch,
    contentFilter,
    setContentFilter,
    selectedContentNames,
    setSelectedContentNames,
    manageDropZoneRef,
    isManageDropTarget,
    handleContentMarqueePointerDown,
    refreshItems,
    handleAddFilesFromPc,
    handleDeleteItem,
    handleToggleItemEnabled,
    toggleContentSelected,
    handleContentRowClick,
    handleBulkSetEnabled,
    handleBulkDelete,
  } = useProfileItems({
    selectedProfileId,
    activeView,
    contentTab,
    showNotification,
    language,
    selectedProfile,
    isProfileSettingsOpen,
    setProfileConflictsRefreshToken,
    tt,
    refreshProfiles,
    setContentUpdatesAvailableFilenames,
    setContentUpdatesAvailabilityLoading,
  });

  const {
    contentUpdates,
    contentUpdatesChecking,
    contentUpdatesApplying,
    contentUpdatesSingleApplyingFilename,
    isContentUpdatesModalOpen,
    setIsContentUpdatesModalOpen,
    selectedContentUpdateFilenames,
    setSelectedContentUpdateFilenames,
    applyContentUpdatesAfterVersionChange,
    handleCheckContentUpdates,
    handleApplyContentUpdates,
    handleUpdateSingleItem,
  } = useContentUpdates({
    selectedProfile,
    contentTab,
    setContentUpdatesAvailableFilenames,
    showNotification,
    tt,
    refreshItems,
  });

  const {
    isExportOpen,
    setIsExportOpen,
    exportFormat,
    setExportFormat,
    exportTree,
    exportTreeLoading,
    setSelectedExportPaths,
    ignorePatternsText,
    setIgnorePatternsText,
    previewLoading,
    previewResult,
    exportBusy,
    exportProgress,
    exportResultPath,
    exportSkippedFiles,
    exportResolvedCount,
    exportOverrideCount,
    exportSpeedLabel,
    collapsedExportPaths,
    setCollapsedExportPaths,
    exportSearchQuery,
    setExportSearchQuery,
    exportFormatTabRefs,
    exportFormatIndicator,
    isExportPathSelected,
    getFolderCheckState,
    setExportNodeChecked,
    applyExportPreset,
    loadExportTree,
    openExportModal,
    handlePreviewExport,
    handleStartExport,
    filteredExportTree,
    exportSelectionStats,
    exportQuickNodes,
  } = useExportFlow({
    showNotification,
    tt,
    selectedProfile,
    language,
  });

  const {
    backupBeforeVersionChange,
    setBackupBeforeVersionChange,
    isChangeVersionOpen,
    migrateGameVersion,
    setMigrateGameVersion,
    migrateLoaderVersion,
    setMigrateLoaderVersion,
    migrateLoaderVersionOptions,
    migrateLoaderVersionsLoading,
    migrateBusy,
    isMigrateVersionDropdownOpen,
    setIsMigrateVersionDropdownOpen,
    isMigrateLoaderVersionDropdownOpen,
    setIsMigrateLoaderVersionDropdownOpen,
    migrateAllVersions,
    setMigrateAllVersions,
    migrateVersionOptions,
    migrateVersionsLoading,
    ensureMigrateVersionsLoaded,
    loadMigrateLoaderVersions,
    openChangeVersionModal,
    closeChangeVersionModal,
    handleChangeProfileVersion,
  } = useVersionMigration({
    selectedProfile,
    showNotification,
    language,
    prepareInstallConsole,
    selectedProfileId,
    setSelectedLogSessionId,
    setManageConsoleExpanded,
    registerDownloadJob,
    finishDownloadJob,
    tt,
    applyContentUpdatesAfterVersionChange,
    setProfiles,
    onProfilesChange,
    onProfileSelectionChange,
    refreshItems,
    contentTab,
  });

  const {
    externalImportLauncher,
    setExternalImportLauncher,
    externalImportPath,
    setExternalImportPath,
    externalImportBusy,
    externalImportProgress,
    setExternalImportProgress,
    externalImportScanBusy,
    externalImportScanError,
    setExternalImportScanError,
    externalImportInstances,
    setExternalImportInstances,
    externalImportSearch,
    setExternalImportSearch,
    externalImportSort,
    setExternalImportSort,
    isExternalLauncherDropdownOpen,
    setIsExternalLauncherDropdownOpen,
    isExternalSortDropdownOpen,
    setIsExternalSortDropdownOpen,
    externalLauncherDropdownRef,
    externalSortDropdownRef,
    ensureExternalImportPathDefault,
    handleBrowseExternalImportPath,
    handleScanExternalInstances,
    handleImportExternalInstance,
  } = useExternalImport({
    language,
    refreshProfiles,
    setSelectedProfileId,
    setContentTab,
    setActiveView,
    refreshItems,
    showNotification,
  });

  const {
    profileWorlds,
    profileWorldsLoading,
    selectedWorldPaths,
    setSelectedWorldPaths,
    worldsDeleteBusy,
    profileDiskUsage,
    profileDiskLoading,
    cleanupSelected,
    setCleanupSelected,
    cleanupBusy,
    refreshProfileWorlds,
    handleDeleteSelectedWorlds,
    refreshProfileDiskUsage,
    handleCleanupProfile,
    openProfileSubfolder,
    diskFolderLabel,
  } = useProfileWorldsDisk({
    selectedProfileId,
    tt,
    showNotification,
    selectedProfile,
    language,
  });

  const {
    isResourcePackReorderMode,
    setIsResourcePackReorderMode,
    resourcePackDragIndex,
    setResourcePackDragIndex,
    resourcePackDragOverIndex,
    setResourcePackDragOverIndex,
    resourcePackDragOverIndexRef,
    resourcePackPointerDragRef,
    resourcePackReorderListenersRef,
    resourcePackRowRefs,
    cleanupResourcePackReorderListeners,
    handleResourcePackGripPointerDown,
  } = useResourcePackReorder({
    setSelectedContentNames,
    setContentFilter,
    selectedProfileId,
    contentTab,
    activeView,
    itemsSearch,
    items,
    selectedProfile,
    setItems,
    refreshItems,
    showNotification,
    tt,
  });

  const {
    mrpackBusy,
    mrpackProgress,
    handleCancelMrpackImport,
    handleImportMrpack,
  } = useMrpackImport({
    finishDownloadJob,
    updateDownloadJob,
    showNotification,
    language,
    makeDownloadJobId,
    registerDownloadJob,
    refreshProfiles,
    setSelectedProfileId,
    setContentTab,
    setActiveView,
    refreshItems,
    openedMrpackPath,
    onOpenedMrpackPathConsumed,
    activeView,
  });

  const {
    profileConflictsLoading,
    profileConflicts,
    conflictFilenames,
    applyConflictAction,
  } = useProfileConflicts({
    selectedProfile,
    isProfileSettingsOpen,
    activeView,
    tt,
    profileConflictsRefreshToken,
    refreshItems,
    setProfileConflictsRefreshToken,
    showNotification,
  });

  const {
    isRenaming,
    setIsRenaming,
    renameValue,
    setRenameValue,
    pendingDeleteProfileId,
    setPendingDeleteProfileId,
    pendingBulkDeleteProfileIds,
    setPendingBulkDeleteProfileIds,
    duplicateBusy,
    handleChooseProfileIcon,
    handleCreateProfile,
    handleCreateDesktopShortcut,
    handleSelectProfile,
    handleDeleteProfile,
    handleBulkDeleteProfiles,
    handleDuplicateProfile,
    handleOpenFolder,
    handleRenameConfirm,
  } = useProfileActions({
    selectedProfile,
    setProfiles,
    onProfilesChange,
    setProfileIconRevisions,
    showNotification,
    tt,
    createName,
    createLoader,
    createGameVersion,
    createLoaderVersion,
    language,
    setCreateBusy,
    versionOptions,
    createIconPath,
    selectedCreatePreset,
    prepareInstallConsole,
    registerDownloadJob,
    finishDownloadJob,
    createNameUserEdited,
    setCreateName,
    setCreateIconPath,
    setCreateLoaderVersion,
    setLoaderVersionOptions,
    clearCreatePresetSelection,
    lazy,
    setActiveView,
    setSelectedProfileId,
    selectedProfileId,
    activeView,
    setMultiSelectedProfileIds,
  });

  useEffect(() => {
    if (!initialSelectedProfileId) return;
    setSelectedProfileId((prev) => prev ?? initialSelectedProfileId);
  }, [initialSelectedProfileId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (selectedProfileId) {
        window.localStorage.setItem("modpacks_selected_profile_id", selectedProfileId);
      } else {
        window.localStorage.removeItem("modpacks_selected_profile_id");
      }
    } catch {
      //ignore
    }
  }, [selectedProfileId]);

  useEffect(() => {
    if (initialProfiles?.length) {
      profilesLoadedRef.current = true;
      return scheduleIdleWork(() => {
        void refreshProfiles({ background: true });
      });
    }
    void refreshProfiles();
  }, []);

  useEffect(() => {
    if (activeView !== "manage" || !selectedProfileId) return;
    if (editorSection === "launch") {
      void loadProfileLaunchSettings(selectedProfileId);
    } else if (editorSection === "worlds") {
      void refreshProfileWorlds(selectedProfileId);
    } else if (editorSection === "cleanup") {
      void refreshProfileDiskUsage(selectedProfileId);
    } else if (editorSection === "backups") {
      void loadBackupsList(selectedProfileId);
    } else if (editorSection === "version") {
      const p = profiles.find((x) => x.id === selectedProfileId);
      setMigrateGameVersion(p?.game_version ?? "");
      setMigrateLoaderVersion(p?.loader_version ?? "");
      void ensureMigrateVersionsLoaded();
    }
  }, [activeView, editorSection, selectedProfileId]);

  useEffect(() => {
    if (!onProfileSelectionChange) return;

    const profile = profiles.find((p) => p.id === selectedProfileId) ?? null;
    onProfileSelectionChange(profile);
  }, [onProfileSelectionChange, profiles, selectedProfileId]);

  useEffect(() => {
    const unlistenPromise = listen<{
      phase: string;
      current?: number;
      total?: number;
      message?: string;
    }>("external-import-progress", (event) => {
      setExternalImportProgress(event.payload);
      if (event.payload.phase === "start") {
        showNotification("info", t(language, "modpacks.import.started"));
      }
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [language, showNotification]);

  async function refreshProfiles(options?: { background?: boolean }) {
    const cached = readDataCache<InstanceProfile[]>("profiles", 8_000);
    if (cached) {
      profilesLoadedRef.current = true;
      setProfiles(cached);
      onProfilesChange?.(cached);
      if (!options?.background) {
        setLoadingProfiles(false);
      }
    } else if (!options?.background) {
      setLoadingProfiles(true);
    }

    try {
      const list = await invoke<InstanceProfile[]>("get_profiles");
      profilesLoadedRef.current = true;
      writeDataCache("profiles", list);
      setProfiles(list);
      onProfilesChange?.(list);
      try {
        const current = await invoke<InstanceProfile | null>("get_selected_profile");
        if (current && current.id) {
          setSelectedProfileId(current.id);
        }
      } catch {
      }
    } catch (e) {
      if (!cached) {
        console.error(e);
        showNotification("error", t(language, "modpacks.toast.loadProfilesFailed"));
      }
    } finally {
      if (!options?.background || !cached) {
        setLoadingProfiles(false);
      }
    }
  }

  useEffect(() => {
    const unlistenPlaytime = listen<PlaytimeUpdatedPayload>(
      "playtime-updated",
      (event) => {
        const { profile_id, total_seconds } = event.payload;
        void (async () => {
          try {
            const seconds =
              typeof total_seconds === "number" && Number.isFinite(total_seconds)
                ? Math.max(0, Math.floor(total_seconds))
                : await invoke<number>("get_profile_play_time_seconds", {
                    profile_id,
                  });
            setProfiles((prev) => {
              const next = prev.map((p) =>
                p.id === profile_id ? { ...p, play_time_seconds: seconds } : p,
              );
              writeDataCache("profiles", next);
              onProfilesChangeRef.current?.(next);
              return next;
            });
          } catch (e) {
            console.error(e);
          }
        })();
      },
    );
    const unlistenLastPlayed = listen<LastPlayedUpdatedPayload>(
      "last-played-updated",
      (event) => {
        const { profile_id, last_played_at } = event.payload;
        setProfiles((prev) => {
          const next = prev.map((p) =>
            p.id === profile_id ? { ...p, last_played_at } : p,
          );
          writeDataCache("profiles", next);
          onProfilesChangeRef.current?.(next);
          return next;
        });
      },
    );
    return () => {
      unlistenPlaytime.then((fn) => fn());
      unlistenLastPlayed.then((fn) => fn());
    };
  }, []);

  const handleOpenCreateView = useCallback(() => {
    createNameUserEdited.current = false;
    setActiveView("create");
    void ensureVersionsLoaded();
  }, [versionOptions.length, versionsLoading, createAllVersions]);

  const handleOpenImportView = useCallback(() => {
    setActiveView("import");
  }, []);

  useEffect(() => {
    if (!onRegisterModpackHotkeys) return;
    onRegisterModpackHotkeys({
      openCreate: handleOpenCreateView,
      openImport: handleOpenImportView,
      openScreenshots: () => {
        if (selectedProfileId) setIsScreenshotsOpen(true);
      },
    });
    return () => onRegisterModpackHotkeys(null);
  }, [handleOpenCreateView, handleOpenImportView, onRegisterModpackHotkeys, selectedProfileId]);

  const hotkeyRefreshRef = useRef<() => void>(() => {});

  hotkeyRefreshRef.current = () => {
    if (activeView === "list") void refreshProfiles();
  };

  useEffect(() => {
    const onRefresh = () => hotkeyRefreshRef.current();
    window.addEventListener(HOTKEY_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(HOTKEY_REFRESH_EVENT, onRefresh);
  }, []);

  useEffect(() => {
    onActiveViewChange?.(activeView);
  }, [activeView, onActiveViewChange]);

  const goToModpackList = useCallback(() => {
    setActiveView("list");
  }, []);

  useEffect(() => {
    if (!onRegisterModpackNavigation) return;
    onRegisterModpackNavigation({
      getActiveView: () => activeView,
      goToList: goToModpackList,
      setActiveView,
      openProfileSettings: (profileId: string) => {
        void openProfileSettings(profileId);
      },
    });
    return () => onRegisterModpackNavigation(null);
  }, [activeView, goToModpackList, onRegisterModpackNavigation]);

  useEffect(() => {
    if (!requestedModpackView) return;
    if (requestedModpackView !== activeView) {
      setActiveView(requestedModpackView);
    }
    onRequestedModpackViewApplied?.();
  }, [requestedModpackView, onRequestedModpackViewApplied]);

  useEffect(() => {
    if (!requestedProfileSettingsId) return;
    void openProfileSettings(requestedProfileSettingsId);
    onRequestedProfileSettingsApplied?.();
  }, [requestedProfileSettingsId, onRequestedProfileSettingsApplied]);

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter((p) =>
      p.name.toLowerCase().includes(query) ||
      p.game_version.toLowerCase().includes(query),
    );
  }, [profiles, search]);

  const profilesById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );

  const {
    profileGroups,
    isGroupModalOpen,
    setIsGroupModalOpen,
    editingGroupId,
    setEditingGroupId,
    groupFormName,
    setGroupFormName,
    groupFormColor,
    setGroupFormColor,
    groupFormProfileIds,
    setGroupFormProfileIds,
    isGroupProfilesDropdownOpen,
    setIsGroupProfilesDropdownOpen,
    dragOverGroupId,
    profileDrag,
    profileDragGhostRef,
    profileDragSuppressClickRef,
    groupProfilesDropdownRef,
    ungroupedProfiles,
    visibleProfileGroups,
    openCreateGroupModal,
    openEditGroupModal,
    handleSaveGroup,
    handleDeleteGroup,
    toggleGroupCollapsed,
    moveProfilesToGroup,
    profileIdsForAction,
    handleProfilePointerDown,
    handleListAreaContextMenuCapture,
  } = useProfileGroups({
    resourcePackReorderListenersRef,
    filteredProfiles,
    profiles,
    search,
    profilesById,
    profilesLoadedRef,
    showNotification,
    tt,
    setMultiSelectedProfileIds,
    multiSelectedProfileIds,
    profilesScrollRef,
    setListContextMenu,
  });

  const manageTabLabels = useMemo(
    () =>
      Object.fromEntries(
        (Object.entries(CONTENT_TAB_KEYS) as [ContentTab, string][]).map(([tab, key]) => [
          tab,
          tt(key),
        ]),
      ) as Record<ContentTab, string>,
    [tt],
  );

  const headerTitle =
    activeView === "create"
      ? tt("modpacks.create.title")
      : activeView === "import"
        ? tt("modpacks.header.importMrpack")
        : tt("modpacks.header.profiles");

  useEffect(() => {
    if (activeView !== "import") return;
    void ensureExternalImportPathDefault();
  }, [activeView, ensureExternalImportPathDefault]);

  return {
    language,
    showNotification,
    onOpenModsTab,
    onPlaySelectedProfile,
    primaryLabel,
    primaryColorClasses,
    isLaunching,
    isStopping,
    onTogglePinInSidebar,
    isPinnedInSidebar,
    gameStatus,
    consoleHistorySessions,
    onClearConsole,
    fillPane,
    tt,
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    activeView,
    setActiveView,
    contentTab,
    setContentTab,
    items,
    itemsLoading,
    itemMetadataByFilename,
    loadingProfiles,
    search,
    setSearch,
    createName,
    setCreateName,
    createNameUserEdited,
    createLoader,
    setCreateLoader,
    createGameVersion,
    setCreateGameVersion,
    createLoaderVersion,
    setCreateLoaderVersion,
    loaderVersionOptions,
    loaderVersionsLoading,
    isLoaderVersionDropdownOpen,
    setIsLoaderVersionDropdownOpen,
    createAllVersions,
    setCreateAllVersions,
    createIconPath,
    setCreateIconPath,
    createBusy,
    buildPresets,
    buildPresetsLoading,
    createSelectedPresetId,
    isPresetsModalOpen,
    setIsPresetsModalOpen,
    presetIconUris,
    lazy,
    profileIconRevisions,
    versionOptions,
    setVersionOptions,
    versionsLoading,
    isVersionDropdownOpen,
    setIsVersionDropdownOpen,
    mrpackBusy,
    mrpackProgress,
    externalImportLauncher,
    setExternalImportLauncher,
    externalImportPath,
    setExternalImportPath,
    externalImportBusy,
    externalImportProgress,
    externalImportScanBusy,
    externalImportScanError,
    setExternalImportScanError,
    externalImportInstances,
    setExternalImportInstances,
    externalImportSearch,
    setExternalImportSearch,
    externalImportSort,
    setExternalImportSort,
    isExternalLauncherDropdownOpen,
    setIsExternalLauncherDropdownOpen,
    isExternalSortDropdownOpen,
    setIsExternalSortDropdownOpen,
    externalLauncherDropdownRef,
    externalSortDropdownRef,
    isAddMenuOpen,
    setIsAddMenuOpen,
    itemsSearch,
    setItemsSearch,
    contentUpdates,
    contentUpdatesChecking,
    contentUpdatesApplying,
    contentUpdatesAvailableFilenames,
    contentUpdatesAvailabilityLoading,
    contentUpdatesSingleApplyingFilename,
    isContentUpdatesModalOpen,
    setIsContentUpdatesModalOpen,
    selectedContentUpdateFilenames,
    setSelectedContentUpdateFilenames,
    isRenaming,
    setIsRenaming,
    renameValue,
    setRenameValue,
    profilesLayout,
    setProfilesLayout,
    contextMenu,
    setContextMenu,
    listContextMenu,
    setListContextMenu,
    groupContextMenu,
    setGroupContextMenu,
    backupsModalProfileId,
    setBackupsModalProfileId,
    backupsList,
    backupsLoading,
    backupCreating,
    backupRestoringId,
    profileGroups,
    isGroupModalOpen,
    setIsGroupModalOpen,
    editingGroupId,
    setEditingGroupId,
    groupFormName,
    setGroupFormName,
    groupFormColor,
    setGroupFormColor,
    groupFormProfileIds,
    setGroupFormProfileIds,
    isGroupProfilesDropdownOpen,
    setIsGroupProfilesDropdownOpen,
    multiSelectedProfileIds,
    setMultiSelectedProfileIds,
    dragOverGroupId,
    profileDrag,
    profileDragGhostRef,
    profileDragSuppressClickRef,
    profilesScrollRef,
    isResourcePackReorderMode,
    setIsResourcePackReorderMode,
    resourcePackDragIndex,
    setResourcePackDragIndex,
    resourcePackDragOverIndex,
    setResourcePackDragOverIndex,
    resourcePackDragOverIndexRef,
    resourcePackPointerDragRef,
    resourcePackRowRefs,
    groupProfilesDropdownRef,
    pendingDeleteProfileId,
    setPendingDeleteProfileId,
    pendingBulkDeleteProfileIds,
    setPendingBulkDeleteProfileIds,
    isProfileSettingsOpen,
    profileSettingsTab,
    setProfileSettingsTab,
    profileEffectiveSettings,
    setProfileEffectiveSettings,
    profileConflictsLoading,
    setProfileConflictsRefreshToken,
    profileConflicts,
    editorSection,
    setEditorSection,
    contentFilter,
    setContentFilter,
    selectedContentNames,
    setSelectedContentNames,
    isManageMoreOpen,
    setIsManageMoreOpen,
    profileResolutionWidth,
    setProfileResolutionWidth,
    profileResolutionHeight,
    setProfileResolutionHeight,
    backupBeforeVersionChange,
    setBackupBeforeVersionChange,
    profileWorlds,
    profileWorldsLoading,
    selectedWorldPaths,
    setSelectedWorldPaths,
    worldsDeleteBusy,
    profileDiskUsage,
    profileDiskLoading,
    cleanupSelected,
    setCleanupSelected,
    cleanupBusy,
    duplicateBusy,
    isChangeVersionOpen,
    migrateGameVersion,
    setMigrateGameVersion,
    migrateLoaderVersion,
    setMigrateLoaderVersion,
    migrateLoaderVersionOptions,
    migrateLoaderVersionsLoading,
    migrateBusy,
    isMigrateVersionDropdownOpen,
    setIsMigrateVersionDropdownOpen,
    isMigrateLoaderVersionDropdownOpen,
    setIsMigrateLoaderVersionDropdownOpen,
    migrateAllVersions,
    setMigrateAllVersions,
    migrateVersionOptions,
    migrateVersionsLoading,
    systemMemoryGb,
    isExportOpen,
    setIsExportOpen,
    isScreenshotsOpen,
    setIsScreenshotsOpen,
    profileInfoProfile,
    setProfileInfoProfile,
    exportFormat,
    setExportFormat,
    exportTree,
    exportTreeLoading,
    setSelectedExportPaths,
    ignorePatternsText,
    setIgnorePatternsText,
    previewLoading,
    previewResult,
    exportBusy,
    exportProgress,
    exportResultPath,
    exportSkippedFiles,
    exportResolvedCount,
    exportOverrideCount,
    exportSpeedLabel,
    collapsedExportPaths,
    setCollapsedExportPaths,
    exportSearchQuery,
    setExportSearchQuery,
    exportFormatTabRefs,
    exportFormatIndicator,
    manageDropZoneRef,
    isManageDropTarget,
    handleProfilesMarqueePointerDown,
    handleContentMarqueePointerDown,
    uiScale,
    manageZoomed,
    scaledRootRef,
    scaledHostSize,
    manageConsoleExpanded,
    setManageConsoleExpanded,
    selectedLogSessionId,
    setSelectedLogSessionId,
    isCopyingConsole,
    isConsoleCopied,
    manageMainWidthFrac,
    isManageSplitDragging,
    manageSplitRowRef,
    manageSplitHandleRef,
    onManageSplitPointerDown,
    displayedConsoleLines,
    consoleFilters,
    toggleConsoleFilter,
    visibleConsoleLines,
    consoleFilterCounts,
    manageConsoleStatusDotClass,
    handleCopyManageConsole,
    formatLogSessionOptionLabel,
    selectedProfile,
    conflictFilenames,
    refreshBuildPresets,
    applyBuildPresetToCreateForm,
    clearCreatePresetSelection,
    handleSaveBuildPresetFromForm,
    handleSaveBuildPresetFromProfile,
    handleDeleteBuildPreset,
    isExportPathSelected,
    getFolderCheckState,
    setExportNodeChecked,
    applyExportPreset,
    loadExportTree,
    openExportModal,
    openBackupsModal,
    handleCreateBackup,
    handleRestoreBackup,
    handleDeleteBackup,
    handlePreviewExport,
    handleStartExport,
    openProfileSettings,
    patchProfileGameSettings,
    commitProfileResolution,
    scheduleProfileRamSave,
    commitProfileRamSaveNow,
    closeProfileSettingsModal,
    ensureMigrateVersionsLoaded,
    loadMigrateLoaderVersions,
    openChangeVersionModal,
    closeChangeVersionModal,
    handleChangeProfileVersion,
    filteredExportTree,
    exportSelectionStats,
    exportQuickNodes,
    handleCancelMrpackImport,
    refreshProfiles,
    refreshItems,
    ensureVersionsLoaded,
    handleOpenCreateView,
    handleOpenImportView,
    loadCreateLoaderVersions,
    selectedLoaderVersionOption,
    loaderChannelLabel,
    filteredProfiles,
    profilesById,
    ungroupedProfiles,
    visibleProfileGroups,
    manageTabLabels,
    headerTitle,
    handleChooseIcon,
    handleChooseProfileIcon,
    handleCreateProfile,
    handleCreateDesktopShortcut,
    handleSelectProfile,
    handleDeleteProfile,
    handleBulkDeleteProfiles,
    handleImportMrpack,
    handleBrowseExternalImportPath,
    handleScanExternalInstances,
    handleImportExternalInstance,
    handleAddFilesFromPc,
    handleDeleteItem,
    handleToggleItemEnabled,
    applyConflictAction,
    toggleContentSelected,
    handleContentRowClick,
    handleBulkSetEnabled,
    handleBulkDelete,
    handleDuplicateProfile,
    handleDeleteSelectedWorlds,
    handleCleanupProfile,
    openProfileSubfolder,
    diskFolderLabel,
    cleanupResourcePackReorderListeners,
    handleResourcePackGripPointerDown,
    handleCheckContentUpdates,
    handleApplyContentUpdates,
    handleUpdateSingleItem,
    handleOpenFolder,
    handleRenameConfirm,
    openCreateGroupModal,
    openEditGroupModal,
    handleSaveGroup,
    handleDeleteGroup,
    toggleGroupCollapsed,
    moveProfilesToGroup,
    profileIdsForAction,
    handleProfilePointerDown,
    handleListAreaContextMenuCapture,
  };
}

export type ModpackController = ReturnType<typeof useModpackController>;
