export type SplittableTabId = "play" | "settings" | "mods" | "modpacks";

export type TabDropZone = "left" | "right" | "top" | "bottom" | "center";

export type SplitDirection = "horizontal" | "vertical";

export type TabSplitLayout = {
  direction: SplitDirection;
  primary: SplittableTabId;
  secondary: SplittableTabId;
  focused: "primary" | "secondary";
  ratio: number;
};

export const TAB_SPLIT_LAYOUT_STORAGE_KEY = "tab_split_layout_v1";
export const TAB_SPLIT_RATIO_MIN = 0.22;
export const TAB_SPLIT_RATIO_MAX = 0.78;
export const TAB_SPLIT_RATIO_DEFAULT = 0.5;
export const TAB_DRAG_THRESHOLD_PX = 8;
export const TAB_DROP_EDGE_FRAC = 0.22;

const SPLITTABLE_ORDER: SplittableTabId[] = ["play", "mods", "modpacks", "settings"];

export function isSplittableTab(id: string): id is SplittableTabId {
  return (
    id === "play" ||
    id === "settings" ||
    id === "mods" ||
    id === "modpacks"
  );
}

export function pickCompanionTab(tab: SplittableTabId): SplittableTabId {
  return SPLITTABLE_ORDER.find((t) => t !== tab) ?? "play";
}

export function detectDropZone(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): TabDropZone {
  const rx = (clientX - rect.left) / rect.width;
  const ry = (clientY - rect.top) / rect.height;
  if (rx < TAB_DROP_EDGE_FRAC) return "left";
  if (rx > 1 - TAB_DROP_EDGE_FRAC) return "right";
  if (ry < TAB_DROP_EDGE_FRAC) return "top";
  if (ry > 1 - TAB_DROP_EDGE_FRAC) return "bottom";
  return "center";
}

export function loadTabSplitLayout(): TabSplitLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TAB_SPLIT_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<TabSplitLayout>;
    if (
      !data ||
      (data.direction !== "horizontal" && data.direction !== "vertical") ||
      !isSplittableTab(data.primary ?? "") ||
      !isSplittableTab(data.secondary ?? "") ||
      data.primary === data.secondary
    ) {
      return null;
    }
    const ratio =
      typeof data.ratio === "number" && Number.isFinite(data.ratio)
        ? Math.min(TAB_SPLIT_RATIO_MAX, Math.max(TAB_SPLIT_RATIO_MIN, data.ratio))
        : TAB_SPLIT_RATIO_DEFAULT;
    return {
      direction: data.direction,
      primary: data.primary!,
      secondary: data.secondary!,
      focused: data.focused === "secondary" ? "secondary" : "primary",
      ratio,
    };
  } catch {
    return null;
  }
}

export function saveTabSplitLayout(layout: TabSplitLayout | null) {
  if (typeof window === "undefined") return;
  try {
    if (!layout) {
      window.localStorage.removeItem(TAB_SPLIT_LAYOUT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(TAB_SPLIT_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
  }
}

export function applyTabDrop(
  dragged: SplittableTabId,
  zone: TabDropZone,
  currentTab: SplittableTabId,
  existing: TabSplitLayout | null,
): { layout: TabSplitLayout | null; focusedTab: SplittableTabId } {
  if (zone === "center") {
    return { layout: null, focusedTab: dragged };
  }

  const direction: SplitDirection =
    zone === "left" || zone === "right" ? "horizontal" : "vertical";
  const draggedInFirst = zone === "left" || zone === "top";

  if (!existing) {
    let primary = draggedInFirst ? dragged : currentTab;
    let secondary = draggedInFirst ? currentTab : dragged;
    if (primary === secondary) {
      secondary = pickCompanionTab(dragged);
      primary = draggedInFirst ? dragged : secondary;
      secondary = draggedInFirst ? secondary : dragged;
    }
    const focused: TabSplitLayout["focused"] = draggedInFirst ? "primary" : "secondary";
    return {
      layout: {
        direction,
        primary,
        secondary,
        focused,
        ratio: TAB_SPLIT_RATIO_DEFAULT,
      },
      focusedTab: draggedInFirst ? primary : secondary,
    };
  }

  const other =
    dragged === existing.primary
      ? existing.secondary
      : dragged === existing.secondary
        ? existing.primary
        : existing.focused === "primary"
          ? existing.secondary
          : existing.primary;

  const primary = draggedInFirst ? dragged : other;
  const secondary = draggedInFirst ? other : dragged;
  const focused: TabSplitLayout["focused"] = draggedInFirst ? "primary" : "secondary";
  return {
    layout: {
      ...existing,
      direction,
      primary,
      secondary,
      focused,
    },
    focusedTab: focused === "primary" ? primary : secondary,
  };
}

export function focusedTabFromLayout(layout: TabSplitLayout): SplittableTabId {
  return layout.focused === "primary" ? layout.primary : layout.secondary;
}

export function tabPaneRole(
  tab: SplittableTabId,
  layout: TabSplitLayout,
): "primary" | "secondary" | null {
  if (tab === layout.primary) return "primary";
  if (tab === layout.secondary) return "secondary";
  return null;
}
