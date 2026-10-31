import { useEffect, useRef, useState, type ReactNode } from "react";

const DEFAULT_HOLD_MS = 900;
// короче — обычный клик, показываем подсказку
const TAP_THRESHOLD_MS = 250;
const HINT_VISIBLE_MS = 1600;

type Props = {
  onConfirm: () => void;
  children: ReactNode;
  holdHint: string;
  holdMs?: number;
  className?: string;
  fillClassName?: string;
  disabled?: boolean;
};

export function HoldToConfirmButton({
  onConfirm,
  children,
  holdHint,
  holdMs = DEFAULT_HOLD_MS,
  className = "",
  fillClassName = "bg-danger-strong/35",
  disabled = false,
}: Props) {
  const [progress, setProgress] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const stopFrame = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  useEffect(
    () => () => {
      stopFrame();
      if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current);
    },
    [],
  );

  const begin = () => {
    if (disabled || startRef.current != null) return;
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current);
    setShowHint(true);
    startRef.current = performance.now();
    const step = () => {
      if (startRef.current == null) return;
      const next = Math.min(1, (performance.now() - startRef.current) / holdMs);
      setProgress(next);
      if (next >= 1) {
        startRef.current = null;
        rafRef.current = null;
        setShowHint(false);
        onConfirmRef.current();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const cancel = () => {
    if (startRef.current == null) return;
    const heldFor = performance.now() - startRef.current;
    startRef.current = null;
    stopFrame();
    setProgress(0);
    if (heldFor < TAP_THRESHOLD_MS) {
      hintTimerRef.current = window.setTimeout(() => setShowHint(false), HINT_VISIBLE_MS);
    } else {
      setShowHint(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={holdHint}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        begin();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") cancel();
      }}
      onBlur={cancel}
      className={`relative isolate overflow-hidden ${className}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 -z-10 ${fillClassName}`}
        style={{ width: `${progress * 100}%` }}
      />
      {showHint ? <span className="min-w-0 truncate">{holdHint}</span> : children}
    </button>
  );
}
