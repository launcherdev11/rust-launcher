import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { playTabSwitchSound } from "./uiSounds";
import { useT, readStoredLanguage, type Language } from "./i18n";
import { isSplittableTab, type SplittableTabId } from "./splitView";
import { OnboardingFlow, ONBOARDING_COMPLETED_STORAGE_KEY, ONBOARDING_FORCE_STORAGE_KEY } from "./onboarding";
import { ProductTour } from "./product-tour";
import type { TourTabId } from "./product-tour/types";
import { ModsTab } from "./tabs/ModsTab";
import { PlayTab } from "./tabs/PlayTab";
import { FriendsTab } from "./tabs/FriendsTab";
import { RoomsTab } from "./tabs/RoomsTab";
import { AccountsTab } from "./tabs/AccountsTab";
import { DEFAULT_ACCENT_COLOR } from "./tabs/settings/accentColor";
import { ActiveDownloadsPanel } from "./components/ActiveDownloadsPanel";
import { HotkeysModal } from "./components/HotkeysModal";
import { SessionNotificationsBell } from "./components/SessionNotificationsBell";
import { TabSplitDropOverlay } from "./components/tab_split_drop_overlay";
import { UpdatePopupModal } from "./components/UpdatePopupModal";
import { ProfileInfoModal, type ProfileInfoData } from "./components/profile_info_modal";
import { AccountSwitcher } from "./app/components/AccountSwitcher";
import { AppSidebar } from "./app/components/AppSidebar";
import { HelpModal } from "./app/components/HelpModal";
import { LauncherAnimationScope } from "./app/components/LauncherAnimationScope";
import { LauncherBackdrop } from "./app/components/LauncherBackdrop";
import { NotificationToasts } from "./app/components/NotificationToasts";
import { PinnedProfileMenu, type PinnedProfileMenuState } from "./app/components/PinnedProfileMenu";
import { RemoveAccountDialog } from "./app/components/RemoveAccountDialog";
import { SocialPromptCards } from "./app/components/SocialPromptCards";
import { TabDragGhost } from "./app/components/TabDragGhost";
import { TabPaneLoading } from "./app/components/TabPaneLoading";
import { ConfirmHost, TabErrorBoundary } from "./components/ui";
import { TabSplitPanes } from "./app/components/TabSplitPanes";
import { TitleBar } from "./app/components/TitleBar";
import { toInstanceProfileCard } from "./app/profiles";
import {
  BOTTOM_SIDEBAR_ITEMS,
  isReorderableSidebarId,
  isSidebarHorizontal,
  parseSidebarPosition,
} from "./app/sidebar";
import type { Settings, SettingsTabId, SidebarItemId } from "./app/types";
import { useDiscordPresence } from "./hooks/useDiscordPresence";
import { useDownloadJobs } from "./hooks/useDownloadJobs";
import { useGameConsole } from "./hooks/useGameConsole";
import { useGameConsoleWindow } from "./hooks/useGameConsoleWindow";
import { useGameLaunch } from "./hooks/useGameLaunch";
import { useLaunchStage } from "./hooks/useLaunchStage";
import { useGameRunState } from "./hooks/useGameRunState";
import { useGlobalUiListeners } from "./hooks/useGlobalUiListeners";
import {
  useHotkeys,
  type AppHotkeyActions,
  type ModpackHotkeyActions,
  type ModpackNavigationActions,
  type ModpackViewId,
  type PlayConsoleHotkeyActions,
} from "./hooks/useHotkeys";
import { useInstanceProfiles } from "./hooks/useInstanceProfiles";
import { useLauncherAccounts } from "./hooks/useLauncherAccounts";
import { useLauncherAppearance } from "./hooks/useLauncherAppearance";
import { useLauncherSession } from "./hooks/useLauncherSession";
import { useLauncherSettings } from "./hooks/useLauncherSettings";
import { useLauncherUpdater } from "./hooks/useLauncherUpdater";
import { useNotifications } from "./hooks/useNotifications";
import { useOnboardingTour } from "./hooks/useOnboardingTour";
import { useOpenedMrpack } from "./hooks/useOpenedMrpack";
import { usePlatformNotificationToasts } from "./hooks/usePlatformNotificationToasts";
import { usePlatformWebSocket } from "./hooks/usePlatformWebSocket";
import { useRemoteNotices } from "./hooks/useRemoteNotices";
import { useSidebarLayout } from "./hooks/useSidebarLayout";
import { useTabSplitView } from "./hooks/useTabSplitView";
import { useVersionManager } from "./hooks/useVersionManager";

const ModpackTab = lazy(() =>
  import("./tabs/ModpackTab").then((m) => ({ default: m.ModpackTab })),
);
const SettingsTab = lazy(() =>
  import("./tabs/SettingsTab").then((m) => ({ default: m.SettingsTab })),
);


