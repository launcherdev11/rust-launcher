import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

const MARQUEE_KEY_ATTR = "data-marquee-key";

const DRAG_THRESHOLD = 5;
const EDGE_SIZE = 44;
const MAX_SCROLL_STEP = 20;
const BOX_CLASS =
  "pointer-events-none fixed z-[200] rounded-md border border-accent-to/80 bg-accent-from/20";

export type UseMarqueeSelectionOptions = {
  containerRef: RefObject<HTMLElement | null>;
  selected: Set<string>;
  onChange: (keys: Set<string>) => void;
  enabled?: boolean;
};

function suppressNextClick() {
  const stop = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
}

function preventDefault(ev: Event) {
  ev.preventDefault();
}

function visualScale(el: HTMLElement, rect: DOMRect): number {
  return el.offsetWidth > 0 && rect.width > 0 ? rect.width / el.offsetWidth : 1;
}

export function useMarqueeSelection({
  containerRef,
  selected,
  onChange,
  enabled = true,
}: UseMarqueeSelectionOptions) {
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  return useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
      const container = containerRef.current;
      if (!container) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      const bounds = container.getBoundingClientRect();
      const scale = visualScale(container, bounds);
      if (e.clientX >= bounds.left + (container.clientLeft + container.clientWidth) * scale) return;
      cleanupRef.current?.();

      const base = new Set(selectedRef.current);
      const start = {
        x: e.clientX - bounds.left + container.scrollLeft * scale,
        y: e.clientY - bounds.top + container.scrollTop * scale,
      };
      const downAt = { x: e.clientX, y: e.clientY };
      const pointer = { x: e.clientX, y: e.clientY };
      let active = false;
      let dirty = false;
      let frame = 0;
      let lastHits = "";
      let box: HTMLDivElement | null = null;

      const update = () => {
        const b = container.getBoundingClientRect();
        const scale = visualScale(container, b);
        const offsetX = b.left - container.scrollLeft * scale;
        const offsetY = b.top - container.scrollTop * scale;
        const curX = pointer.x - offsetX;
        const curY = pointer.y - offsetY;
        const left = Math.min(start.x, curX) + offsetX;
        const right = Math.max(start.x, curX) + offsetX;
        const top = Math.min(start.y, curY) + offsetY;
        const bottom = Math.max(start.y, curY) + offsetY;

        const hits: string[] = [];
        container.querySelectorAll<HTMLElement>(`[${MARQUEE_KEY_ATTR}]`).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right < left || r.left > right || r.bottom < top || r.top > bottom) return;
          const key = el.getAttribute(MARQUEE_KEY_ATTR);
          if (key) hits.push(key);
        });
        const signature = hits.join("\n");
        if (signature !== lastHits) {
          lastHits = signature;
          onChangeRef.current(new Set([...base, ...hits]));
        }

        if (box) {
          const clipLeft = Math.max(left, b.left);
          const clipTop = Math.max(top, b.top);
          const clipRight = Math.min(right, b.right);
          const clipBottom = Math.min(bottom, b.bottom);
          box.style.left = `${clipLeft}px`;
          box.style.top = `${clipTop}px`;
          box.style.width = `${Math.max(0, clipRight - clipLeft)}px`;
          box.style.height = `${Math.max(0, clipBottom - clipTop)}px`;
        }
      };

      const tick = () => {
        const b = container.getBoundingClientRect();
        let step = 0;
        if (pointer.y < b.top + EDGE_SIZE) {
          step = -Math.min(MAX_SCROLL_STEP, Math.ceil((b.top + EDGE_SIZE - pointer.y) / 3));
        } else if (pointer.y > b.bottom - EDGE_SIZE) {
          step = Math.min(MAX_SCROLL_STEP, Math.ceil((pointer.y - (b.bottom - EDGE_SIZE)) / 3));
        }
        if (step !== 0) {
          const before = container.scrollTop;
          container.scrollTop += step;
          if (container.scrollTop !== before) dirty = true;
        }
        if (dirty) {
          dirty = false;
          update();
        }
        frame = requestAnimationFrame(tick);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("dragstart", preventDefault, true);
        window.removeEventListener("selectstart", preventDefault, true);
        cancelAnimationFrame(frame);
        box?.remove();
        box = null;
        if (active) document.body.style.userSelect = "";
        cleanupRef.current = null;
      };

      const onMove = (ev: PointerEvent) => {
        pointer.x = ev.clientX;
        pointer.y = ev.clientY;
        if (!active) {
          if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) < DRAG_THRESHOLD) return;
          active = true;
          document.body.style.userSelect = "none";
          window.getSelection()?.removeAllRanges();
          box = document.createElement("div");
          box.className = BOX_CLASS;
          document.body.appendChild(box);
          frame = requestAnimationFrame(tick);
        }
        dirty = true;
      };

      const onUp = (ev: PointerEvent) => {
        const wasActive = active;
        if (wasActive) {
          pointer.x = ev.clientX;
          pointer.y = ev.clientY;
          update();
        }
        cleanup();
        if (wasActive) suppressNextClick();
      };

      const onCancel = () => cleanup();

      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        const wasActive = active;
        cleanup();
        if (wasActive) onChangeRef.current(base);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      window.addEventListener("dragstart", preventDefault, true);
      window.addEventListener("selectstart", preventDefault, true);
      cleanupRef.current = cleanup;
    },
    [containerRef, enabled],
  );
}
