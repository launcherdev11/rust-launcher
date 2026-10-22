import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { NotificationKind } from "../app/notifications";
import type { SidebarItemId, Tt } from "../app/types";
import {
  applyTabDrop,
  detectDropZone,
  isSplittableTab,
  loadTabSplitLayout,
  saveTabSplitLayout,
  tabAfterClosingSplitPane,
  tabPaneRole,
  TAB_DRAG_THRESHOLD_PX,
  TAB_SPLIT_MIN_WIDTH_PX,
  TAB_SPLIT_RATIO_MAX,
  TAB_SPLIT_RATIO_MIN,
  type SplittableTabId,
  type TabDropZone,
  type TabSplitLayout,
} from "../splitView";

type UseTabSplitViewOptions = {
  activeItem: SidebarItemId;
  splitViewEnabled: boolean;
  setActiveItemWithSound: (next: SidebarItemId) => void;
  showNotification: (kind: NotificationKind, message: string) => void;
  tt: Tt;
};

export function useTabSplitView({
  activeItem,
  splitViewEnabled,
  setActiveItemWithSound,
  showNotification,
  tt,
}: UseTabSplitViewOptions) {
  const [tabSplitLayout, setTabSplitLayout] = useState<TabSplitLayout | null>(() =>
    loadTabSplitLayout(),
  );
  const [tabDrag, setTabDrag] = useState<{
    tab: SplittableTabId;
    x: number;
    y: number;
  } | null>(null);
  const [tabDropZone, setTabDropZone] = useState<TabDropZone | null>(null);
  const tabDropZoneRef = useRef<TabDropZone | null>(null);
  const [isTabSplitDividerDragging, setIsTabSplitDividerDragging] = useState(false);
  const mainSplitRef = useRef<HTMLElement | null>(null);
  const sidebarTabDragRef = useRef<{
    tab: SplittableTabId;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const sidebarTabDragListenersRef = useRef<(() => void) | null>(null);
  const sidebarDragConsumedRef = useRef(false);
  const tabSplitDividerDragRef = useRef<{
    startCoord: number;
    startRatio: number;
    direction: TabSplitLayout["direction"];
  } | null>(null);

  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : TAB_SPLIT_MIN_WIDTH_PX,
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const splitTooNarrow = viewportWidth < TAB_SPLIT_MIN_WIDTH_PX;
  const canUseSplitView = splitViewEnabled && !splitTooNarrow;

  const effectiveTabSplit =
    canUseSplitView && tabSplitLayout ? tabSplitLayout : null;

  const splitDropZoneLabels = useMemo(
    () => ({
      left: tt("app.splitView.zones.left"),
      right: tt("app.splitView.zones.right"),
      top: tt("app.splitView.zones.top"),
      bottom: tt("app.splitView.zones.bottom"),
      center: tt("app.splitView.zones.center"),
    }),
    [tt],
  );

  useEffect(() => {
    if (splitViewEnabled) {
      saveTabSplitLayout(tabSplitLayout);
    } else {
      saveTabSplitLayout(null);
    }
  }, [splitViewEnabled, tabSplitLayout]);

  useEffect(() => {
    if (!canUseSplitView) return;
    if (tabSplitLayout) return;
    const saved = loadTabSplitLayout();
    if (saved) setTabSplitLayout(saved);
  }, [canUseSplitView, tabSplitLayout]);

  const activateSidebarTab = useCallback(
    (next: SplittableTabId) => {
      if (!effectiveTabSplit) {
        setActiveItemWithSound(next);
        return;
      }
      const role = tabPaneRole(next, effectiveTabSplit);
      if (role) {
        if (effectiveTabSplit.focused !== role) {
          setTabSplitLayout({ ...effectiveTabSplit, focused: role });
        }
        setActiveItemWithSound(next);
        return;
      }
      const updated: TabSplitLayout =
        effectiveTabSplit.focused === "primary"
          ? { ...effectiveTabSplit, primary: next }
          : { ...effectiveTabSplit, secondary: next };
      setTabSplitLayout(updated);
      setActiveItemWithSound(next);
    },
    [effectiveTabSplit, setActiveItemWithSound],
  );

  const dismissTabSplitPane = useCallback(
    (role: "primary" | "secondary") => {
      if (!effectiveTabSplit) return;
      const keepTab = tabAfterClosingSplitPane(effectiveTabSplit, role);
      setTabSplitLayout(null);
      setActiveItemWithSound(keepTab);
    },
    [effectiveTabSplit, setActiveItemWithSound],
  );

  const finishTabDrag = useCallback(
    (clientX: number, clientY: number, draggedTab: SplittableTabId) => {
      sidebarTabDragRef.current = null;
      setTabDrag(null);
      setTabDropZone(null);

      if (!splitViewEnabled) {
        tabDropZoneRef.current = null;
        return;
      }

      if (splitTooNarrow) {
        tabDropZoneRef.current = null;
        showNotification("warning", tt("app.splitView.tooNarrow"));
        return;
      }

      sidebarDragConsumedRef.current = true;
      const mainEl = mainSplitRef.current;
      if (!mainEl) {
        tabDropZoneRef.current = null;
        return;
      }

      const rect = mainEl.getBoundingClientRect();
      const zone =
        tabDropZoneRef.current ?? detectDropZone(clientX, clientY, rect);
      tabDropZoneRef.current = null;

      const currentTab = isSplittableTab(activeItem) ? activeItem : "play";
      const { layout, focusedTab } = applyTabDrop(
        draggedTab,
        zone,
        currentTab,
        effectiveTabSplit,
      );
      setTabSplitLayout(layout);
      setActiveItemWithSound(focusedTab);
    },
    [
      activeItem,
      effectiveTabSplit,
      setActiveItemWithSound,
      showNotification,
      splitTooNarrow,
      splitViewEnabled,
      tt,
    ],
  );

  const cleanupSidebarTabDragListeners = useCallback(() => {
    sidebarTabDragListenersRef.current?.();
    sidebarTabDragListenersRef.current = null;
  }, []);

  const updateTabDragPointer = useCallback((clientX: number, clientY: number, tab: SplittableTabId) => {
    setTabDrag({ tab, x: clientX, y: clientY });
    const mainEl = mainSplitRef.current;
    if (mainEl) {
      const zone = detectDropZone(clientX, clientY, mainEl.getBoundingClientRect());
      tabDropZoneRef.current = zone;
      setTabDropZone(zone);
    }
  }, []);

  const handleSidebarTabPointerDown = useCallback(
    (tab: SplittableTabId, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!canUseSplitView || e.button !== 0) return;
      cleanupSidebarTabDragListeners();

      const pointerId = e.pointerId;
      sidebarTabDragRef.current = {
        tab,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const drag = sidebarTabDragRef.current;
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (
          !drag.active &&
          (Math.abs(dx) > TAB_DRAG_THRESHOLD_PX || Math.abs(dy) > TAB_DRAG_THRESHOLD_PX)
        ) {
          drag.active = true;
        }
        if (!drag.active) return;
        updateTabDragPointer(ev.clientX, ev.clientY, drag.tab);
      };

      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanupSidebarTabDragListeners();
        const drag = sidebarTabDragRef.current;
        if (drag?.active) {
          finishTabDrag(ev.clientX, ev.clientY, drag.tab);
        } else {
          sidebarTabDragRef.current = null;
          tabDropZoneRef.current = null;
          setTabDrag(null);
          setTabDropZone(null);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      sidebarTabDragListenersRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
    },
    [cleanupSidebarTabDragListeners, finishTabDrag, canUseSplitView, updateTabDragPointer],
  );

  useEffect(() => () => cleanupSidebarTabDragListeners(), [cleanupSidebarTabDragListeners]);

  const onTabSplitDividerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!effectiveTabSplit || e.button !== 0) return;
      e.preventDefault();
      const row = mainSplitRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const horizontal = effectiveTabSplit.direction === "horizontal";
      const size = horizontal ? rect.width : rect.height;
      const origin = horizontal ? rect.left : rect.top;
      const coord = horizontal ? e.clientX : e.clientY;
      const startRel = size > 0 ? (coord - origin) / size : effectiveTabSplit.ratio;
      tabSplitDividerDragRef.current = {
        startCoord: startRel,
        startRatio: effectiveTabSplit.ratio,
        direction: effectiveTabSplit.direction,
      };
      setIsTabSplitDividerDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [effectiveTabSplit],
  );

  useEffect(() => {
    if (!isTabSplitDividerDragging) return;
    const onMove = (e: PointerEvent) => {
      const d = tabSplitDividerDragRef.current;
      const row = mainSplitRef.current;
      if (!d || !row) return;
      const rect = row.getBoundingClientRect();
      const size = d.direction === "horizontal" ? rect.width : rect.height;
      if (size <= 0) return;
      const coord = d.direction === "horizontal" ? e.clientX : e.clientY;
      const origin = d.direction === "horizontal" ? rect.left : rect.top;
      const rel = size > 0 ? (coord - origin) / size : d.startRatio;
      const delta = rel - d.startCoord;
      let next = d.startRatio + delta;
      next = Math.min(TAB_SPLIT_RATIO_MAX, Math.max(TAB_SPLIT_RATIO_MIN, next));
      setTabSplitLayout((prev) => (prev ? { ...prev, ratio: next } : prev));
    };
    const onUp = () => {
      tabSplitDividerDragRef.current = null;
      setIsTabSplitDividerDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isTabSplitDividerDragging]);

  return {
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
  };
}