function App() {
  usePlatformWebSocket();
  useLauncherSession();
  useGlobalUiListeners();
  const [activeItem, setActiveItem] = useState<SidebarItemId>("play");
  const [settings, setSettings] = useState<Settings | null>(null);
  const sidebarPosition = parseSidebarPosition(settings?.sidebar_position);
  const sidebarHorizontal = isSidebarHorizontal(sidebarPosition);
  const {
    sidebarOrder,
    setSidebarOrder,
    sidebarRef,
    sidebarButtonRefs,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    sidebarIndicator,
    orderedSidebarItems,
  } = useSidebarLayout(activeItem, sidebarPosition);

  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false);
  const [isLoaderDropdownOpen, setIsLoaderDropdownOpen] = useState(false);
  const {
    jobs: activeDownloadJobs,
    startJob: startDownloadJob,
    updateJobProgress: updateDownloadJobProgress,
    setJobPaused: setDownloadJobPaused,
    finishJob: finishDownloadJob,
    makeJobId: makeDownloadJobId,
  } = useDownloadJobs();
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("game");
  const [modpackView, setModpackView] = useState<ModpackViewId>("list");
  const [requestedModpackView, setRequestedModpackView] = useState<ModpackViewId | null>(
    null,
  );
  const [requestedProfileSettingsId, setRequestedProfileSettingsId] = useState<string | null>(
    null,
  );
  const [language, setLanguage] = useState<Language>(
    () => readStoredLanguage() ?? "ru",
  );
  const [showHelpModal, setShowHelpModal] = useState(false);
  const tt = useT(language);

  const {
    notifications,
    setNotifications,
    beginDismissNotification,
    pushNotification,
    showNotification,
    sessionNotifications,
    setSessionNotifications,
    sessionNotificationsOpen,
    setSessionNotificationsOpen,
    sessionNotificationsRef,
  } = useNotifications(settings);

  usePlatformNotificationToasts(showNotification, language);

  const {
    profile,
    setProfile,
    launcherAccounts,
    refreshLauncherAccounts,
    addingAccount,
    pendingRemoveAccountId,
    setPendingRemoveAccountId,
    accountSwitcherOpen,
    setAccountSwitcherOpen,
    accountSwitcherRef,
    nicknameDraft,
    setNicknameDraft,
    elyLoading,
    msLoading,
    elyAuthUrl,
    msAuthUrl,
    accountKindShortLabel,
    isAuthorized,
    displayedNickname,
    activeAccountId,
    activeAccountLabel,
    activeAccountKind,
    profileAvatarInput,
    platformNickname,
    loadProfile,
    handleSaveNickname,
    handleElyLogin,
    handleElyLogout,
    handleMicrosoftLogin,
    handleMicrosoftLogout,
    handleSwitchLauncherAccount,
    requestRemoveLauncherAccount,
    confirmRemoveLauncherAccount,
    removeLauncherAccount,
    handleAddLauncherAccount,
  } = useLauncherAccounts({ activeItem, language, showNotification, tt });

  const splitViewEnabled = settings?.split_view_enabled ?? false;
  const animationsDisabled = settings?.animations_disabled ?? false;

  const playConsoleHotkeysRef = useRef<PlayConsoleHotkeyActions | null>(null);
  const modpackHotkeysRef = useRef<ModpackHotkeyActions | null>(null);
  const appHotkeysRef = useRef<AppHotkeyActions | null>(null);
  const [showHotkeysModal, setShowHotkeysModal] = useState(false);
  const modpackNavRef = useRef<ModpackNavigationActions | null>(null);

  const registerPlayConsoleHotkeys = useCallback(
    (actions: PlayConsoleHotkeyActions | null) => {
      playConsoleHotkeysRef.current = actions;
    },
    [],
  );

  const registerModpackHotkeys = useCallback(
    (actions: ModpackHotkeyActions | null) => {
      modpackHotkeysRef.current = actions;
    },
    [],
  );

  const registerModpackNavigation = useCallback(
    (actions: ModpackNavigationActions | null) => {
      modpackNavRef.current = actions;
    },
    [],
  );

  const clearRequestedModpackView = useCallback(() => {
    setRequestedModpackView(null);
  }, []);

  const clearRequestedProfileSettings = useCallback(() => {
    setRequestedProfileSettingsId(null);
  }, []);

  const setActiveItemWithSound = useCallback(
    (next: SidebarItemId) => {
      const uiSoundsEnabled = settings?.ui_sounds_enabled ?? true;
      if (uiSoundsEnabled && next !== activeItem) playTabSwitchSound();
      startTransition(() => {
        setActiveItem(next);
      });
    },
    [activeItem, settings?.ui_sounds_enabled],
  );

  const {
    onboardingVisible,
    setOnboardingVisible,
    productTourActive,
    tourAccountsSection,
    setTourAccountsSection,
    pendingProductTourRef,
    completeProductTour,
    startProductTour,
  } = useOnboardingTour({
    settings,
    setActiveItemWithSound,
    closeHelp: () => setShowHelpModal(false),
  });

  const {
    effectiveTabSplit,
    tabDrag,
    tabDropZone,
    isTabSplitDividerDragging,
    mainSplitRef,
    sidebarDragConsumedRef,
    splitTooNarrow,
    canUseSplitView,
    splitDropZoneLabels,
    setTabSplitLayout,
    activateSidebarTab,
    dismissTabSplitPane,
    handleSidebarTabPointerDown,
    onTabSplitDividerPointerDown,
  } = useTabSplitView({
    activeItem,
    splitViewEnabled,
    setActiveItemWithSound,
    showNotification,
    tt,
  });

  const {
    activeInstanceProfile,
    setActiveInstanceProfile,
    knownProfiles,
    setKnownProfiles,
    profilesHydrated,
    setProfilesHydrated,
    pinnedProfileIds,
    pinnedProfiles,
    activeProfileCard,
    handleToggleSidebarPin,
    handleOpenProfileInModpacks,
    handleDeleteProfileFromSidebar,
    handleModpackProfileSelectionChange,
    handleCreateProfileDesktopShortcut,
  } = useInstanceProfiles({ showNotification, tt, setActiveItemWithSound });
  const run = useGameRunState({
    activeItem,
    activeInstanceName: activeInstanceProfile?.name ?? null,
  });
  const { gameStatus, isLaunching, isStopping, setRoomPresenceContext, setLaunchPresenceContext } = run;
  const launchStage = useLaunchStage(isLaunching);
  const {
    runningConsoleProfileId,
    runningConsoleProfileIdRef,
    setRunningConsoleProfile,
    isConsoleVisible,
    setIsConsoleVisible,
    consoleLines,
    installConsoleLines,
    playConsoleLines,
    consoleHistorySessions,
    lastConsoleLineTextRef,
    manageConsoleExpandedRef,
    isConsoleDetachedRef,
    consoleUiActiveRef,
    archiveCurrentConsoleAndClear,
    flushPendingConsoleLines,
    restoreHiddenConsoleBuffer,
    handleManageConsoleExpandedChange,
    prepareInstallConsole,
    resolveLaunchConsoleProfileId,
    handleToggleConsole,
    handleClearConsole,
  } = useGameConsole({
    activeInstanceProfileId: activeInstanceProfile?.id ?? null,
    gameStatus,
    isLaunching,
  });

  const {
    loader,
    setLoader,
    versions,
    selectedVersion,
    setSelectedVersion,
    versionsLoading,
    isInstalling,
    installPaused,
    progress,
    fabricProfileId,
    quiltProfileId,
    isInstalled,
    installedVersionIdsForDropdown,
    handlePauseInstall,
    handleCancelInstall,
    handleResumeInstall,
    runVersionInstall,
    roomCurrentGame,
    applyRoomGameSettings,
  } = useVersionManager({
    settings,
    activeInstanceProfile,
    language,
    tt,
    showNotification,
    startDownloadJob,
    updateDownloadJobProgress,
    setDownloadJobPaused,
    finishDownloadJob,
    prepareInstallConsole,
    setIsConsoleVisible,
  });

  const hotkeyTabOrder = useMemo<SidebarItemId[]>(
    () => [...orderedSidebarItems.map((i) => i.id), ...BOTTOM_SIDEBAR_ITEMS.map((i) => i.id)],
    [orderedSidebarItems],
  );
  const hotkeyForTab = useCallback(
    (id: SidebarItemId): string | null => {
      const idx = hotkeyTabOrder.indexOf(id);
      return idx >= 0 && idx < 9 ? String(idx + 1) : null;
    },
    [hotkeyTabOrder],
  );
  const activateHotkeyTab = useCallback(
    (id: SidebarItemId) => {
      if (isSplittableTab(id)) activateSidebarTab(id);
      else setActiveItemWithSound(id);
    },
    [activateSidebarTab, setActiveItemWithSound],
  );
  const { handleModpackSidebarClick } = useHotkeys({
    activeTab: activeItem,
    effectiveTabSplit,
    isConsoleVisible,
    playConsoleActionsRef: playConsoleHotkeysRef,
    modpackActionsRef: modpackHotkeysRef,
    appActionsRef: appHotkeysRef,
    settingsTab,
    modpackView,
    modpackNavRef,
    setActiveItem: setActiveItemWithSound,
    tabOrder: hotkeyTabOrder,
    activateTab: activateHotkeyTab,
    setSettingsTab,
    setModpackView,
    setRequestedModpackView,
  });

  const [pinnedContextMenu, setPinnedContextMenu] = useState<PinnedProfileMenuState | null>(null);
  const [profileInfoProfile, setProfileInfoProfile] = useState<ProfileInfoData | null>(null);
  const [discordModsTitle, setDiscordModsTitle] = useState<string | null>(null);

  const {
    handlePlayPinnedProfile,
    handleOpenGameFolder,
    handleStopGame,
    handleTitleBarProfilePlay,
    handlePrimaryClick,
    handleLaunchToServer,
    primaryColorClasses,
    primaryLabel,
  } = useGameLaunch({
    settings,
    profile,
    activeAccountKind,
    activeInstanceProfile,
    setActiveInstanceProfile,
    knownProfiles,
    profilesHydrated,
    run,
    gameConsole: {
      setRunningConsoleProfile,
      runningConsoleProfileIdRef,
      archiveCurrentConsoleAndClear,
      restoreHiddenConsoleBuffer,
      flushPendingConsoleLines,
      resolveLaunchConsoleProfileId,
      lastConsoleLineTextRef,
      setIsConsoleVisible,
    },
    versionState: {
      selectedVersion,
      loader,
      fabricProfileId,
      quiltProfileId,
      isInstalled,
      isInstalling,
      runVersionInstall,
    },
    showNotification,
    tt,
  });

  const { systemMemoryGb, refreshSettings, updateSettings, persistInterfaceLanguage } =
    useLauncherSettings({
      settings,
      setSettings,
      setLanguage,
      setActiveItem,
      setActiveItemWithSound,
      showNotification,
      tt,
    });

  const { bottomSocialNotifications, setBottomSocialNotifications } = useRemoteNotices(
    settings,
    pushNotification,
  );

  const {
    updateStatus,
    updateVersion,
    updateDownloadPercent,
    updatePopupBanner,
    setUpdatePopupBanner,
    launcherVersion,
    launcherVersionBadgeKind,
    checkForUpdate,
    installUpdate,
    previewUpdatePopup,
  } = useLauncherUpdater({ settings, showNotification, tt });

  const { openedMrpackPath, setOpenedMrpackPath } = useOpenedMrpack(activateSidebarTab);

  useEffect(() => {
    if (activeItem === "settings") {
      void refreshSettings(activeInstanceProfile?.id ?? undefined);
    }
  }, [activeItem, activeInstanceProfile?.id, refreshSettings]);

  useDiscordPresence({
    activeItem,
    language,
    discordModsTitle,
    activeInstanceProfile,
    gameStatus,
    loader,
    selectedVersion,
    settings,
  });

  const { isConsoleDetached, toggleConsoleDetached } = useGameConsoleWindow({
    enabled:
      (settings?.show_console_on_launch ?? false) || isInstalling || installPaused,
    profileName: activeInstanceProfile?.name ?? null,
    profileId: activeInstanceProfile?.id ?? runningConsoleProfileId ?? null,
    language,
    consoleLines: playConsoleLines,
    isConsoleVisible,
    gameStatus,
    onClearConsole: handleClearConsole,
    onToggleConsole: handleToggleConsole,
  });

  useEffect(() => {
    isConsoleDetachedRef.current = isConsoleDetached;
    consoleUiActiveRef.current =
      isConsoleVisible ||
      isConsoleDetached ||
      manageConsoleExpandedRef.current ||
      isLaunching;

    if (!consoleUiActiveRef.current) return;
    const profileId =
      activeInstanceProfile?.id ?? runningConsoleProfileIdRef.current ?? null;
    if (profileId) restoreHiddenConsoleBuffer(profileId);
  }, [
    isConsoleVisible,
    isConsoleDetached,
    isLaunching,
    activeInstanceProfile?.id,
    restoreHiddenConsoleBuffer,
  ]);

  appHotkeysRef.current = {
    launchGame: () => {
      if (gameStatus === "running") return;
      handleTitleBarProfilePlay();
    },
    stopGame: () => void handleStopGame(),
    toggleSidebar: toggleSidebarCollapsed,
    openHotkeysHelp: () => setShowHotkeysModal(true),
  };
  const handleTitleBarProfileSettings = () => {
    if (!activeInstanceProfile) return;
    setActiveItemWithSound("modpacks");
    setRequestedProfileSettingsId(activeInstanceProfile.id);
  };

  const { accentColor, backgroundImageUrl, backgroundIsAnimated } = useLauncherAppearance(settings, activeItem);

  const renderMainTabContentRaw = useCallback(
    (tab: SplittableTabId, inSplitPane = false) => {
      switch (tab) {
        case "mods":
          return (
            <div
              className={
                inSplitPane
                  ? "tab-pane-fill px-2 py-2"
                  : "flex w-full flex-1 flex-col gap-4 overflow-auto py-4 items-stretch"
              }
            >
              <ModsTab
                fillPane={inSplitPane}
                showNotification={showNotification}
                language={language}
                activeProfileId={activeInstanceProfile?.id ?? null}
                activeProfileGameVersion={activeInstanceProfile?.game_version}
                activeProfileLoader={activeInstanceProfile?.loader}
                onOpenModpacksTab={() => activateSidebarTab("modpacks")}
                onSelectedModTitleChange={setDiscordModsTitle}
                registerDownloadJob={startDownloadJob}
                updateDownloadJob={updateDownloadJobProgress}
                finishDownloadJob={finishDownloadJob}
                makeDownloadJobId={makeDownloadJobId}
              />
            </div>
          );
        case "modpacks":
          return (
            <div
              className={
                inSplitPane
                  ? "tab-pane-fill py-2"
                  : "flex min-h-0 w-full flex-1 flex-col gap-4 overflow-auto self-stretch py-4"
              }
            >
              <Suspense fallback={<TabPaneLoading />}>
                <ModpackTab
                  fillPane={inSplitPane}
                  language={language}
                  initialProfiles={profilesHydrated ? knownProfiles : undefined}
                  onRegisterModpackHotkeys={registerModpackHotkeys}
                  onRegisterModpackNavigation={registerModpackNavigation}
                  onActiveViewChange={setModpackView}
                  requestedModpackView={requestedModpackView}
                  onRequestedModpackViewApplied={clearRequestedModpackView}
                  requestedProfileSettingsId={requestedProfileSettingsId}
                  onRequestedProfileSettingsApplied={clearRequestedProfileSettings}
                  showNotification={showNotification}
                  registerDownloadJob={startDownloadJob}
                  updateDownloadJob={updateDownloadJobProgress}
                  finishDownloadJob={finishDownloadJob}
                  makeDownloadJobId={makeDownloadJobId}
                  onProfileSelectionChange={handleModpackProfileSelectionChange}
                  initialSelectedProfileId={activeInstanceProfile?.id ?? null}
                  openedMrpackPath={openedMrpackPath}
                  onOpenedMrpackPathConsumed={() => setOpenedMrpackPath(null)}
                  onProfilesChange={(profiles) => {
                    setKnownProfiles(profiles.map(toInstanceProfileCard));
                    setProfilesHydrated(true);
                  }}
                  onTogglePinInSidebar={(profile) =>
                    handleToggleSidebarPin(toInstanceProfileCard(profile))
                  }
                  isPinnedInSidebar={(profileId) => pinnedProfileIds.includes(profileId)}
                  onOpenModsTab={() => activateSidebarTab("mods")}
                  onPlaySelectedProfile={() => {
                    if (!activeInstanceProfile) {
                      showNotification("warning", tt("app.warnings.selectProfileFirst"));
                      return;
                    }
                    void handlePrimaryClick();
                  }}
                  primaryLabel={primaryLabel}
                  primaryColorClasses={primaryColorClasses}
                  isLaunching={isLaunching}
                  isStopping={isStopping}
                  gameStatus={gameStatus}
                  consoleLines={consoleLines}
                  consoleHistorySessions={consoleHistorySessions}
                  onClearConsole={handleClearConsole}
                  prepareInstallConsole={prepareInstallConsole}
                  onManageConsoleExpandedChange={handleManageConsoleExpandedChange}
                />
              </Suspense>
            </div>
          );
        case "settings":
          return (
            <div
              className={
                inSplitPane
                  ? "tab-pane-fill"
                  : "flex h-full min-h-0 w-full flex-1 flex-col"
              }
            >
              <Suspense fallback={<TabPaneLoading />}>
              <SettingsTab
                fillPane={inSplitPane}
                settings={settings}
                settingsTab={settingsTab}
                setSettingsTab={setSettingsTab}
                systemMemoryGb={systemMemoryGb}
                updateSettings={(patch) =>
                  updateSettings(patch, activeInstanceProfile?.id ?? undefined)
                }
                showNotification={showNotification}
                language={language}
                setLanguage={persistInterfaceLanguage}
                sidebarOrder={sidebarOrder.filter(isReorderableSidebarId)}
                setSidebarOrder={setSidebarOrder}
                updateStatus={updateStatus}
                updateVersion={updateVersion}
                updateDownloadPercent={updateDownloadPercent}
                onCheckUpdate={() => void checkForUpdate({ silent: false, source: "manual" })}
                onPreviewUpdatePopup={() => void previewUpdatePopup()}
                onInstallUpdate={() => void installUpdate()}
              />
              </Suspense>
            </div>
          );
        case "play":
        default:
          return (
            <div
              className={
                inSplitPane
                  ? "tab-pane-fill items-center justify-center overflow-auto py-2"
                  : "flex min-h-0 w-full flex-1 flex-col items-center"
              }
            >
              <PlayTab
                fillPane={inSplitPane}
                gameStatus={gameStatus}
                playConsoleLines={playConsoleLines}
                isConsoleVisible={isConsoleVisible}
                onRegisterConsoleHotkeys={registerPlayConsoleHotkeys}
                onToggleConsole={handleToggleConsole}
                onClearConsole={handleClearConsole}
                showConsoleOnLaunch={settings?.show_console_on_launch ?? false}
                versions={versions}
                selectedVersion={selectedVersion}
                setSelectedVersion={setSelectedVersion}
                versionsLoading={versionsLoading}
                isVersionDropdownOpen={isVersionDropdownOpen}
                setIsVersionDropdownOpen={setIsVersionDropdownOpen}
                installPaused={installPaused}
                isInstalling={isInstalling}
                handleResumeInstall={handleResumeInstall}
                handlePauseInstall={handlePauseInstall}
                handleCancelInstall={handleCancelInstall}
                handlePrimaryClick={handlePrimaryClick}
                isLaunching={isLaunching}
                launchStage={launchStage}
                primaryColorClasses={primaryColorClasses}
                primaryLabel={primaryLabel}
                progress={progress}
                loader={loader}
                setLoader={setLoader}
                isLoaderDropdownOpen={isLoaderDropdownOpen}
                setIsLoaderDropdownOpen={setIsLoaderDropdownOpen}
                handleOpenGameFolder={handleOpenGameFolder}
                language={language}
                installedVersionIds={installedVersionIdsForDropdown}
                showSnapshots={settings?.show_snapshots ?? false}
                isConsoleDetached={isConsoleDetached}
                onToggleConsoleDetached={toggleConsoleDetached}
                profiles={profilesHydrated ? knownProfiles : []}
                selectedProfileId={activeInstanceProfile?.id ?? null}
                onSelectProfile={(profileId) => {
                  const profile = knownProfiles.find((p) => p.id === profileId);
                  if (!profile) return;
                  handleModpackProfileSelectionChange(profile);
                  void invoke("set_selected_profile", { id: profileId }).catch(() => {});
                }}
                onPlayProfile={(profileId) => {
                  const profile = knownProfiles.find((p) => p.id === profileId);
                  if (!profile) return;
                  void handlePlayPinnedProfile(profile);
                }}
                onOpenModpacks={() => activateSidebarTab("modpacks")}
                onOpenModpackView={(view) => {
                  setRequestedModpackView(view);
                  activateSidebarTab("modpacks");
                }}
                onOpenProfile={(profileId) => {
                  void handleOpenProfileInModpacks(profileId);
                }}
                onOpenProfileSettings={handleTitleBarProfileSettings}
              />
            </div>
          );
      }
    },
    [
      activateSidebarTab,
      activeInstanceProfile,
      checkForUpdate,
      consoleHistorySessions,
      consoleLines,
      playConsoleLines,
      installConsoleLines,
      gameStatus,
      handleCancelInstall,
      handleClearConsole,
      handleModpackProfileSelectionChange,
      prepareInstallConsole,
      registerModpackHotkeys,
      registerPlayConsoleHotkeys,
      handleOpenGameFolder,
      handlePauseInstall,
      handlePrimaryClick,
      handleResumeInstall,
      handleToggleConsole,
      isConsoleDetached,
      toggleConsoleDetached,
      handleToggleSidebarPin,
      installPaused,
      installUpdate,
      previewUpdatePopup,
      installedVersionIdsForDropdown,
      isConsoleVisible,
      isInstalling,
      isLaunching,
      launchStage,
      isStopping,
      isLoaderDropdownOpen,
      isVersionDropdownOpen,
      language,
      loader,
      pinnedProfileIds,
      primaryColorClasses,
      primaryLabel,
      profilesHydrated,
      knownProfiles,
      progress,
      selectedVersion,
      setDiscordModsTitle,
      setIsLoaderDropdownOpen,
      setIsVersionDropdownOpen,
      persistInterfaceLanguage,
      setLoader,
      setSelectedVersion,
      setSettingsTab,
      settings,
      settingsTab,
      showNotification,
      sidebarOrder,
      systemMemoryGb,
      tt,
      updateDownloadPercent,
      updateSettings,
      updateStatus,
      updateVersion,
      versions,
      versionsLoading,
    ],
  );

  const renderMainTabContent = useCallback(
    (tab: SplittableTabId, inSplitPane = false) => (
      <TabErrorBoundary key={tab} language={language} tabName={tab}>
        {renderMainTabContentRaw(tab, inSplitPane)}
      </TabErrorBoundary>
    ),
    [language, renderMainTabContentRaw],
  );

  const singleMainTab: SplittableTabId = isSplittableTab(activeItem) ? activeItem : "play";

  if (onboardingVisible === null) {
    return (
      <LauncherAnimationScope animationsDisabled={animationsDisabled}>
        <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#050609] text-white">
          <p className="text-sm text-white/45">{tt("common.loading")}</p>
        </div>
      </LauncherAnimationScope>
    );
  }

  if (onboardingVisible) {
    return (
      <LauncherAnimationScope animationsDisabled={animationsDisabled}>
        <OnboardingFlow
          language={language}
          accentColor={settings?.background_accent_color ?? DEFAULT_ACCENT_COLOR}
          backgroundImageUrl={backgroundImageUrl}
          backgroundAnimated={backgroundIsAnimated}
          onLanguagePersist={persistInterfaceLanguage}
          onAccentPersist={(color) => void updateSettings({ background_accent_color: color })}
          onProfileUpdated={loadProfile}
          onComplete={async ({ tour }) => {
            pendingProductTourRef.current = tour;
            try {
              window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "1");
              window.localStorage.removeItem(ONBOARDING_FORCE_STORAGE_KEY);
            } catch {
            }
            await updateSettings({ onboarding_completed: true });
            setOnboardingVisible(false);
          }}
        />
      </LauncherAnimationScope>
    );
  }

  return (
    <LauncherAnimationScope animationsDisabled={animationsDisabled}>
      <div className="relative min-h-screen w-full overflow-hidden text-white">
        <LauncherBackdrop
          settings={settings}
          backgroundImageUrl={backgroundImageUrl}
          backgroundIsAnimated={backgroundIsAnimated}
        />

        <ConfirmHost language={language} />

        <NotificationToasts
          notifications={notifications}
          setNotifications={setNotifications}
          onDismiss={beginDismissNotification}
        />

        <SocialPromptCards
          items={bottomSocialNotifications}
          setItems={setBottomSocialNotifications}
          tt={tt}
        />

        {updatePopupBanner && (
          <UpdatePopupModal
            language={language}
            banner={updatePopupBanner}
            version={updateVersion}
            busy={
              updateStatus === "checking" ||
              updateStatus === "downloading" ||
              updateStatus === "installing"
            }
            onClose={() => setUpdatePopupBanner(null)}
            onUpdate={() => {
              void installUpdate();
            }}
          />
        )}

        <HotkeysModal
          language={language}
          open={showHotkeysModal}
          onClose={() => setShowHotkeysModal(false)}
        />
        {showHelpModal && (
          <HelpModal
            tt={tt}
            onClose={() => setShowHelpModal(false)}
            onReplayTour={startProductTour}
          />
        )}

        {pendingRemoveAccountId !== null && (
          <RemoveAccountDialog
            tt={tt}
            onCancel={() => setPendingRemoveAccountId(null)}
            onConfirm={confirmRemoveLauncherAccount}
          />
        )}

        <ProfileInfoModal
          language={language}
          profile={profileInfoProfile}
          onClose={() => setProfileInfoProfile(null)}
        />

        {pinnedContextMenu && (
          <PinnedProfileMenu
            menu={pinnedContextMenu}
            profiles={knownProfiles}
            tt={tt}
            onClose={() => setPinnedContextMenu(null)}
            onShowInfo={setProfileInfoProfile}
            onOpenProfile={(profileId) => void handleOpenProfileInModpacks(profileId)}
            onCreateShortcut={(profile) => void handleCreateProfileDesktopShortcut(profile)}
            onTogglePin={handleToggleSidebarPin}
            onDeleteProfile={(profileId) => void handleDeleteProfileFromSidebar(profileId)}
          />
        )}

        <TitleBar
          tt={tt}
          language={language}
          launcherVersion={launcherVersion}
          launcherVersionBadgeKind={launcherVersionBadgeKind}
          updateVersion={updateVersion}
          onOpenHelp={() => setShowHelpModal(true)}
          activeInstanceProfile={activeInstanceProfile}
          activeProfileIconPath={activeProfileCard?.icon_path ?? null}
          gameStatus={gameStatus}
          isLaunching={isLaunching}
          isStopping={isStopping}
          onProfilePlay={handleTitleBarProfilePlay}
          onProfileStop={() => void handleStopGame()}
          onProfileSettings={handleTitleBarProfileSettings}
          onProfileOpen={(profileId) => void handleOpenProfileInModpacks(profileId)}
        >
          <SessionNotificationsBell
            language={language}
            open={sessionNotificationsOpen}
            items={sessionNotifications}
            panelRef={sessionNotificationsRef}
            onToggle={() => {
              setAccountSwitcherOpen(false);
              setSessionNotificationsOpen((o) => !o);
            }}
            onClear={() => setSessionNotifications([])}
          />
          <AccountSwitcher
            containerRef={accountSwitcherRef}
            open={accountSwitcherOpen}
            onToggle={() => {
              void refreshLauncherAccounts();
              setSessionNotificationsOpen(false);
              setAccountSwitcherOpen((o) => !o);
            }}
            tt={tt}
            label={activeAccountLabel}
            kind={activeAccountKind}
            avatarProfile={profileAvatarInput}
            accounts={launcherAccounts}
            kindShortLabel={accountKindShortLabel}
            adding={addingAccount}
            onSwitch={(accountId) => void handleSwitchLauncherAccount(accountId)}
            onRemove={requestRemoveLauncherAccount}
            onAdd={() => void handleAddLauncherAccount()}
            onManageAll={() => {
              setAccountSwitcherOpen(false);
              setActiveItemWithSound("accounts");
            }}
          />
        </TitleBar>

        <div
          className={`relative z-10 flex h-[calc(100vh-2.75rem)] ${
            sidebarPosition === "top"
              ? "flex-col"
              : sidebarPosition === "bottom"
                ? "flex-col-reverse"
                : sidebarPosition === "right"
                  ? "flex-row-reverse"
                  : "flex-row"
          }`}
        >
          <AppSidebar
            tt={tt}
            activeItem={activeItem}
            sidebarRef={sidebarRef}
            sidebarButtonRefs={sidebarButtonRefs}
            sidebarPosition={sidebarPosition}
            sidebarHorizontal={sidebarHorizontal}
            sidebarCollapsed={sidebarCollapsed}
            sidebarIndicator={sidebarIndicator}
            orderedSidebarItems={orderedSidebarItems}
            activeAccountLabel={activeAccountLabel}
            activeAccountKind={activeAccountKind}
            profileAvatarInput={profileAvatarInput}
            platformNickname={platformNickname}
            effectiveTabSplit={effectiveTabSplit}
            canUseSplitView={canUseSplitView}
            sidebarDragConsumedRef={sidebarDragConsumedRef}
            hotkeyForTab={hotkeyForTab}
            pinnedProfiles={pinnedProfiles}
            onSelectTab={setActiveItemWithSound}
            onActivateTab={activateSidebarTab}
            onModpacksTabClick={handleModpackSidebarClick}
            onTabPointerDown={handleSidebarTabPointerDown}
            onDismissSplitPane={dismissTabSplitPane}
            onPlayPinned={handlePlayPinnedProfile}
            onPinnedContextMenu={setPinnedContextMenu}
            onToggleCollapsed={toggleSidebarCollapsed}
          />

          <main
            ref={mainSplitRef}
            className={`relative z-0 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden px-6 py-3 ${
              tabDrag ? "select-none" : ""
            }`}
          >
            {splitViewEnabled && splitTooNarrow ? (
              <div
                className="mb-2 shrink-0 rounded-xl border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-center text-caption text-amber-100/90"
                role="status"
              >
                {tt("app.splitView.tooNarrowBanner")}
              </div>
            ) : null}
            {splitViewEnabled && !splitTooNarrow && !effectiveTabSplit && !tabDrag ? (
              <div
                className="pointer-events-none mb-2 shrink-0 text-center text-caption text-white/40"
                aria-hidden="true"
              >
                {tt("app.splitView.dragSidebarHint")}
              </div>
            ) : null}
            {tabDrag ? <TabDragGhost drag={tabDrag} /> : null}
            <div
              className={
                activeItem === "rooms"
                  ? "flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto py-4"
                  : "hidden"
              }
              aria-hidden={activeItem !== "rooms"}
            >
              <TabErrorBoundary language={language} tabName="rooms">
                <RoomsTab
                  showNotification={showNotification}
                  language={language}
                  minecraftAccountKind={activeAccountKind}
                  gameStatus={gameStatus}
                  tabActive={activeItem === "rooms"}
                  onLaunchToServer={handleLaunchToServer}
                  onPresenceContextChange={setRoomPresenceContext}
                  onRoomLaunchContextChange={setLaunchPresenceContext}
                  onOpenAccounts={() => setActiveItemWithSound("accounts")}
                  onApplyRoomGameSettings={applyRoomGameSettings}
                  currentGame={roomCurrentGame}
                />
              </TabErrorBoundary>
            </div>
            {activeItem === "friends" ? (
              <div className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto py-4">
                <TabErrorBoundary language={language} tabName="friends">
                  <FriendsTab
                    showNotification={showNotification}
                    language={language}
                    onOpenRooms={() => setActiveItemWithSound("rooms")}
                    onOpenAccounts={() => setActiveItemWithSound("accounts")}
                  />
                </TabErrorBoundary>
              </div>
            ) : activeItem === "rooms" ? null : activeItem === "accounts" ? (
              <TabErrorBoundary language={language} tabName="accounts">
              <AccountsTab
                showNotification={showNotification}
                language={language}
                profile={profile}
                setProfile={setProfile}
                launcherAccounts={launcherAccounts}
                nicknameDraft={nicknameDraft}
                setNicknameDraft={setNicknameDraft}
                isAuthorized={isAuthorized}
                displayedNickname={displayedNickname}
                profileAvatarInput={profileAvatarInput}
                activeAccountKind={activeAccountKind}
                activeAccountId={activeAccountId}
                elyLoading={elyLoading}
                msLoading={msLoading}
                elyAuthUrl={elyAuthUrl}
                msAuthUrl={msAuthUrl}
                addingAccount={addingAccount}
                accountKindShortLabel={accountKindShortLabel}
                onSaveNickname={handleSaveNickname}
                onMicrosoftLogin={handleMicrosoftLogin}
                onMicrosoftLogout={handleMicrosoftLogout}
                onElyLogin={handleElyLogin}
                onElyLogout={handleElyLogout}
                onSwitchAccount={handleSwitchLauncherAccount}
                tourAccountsSection={productTourActive ? tourAccountsSection : null}
                tourForceSettingsOpen={productTourActive && tourAccountsSection === "platform"}
                onRemoveAccount={removeLauncherAccount}
                onAddAccount={handleAddLauncherAccount}
              />
              </TabErrorBoundary>
            ) : effectiveTabSplit ? (
              <TabSplitPanes
                layout={effectiveTabSplit}
                tt={tt}
                dividerDragging={isTabSplitDividerDragging}
                onDividerPointerDown={onTabSplitDividerPointerDown}
                onLayoutChange={setTabSplitLayout}
                onFocusTab={setActiveItemWithSound}
                onDismissPane={dismissTabSplitPane}
                renderPane={(tab) => renderMainTabContent(tab, true)}
              />
            ) : (
              <div
                key={singleMainTab}
                className="tab-animate flex min-h-0 w-full flex-1 flex-col items-stretch justify-start"
              >
                {renderMainTabContent(singleMainTab)}
              </div>
            )}
            {tabDrag && canUseSplitView ? (
              <TabSplitDropOverlay zone={tabDropZone} labels={splitDropZoneLabels} />
            ) : null}
          </main>

          <ActiveDownloadsPanel jobs={activeDownloadJobs} language={language} />
        </div>

        <ProductTour
          language={language}
          accentColor={accentColor}
          active={productTourActive}
          onNavigateTab={(tab: TourTabId) => setActiveItemWithSound(tab)}
          onNavigateAccountsSection={setTourAccountsSection}
          onComplete={completeProductTour}
          onSkip={completeProductTour}
        />
      </div>
    </LauncherAnimationScope>
  );
}

export default App;
