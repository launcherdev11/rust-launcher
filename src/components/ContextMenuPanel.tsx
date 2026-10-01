import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { clampMenuPosition } from "../lib/contextMenuPosition";

type Props = {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  zIndex?: number;
};

export function ContextMenuPanel({
  x,
  y,
  onClose,
  children,
  className = "w-56",
  zIndex = 40,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setReady(false);
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(clampMenuPosition(x, y, width, height));
    setReady(true);
  }, [x, y]);

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex }}
      onClick={onClose}
      onContextMenu={(e: ReactMouseEvent) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className={`absolute glass-popover p-1 text-xs text-white ${className}`}
        style={{
          top: pos.top,
          left: pos.left,
          zIndex: zIndex + 10,
          visibility: ready ? "visible" : "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
}
