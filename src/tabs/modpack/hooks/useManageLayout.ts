import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  computeTabUiScale,
  MODPACK_MANAGE_SPLIT_DEFAULT,
  MODPACK_MANAGE_SPLIT_MAX,
  MODPACK_MANAGE_SPLIT_MIN,
  MODPACK_MANAGE_SPLIT_STORAGE_KEY,
} from "../helpers";
import { type ViewId } from "../types";

type ManageLayoutDeps = {
  activeView: ViewId;
};

export function useManageLayout(deps: ManageLayoutDeps) {
  const {
    activeView,
  } = deps;

  const [uiScale, setUiScale] = useState(() =>
    typeof window === "undefined" ? 1 : computeTabUiScale(window.innerWidth),
  );

  useEffect(() => {
    const onResize = () => setUiScale(computeTabUiScale(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const manageZoomed = activeView === "manage" && uiScale > 1;

  const scaledRootRef = useRef<HTMLDivElement | null>(null);
  const [scaledHostSize, setScaledHostSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    if (!manageZoomed) return;
    const host = scaledRootRef.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const cs = getComputedStyle(host);
      const w = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = host.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setScaledHostSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [manageZoomed]);

  const [manageMainWidthFrac, setManageMainWidthFrac] = useState(() => {
    if (typeof window === "undefined") return MODPACK_MANAGE_SPLIT_DEFAULT;
    try {
      const raw = window.localStorage.getItem(MODPACK_MANAGE_SPLIT_STORAGE_KEY);
      const v = raw == null ? Number.NaN : Number.parseFloat(raw);
      if (
        Number.isFinite(v) &&
        v >= MODPACK_MANAGE_SPLIT_MIN &&
        v <= MODPACK_MANAGE_SPLIT_MAX
      ) {
        return v;
      }
    } catch {
    }
    return MODPACK_MANAGE_SPLIT_DEFAULT;
  });

  const [isManageSplitDragging, setIsManageSplitDragging] = useState(false);
  const manageSplitRowRef = useRef<HTMLDivElement | null>(null);
  const manageSplitHandleRef = useRef<HTMLDivElement | null>(null);

  const manageSplitDragRef = useRef<{
    pointerId: number;
    startX: number;
    startFrac: number;
    rowWidth: number;
  } | null>(null);

  const onManageSplitPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const row = manageSplitRowRef.current;
      if (!row) return;
      if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) {
        return;
      }
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      manageSplitDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startFrac: manageMainWidthFrac,
        rowWidth: Math.max(1, rect.width),
      };
      setIsManageSplitDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
      }
    },
    [manageMainWidthFrac],
  );

  useEffect(() => {
    if (!isManageSplitDragging) return;
    const handleEl = manageSplitHandleRef.current;

    const onMove = (e: PointerEvent) => {
      const d = manageSplitDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const row = manageSplitRowRef.current;
      const rowWidth = row ? Math.max(1, row.getBoundingClientRect().width) : d.rowWidth;
      const delta = e.clientX - d.startX;
      let next = d.startFrac + delta / rowWidth;
      next = Math.min(MODPACK_MANAGE_SPLIT_MAX, Math.max(MODPACK_MANAGE_SPLIT_MIN, next));
      setManageMainWidthFrac(next);
    };

    const finish = (e: PointerEvent) => {
      const d = manageSplitDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      manageSplitDragRef.current = null;
      setIsManageSplitDragging(false);
      if (handleEl) {
        try {
          handleEl.releasePointerCapture(e.pointerId);
        } catch {
        }
      }
      setManageMainWidthFrac((frac) => {
        try {
          window.localStorage.setItem(MODPACK_MANAGE_SPLIT_STORAGE_KEY, String(frac));
        } catch {
        }
        return frac;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [isManageSplitDragging]);

  useEffect(() => {
    if (!isManageSplitDragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [isManageSplitDragging]);

  return {
    uiScale,
    manageZoomed,
    scaledRootRef,
    scaledHostSize,
    manageMainWidthFrac,
    isManageSplitDragging,
    manageSplitRowRef,
    manageSplitHandleRef,
    onManageSplitPointerDown,
  };
}
