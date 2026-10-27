import {
  BackupsSectionPanel,
  CleanupPanel,
  ConflictsPanel,
  EditorSideNav,
  LaunchSettingsPanel,
  WorldsPanel,
} from "../../../features/profile-editor/ManageEditorSections";
import { ProfileInstanceIcon } from "../../../components/profile_instance_icon";
import { InputClearButton } from "../../../components/ui";
import { ProfileInfoIcon } from "../../../components/profile_info_modal";
import {
  EditIcon,
  ExportIcon,
  FolderIcon,
  ModsIcon,
  PlusIcon,
  RefreshIcon,
  ScreenshotsIcon,
  SearchIcon,
  SettingsIcon,
  UndoIcon,
  WeightIcon,
} from "../icons";
import { formatByteSize, formatPlaytimeShort } from "../../../i18n";
import {
  CONTENT_SEG_BTN_CLASS,
  countLabel,
  formatLastPlayedAt,
  MANAGE_ACTION_BTN_CLASS,
  MANAGE_ICON_BTN_CLASS,
  MODPACK_MANAGE_SPLIT_MAX,
  MODPACK_MANAGE_SPLIT_MIN,
} from "../helpers";
import { ChevronDown, Download, FolderPlus } from "lucide-react";
import { lazyItemsFromFiles } from "../hooks/useLazyMods";
import { type ContentTab, type ProfileItemEntry, type Settings } from "../types";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { type ConflictActionKind, type ProfileConflict } from "../../../lib/profileConflicts";
import { invoke } from "@tauri-apps/api/core";
import { type CSSProperties, useEffect, useState } from "react";
import { ProfileItemDetails, ProfileItemIcon } from "../ProfileItemParts";
import { DeleteIcon } from "../../../components/delete_icon";
import { ConsoleFilterBar, ConsoleLines } from "../../../components/ConsoleLogView";
import { LogAnalyzerPanel } from "../../../components/LogAnalyzerPanel";
import { ListView } from "./ListView";
import { RunHistoryPanel } from "../../../features/run-history/RunHistoryPanel";
import { ConfigEditorPanel } from "../../../features/config-editor/ConfigEditorPanel";
import { WorldToolsView } from "../../../features/worlds/WorldToolsView";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function ManageView({ ctx }: Props) {
  const {
    selectedProfile,
    itemsSearch,
    items,
    contentFilter,
    contentUpdatesAvailableFilenames,
    itemMetadataByFilename,
    editorSection,
    setEditorSection,
    profileConflicts,
    profileConflictsLoading,
    tt,
    isRenaming,
    profileIconRevisions,
    renameValue,
    setRenameValue,
    handleRenameConfirm,
    setIsRenaming,
    handleChooseProfileIcon,
    setProfileInfoProfile,
    language,
    onPlaySelectedProfile,
    isLaunching,
    isStopping,
    primaryColorClasses,
    primaryLabel,
    setActiveView,
    handleSelectProfile,
    selectedProfileId,
    setIsManageMoreOpen,
    isManageMoreOpen,
    handleOpenFolder,
    openExportModal,
    setIsScreenshotsOpen,
    duplicateBusy,
    handleDuplicateProfile,
    systemMemoryGb,
    profileEffectiveSettings,
    profileResolutionWidth,
    profileResolutionHeight,
    setProfileResolutionWidth,
    setProfileResolutionHeight,
    commitProfileResolution,
    patchProfileGameSettings,
    setProfileEffectiveSettings,
    scheduleProfileRamSave,
    commitProfileRamSaveNow,
    showNotification,
    profileWorldsLoading,
    refreshProfileWorlds,
    profileWorlds,
    selectedWorldPaths,
    setSelectedWorldPaths,
    openProfileSubfolder,
    handleDeleteSelectedWorlds,
    worldsDeleteBusy,
    setProfileConflictsRefreshToken,
    applyConflictAction,
    profileDiskLoading,
    cleanupBusy,
    profileDiskUsage,
    cleanupSelected,
    setCleanupSelected,
    handleCleanupProfile,
    diskFolderLabel,
    backupsLoading,
    backupCreating,
    backupRestoringId,
    backupsList,
    handleCreateBackup,
    handleRestoreBackup,
    handleDeleteBackup,
    backupBeforeVersionChange,
    setBackupBeforeVersionChange,
    openChangeVersionModal,
    manageSplitRowRef,
    manageMainWidthFrac,
    manageConsoleExpanded,
    setItemsSearch,
    refreshItems,
    contentTab,
    handleCheckContentUpdates,
    contentUpdatesChecking,
    contentSnapshot,
    contentRollbackBusy,
    handleRollbackContentUpdate,
    setIsAddMenuOpen,
    isAddMenuOpen,
    onOpenModsTab,
    handleAddFilesFromPc,
    setContentTab,
    manageTabLabels,
    setIsResourcePackReorderMode,
    setResourcePackDragIndex,
    setResourcePackDragOverIndex,
    resourcePackDragOverIndexRef,
    resourcePackPointerDragRef,
    cleanupResourcePackReorderListeners,
    itemsLoading,
    isResourcePackReorderMode,
    setContentFilter,
    selectedContentNames,
    lazy,
    setSelectedContentNames,
    handleBulkSetEnabled,
    handleBulkDelete,
    manageDropZoneRef,
    handleContentMarqueePointerDown,
    isManageDropTarget,
    resourcePackDragIndex,
    resourcePackDragOverIndex,
    resourcePackRowRefs,
    handleContentRowClick,
    toggleContentSelected,
    handleResourcePackGripPointerDown,
    handleToggleItemEnabled,
    handleDeleteItem,
    conflictFilenames,
    contentUpdatesAvailabilityLoading,
    handleUpdateSingleItem,
    contentUpdatesApplying,
    contentUpdatesSingleApplyingFilename,
    manageSplitHandleRef,
    onManageSplitPointerDown,
    isManageSplitDragging,
    setManageConsoleExpanded,
    manageConsoleStatusDotClass,
    handleCopyManageConsole,
    isCopyingConsole,
    isConsoleCopied,
    selectedLogSessionId,
    onClearConsole,
    setSelectedLogSessionId,
    consoleHistorySessions,
    formatLogSessionOptionLabel,
    consoleFilters,
    consoleFilterCounts,
    toggleConsoleFilter,
    displayedConsoleLines,
    gameStatus,
    visibleConsoleLines,
  } = ctx;

  const [openWorldName, setOpenWorldName] = useState<string | null>(null);
  const selectedProfileKey = selectedProfile?.id ?? null;
  useEffect(() => {
    setOpenWorldName(null);
  }, [selectedProfileKey, editorSection]);

  if (!selectedProfile) return <ListView ctx={ctx} />;

  const searchValue = itemsSearch.trim().toLowerCase();
  let filteredItems = items;
  if (contentFilter === "enabled") {
    filteredItems = filteredItems.filter((i) => i.enabled);
  } else if (contentFilter === "disabled") {
    filteredItems = filteredItems.filter((i) => !i.enabled);
  } else if (contentFilter === "updates") {
    filteredItems = filteredItems.filter((i) =>
      contentUpdatesAvailableFilenames.has(i.name),
    );
  }
  const visibleItems =
    searchValue.length === 0
      ? filteredItems
      : filteredItems.filter((item) => {
          if (item.name.toLowerCase().includes(searchValue)) return true;
          const meta = itemMetadataByFilename[item.name];
          const title = meta?.title?.toLowerCase() ?? "";
          return title.includes(searchValue);
        });

  const editorNav = (
    <EditorSideNav
      section={editorSection}
      onChange={setEditorSection}
      conflictCount={profileConflicts.length}
      conflictsLoading={profileConflictsLoading}
      tt={tt}
    />
  );

  return (
    <div className="custom-scrollbar flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto pr-1">
      <div className="sticky top-0 z-20 -mx-1 flex w-full shrink-0 flex-wrap items-stretch justify-between gap-3">
        {isRenaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/90 px-4 py-3">
            <ProfileInstanceIcon
              profile={selectedProfile}
              refreshKey={profileIconRevisions[selectedProfile.id] ?? 0}
            />
            <div className="relative min-w-0 flex-1">
              <input
                autoFocus
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleRenameConfirm();
                  } else if (e.key === "Escape") {
                    setIsRenaming(false);
                  }
                }}
                className={`min-w-0 w-full rounded-xl border border-white/20 bg-black/60 px-2 py-1 text-sm text-white focus:outline-none ${
                  renameValue ? "pr-9" : ""
                }`}
              />
              <InputClearButton
                value={renameValue}
                onClear={() => setRenameValue("")}
                className="absolute right-1 top-1/2 -translate-y-1/2"
                aria-label={tt("common.clear")}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleRenameConfirm()}
              className="interactive-press rounded-lg accent-bg p-1 text-white hover:opacity-90"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              className="interactive-press rounded-lg bg-white/10 p-1 text-white hover:bg-white/20"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/90 px-4 py-3">
            <ProfileInstanceIcon
              profile={selectedProfile}
              refreshKey={profileIconRevisions[selectedProfile.id] ?? 0}
              editable
              editTitle={tt("modpacks.profile.changeIconTitle")}
              onEditClick={() => void handleChooseProfileIcon(selectedProfile)}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-white">
                  {selectedProfile.name}
                </span>
                <button
                  type="button"
                  onClick={() => setProfileInfoProfile(selectedProfile)}
                  className="interactive-press rounded-lg bg-white/10 p-0.5 text-white/70 hover:bg-white/20"
                  title={tt("modpacks.profileInfo.buttonTitle")}
                >
                  <ProfileInfoIcon className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenameValue(selectedProfile.name);
                    setIsRenaming(true);
                  }}
                  className="interactive-press rounded-lg bg-white/10 p-1 text-white/70 hover:bg-white/20"
                  title={tt("common.rename")}
                >
                  <EditIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-white/70">
                <span>{`${selectedProfile.game_version} • ${selectedProfile.loader}`}</span>
                <span className="flex items-center gap-1">
                  <img
                    src="/launcher-assets/cllock.png"
                    alt=""
                    title={tt("modpacks.list.playtimeLabel")}
                    className="h-3 w-3 object-contain opacity-80"
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.dataset.failedOnce !== "1") {
                        img.dataset.failedOnce = "1";
                        img.src = "/launcher-assets/clock.png";
                        return;
                      }
                      img.style.display = "none";
                    }}
                  />
                  <span>
                    {formatPlaytimeShort(language, selectedProfile.play_time_seconds)}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <ModsIcon className="h-3 w-3" />
                  <span>{countLabel(selectedProfile.mods_count, language)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <WeightIcon className="h-3 w-3" />
                  <span>
                    {formatByteSize(language, selectedProfile.total_size_bytes)}
                  </span>
                </span>
                <span className="text-white/55">
                  {tt("modpacks.list.lastPlayed", {
                    date: formatLastPlayedAt(selectedProfile.last_played_at, language),
                  })}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="ml-auto flex w-fit shrink-0 items-center justify-end gap-2 rounded-2xl border border-white/10 bg-ink-900/90 px-2 py-2">
          <button
            type="button"
            onClick={() => onPlaySelectedProfile?.()}
            disabled={isLaunching || isStopping}
            className={`${MANAGE_ACTION_BTN_CLASS} disabled:cursor-not-allowed disabled:opacity-60 ${primaryColorClasses}`}
            title={tt("modpacks.list.playSelectedTitle")}
          >
            {primaryLabel ?? tt("modpacks.actions.play")}
          </button>
          <button
            type="button"
            onClick={() => setActiveView("list")}
            className={`${MANAGE_ACTION_BTN_CLASS} bg-white/10 hover:bg-white/20`}
            title={tt("modpacks.manage.backToList")}
          >
            {tt("modpacks.manage.backToList")}
          </button>
          <button
            type="button"
            onClick={() => void handleSelectProfile(selectedProfile)}
            className={`${MANAGE_ACTION_BTN_CLASS} bg-white/10 hover:bg-white/20`}
            title={tt("modpacks.manage.selectProfile")}
          >
            <Download className="h-4 w-4 shrink-0" />
            {selectedProfileId === selectedProfile.id
              ? tt("modpacks.actions.unselect")
              : tt("modpacks.actions.select")}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsManageMoreOpen((v) => !v)}
              className={`${MANAGE_ICON_BTN_CLASS} bg-white/10 hover:bg-white/20`}
              title={tt("modpacks.editor.moreActions")}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {isManageMoreOpen && (
              <div className="absolute right-0 z-30 mt-1 w-52 glass-popover p-1 text-xs text-white">
                <button
                  type="button"
                  onClick={() => {
                    setIsManageMoreOpen(false);
                    void handleOpenFolder();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                >
                  <FolderIcon className="h-3.5 w-3.5" />
                  <span>{tt("modpacks.manage.openFolder")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsManageMoreOpen(false);
                    void openExportModal();
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                >
                  <ExportIcon className="h-3.5 w-3.5" />
                  <span>{tt("modpacks.manage.exportBuild")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsManageMoreOpen(false);
                    setIsScreenshotsOpen(true);
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                >
                  <ScreenshotsIcon className="h-3.5 w-3.5" />
                  <span>{tt("modpacks.screenshots.title")}</span>
                </button>
                <button
                  type="button"
                  disabled={duplicateBusy}
                  onClick={() => {
                    setIsManageMoreOpen(false);
                    void handleDuplicateProfile(selectedProfile);
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10 disabled:opacity-50"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  <span>
                    {duplicateBusy
                      ? tt("modpacks.editor.duplicating")
                      : tt("modpacks.editor.duplicate")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsManageMoreOpen(false);
                    setEditorSection("launch");
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                >
                  <SettingsIcon className="h-3.5 w-3.5" />
                  <span>{tt("modpacks.manage.profileSettings")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 sm:flex-row sm:items-stretch">
        {editorNav}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {editorSection === "launch" ? (
        <LaunchSettingsPanel
          language={language}
          systemMemoryGb={systemMemoryGb}
          settings={profileEffectiveSettings}
          profileId={selectedProfile.id}
          resolutionWidth={profileResolutionWidth}
          resolutionHeight={profileResolutionHeight}
          onResolutionWidth={setProfileResolutionWidth}
          onResolutionHeight={setProfileResolutionHeight}
          onCommitResolution={() => commitProfileResolution(selectedProfile.id)}
          onResetResolution={() => {
            setProfileResolutionWidth("");
            setProfileResolutionHeight("");
            void patchProfileGameSettings(selectedProfile.id, {
              resolution_width: null,
              resolution_height: null,
            });
          }}
          onPatch={(patch) =>
            void patchProfileGameSettings(selectedProfile.id, patch as Partial<Settings>)
          }
          onRamChange={(gb) => {
            const ramMb = Math.max(1, gb) * 1024;
            setProfileEffectiveSettings((prev) =>
              prev ? { ...prev, ram_mb: ramMb } : prev,
            );
            scheduleProfileRamSave(selectedProfile.id, ramMb);
          }}
          onRamCommit={(gb) =>
            commitProfileRamSaveNow(selectedProfile.id, Math.max(1, gb) * 1024)
          }
          showNotification={showNotification}
          tt={tt}
        />
      ) : editorSection === "worlds" && openWorldName ? (
        <WorldToolsView
          profileId={selectedProfile.id}
          world={openWorldName}
          language={language}
          gameRunning={gameStatus === "running"}
          tt={tt}
          showNotification={showNotification}
          onBack={() => setOpenWorldName(null)}
          onWorldChanged={() => void refreshProfileWorlds(selectedProfile.id)}
        />
      ) : editorSection === "worlds" ? (
        <WorldsPanel
          onOpenDetails={setOpenWorldName}
          language={language}
          loading={profileWorldsLoading}
          worlds={profileWorlds}
          selected={selectedWorldPaths}
          onToggle={(path) => {
            setSelectedWorldPaths((prev) => {
              const next = new Set(prev);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            });
          }}
          onSelectAll={() =>
            setSelectedWorldPaths(new Set(profileWorlds.map((w) => w.path)))
          }
          onClearSelection={() => setSelectedWorldPaths(new Set())}
          onOpenWorld={(path) => {
            void revealItemInDir(path).catch(() =>
              showNotification("error", tt("modpacks.editor.openFailed")),
            );
          }}
          onOpenSaves={() => void openProfileSubfolder("saves")}
          onOpenConfig={() => void openProfileSubfolder("config")}
          onDeleteSelected={() => void handleDeleteSelectedWorlds()}
          deleteBusy={worldsDeleteBusy}
          tt={tt}
        />
      ) : editorSection === "configs" ? (
        <ConfigEditorPanel
          profileId={selectedProfile.id}
          language={language}
          tt={tt}
          showNotification={showNotification}
        />
      ) : editorSection === "runs" ? (
        <RunHistoryPanel
          profileId={selectedProfile.id}
          language={language}
          tt={tt}
          showNotification={showNotification}
        />
      ) : editorSection === "conflicts" ? (
        <ConflictsPanel
          loading={profileConflictsLoading}
          conflicts={profileConflicts}
          onRefresh={() => setProfileConflictsRefreshToken((v) => v + 1)}
          onAction={(c, actionId) => {
            const action = c.actions?.find((a) => a.id === actionId);
            if (!action) return;
            void applyConflictAction(c as ProfileConflict, {
              kind: action.kind as ConflictActionKind,
              keep: action.keep,
              targets: action.targets,
            });
          }}
          tt={tt}
        />
      ) : editorSection === "cleanup" ? (
        <CleanupPanel
          language={language}
          loading={profileDiskLoading}
          busy={cleanupBusy}
          usage={profileDiskUsage}
          selected={cleanupSelected}
          onToggle={(id) => {
            setCleanupSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onRun={() => void handleCleanupProfile()}
          folderLabel={diskFolderLabel}
          tt={tt}
        />
      ) : editorSection === "backups" ? (
        <BackupsSectionPanel
          language={language}
          profileName={selectedProfile.name}
          loading={backupsLoading}
          creating={backupCreating}
          restoringId={backupRestoringId}
          backups={backupsList.map((b) => ({
            id: b.id,
            createdAt: b.created_at,
            sizeBytes: b.size_bytes,
          }))}
          onCreate={() => void handleCreateBackup(selectedProfile.id)}
          onRestore={(backupId) =>
            void handleRestoreBackup(selectedProfile.id, backupId)
          }
          onDelete={(backupId) =>
            void handleDeleteBackup(selectedProfile.id, backupId)
          }
          onOpenFolder={() =>
            void invoke("open_profile_backups_folder", {
              profileId: selectedProfile.id,
            }).catch((e) => {
              console.error(e);
              showNotification("error", tt("modpacks.backups.openFolderFailed"));
            })
          }
          tt={tt}
        />
      ) : editorSection === "version" ? (
        <div className="glass-panel flex min-h-0 flex-1 flex-col gap-4 p-4">
          <div>
            <div className="text-sm font-semibold text-white">
              {tt("modpacks.changeVersion.title")}
            </div>
            <div className="mt-1 text-xs text-white/60">
              {tt("modpacks.changeVersion.description")}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white/90">
            {tt("modpacks.changeVersion.currentVersion")}: {selectedProfile.game_version}
            {selectedProfile.loader !== "vanilla"
              ? ` · ${selectedProfile.loader}${selectedProfile.loader_version ? ` ${selectedProfile.loader_version}` : ""}`
              : ""}
          </div>
          <label className="flex items-start gap-2 text-xs text-white/80">
            <input
              type="checkbox"
              checked={backupBeforeVersionChange}
              onChange={(e) => setBackupBeforeVersionChange(e.target.checked)}
              className="mt-0.5 accent-checkbox"
            />
            <span>
              <span className="font-semibold">{tt("modpacks.editor.backupBeforeChange")}</span>
              <span className="mt-0.5 block text-white/50">
                {tt("modpacks.editor.backupBeforeChangeHint")}
              </span>
            </span>
          </label>
          <button
            type="button"
            onClick={openChangeVersionModal}
            className="interactive-press rounded-xl accent-bg px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:opacity-90"
          >
            {tt("modpacks.changeVersion.button")}
          </button>
        </div>
      ) : (
      <div
        ref={manageSplitRowRef}
        className="flex min-h-0 w-full flex-1 flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-0"
        style={
          {
            ["--modpack-main-frac" as string]: String(manageMainWidthFrac),
          } as CSSProperties
        }
      >
        <div
          className={`glass-panel flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden p-3 ${
            manageConsoleExpanded
              ? "lg:flex-none lg:shrink-0 lg:[flex-basis:calc(var(--modpack-main-frac,0.68)*100%)]"
              : ""
          }`}
        >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <label className="glass-control flex h-9 min-w-0 flex-1 basis-[14rem] cursor-text items-center gap-2.5 px-3 focus-within:!border-[color:var(--accent-line)]">
            <SearchIcon className="h-4 w-4 shrink-0 opacity-60" />
            <input
              type="text"
              placeholder={tt("modpacks.manage.searchFiles")}
              value={itemsSearch}
              onChange={(e) => setItemsSearch(e.target.value)}
              className="min-w-0 w-full bg-transparent text-[0.8125rem] text-white placeholder:text-white/40 focus:outline-none"
            />
            <InputClearButton
              value={itemsSearch}
              onClear={() => setItemsSearch("")}
              aria-label={tt("common.clear")}
            />
          </label>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                selectedProfile && void refreshItems(selectedProfile.id, contentTab)
              }
              className="btn btn-soft w-9 px-0"
              title={tt("modpacks.manage.rescan")}
              aria-label={tt("modpacks.manage.rescan")}
            >
              <RefreshIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void handleCheckContentUpdates()}
              disabled={contentUpdatesChecking || !selectedProfile}
              className="btn btn-soft px-3.5 text-xs disabled:cursor-not-allowed"
            >
              {contentUpdatesChecking
                ? tt("modpacks.contentUpdates.checking")
                : tt("modpacks.contentUpdates.check")}
            </button>
            {contentSnapshot && (
              <button
                type="button"
                onClick={() => void handleRollbackContentUpdate()}
                disabled={contentRollbackBusy || contentUpdatesApplying}
                className="btn btn-soft w-9 px-0 disabled:cursor-not-allowed"
                title={tt("modpacks.contentUpdates.rollbackTitle", {
                  count: contentSnapshot.items.length,
                })}
                aria-label={tt("modpacks.contentUpdates.rollback")}
              >
                <UndoIcon className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsAddMenuOpen((v) => !v)}
                className="btn btn-accent gap-1.5 px-3.5 text-xs"
                aria-expanded={isAddMenuOpen}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                <span>{tt("common.add")}</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${isAddMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {isAddMenuOpen && (
                <div className="absolute right-0 z-30 mt-1 w-48 glass-popover p-1 text-xs text-white">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    onOpenModsTab?.();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>
                    {tt("modpacks.manage.downloadFromCatalog")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    void handleAddFilesFromPc();
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10"
                >
                  <FolderIcon className="h-3.5 w-3.5" />
                  <span>
                    {tt("modpacks.manage.chooseFileFromPc")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    if (selectedProfile) {
                      lazy.setModal({ mode: "apply", profileId: selectedProfile.id });
                    }
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  <span>{tt("modpacks.lazy.applyMenu")}</span>
                </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="seg-track inline-flex h-9 max-w-full items-center gap-0.5 overflow-x-auto p-0.5">
              {(["mods", "resourcepacks", "shaderpacks"] as ContentTab[]).map(
                (tab) => {
                  const active = tab === contentTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setContentTab(tab)}
                      className={`${CONTENT_SEG_BTN_CLASS} ${
                        active ? "seg-on" : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      {manageTabLabels[tab]}
                    </button>
                  );
                },
              )}
            </div>
            {contentTab === "resourcepacks" && (
              <button
                type="button"
                onClick={() => {
                  setIsResourcePackReorderMode((active) => {
                    if (active) {
                      setResourcePackDragIndex(null);
                      setResourcePackDragOverIndex(null);
                      resourcePackDragOverIndexRef.current = null;
                      resourcePackPointerDragRef.current = null;
                      cleanupResourcePackReorderListeners();
                    }
                    return !active;
                  });
                }}
                disabled={itemsLoading || items.filter((item) => item.enabled).length < 2}
                className={`btn px-3 text-xs disabled:cursor-not-allowed ${
                  isResourcePackReorderMode ? "btn-tint" : "btn-soft"
                }`}
                title={
                  isResourcePackReorderMode
                    ? tt("modpacks.manage.reorderResourcePacksDone")
                    : tt("modpacks.manage.reorderResourcePacks")
                }
              >
                {isResourcePackReorderMode
                  ? tt("modpacks.manage.reorderResourcePacksDone")
                  : tt("modpacks.manage.reorderResourcePacks")}
              </button>
            )}
          </div>

          <div className="flex min-w-0 items-center gap-1.5">
            <div className="seg-track inline-flex h-9 max-w-full items-center gap-0.5 overflow-x-auto p-0.5">
              {(
                [
                  ["all", "modpacks.editor.filterAll"],
                  ["enabled", "modpacks.editor.filterEnabled"],
                  ["disabled", "modpacks.editor.filterDisabled"],
                  ["updates", "modpacks.editor.filterUpdates"],
                ] as const
              ).map(([id, key]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setContentFilter(id)}
                  aria-pressed={contentFilter === id}
                  className={`${CONTENT_SEG_BTN_CLASS} ${
                    contentFilter === id
                      ? "seg-on"
                      : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <span>{tt(key)}</span>
                  {id === "updates" && contentUpdatesAvailableFilenames.size > 0 ? (
                    <span className="rounded-md bg-accent-from/30 px-1.5 py-0.5 text-[0.6875rem] font-bold leading-none tabular-nums text-accent-hi">
                      {contentUpdatesAvailableFilenames.size}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {profileConflicts.length > 0 ? (
              <button
                type="button"
                onClick={() => setEditorSection("conflicts")}
                className="btn gap-1.5 border-amber-400/25 bg-amber-500/10 px-2.5 text-xs text-amber-100 hover:bg-amber-500/20"
                title={tt("modpacks.conflicts.openFromContent")}
                aria-label={`${tt("modpacks.editor.nav.conflicts")}: ${profileConflicts.length}`}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 9v4m0 4h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                </svg>
                <span className="tabular-nums">{profileConflicts.length}</span>
              </button>
            ) : null}
          </div>
        </div>
        {selectedContentNames.size > 0 && (
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-ink-2 py-1 pl-3 pr-1 text-xs">
            <span className="mr-auto text-white/70">
              {tt("modpacks.editor.selectedCount", { count: selectedContentNames.size })}
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedContentNames(new Set(visibleItems.map((i) => i.name)))
              }
              className="btn btn-sm btn-ghost"
            >
              {tt("modpacks.editor.selectAll")}
            </button>
            <button
              type="button"
              onClick={() => setSelectedContentNames(new Set())}
              className="btn btn-sm btn-ghost"
            >
              {tt("modpacks.editor.clearSelection")}
            </button>
            <button
              type="button"
              onClick={() => {
                const { items: lazyItems, skipped } = lazyItemsFromFiles(
                  selectedContentNames,
                  itemMetadataByFilename,
                  contentTab,
                );
                lazy.openAddModal(lazyItems, skipped);
              }}
              className="btn btn-sm btn-soft"
            >
              {tt("modpacks.lazy.addToSet")}
            </button>
            <button
              type="button"
              onClick={() => void handleBulkSetEnabled(true)}
              className="btn btn-sm btn-soft"
            >
              {tt("modpacks.editor.bulkEnable")}
            </button>
            <button
              type="button"
              onClick={() => void handleBulkSetEnabled(false)}
              className="btn btn-sm btn-soft"
            >
              {tt("modpacks.editor.bulkDisable")}
            </button>
            <button
              type="button"
              onClick={() => void handleBulkDelete()}
              className="btn btn-sm btn-danger"
            >
              {tt("modpacks.editor.bulkDelete")}
            </button>
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={manageDropZoneRef}
            onPointerDown={handleContentMarqueePointerDown}
            className={`custom-scrollbar min-h-0 flex-1 overflow-y-auto rounded-2xl bg-black/35 p-2.5 shadow-inner transition-colors ${
              isManageDropTarget
                ? "bg-accent-from/15 ring-2 ring-accent-to/70 ring-inset"
                : ""
            }`}
          >
          {itemsLoading ? (
            <div className="flex h-32 items-center justify-center text-xs text-white/70">
              {tt("modpacks.manage.loadingFiles")}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex min-h-[10rem] items-center justify-center rounded-2xl bg-black/40 px-4 text-center text-xs text-white/60">
              <div className="max-w-sm space-y-2">
                <p>
                  {tt("modpacks.manage.emptyTab")}
                </p>
                <p className="text-white/45">
                  {tt("modpacks.manage.dropHint")}
                </p>
              </div>
            </div>
          ) : contentTab === "resourcepacks" || contentTab === "shaderpacks" ? (
            (() => {
              const enabledItems = visibleItems.filter((item) => item.enabled);
              const disabledItems = visibleItems.filter((item) => !item.enabled);
              const canReorder =
                contentTab === "resourcepacks" &&
                searchValue.length === 0 &&
                isResourcePackReorderMode;
              const isShaders = contentTab === "shaderpacks";

              function renderPackRow(
                item: ProfileItemEntry,
                index: number,
                reorderable: boolean,
              ) {
                const isDragging = reorderable && resourcePackDragIndex === index;
                const isDropTarget =
                  reorderable &&
                  resourcePackDragOverIndex === index &&
                  resourcePackDragIndex !== index;
                return (
                  <div
                    key={item.name}
                    ref={(el) => {
                      if (el && reorderable) {
                        resourcePackRowRefs.current.set(item.name, el);
                      } else {
                        resourcePackRowRefs.current.delete(item.name);
                      }
                    }}
                    data-marquee-key={item.name}
                    onClick={(e) => handleContentRowClick(item.name, e)}
                    className={`flex items-center justify-between gap-2.5 rounded-2xl px-3 py-3 text-xs transition-opacity ${
                      selectedContentNames.has(item.name)
                        ? "bg-accent-from/15 ring-1 ring-accent-to/45 ring-inset"
                        : "bg-black/45"
                    } ${
                      item.enabled ? "text-white/85" : "text-white/45 opacity-75"
                    } ${isDragging ? "opacity-50" : ""} ${
                      isDropTarget ? "ring-2 ring-accent-to/70 ring-inset" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={selectedContentNames.has(item.name)}
                        onChange={() => toggleContentSelected(item.name)}
                        className="accent-checkbox accent-checkbox-lg"
                      />
                      {reorderable && canReorder ? (
                        <button
                          type="button"
                          onPointerDown={(e) => handleResourcePackGripPointerDown(index, e)}
                          className="interactive-press shrink-0 cursor-grab touch-none rounded-md p-1 text-white/35 hover:bg-white/10 hover:text-white/60 active:cursor-grabbing"
                          title={tt("modpacks.manage.dragToReorder")}
                          aria-label={tt("modpacks.manage.dragToReorder")}
                        >
                          <span className="text-base leading-none" aria-hidden="true">
                            ⠿
                          </span>
                        </button>
                      ) : (
                        <span className="w-5 shrink-0" aria-hidden="true" />
                      )}
                      <ProfileItemIcon
                        contentTab={contentTab}
                        metadata={itemMetadataByFilename[item.name]}
                      />
                      <ProfileItemDetails
                        contentTab={contentTab}
                        itemName={item.name}
                        metadata={itemMetadataByFilename[item.name]}
                        titleClassName="block max-w-[200px] truncate md:max-w-[320px]"
                        subtitleClassName="max-w-[200px] truncate text-[0.75rem] text-white/45 md:max-w-[320px]"
                        tt={tt}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.enabled}
                        onClick={() => void handleToggleItemEnabled(item)}
                        className={`interactive-press relative h-7 w-12 rounded-full transition-colors ${
                          item.enabled ? "accent-bg" : "bg-white/15"
                        }`}
                        title={
                          item.enabled
                            ? isShaders
                              ? tt("modpacks.manage.disableShader")
                              : tt("modpacks.manage.disableItem")
                            : isShaders
                              ? tt("modpacks.manage.enableShader")
                              : tt("modpacks.manage.enableItem")
                        }
                      >
                        <span
                          className={`absolute top-0.5 h-6 w-6 rounded-full shadow transition-[left] ${
                            item.enabled ? "left-[1.375rem] bg-[var(--on-accent,#fff)]" : "left-0.5 bg-white"
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteItem(item)}
                        className="interactive-press rounded-lg bg-white/10 p-2 text-white/80 hover:bg-red-600 hover:text-white"
                        title={tt("common.delete")}
                      >
                        <DeleteIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="flex flex-col gap-2.5">
                  {isShaders && visibleItems.length > 0 && (
                    <p className="px-1 text-[0.8125rem] text-white/45">
                      {tt("modpacks.manage.shaderPackActiveHint")}
                    </p>
                  )}
                  {canReorder && enabledItems.length > 0 && (
                    <p className="px-1 text-[0.8125rem] text-white/45">
                      {tt("modpacks.manage.resourcePackOrderHint")}
                    </p>
                  )}
                  {enabledItems.map((item, index) => renderPackRow(item, index, !isShaders))}
                  {disabledItems.length > 0 && enabledItems.length > 0 && (
                    <div className="px-1 pt-1 text-[0.8125rem] font-semibold text-white/40">
                      {isShaders
                        ? tt("modpacks.manage.inactiveShaders")
                        : tt("modpacks.manage.disabledResourcePacks")}
                    </div>
                  )}
                  {disabledItems.map((item, index) =>
                    renderPackRow(item, index, false),
                  )}
                </div>
              );
            })()
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-2.5">
              {visibleItems.map((item) => {
                const hasConflict =
                  contentTab === "mods" && conflictFilenames.has(item.name);
                return (
                <div
                  key={item.name}
                  data-marquee-key={item.name}
                  onClick={(e) => handleContentRowClick(item.name, e)}
                  className={`flex items-center justify-between gap-2.5 rounded-2xl px-3 py-3 text-xs transition-opacity ${
                    selectedContentNames.has(item.name)
                      ? "bg-accent-from/15 ring-1 ring-accent-to/45 ring-inset"
                      : hasConflict
                        ? "bg-amber-500/10"
                        : "bg-black/45"
                  } ${item.enabled ? "text-white/85" : "text-white/45 opacity-75"}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedContentNames.has(item.name)}
                      onChange={() => toggleContentSelected(item.name)}
                      className="accent-checkbox accent-checkbox-lg"
                    />
                    <ProfileItemIcon
                      contentTab={contentTab}
                      metadata={itemMetadataByFilename[item.name]}
                    />
                    <ProfileItemDetails
                      contentTab={contentTab}
                      itemName={item.name}
                      metadata={itemMetadataByFilename[item.name]}
                      titleClassName="block max-w-[200px] truncate md:max-w-[280px]"
                      subtitleClassName="max-w-[200px] truncate text-[0.75rem] text-white/45 md:max-w-[280px]"
                      tt={tt}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {hasConflict ? (
                      <button
                        type="button"
                        onClick={() => setEditorSection("conflicts")}
                        className="interactive-press rounded-xl bg-amber-500/25 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-500/40"
                        title={tt("modpacks.conflicts.openFromContent")}
                      >
                        !
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.enabled}
                      onClick={() => void handleToggleItemEnabled(item)}
                      className={`interactive-press relative h-7 w-12 rounded-full transition-colors ${
                        item.enabled ? "accent-bg" : "bg-white/15"
                      }`}
                      title={
                        item.enabled
                          ? tt("modpacks.manage.disableItem")
                          : tt("modpacks.manage.enableItem")
                      }
                    >
                      <span
                        className={`absolute top-0.5 h-6 w-6 rounded-full shadow transition-[left] ${
                          item.enabled ? "left-[1.375rem] bg-[var(--on-accent,#fff)]" : "left-0.5 bg-white"
                        }`}
                      />
                    </button>
                    {contentTab === "mods" &&
                      !contentUpdatesAvailabilityLoading &&
                      contentUpdatesAvailableFilenames.has(item.name) && (
                      <button
                        type="button"
                        onClick={() => void handleUpdateSingleItem(item)}
                        disabled={
                          contentUpdatesApplying ||
                          contentUpdatesChecking ||
                          contentUpdatesSingleApplyingFilename === item.name
                        }
                        className="interactive-press rounded-lg bg-white/10 p-2 text-white/80 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                        title={tt("modpacks.manage.update")}
                      >
                        <img
                          src="/launcher-assets/download.png"
                          alt=""
                          className="h-4 w-4 object-contain"
                          aria-hidden="true"
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDeleteItem(item)}
                      className="interactive-press rounded-lg bg-white/10 p-2 text-white/80 hover:bg-red-600 hover:text-white"
                      title={tt("common.delete")}
                    >
                      <DeleteIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          </div>
        </div>
      </div>

      {manageConsoleExpanded ? (
      <div
        ref={manageSplitHandleRef}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(manageMainWidthFrac * 100)}
        aria-valuemin={Math.round(MODPACK_MANAGE_SPLIT_MIN * 100)}
        aria-valuemax={Math.round(MODPACK_MANAGE_SPLIT_MAX * 100)}
        aria-label={tt("modpacks.manage.splitResizeAria")}
        title={tt("modpacks.manage.splitResizeTitle")}
        onPointerDown={onManageSplitPointerDown}
        className={`hidden lg:flex lg:w-2 lg:shrink-0 lg:cursor-col-resize lg:select-none lg:touch-none lg:flex-col lg:items-center lg:justify-center lg:self-stretch ${
          isManageSplitDragging ? "lg:bg-white/25" : "lg:bg-transparent lg:hover:bg-white/10"
        }`}
      >
        <span className="pointer-events-none h-24 w-1 rounded-full bg-white/35 shadow-sm" />
      </div>
      ) : (
        <div className="hidden lg:block lg:w-3 lg:shrink-0" aria-hidden="true" />
      )}

      <div
        className={`glass-panel relative z-10 flex min-h-0 min-w-0 flex-col py-3 max-h-[min(42rem,calc(100vh-6rem))] lg:sticky lg:top-2 lg:mt-0 lg:self-stretch ${
          manageConsoleExpanded
            ? "w-full flex-1 px-3 lg:min-w-[11rem] lg:flex-1"
            : "w-full px-3 lg:w-11 lg:flex-none lg:shrink-0 lg:items-center lg:px-0"
        }`}
      >
        <div
          className={`flex items-center gap-1 ${
            manageConsoleExpanded ? "mb-2" : "lg:flex-col lg:gap-2"
          }`}
        >
          {!manageConsoleExpanded && (
            <button
              type="button"
              onClick={() => setManageConsoleExpanded(true)}
              className="icon-btn order-first hidden h-7 w-7 lg:flex"
              title={tt("play.console.show")}
              aria-label={tt("play.console.show")}
              aria-expanded={false}
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-90" />
            </button>
          )}
          <span
            className={`ml-0.5 h-2 w-2 shrink-0 rounded-full ${manageConsoleStatusDotClass} ${
              manageConsoleExpanded ? "" : "lg:ml-0"
            }`}
            aria-hidden="true"
          />
          <span
            className={`ml-1.5 min-w-[3rem] flex-1 truncate text-[0.8125rem] font-semibold text-white/85 ${
              manageConsoleExpanded
                ? ""
                : "lg:ml-0 lg:min-w-0 lg:flex-none lg:[text-orientation:mixed] lg:[writing-mode:vertical-rl]"
            }`}
          >
            {tt("play.console.title")}
          </span>
          {manageConsoleExpanded && (
          <>
          <button
            type="button"
            onClick={() => void handleCopyManageConsole()}
            disabled={isCopyingConsole}
            className="icon-btn h-7 w-7 disabled:opacity-50"
            title={
              isConsoleCopied ? tt("app.toast.copied") : tt("app.toast.copy")
            }
            aria-label={tt("app.toast.copy")}
          >
            <img
              src="/launcher-assets/copy.png"
              alt=""
              className="h-3.5 w-3.5 object-contain opacity-80"
            />
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedLogSessionId === "live") onClearConsole?.();
            }}
            disabled={selectedLogSessionId !== "live"}
            className="icon-btn h-7 w-7 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              selectedLogSessionId !== "live"
                ? tt("modpacks.manage.clearOnlyLive")
                : tt("play.console.clear")
            }
            aria-label={tt("play.console.clear")}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
            </svg>
          </button>
          </>
          )}
          <button
            type="button"
            onClick={() => setManageConsoleExpanded((v) => !v)}
            className={`icon-btn h-7 w-7 ${manageConsoleExpanded ? "" : "lg:hidden"}`}
            title={manageConsoleExpanded ? tt("play.console.hide") : tt("play.console.show")}
            aria-label={manageConsoleExpanded ? tt("play.console.hide") : tt("play.console.show")}
            aria-expanded={manageConsoleExpanded}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${manageConsoleExpanded ? "rotate-180 lg:-rotate-90" : ""}`}
            />
          </button>
        </div>
        <select
          value={selectedLogSessionId}
          onChange={(e) => setSelectedLogSessionId(e.target.value)}
          className={`launcher-select glass-control mb-2 w-full shrink-0 truncate pl-3 text-[0.8125rem] focus:outline-none ${
            manageConsoleExpanded ? "" : "lg:hidden"
          }`}
          aria-label={tt("modpacks.manage.currentOutput")}
        >
          <option value="live">
            {tt("modpacks.manage.currentOutput")}
          </option>
          {consoleHistorySessions.map((s) => (
            <option key={s.id} value={s.id}>
              {formatLogSessionOptionLabel(s)}
            </option>
          ))}
        </select>

        {manageConsoleExpanded && (
          <div className="flex min-h-0 flex-1 flex-col">
            <ConsoleFilterBar
              tt={tt}
              filters={consoleFilters}
              counts={consoleFilterCounts}
              onToggle={toggleConsoleFilter}
              className="mb-2 shrink-0 px-0.5"
            />
            <LogAnalyzerPanel
              lines={displayedConsoleLines.map((e) => e.line)}
              language={language}
              profileId={selectedProfile?.id ?? selectedProfileId}
              gameStatus={gameStatus}
              includeDiskLogs={selectedLogSessionId === "live"}
              compact
              className="mb-2"
            />
            {displayedConsoleLines.length > 0 ? (
              <ConsoleLines
                tt={tt}
                visible={visibleConsoleLines}
                filters={consoleFilters}
                keyPrefix={`${selectedLogSessionId}-`}
                className="min-h-0 flex-1 rounded-xl border border-white/[0.06] bg-[var(--ink-0)] px-3 py-2 text-[0.75rem] leading-[1.55] sm:min-h-[10rem]"
              />
            ) : (
              <div className="flex h-24 w-full shrink-0 items-center justify-center rounded-xl border border-dashed border-white/10 px-3 py-2 text-[0.8125rem] text-white/45 lg:flex-1">
                {tt("play.console.empty")}
              </div>
            )}
            <p className="mt-2 shrink-0 text-[0.75rem] text-white/40">
              {tt("modpacks.manage.consoleResizeHint")}
            </p>
          </div>
        )}
      </div>
      </div>
      )}
        </div>
      </div>
    </div>
  );
}
