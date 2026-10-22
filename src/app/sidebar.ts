import type { SidebarItemId } from "./types";

export const SIDEBAR_POSITIONS = ["left", "right", "top", "bottom"] as const;
export type SidebarPosition = (typeof SIDEBAR_POSITIONS)[number];

export function parseSidebarPosition(value: string | undefined | null): SidebarPosition {
  if (value && SIDEBAR_POSITIONS.includes(value as SidebarPosition)) {
    return value as SidebarPosition;
  }
  return "left";
}

export function isSidebarHorizontal(position: SidebarPosition): boolean {
  return position === "top" || position === "bottom";
}

export const SIDEBAR_ICON_PATHS: Partial<Record<SidebarItemId, string>> = {
  play: "/launcher-assets/play.svg",
  settings: "/launcher-assets/settings.svg",
  friends: "/launcher-assets/group.svg",
  rooms: "/launcher-assets/room.svg",
  mods: "/launcher-assets/mods.svg",
  modpacks: "/launcher-assets/modpack_icon.svg",
};

export const REORDERABLE_SIDEBAR_IDS = ["play", "settings", "mods", "modpacks"] as const;
export type ReorderableSidebarId = (typeof REORDERABLE_SIDEBAR_IDS)[number];

export function isReorderableSidebarId(id: SidebarItemId): id is ReorderableSidebarId {
  return (REORDERABLE_SIDEBAR_IDS as readonly string[]).includes(id);
}

export const DEFAULT_SIDEBAR_ORDER: SidebarItemId[] = [...REORDERABLE_SIDEBAR_IDS];

export const sidebarItems: { id: SidebarItemId; labelKey: string }[] = [
  { id: "play", labelKey: "app.sidebar.play" },
  { id: "settings", labelKey: "app.sidebar.settings" },
  { id: "mods", labelKey: "app.sidebar.mods" },
  { id: "modpacks", labelKey: "app.sidebar.modpacks" },
];

export const BOTTOM_SIDEBAR_ITEMS: { id: SidebarItemId; labelKey: string }[] = [
  { id: "rooms", labelKey: "app.sidebar.rooms" },
  { id: "friends", labelKey: "app.sidebar.friends" },
];

export const TOUR_SIDEBAR_TARGET_IDS: Partial<Record<SidebarItemId, string>> = {
  settings: "tour-sidebar-settings",
  mods: "tour-sidebar-mods",
  modpacks: "tour-sidebar-modpacks",
};
