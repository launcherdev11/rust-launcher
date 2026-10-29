import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AssetIcon } from "./asset_icon";

export type CursorHintState = {
  x: number;
  y: number;
};

export function useCursorHint() {
  const [hint, setHint] = useState<CursorHintState | null>(null);

  const show = useCallback((e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromKeyboard = e.clientX === 0 && e.clientY === 0;
    setHint({
      x: fromKeyboard ? rect.left + rect.width / 2 : e.clientX,
      y: fromKeyboard ? rect.bottom : e.clientY,
    });
  }, []);

  const hide = useCallback(() => setHint(null), []);

  return { hint, show, hide };
}

const GAP = 12;
const EDGE = 8;
const AUTO_HIDE_MS = 4500;

export function CursorHint({
  hint,
  onClose,
  title,
  children,
  action,
}: {
  hint: CursorHintState | null;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!hint) {
      setPos(null);
      return;
    }
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    let left = hint.x + GAP;
    let top = hint.y + GAP;
    if (left + w > window.innerWidth - EDGE) left = Math.max(EDGE, hint.x - GAP - w);
    if (top + h > window.innerHeight - EDGE) top = Math.max(EDGE, hint.y - GAP - h);
    setPos({ left, top });
  }, [hint]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(onClose, AUTO_HIDE_MS);
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    
    const frame = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [hint, onClose]);

  if (!hint) return null;

  return createPortal(
    <div
      ref={ref}
      role="status"
      className="glass-popover fixed z-[300] w-max max-w-[17rem] px-3 py-2.5 text-left"
      style={{
        left: pos?.left ?? hint.x + GAP,
        top: pos?.top ?? hint.y + GAP,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="flex items-start gap-2">
        <AssetIcon name="info" className="mt-0.5 h-3.5 w-3.5 text-warn-fg" />
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-semibold leading-snug text-white">{title}</p>
          {children ? (
            <p className="mt-0.5 text-[0.75rem] leading-snug text-white/65">{children}</p>
          ) : null}
          {action ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                action.onClick();
              }}
              className="btn btn-sm btn-soft mt-2 h-7"
            >
              {action.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
