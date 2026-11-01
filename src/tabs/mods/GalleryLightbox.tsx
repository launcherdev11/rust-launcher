import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AssetIcon } from "../../components/asset_icon";
import type { GalleryItem } from "./types";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type GalleryLightboxProps = {
  tt: Tt;
  items: GalleryItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

export function GalleryLightbox({
  tt,
  items,
  index,
  onIndexChange,
  onClose,
}: GalleryLightboxProps) {
  const count = items.length;
  const item = items[index];
  const stripRef = useRef<HTMLDivElement | null>(null);

  const step = (delta: number) => {
    if (count < 2) return;
    onIndexChange((index + delta + count) % count);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "ArrowLeft") {
        step(-1);
      } else if (e.key === "ArrowRight") {
        step(1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => {
    const thumb = stripRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    thumb?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  if (!item) return null;

  return createPortal(
    <div
      className="glass-overlay fixed inset-0 z-[220] flex flex-col"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex shrink-0 items-center gap-3 px-5 pb-2 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="shrink-0 text-[0.8125rem] tabular-nums text-white/50">
          {index + 1} / {count}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
          {item.title || ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="icon-btn"
          aria-label={tt("common.close")}
          title={tt("common.close")}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path
              d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 py-2">
        {count > 1 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            className="glass-chip interactive-press absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white/75 hover:text-white"
            aria-label={tt("mods.detail.prevImage")}
            title={tt("mods.detail.prevImage")}
          >
            <AssetIcon name="back" className="h-4 w-4" />
          </button>
        ) : null}
        <img
          key={item.url}
          src={item.url}
          alt={item.title || ""}
          onClick={(e) => e.stopPropagation()}
          className="mods-lightbox-img max-h-full max-w-full rounded-2xl object-contain shadow-xl"
        />
        {count > 1 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            className="glass-chip interactive-press absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white/75 hover:text-white"
            aria-label={tt("mods.detail.nextImage")}
            title={tt("mods.detail.nextImage")}
          >
            <AssetIcon name="back" className="h-4 w-4 rotate-180" />
          </button>
        ) : null}
      </div>

      {item.description ? (
        <p
          className="mx-auto max-w-3xl shrink-0 px-6 pt-1 text-center text-[0.8125rem] text-white/65"
          onClick={(e) => e.stopPropagation()}
        >
          {item.description}
        </p>
      ) : null}

      {count > 1 ? (
        <div
          ref={stripRef}
          className="custom-scrollbar mx-auto flex max-w-full shrink-0 gap-2 overflow-x-auto px-5 pb-4 pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((g, i) => (
            <button
              key={g.url}
              type="button"
              data-index={i}
              onClick={() => onIndexChange(i)}
              className={`interactive-press h-14 w-24 shrink-0 overflow-hidden rounded-xl border transition ${
                i === index
                  ? "border-accent-to/80 opacity-100"
                  : "border-white/10 opacity-55 hover:opacity-90"
              }`}
              aria-label={g.title || `${i + 1}`}
            >
              <img src={g.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <div className="h-4 shrink-0" />
      )}
    </div>,
    document.body,
  );
}
