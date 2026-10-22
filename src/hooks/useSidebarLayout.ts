import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SIDEBAR_ORDER,
  REORDERABLE_SIDEBAR_IDS,
  isSidebarHorizontal,
  sidebarItems,
  type SidebarPosition,
} from "../app/sidebar";
import type { SidebarItemId } from "../app/types";

export function useSidebarLayout(activeItem: SidebarItemId, sidebarPosition: SidebarPosition) {
  const [sidebarOrder, setSidebarOrder] = useState<SidebarItemId[]>(() => {
    if (typeof window === "undefined") return DEFAULT_SIDEBAR_ORDER;
    try {
      const raw = window.localStorage.getItem("sidebar_order");
      if (!raw) return DEFAULT_SIDEBAR_ORDER;
      const parsed = JSON.parse(raw);
      const allowed: readonly string[] = REORDERABLE_SIDEBAR_IDS;
      if (
        Array.isArray(parsed) &&
        parsed.every((id) => allowed.includes(id))
      ) {
        return parsed as SidebarItemId[];
      }
    } catch {
    }
    return DEFAULT_SIDEBAR_ORDER;
  });
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarButtonRefs = useRef<
    Partial<Record<SidebarItemId, HTMLButtonElement | null>>
  >({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
      } catch {
      }
      return next;
    });
  }, []);
  const [sidebarIndicator, setSidebarIndicator] = useState<{
    offset: number;
    span: number;
    ready: boolean;
  }>({ offset: 0, span: 32, ready: false });

  const updateSidebarIndicator = useCallback(() => {
    const container = sidebarRef.current;
    const btn = sidebarButtonRefs.current[activeItem];
    if (!container || !btn) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const horizontal = isSidebarHorizontal(sidebarPosition);

    if (horizontal) {
      const span = Math.max(16, btnRect.width - 20);
      const offset = btnRect.left - containerRect.left + (btnRect.width - span) / 2;
      setSidebarIndicator({ offset, span, ready: true });
      return;
    }

    const span = Math.max(20, btnRect.height - 14);
    const offset = btnRect.top - containerRect.top + (btnRect.height - span) / 2;
    setSidebarIndicator({ offset, span, ready: true });
  }, [activeItem, sidebarPosition]);

  useLayoutEffect(() => {
    updateSidebarIndicator();
    const timer = window.setTimeout(updateSidebarIndicator, 320);
    return () => window.clearTimeout(timer);
  }, [updateSidebarIndicator, sidebarPosition, sidebarCollapsed]);

  useEffect(() => {
    let raf = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateSidebarIndicator);
    };
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [updateSidebarIndicator]);

  const orderedSidebarItems = useMemo(() => {
    const byId = new Map(sidebarItems.map((i) => [i.id, i]));
    const result: { id: SidebarItemId; labelKey: string }[] = [];
    for (const id of sidebarOrder) {
      const item = byId.get(id);
      if (item && item.id !== "accounts") {
        result.push(item);
      }
    }
    for (const item of sidebarItems) {
      if (item.id !== "accounts" && !result.find((x) => x.id === item.id)) {
        result.push(item);
      }
    }
    return result;
  }, [sidebarOrder]);

  return {
    sidebarOrder,
    setSidebarOrder,
    sidebarRef,
    sidebarButtonRefs,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    sidebarIndicator,
    orderedSidebarItems,
  };
}
