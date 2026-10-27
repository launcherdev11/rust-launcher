import type { SettingsTabId } from "../../app/types";

export type SettingSearchId =
  | "game.showConsole"
  | "game.graphicsAdapter"
  | "game.closeLauncher"
  | "game.checkProcesses"
  | "game.worldAutoBackup"
  | "game.gameDirectory"
  | "game.windowSize"
  | "game.ram"
  | "game.java"
  | "versions.showSnapshots"
  | "versions.showAlpha"
  | "versions.forgeProxy"
  | "versions.downloadSource"
  | "versions.loaderFilter"
  | "versions.versionFilter"
  | "versions.available"
  | "launcher.updates"
  | "launcher.openOnProfiles"
  | "launcher.uiSounds"
  | "launcher.discordRpc"
  | "launcher.minimizeToTray"
  | "launcher.autostart"
  | "launcher.splitView"
  | "launcher.disableAnimations"
  | "launcher.backgroundAnimation"
  | "launcher.disableThematicDecorations"
  | "launcher.language"
  | "launcher.accentColor"
  | "launcher.backgroundImage"
  | "launcher.adaptiveAccent"
  | "launcher.backgroundBlur"
  | "launcher.customThemes"
  | "launcher.sidebarPosition"
  | "launcher.sidebarOrder"
  | "launcher.resetSettings"
  | "launcher.cache"
  | "launcher.backup";

export type SettingSearchDef = {
  id: SettingSearchId;
  tab: SettingsTabId;
  keys: string[];
};


