import type { Dispatch, SetStateAction } from "react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type ContentFilter,
  type ContentTab,
  type InstanceProfile,
  type NotificationKind,
  type ProfileItemEntry,
  type ViewId,
} from "../types";

type ResourcePackReorderDeps = {
  setSelectedContentNames: Dispatch<SetStateAction<Set<string>>>;
  setContentFilter: Dispatch<SetStateAction<ContentFilter>>;
  selectedProfileId: string | null;
  contentTab: ContentTab;
  activeView: ViewId;
  itemsSearch: string;
  items: ProfileItemEntry[];
  selectedProfile: InstanceProfile | null;
  setItems: Dispatch<SetStateAction<ProfileItemEntry[]>>;
  refreshItems: (id: string, tab: ContentTab) => Promise<void>;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
};

export function useResourcePackReorder(deps: ResourcePackReorderDeps) {
  const {
    setSelectedContentNames,
    setContentFilter,
    selectedProfileId,
    contentTab,
    activeView,
    itemsSearch,
    items,
    selectedProfile,
    setItems,
    refreshItems,
    showNotification,
    tt,
  } = deps;

  const [isResourcePackReorderMode, setIsResourcePackReorderMode] = useState(false);
  const [resourcePackDragIndex, setResourcePackDragIndex] = useState<number | null>(null);
  const [resourcePackDragOverIndex, setResourcePackDragOverIndex] = useState<number | null>(null);
  const resourcePackDragOverIndexRef = useRef<number | null>(null);
  const resourcePackPointerDragRef = useRef<{ fromIndex: number; active: boolean } | null>(null);
  const resourcePackReorderListenersRef = useRef<(() => void) | null>(null);
  const resourcePackRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    setIsResourcePackReorderMode(false);
    setResourcePackDragIndex(null);
    setResourcePackDragOverIndex(null);
    resourcePackDragOverIndexRef.current = null;
    resourcePackPointerDragRef.current = null;
    resourcePackReorderListenersRef.current?.();
    resourcePackReorderListenersRef.current = null;
    setSelectedContentNames(new Set());
    setContentFilter("all");
  }, [selectedProfileId, contentTab, activeView]);

  useEffect(() => {
    if (itemsSearch.trim().length > 0 && isResourcePackReorderMode) {
      setIsResourcePackReorderMode(false);
      setResourcePackDragIndex(null);
      setResourcePackDragOverIndex(null);
      resourcePackDragOverIndexRef.current = null;
      resourcePackPointerDragRef.current = null;
      resourcePackReorderListenersRef.current?.();
      resourcePackReorderListenersRef.current = null;
    }
  }, [itemsSearch, isResourcePackReorderMode]);

  function cleanupResourcePackReorderListeners() {
    resourcePackReorderListenersRef.current?.();
    resourcePackReorderListenersRef.current = null;
  }

  function resolveResourcePackDropIndex(clientY: number): number | null {
    const enabledItems = items.filter((entry) => entry.enabled);
    if (enabledItems.length === 0) return null;

    for (let i = 0; i < enabledItems.length; i++) {
      const el = resourcePackRowRefs.current.get(enabledItems[i].name);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const mid = rect.top + rect.height / 2;
        return clientY < mid ? i : Math.min(i + 1, enabledItems.length - 1);
      }
    }

    const lastItem = enabledItems[enabledItems.length - 1];
    const lastEl = resourcePackRowRefs.current.get(lastItem.name);
    if (lastEl && clientY > lastEl.getBoundingClientRect().bottom) {
      return enabledItems.length - 1;
    }
    const firstEl = resourcePackRowRefs.current.get(enabledItems[0].name);
    if (firstEl && clientY < firstEl.getBoundingClientRect().top) {
      return 0;
    }
    return null;
  }

  function handleResourcePackGripPointerDown(index: number, e: ReactPointerEvent<HTMLButtonElement>) {
    if (!isResourcePackReorderMode || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    cleanupResourcePackReorderListeners();

    const pointerId = e.pointerId;
    const startY = e.clientY;
    resourcePackPointerDragRef.current = { fromIndex: index, active: false };
    setResourcePackDragIndex(index);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const drag = resourcePackPointerDragRef.current;
      if (!drag) return;
      if (!drag.active && Math.abs(ev.clientY - startY) > 4) {
        drag.active = true;
      }
      if (!drag.active) return;

      const overIndex = resolveResourcePackDropIndex(ev.clientY);
      resourcePackDragOverIndexRef.current = overIndex;
      setResourcePackDragOverIndex(overIndex);
    };

    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanupResourcePackReorderListeners();
      const drag = resourcePackPointerDragRef.current;
      const toIndex = resourcePackDragOverIndexRef.current;
      resourcePackPointerDragRef.current = null;
      resourcePackDragOverIndexRef.current = null;
      setResourcePackDragIndex(null);
      setResourcePackDragOverIndex(null);
      if (drag?.active && toIndex !== null && drag.fromIndex !== toIndex) {
        void handleResourcePackReorder(drag.fromIndex, toIndex);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    resourcePackReorderListenersRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }

  async function handleResourcePackReorder(fromIndex: number, toIndex: number) {
    if (!selectedProfile || fromIndex === toIndex) return;
    const enabledItems = items.filter((entry) => entry.enabled);
    const disabledItems = items.filter((entry) => !entry.enabled);
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= enabledItems.length ||
      toIndex >= enabledItems.length
    ) {
      return;
    }
    const nextEnabled = [...enabledItems];
    const [moved] = nextEnabled.splice(fromIndex, 1);
    nextEnabled.splice(toIndex, 0, moved);
    const orderedNames = nextEnabled.map((entry) => entry.name);
    setItems([...nextEnabled, ...disabledItems]);
    try {
      await invoke("reorder_profile_resource_packs", {
        id: selectedProfile.id,
        orderedNames,
      });
    } catch (e) {
      console.error(e);
      await refreshItems(selectedProfile.id, "resourcepacks");
      showNotification("error", tt("modpacks.manage.reorderFailed"));
    }
  }

  return {
    isResourcePackReorderMode,
    setIsResourcePackReorderMode,
    resourcePackDragIndex,
    setResourcePackDragIndex,
    resourcePackDragOverIndex,
    setResourcePackDragOverIndex,
    resourcePackDragOverIndexRef,
    resourcePackPointerDragRef,
    resourcePackReorderListenersRef,
    resourcePackRowRefs,
    cleanupResourcePackReorderListeners,
    handleResourcePackGripPointerDown,
  };
}
