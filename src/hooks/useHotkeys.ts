import { useEffect, type MutableRefObject } from "react";
import type { TabSplitLayout } from "../splitView";

export type PlayConsoleHotkeyActions = {
  copyConsole: () => void | Promise<void>;
  toggleConsoleDetached: () => void;
};

export type ModpackHotkeyActions = {
  openCreate: () => void;
  openImport: () => void;
};

type SidebarTabId = "play" | "settings" | "mods" | "modpacks" | "accounts";

export type UseHotkeysOptions = {
  activeTab: SidebarTabId;
  effectiveTabSplit: TabSplitLayout | null;
  isConsoleVisible: boolean;
  playConsoleActionsRef: MutableRefObject<PlayConsoleHotkeyActions | null>;
  modpackActionsRef: MutableRefObject<ModpackHotkeyActions | null>;
};

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

export function useHotkeys({
  activeTab,
  effectiveTabSplit,
  isConsoleVisible,
  playConsoleActionsRef,
  modpackActionsRef,
}: UseHotkeysOptions) {
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

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTab,
    effectiveTabSplit,
    isConsoleVisible,
    playConsoleActionsRef,
    modpackActionsRef,
  ]);
}