export const SETTING_SEARCH_CATALOG: SettingSearchDef[] = [
  {
    id: "game.showConsole",
    tab: "game",
    keys: ["settings.game.showConsoleOnLaunch.label"],
  },
  {
    id: "game.graphicsAdapter",
    tab: "game",
    keys: [
      "settings.section.display",
      "settings.game.graphicsAdapter.label",
      "settings.game.graphicsAdapter.hint",
    ],
  },
  {
    id: "game.closeLauncher",
    tab: "game",
    keys: ["settings.game.closeLauncherOnStart.label"],
  },
  {
    id: "game.checkProcesses",
    tab: "game",
    keys: ["settings.game.checkGameProcesses.label"],
  },
  {
    id: "game.worldAutoBackup",
    tab: "game",
    keys: ["worldTools.autoBackup.label", "worldTools.autoBackup.hint"],
  },
  {
    id: "game.gameDirectory",
    tab: "game",
    keys: [
      "settings.game.gameDirectory.label",
      "settings.game.gameDirectory.hint",
      "settings.game.gameDirectory.defaultPathHint",
    ],
  },
  {
    id: "game.windowSize",
    tab: "game",
    keys: ["settings.section.display", "settings.game.windowSize.label"],
  },
  {
    id: "game.ram",
    tab: "game",
    keys: ["settings.section.java", "settings.game.ram.label", "settings.game.subtab.java"],
  },
  {
    id: "game.java",
    tab: "game",
    keys: [
      "settings.section.java",
      "settings.game.subtab.java",
      "javaSettings.description",
      "javaSettings.useCustomArgs.label",
      "javaSettings.preferIpv6.label",
      "javaSettings.javaPath.label",
      "javaSettings.memory.title",
      "javaSettings.jvmArgs.title",
      "javaSettings.actions.verify",
      "javaSettings.actions.reinstall",
    ],
  },
  {
    id: "versions.showSnapshots",
    tab: "versions",
    keys: [
      "settings.section.versionList",
      "settings.versions.showSnapshots.label",
      "settings.tab.versions",
    ],
  },
  {
    id: "versions.showAlpha",
    tab: "versions",
    keys: ["settings.section.versionList", "settings.versions.showAlpha.label"],
  },
  {
    id: "versions.forgeProxy",
    tab: "versions",
    keys: ["settings.section.versionList", "settings.versions.forgeProxyFallback.label"],
  },
  {
    id: "versions.downloadSource",
    tab: "versions",
    keys: ["settings.section.versionList", "downloads.source.label", "downloads.source.hint"],
  },
  {
    id: "versions.loaderFilter",
    tab: "versions",
    keys: ["settings.versions.loaderFilter.label"],
  },
  {
    id: "versions.versionFilter",
    tab: "versions",
    keys: ["settings.versions.versionFilter.label"],
  },
  {
    id: "versions.available",
    tab: "versions",
    keys: ["settings.versions.available.label", "settings.card.versions"],
  },
  {
    id: "launcher.updates",
    tab: "launcher",
    keys: [
      "settings.card.updates",
      "settings.updates.checkOnStart.label",
      "settings.updates.autoInstall.label",
      "settings.updates.checkNow",
    ],
  },
  {
    id: "launcher.openOnProfiles",
    tab: "launcher",
    keys: [
      "settings.section.behavior",
      "settings.launcher.openOnProfilesTab.label",
      "settings.card.customization",
    ],
  },
  {
    id: "launcher.uiSounds",
    tab: "launcher",
    keys: ["settings.section.behavior", "settings.launcher.uiSounds.label"],
  },
  {
    id: "launcher.discordRpc",
    tab: "launcher",
    keys: [
      "settings.section.behavior",
      "settings.launcher.discordRpc.label",
      "settings.launcher.discordRpc.hint",
    ],
  },
  {
    id: "launcher.minimizeToTray",
    tab: "launcher",
    keys: ["settings.section.behavior", "settings.launcher.minimizeToTray.label"],
  },
  {
    id: "launcher.autostart",
    tab: "launcher",
    keys: ["settings.section.behavior", "settings.launcher.autostart.label"],
  },
  {
    id: "launcher.splitView",
    tab: "launcher",
    keys: [
      "settings.section.behavior",
      "settings.launcher.splitView.label",
      "settings.launcher.splitView.hint",
    ],
  },
  {
    id: "launcher.disableAnimations",
    tab: "launcher",
    keys: ["settings.section.appearance", "settings.launcher.disableAnimations.label"],
  },
  {
    id: "launcher.backgroundAnimation",
    tab: "launcher",
    keys: [
      "settings.section.appearance",
      "settings.launcher.backgroundAnimation.label",
      "settings.launcher.backgroundAnimation.hint",
    ],
  },
  {
    id: "launcher.disableThematicDecorations",
    tab: "launcher",
    keys: [
      "settings.section.appearance",
      "settings.launcher.disableThematicDecorations.label",
      "settings.launcher.disableThematicDecorations.hint",
    ],
  },
  {
    id: "launcher.language",
    tab: "launcher",
    keys: [
      "settings.section.interface",
      "settings.launcher.interfaceLanguage.label",
      "settings.card.interfaceLanguage",
    ],
  },
  {
    id: "launcher.accentColor",
    tab: "launcher",
    keys: ["settings.section.appearance", "settings.launcher.accentColor.label"],
  },
  {
    id: "launcher.backgroundImage",
    tab: "launcher",
    keys: [
      "settings.section.appearance",
      "settings.launcher.backgroundImage.label",
      "settings.launcher.backgroundImage.hint",
    ],
  },
  {
    id: "launcher.adaptiveAccent",
    tab: "launcher",
    keys: [
      "settings.section.appearance",
      "settings.launcher.adaptiveAccent.label",
      "settings.launcher.adaptiveAccent.hint",
    ],
  },
  {
    id: "launcher.backgroundBlur",
    tab: "launcher",
    keys: ["settings.section.appearance", "settings.launcher.backgroundBlur.label"],
  },
  {
    id: "launcher.customThemes",
    tab: "launcher",
    keys: [
      "settings.section.themes",
      "settings.launcher.customThemes.label",
      "settings.launcher.customThemes.default",
      "settings.launcher.customThemes.importZip",
      "settings.launcher.customThemes.create",
      "settings.launcher.customThemes.openFolder",
      "settings.launcher.customThemes.editCss",
      "settings.launcher.customThemes.delete",
      "settings.launcher.customThemes.openEditor",
      "settings.launcher.customThemes.duplicate",
      "settings.launcher.customThemes.exportZip",
      "settings.launcher.customThemes.hotReload.label",
    ],
  },
  {
    id: "launcher.sidebarPosition",
    tab: "launcher",
    keys: ["settings.section.interface", "settings.launcher.sidebarPosition.label"],
  },
  {
    id: "launcher.sidebarOrder",
    tab: "launcher",
    keys: ["settings.section.interface", "settings.launcher.sidebarOrder.label"],
  },
  {
    id: "launcher.resetSettings",
    tab: "launcher",
    keys: ["settings.section.data", "settings.launcher.resetSettings.button"],
  },
  {
    id: "launcher.cache",
    tab: "launcher",
    keys: [
      "settings.section.data",
      "settings.launcher.cache.label",
      "settings.launcher.cache.description",
    ],
  },
  {
    id: "launcher.backup",
    tab: "launcher",
    keys: [
      "settings.section.data",
      "settings.launcher.backup.title",
      "settings.launcher.backup.exportButton",
      "settings.launcher.backup.importButton",
      "settings.launcher.backup.hint",
    ],
  },
];
