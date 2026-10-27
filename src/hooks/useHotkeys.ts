import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { hotkeyKey, isHotkeyKey } from "../lib/hotkeyKey";
import type { TabSplitLayout } from "../splitView";

export type PlayConsoleHotkeyActions = {
  copyConsole: () => void | Promise<void>;
  toggleConsoleDetached: () => void;
};

export type ModpackHotkeyActions = {
  openCreate: () => void;
  openImport: () => void;
  openScreenshots: () => void;
};

export type AppHotkeyActions = {
  launchGame: () => void;
  stopGame: () => void;
  toggleSidebar: () => void;
  openHotkeysHelp: () => void;
  openCommandPalette: () => void;
};

export const HOTKEY_REFRESH_EVENT = "launcher:hotkey-refresh";
export const HOTKEY_SEARCH_SELECTOR = "[data-hotkey-search]";

export type ModpackViewId = "list" | "create" | "import" | "manage";

export type ModpackNavigationActions = {
  getActiveView: () => ModpackViewId;
  goToList: () => void;
  setActiveView: (view: ModpackViewId) => void;
  openProfileSettings: (profileId: string) => void;
};

type SidebarTabId = "play" | "settings" | "friends" | "rooms" | "mods" | "modpacks" | "accounts";
type SettingsTabId = "game" | "versions" | "launcher";

type NavSnapshot = {
  activeItem: SidebarTabId;
  settingsTab: SettingsTabId;
  modpackView: ModpackViewId;
};

const MAX_NAV_HISTORY = 50;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const el = target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
  );
  return el !== null;
}

function isOverlayOpen(): boolean {
  return document.querySelector('[aria-modal="true"], .glass-overlay') !== null;
}

function focusVisibleSearch(): boolean {
  const fields = document.querySelectorAll<HTMLInputElement>(HOTKEY_SEARCH_SELECTOR);
  for (const field of fields) {
    if (field.offsetParent === null || field.disabled) continue;
    field.focus();
    field.select();
    return true;
  }
  return false;
}

function digitFromEvent(e: KeyboardEvent): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  return m ? Number(m[1]) : null;
}

