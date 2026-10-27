import { useMemo } from "react";
import type { InstanceProfileCard, SettingsTabId, SidebarItemId } from "../../app/types";
import { BOTTOM_SIDEBAR_ITEMS, SIDEBAR_ICON_PATHS, sidebarItems } from "../../app/sidebar";
import type { ModpackViewId } from "../../hooks/useHotkeys";
import { requestSettingsSearch } from "../../lib/settingsSearchBridge";
import { SETTING_SEARCH_CATALOG } from "../../tabs/settings/searchCatalog";
import type { PaletteCommand } from "./matching";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

export type PaletteDeps = {
  tt: Tt;
  profiles: InstanceProfileCard[];
  hotkeyForTab: (id: SidebarItemId) => string | null;
  gameRunning: boolean;
  activateTab: (id: SidebarItemId) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  openModpackView: (view: ModpackViewId) => void;
  openProfile: (profileId: string) => void;
  playProfile: (profile: InstanceProfileCard) => void;
  launchGame: () => void;
  stopGame: () => void;
  openGameFolder: () => void;
  toggleSidebar: () => void;
  openHotkeysHelp: () => void;
};

const SETTINGS_TABS: SettingsTabId[] = ["game", "versions", "launcher"];

function settingLabelKey(keys: string[]): string {
  return (
    keys.find((k) => /\.(label|title)$/.test(k) && !k.startsWith("settings.section.")) ??
    keys.find((k) => !k.startsWith("settings.section.") && !k.startsWith("settings.tab.")) ??
    keys[0]
  );
}

function cleanLabel(text: string): string {
  return text.replace(/[:：]\s*$/, "").trim();
}

export function usePaletteCommands(deps: PaletteDeps): PaletteCommand[] {
  const {
    tt,
    profiles,
    hotkeyForTab,
    gameRunning,
    activateTab,
    setSettingsTab,
    openModpackView,
    openProfile,
    playProfile,
    launchGame,
    stopGame,
    openGameFolder,
    toggleSidebar,
    openHotkeysHelp,
  } = deps;

  return useMemo(() => {
    const out: PaletteCommand[] = [];

    out.push(
      gameRunning
        ? {
            id: "action:stop",
            group: "actions",
            title: tt("commandPalette.action.stop"),
            hint: "Ctrl+Shift+K",
            run: stopGame,
          }
        : {
            id: "action:launch",
            group: "actions",
            title: tt("commandPalette.action.launch"),
            hint: "Ctrl+Enter",
            run: launchGame,
          },
      {
        id: "action:create",
        group: "actions",
        title: tt("commandPalette.action.create"),
        keywords: ["new", "instance", "новая"],
        run: () => openModpackView("create"),
      },
      {
        id: "action:import",
        group: "actions",
        title: tt("commandPalette.action.import"),
        keywords: ["mrpack", "zip", "curseforge", "prism"],
        run: () => openModpackView("import"),
      },
      {
        id: "action:gameFolder",
        group: "actions",
        title: tt("commandPalette.action.gameFolder"),
        run: openGameFolder,
      },
      {
        id: "action:sidebar",
        group: "actions",
        title: tt("commandPalette.action.sidebar"),
        hint: "Ctrl+B",
        run: toggleSidebar,
      },
      {
        id: "action:hotkeys",
        group: "actions",
        title: tt("commandPalette.action.hotkeys"),
        hint: "F1",
        run: openHotkeysHelp,
      },
    );

    for (const item of [...sidebarItems, ...BOTTOM_SIDEBAR_ITEMS]) {
      const key = hotkeyForTab(item.id);
      out.push({
        id: `tab:${item.id}`,
        group: "navigation",
        title: tt(item.labelKey),
        subtitle: tt("commandPalette.openTab"),
        iconSrc: SIDEBAR_ICON_PATHS[item.id] ?? null,
        hint: key ?? undefined,
        run: () => activateTab(item.id),
      });
    }
    for (const tab of SETTINGS_TABS) {
      out.push({
        id: `settingsTab:${tab}`,
        group: "navigation",
        title: `${tt("app.sidebar.settings")}: ${tt(`settings.tab.${tab}`)}`,
        run: () => {
          activateTab("settings");
          setSettingsTab(tab);
        },
      });
    }

    for (const p of profiles) {
      const meta = [p.game_version, p.loader !== "vanilla" ? p.loader : null].filter(Boolean).join(" · ");
      out.push({
        id: `profile:${p.id}`,
        group: "instances",
        title: p.name,
        subtitle: `${tt("commandPalette.openInstance")} · ${meta}`,
        keywords: [p.game_version, p.loader],
        run: () => openProfile(p.id),
      });
      out.push({
        id: `play:${p.id}`,
        group: "instances",
        title: tt("commandPalette.playInstance", { name: p.name }),
        subtitle: meta,
        disabled: gameRunning,
        run: () => playProfile(p),
      });
    }

    for (const entry of SETTING_SEARCH_CATALOG) {
      const label = cleanLabel(tt(settingLabelKey(entry.keys)));
      if (!label) continue;
      out.push({
        id: `setting:${entry.id}`,
        group: "settings",
        title: label,
        subtitle: `${tt("app.sidebar.settings")} · ${tt(`settings.tab.${entry.tab}`)}`,
        keywords: entry.keys.map((k) => tt(k)),
        run: () => {
          activateTab("settings");
          setSettingsTab(entry.tab);
          requestSettingsSearch(label);
        },
      });
    }

    return out;
  }, [
    tt,
    profiles,
    hotkeyForTab,
    gameRunning,
    activateTab,
    setSettingsTab,
    openModpackView,
    openProfile,
    playProfile,
    launchGame,
    stopGame,
    openGameFolder,
    toggleSidebar,
    openHotkeysHelp,
  ]);
}
