import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { TabSplitLayout } from "../splitView";

export type PlayConsoleHotkeyActions = {
  copyConsole: () => void | Promise<void>;
  toggleConsoleDetached: () => void;
};

export type ModpackHotkeyActions = {
  openCreate: () => void;
  openImport: () => void;
};

export type ModpackViewId = "list" | "create" | "import" | "manage";

export type ModpackNavigationActions = {
  getActiveView: () => ModpackViewId;
  goToList: () => void;
  setActiveView: (view: ModpackViewId) => void;
  openProfileSettings: (profileId: string) => void;
};

type SidebarTabId = "play" | "settings" | "friends" | "mods" | "modpacks" | "accounts";
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
  if (e.key.toLowerCase() !== spec.key.toLowerCase()) return false;
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
  settingsTab: SettingsTabId;
  modpackView: ModpackViewId;
  modpackNavRef: MutableRefObject<ModpackNavigationActions | null>;
  setActiveItem: (item: SidebarTabId) => void;
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
  settingsTab,
  modpackView,
  modpackNavRef,
  setActiveItem,
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
      if (e.repeat || isEditableTarget(e.target)) return;

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
    goBack,
    goForward,
  ]);

  return { handleModpackSidebarClick };
}
