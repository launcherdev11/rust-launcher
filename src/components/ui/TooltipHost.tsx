import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 450;
const REOPEN_WINDOW_MS = 400;
const GAP = 8;
const EDGE = 6;

type Tip = { text: string; rect: DOMRect };

function findAnchor(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Element ? target : null;
  while (el) {
    if (el instanceof HTMLElement && (el.getAttribute("title") || el.dataset.tip)) return el;
    el = el.parentElement;
  }
  return null;
}

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let anchor: HTMLElement | null = null;
    let heldTitle: string | null = null;
    let observer: MutationObserver | null = null;
    let timer: number | null = null;
    let lastHiddenAt = 0;
    let visible = false;

    const clearTimer = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const currentText = () => heldTitle ?? anchor?.dataset.tip ?? "";

    const show = () => {
      timer = null;
      if (!anchor || !anchor.isConnected) return;
      const text = currentText().trim();
      if (!text) return;
      visible = true;
      setTip({ text, rect: anchor.getBoundingClientRect() });
    };

    const release = () => {
      clearTimer();
      observer?.disconnect();
      observer = null;
      if (anchor && heldTitle != null && anchor.getAttribute("title") === "") {
        anchor.setAttribute("title", heldTitle);
      }
      anchor = null;
      heldTitle = null;
      if (visible) {
        visible = false;
        lastHiddenAt = performance.now();
        setTip(null);
      }
    };

    const take = (el: HTMLElement, immediate: boolean) => {
      if (el === anchor) return;
      release();
      anchor = el;
      const title = el.getAttribute("title");
      if (title) {
        heldTitle = title;
        el.setAttribute("title", "");
        observer = new MutationObserver(() => {
          if (el !== anchor) return;
          const next = el.getAttribute("title");
          if (next === "") return;
          if (next == null) {
            heldTitle = null;
            release();
            return;
          }
          heldTitle = next;
          el.setAttribute("title", "");
          if (visible) setTip({ text: next, rect: el.getBoundingClientRect() });
        });
        observer.observe(el, { attributes: true, attributeFilter: ["title"] });
      }
      const quick = immediate || performance.now() - lastHiddenAt < REOPEN_WINDOW_MS;
      timer = window.setTimeout(show, quick ? 60 : SHOW_DELAY_MS);
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = findAnchor(e.target);
      if (!el) {
        release();
        return;
      }
      take(el, false);
    };

    const onPointerMove = () => {
      if (anchor && !anchor.isConnected) release();
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = findAnchor(e.target);
      if (!el || !(e.target instanceof Element) || !e.target.matches(":focus-visible")) return;
      take(el, true);
    };

    const onLeaveDocument = (e: PointerEvent) => {
      if (e.relatedTarget == null) release();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerout", onLeaveDocument, true);
    document.addEventListener("pointerdown", release, true);
    document.addEventListener("keydown", release, true);
    document.addEventListener("wheel", release, { capture: true, passive: true });
    document.addEventListener("scroll", release, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", release, true);
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerout", onLeaveDocument, true);
      document.removeEventListener("pointerdown", release, true);
      document.removeEventListener("keydown", release, true);
      document.removeEventListener("wheel", release, true);
      document.removeEventListener("scroll", release, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", release, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!tip || !box) {
      setPos(null);
      return;
    }
    const { width, height } = box.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = tip.rect.bottom + GAP;
    if (top + height > vh - EDGE) top = tip.rect.top - GAP - height;
    if (top < EDGE) top = EDGE;
    let left = tip.rect.left + tip.rect.width / 2 - width / 2;
    left = Math.max(EDGE, Math.min(left, vw - width - EDGE));
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      className="ui-tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