function isCtrlOrMeta(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

function isSplittableTabVisible(
  tab: "play" | "modpacks",
  activeTab: SidebarTabId,
  split: TabSplitLayout | null,
): boolean {
  if (split) {
    return split.primary === tab || split.secondary === tab;
  }
  return activeTab === tab;
}

function isModpacksTabVisible(activeItem: SidebarTabId, split: TabSplitLayout | null): boolean {
  if (split) {
    return split.primary === "modpacks" || split.secondary === "modpacks";
  }
  return activeItem === "modpacks";
}

function navSnapshotsEqual(a: NavSnapshot, b: NavSnapshot): boolean {
  return (
    a.activeItem === b.activeItem &&
    a.settingsTab === b.settingsTab &&
    a.modpackView === b.modpackView
  );
}

type HotkeyMatch = {
  key: string;
  ctrl: boolean;
  shift: boolean;
};

type HotkeyHandlerContext = {
  activeTab: SidebarTabId;
  effectiveTabSplit: TabSplitLayout | null;
  isConsoleVisible: boolean;
  playConsoleActionsRef: MutableRefObject<PlayConsoleHotkeyActions | null>;
  modpackActionsRef: MutableRefObject<ModpackHotkeyActions | null>;
};

type HotkeyBinding = {
  id: string;
  match: HotkeyMatch;
  when: (ctx: HotkeyHandlerContext) => boolean;
  run: (ctx: HotkeyHandlerContext) => boolean;
};

function matchesHotkey(e: KeyboardEvent, spec: HotkeyMatch): boolean {
  if (!isHotkeyKey(e, spec.key)) return false;
  if (spec.ctrl !== isCtrlOrMeta(e)) return false;
  if (spec.shift !== e.shiftKey) return false;
  if (e.altKey) return false;
  return true;
}

const HOTKEY_BINDINGS: HotkeyBinding[] = [
  {
    id: "play.copyConsole",
    match: { key: "c", ctrl: true, shift: true },
    when: (ctx) =>
      isSplittableTabVisible("play", ctx.activeTab, ctx.effectiveTabSplit) &&
      ctx.isConsoleVisible,
    run: (ctx) => {
      const actions = ctx.playConsoleActionsRef.current;
      if (!actions) return false;
      void actions.copyConsole();
      return true;
    },
  },
  {
    id: "play.toggleConsoleDetach",
    match: { key: "d", ctrl: true, shift: true },
    when: (ctx) =>
      isSplittableTabVisible("play", ctx.activeTab, ctx.effectiveTabSplit),
    run: (ctx) => {
      const actions = ctx.playConsoleActionsRef.current;
      if (!actions) return false;
      actions.toggleConsoleDetached();
      return true;
    },
  },
  {
    id: "modpacks.openCreate",
    match: { key: "n", ctrl: true, shift: false },
    when: (ctx) =>
      isSplittableTabVisible("modpacks", ctx.activeTab, ctx.effectiveTabSplit),
    run: (ctx) => {
      const actions = ctx.modpackActionsRef.current;
      if (!actions) return false;
      actions.openCreate();
      return true;
    },
  },
  {
    id: "modpacks.openScreenshots",
    match: { key: "s", ctrl: true, shift: true },
    when: (ctx) =>
      isSplittableTabVisible("modpacks", ctx.activeTab, ctx.effectiveTabSplit),
    run: (ctx) => {
      const actions = ctx.modpackActionsRef.current;
      if (!actions) return false;
      actions.openScreenshots();
      return true;
    },
  },
  {
    id: "modpacks.openImport",
    match: { key: "i", ctrl: true, shift: false },
    when: (ctx) =>
      isSplittableTabVisible("modpacks", ctx.activeTab, ctx.effectiveTabSplit),
    run: (ctx) => {
      const actions = ctx.modpackActionsRef.current;
      if (!actions) return false;
      actions.openImport();
      return true;
    },
  },
];

export type UseHotkeysOptions = {
  activeTab: SidebarTabId;
  effectiveTabSplit: TabSplitLayout | null;
  isConsoleVisible: boolean;
  playConsoleActionsRef: MutableRefObject<PlayConsoleHotkeyActions | null>;
  modpackActionsRef: MutableRefObject<ModpackHotkeyActions | null>;
  appActionsRef: MutableRefObject<AppHotkeyActions | null>;
  settingsTab: SettingsTabId;
  modpackView: ModpackViewId;
  modpackNavRef: MutableRefObject<ModpackNavigationActions | null>;
  setActiveItem: (item: SidebarTabId) => void;
  tabOrder: SidebarTabId[];
  activateTab: (item: SidebarTabId) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  setModpackView: (view: ModpackViewId) => void;
  setRequestedModpackView: (view: ModpackViewId | null) => void;
};

export function useHotkeys({
  activeTab,
  effectiveTabSplit,
  isConsoleVisible,
  playConsoleActionsRef,
  modpackActionsRef,
  appActionsRef,
  settingsTab,
  modpackView,
  modpackNavRef,
  setActiveItem,
  tabOrder,
  activateTab,
  setSettingsTab,
  setModpackView,
  setRequestedModpackView,
}: UseHotkeysOptions) {
  const pastRef = useRef<NavSnapshot[]>([]);
  const futureRef = useRef<NavSnapshot[]>([]);
  const applyingNavRef = useRef(false);
  const lastNavRef = useRef<NavSnapshot | null>(null);
  const isFirstNavRenderRef = useRef(true);

  const currentNavSnapshot = useCallback(
    (): NavSnapshot => ({
      activeItem: activeTab,
      settingsTab,
      modpackView,
    }),
    [activeTab, settingsTab, modpackView],
  );

  useEffect(() => {
    const snap = currentNavSnapshot();
    if (isFirstNavRenderRef.current) {
      isFirstNavRenderRef.current = false;
      lastNavRef.current = snap;
      return;
    }
    if (applyingNavRef.current) {
      applyingNavRef.current = false;
      lastNavRef.current = snap;
      return;
    }
    const prev = lastNavRef.current;
    if (prev && navSnapshotsEqual(prev, snap)) return;
    if (prev) {
      pastRef.current.push(prev);
      if (pastRef.current.length > MAX_NAV_HISTORY) pastRef.current.shift();
      futureRef.current = [];
    }
    lastNavRef.current = snap;
  }, [activeTab, settingsTab, modpackView, currentNavSnapshot]);

  const applyNavSnapshot = useCallback(
    (snap: NavSnapshot) => {
      applyingNavRef.current = true;
      if (snap.activeItem !== activeTab) setActiveItem(snap.activeItem);
      if (snap.settingsTab !== settingsTab) setSettingsTab(snap.settingsTab);
      if (snap.modpackView !== modpackView) {
        setModpackView(snap.modpackView);
        if (snap.activeItem === "modpacks") {
          const nav = modpackNavRef.current;
          if (nav) nav.setActiveView(snap.modpackView);
          else setRequestedModpackView(snap.modpackView);
        }
      }
      lastNavRef.current = snap;
    },
    [
      activeTab,
      settingsTab,
      modpackView,
      modpackNavRef,
      setActiveItem,
      setSettingsTab,
      setModpackView,
      setRequestedModpackView,
    ],
  );

  const goBack = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return false;
    const prev = past.pop()!;
    futureRef.current.push(currentNavSnapshot());
    applyNavSnapshot(prev);
    return true;
  }, [applyNavSnapshot, currentNavSnapshot]);

  const goForward = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return false;
    const next = future.pop()!;
    pastRef.current.push(currentNavSnapshot());
    applyNavSnapshot(next);
    return true;
  }, [applyNavSnapshot, currentNavSnapshot]);

  const handleModpackSidebarClick = useCallback((): boolean => {
    if (!isModpacksTabVisible(activeTab, effectiveTabSplit)) return false;
    if (modpackView === "list") return false;
    modpackNavRef.current?.goToList();
    setModpackView("list");
    return true;
  }, [activeTab, modpackView, effectiveTabSplit, modpackNavRef, setModpackView]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !e.repeat &&
        isCtrlOrMeta(e) &&
        !e.shiftKey &&
        !e.altKey &&
        isHotkeyKey(e, "k") &&
        !isOverlayOpen() &&
        appActionsRef.current
      ) {
        e.preventDefault();
        appActionsRef.current.openCommandPalette();
        return;
      }
      if (e.repeat || isEditableTarget(e.target)) return;

      const ctrl = isCtrlOrMeta(e);
      const overlay = isOverlayOpen();

      if (!ctrl && !e.altKey && !e.shiftKey) {
        const digit = digitFromEvent(e);
        const target = digit === null ? undefined : tabOrder[digit - 1];
        if (target && !overlay) {
          e.preventDefault();
          activateTab(target);
          return;
        }
      }

      if (e.key === "F5" && !ctrl && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!overlay) window.dispatchEvent(new Event(HOTKEY_REFRESH_EVENT));
        return;
      }

      const runGlobal = (): boolean => {
        const app = appActionsRef.current;

        if (e.altKey && !ctrl && !e.shiftKey) {
          if (e.key === "ArrowLeft" && goBack()) e.preventDefault();
          else if (e.key === "ArrowRight" && goForward()) e.preventDefault();
          return true;
        }

        if (ctrl && e.key === "Tab" && !e.altKey) {
          const idx = tabOrder.indexOf(activeTab);
          if (tabOrder.length > 0) {
            const step = e.shiftKey ? -1 : 1;
            const next = tabOrder[(Math.max(idx, 0) + step + tabOrder.length) % tabOrder.length];
            e.preventDefault();
            activateTab(next);
          }
          return true;
        }

        if (ctrl && !e.altKey && !e.shiftKey) {
          if (hotkeyKey(e) === ",") {
            e.preventDefault();
            activateTab("settings");
            return true;
          }
          if (isHotkeyKey(e, "b") && app) {
            e.preventDefault();
            app.toggleSidebar();
            return true;
          }
          if (e.key === "Enter" && app) {
            e.preventDefault();
            app.launchGame();
            return true;
          }
        }

        if (ctrl && e.shiftKey && !e.altKey && isHotkeyKey(e, "k") && app) {
          e.preventDefault();
          app.stopGame();
          return true;
        }

        if (!ctrl && !e.altKey) {
          if (hotkeyKey(e) === "/" && !e.shiftKey && focusVisibleSearch()) {
            e.preventDefault();
            return true;
          }
          const isQuestionMark = e.key === "?" || (e.shiftKey && e.code === "Slash");
          if ((e.key === "F1" || isQuestionMark) && app) {
            e.preventDefault();
            app.openHotkeysHelp();
            return true;
          }
          if (
            e.key === "Escape" &&
            isModpacksTabVisible(activeTab, effectiveTabSplit) &&
            modpackView !== "list"
          ) {
            e.preventDefault();
            modpackNavRef.current?.goToList();
            setModpackView("list");
            return true;
          }
        }
        return false;
      };
      if (!overlay && runGlobal()) return;

      const ctx: HotkeyHandlerContext = {
        activeTab,
        effectiveTabSplit,
        isConsoleVisible,
        playConsoleActionsRef,
        modpackActionsRef,
      };

      for (const binding of HOTKEY_BINDINGS) {
        if (!matchesHotkey(e, binding.match)) continue;
        if (!binding.when(ctx)) continue;
        if (!binding.run(ctx)) continue;
        e.preventDefault();
        return;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      if (isEditableTarget(e.target)) return;
      if (e.button === 3 && goBack()) e.preventDefault();
      else if (e.button === 4 && goForward()) e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    activeTab,
    effectiveTabSplit,
    isConsoleVisible,
    playConsoleActionsRef,
    modpackActionsRef,
    appActionsRef,
    modpackView,
    modpackNavRef,
    setModpackView,
    tabOrder,
    activateTab,
    goBack,
    goForward,
  ]);

  return { handleModpackSidebarClick };
}
