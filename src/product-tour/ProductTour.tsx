import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Language } from "../i18n";
import { useT } from "../i18n";
import { TOUR_STEPS, type TourAccountsSection, type TourStep, type TourTabId } from "./types";

const SPOTLIGHT_PADDING = 10;
const TOOLTIP_GAP = 20;
const TOOLTIP_WIDTH = 380;
const TOOLTIP_EST_HEIGHT = 260;
const VIEWPORT_MARGIN = 16;

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TooltipRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TooltipPos = {
  top: number;
  left: number;
  placement: "top" | "bottom" | "left" | "right" | "center";
};

export type ProductTourProps = {
  language: Language;
  accentColor?: string;
  active: boolean;
  onNavigateTab: (tab: TourTabId) => void;
  onNavigateAccountsSection: (section: TourAccountsSection) => void;
  onComplete: () => void;
  onSkip: () => void;
};

function queryTargetRect(targetId: string): DOMRect | null {
  const el = document.querySelector(`[data-tour-id="${targetId}"]`);
  if (!el) return null;
  return el.getBoundingClientRect();
}

function toSpotlight(rect: DOMRect): SpotlightRect {
  return {
    top: rect.top - SPOTLIGHT_PADDING,
    left: rect.left - SPOTLIGHT_PADDING,
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
  };
}

function clampHorizontal(left: number, width: number): number {
  const vw = window.innerWidth;
  return Math.max(VIEWPORT_MARGIN, Math.min(vw - width - VIEWPORT_MARGIN, left));
}

function clampVertical(top: number, height: number): number {
  const vh = window.innerHeight;
  return Math.max(VIEWPORT_MARGIN, Math.min(vh - height - VIEWPORT_MARGIN, top));
}

function tooltipOverlapsSpotlight(tooltip: TooltipRect, spotlight: SpotlightRect): boolean {
  const gap = 6;
  return !(
    tooltip.left + tooltip.width + gap <= spotlight.left ||
    tooltip.left >= spotlight.left + spotlight.width + gap ||
    tooltip.top + tooltip.height + gap <= spotlight.top ||
    tooltip.top >= spotlight.top + spotlight.height + gap
  );
}

function fitsViewport(tooltip: TooltipRect): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return (
    tooltip.top >= VIEWPORT_MARGIN &&
    tooltip.left >= VIEWPORT_MARGIN &&
    tooltip.top + tooltip.height <= vh - VIEWPORT_MARGIN &&
    tooltip.left + tooltip.width <= vw - VIEWPORT_MARGIN
  );
}

function rectForPlacement(
  spotlight: SpotlightRect,
  placement: "top" | "bottom" | "left" | "right",
  tooltipW: number,
  tooltipH: number,
): TooltipRect {
  const cx = spotlight.left + spotlight.width / 2;
  const cy = spotlight.top + spotlight.height / 2;

  switch (placement) {
    case "top":
      return {
        top: spotlight.top - TOOLTIP_GAP - tooltipH,
        left: clampHorizontal(cx - tooltipW / 2, tooltipW),
        width: tooltipW,
        height: tooltipH,
      };
    case "bottom":
      return {
        top: spotlight.top + spotlight.height + TOOLTIP_GAP,
        left: clampHorizontal(cx - tooltipW / 2, tooltipW),
        width: tooltipW,
        height: tooltipH,
      };
    case "left":
      return {
        top: clampVertical(cy - tooltipH / 2, tooltipH),
        left: spotlight.left - TOOLTIP_GAP - tooltipW,
        width: tooltipW,
        height: tooltipH,
      };
    case "right":
      return {
        top: clampVertical(cy - tooltipH / 2, tooltipH),
        left: spotlight.left + spotlight.width + TOOLTIP_GAP,
        width: tooltipW,
        height: tooltipH,
      };
  }
}

function fallbackTooltipPos(spotlight: SpotlightRect, tooltipW: number, tooltipH: number): TooltipPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceAbove = spotlight.top - VIEWPORT_MARGIN;
  const spaceBelow = vh - VIEWPORT_MARGIN - (spotlight.top + spotlight.height);
  const spaceLeft = spotlight.left - VIEWPORT_MARGIN;
  const spaceRight = vw - VIEWPORT_MARGIN - (spotlight.left + spotlight.width);

  type Zone = { placement: "top" | "bottom" | "left" | "right"; space: number };
  const zones: Zone[] = [
    { placement: "top" as const, space: spaceAbove },
    { placement: "bottom" as const, space: spaceBelow },
    { placement: "left" as const, space: spaceLeft },
    { placement: "right" as const, space: spaceRight },
  ].sort((a, b) => b.space - a.space);

  for (const { placement } of zones) {
    const rect = rectForPlacement(spotlight, placement, tooltipW, tooltipH);
    if (!tooltipOverlapsSpotlight(rect, spotlight)) {
      return {
        top: clampVertical(rect.top, tooltipH),
        left: clampHorizontal(rect.left, tooltipW),
        placement,
      };
    }
  }

  if (spaceAbove >= spaceBelow) {
    return {
      top: VIEWPORT_MARGIN,
      left: clampHorizontal(vw / 2 - tooltipW / 2, tooltipW),
      placement: "top",
    };
  }

  return {
    top: vh - tooltipH - VIEWPORT_MARGIN,
    left: clampHorizontal(vw / 2 - tooltipW / 2, tooltipW),
    placement: "bottom",
  };
}

function computeTooltipPos(
  spotlight: SpotlightRect,
  preferred: TourStep["placement"],
  tooltipW: number,
  tooltipH: number,
): TooltipPos {
  const preferredOrder: Array<"top" | "bottom" | "left" | "right"> = [];

  if (preferred === "top" || preferred === "bottom" || preferred === "left" || preferred === "right") {
    preferredOrder.push(preferred);
  }

  for (const p of ["top", "bottom", "left", "right"] as const) {
    if (!preferredOrder.includes(p)) preferredOrder.push(p);
  }

  for (const placement of preferredOrder) {
    const rect = rectForPlacement(spotlight, placement, tooltipW, tooltipH);
    if (fitsViewport(rect) && !tooltipOverlapsSpotlight(rect, spotlight)) {
      return { top: rect.top, left: rect.left, placement };
    }
  }

  return fallbackTooltipPos(spotlight, tooltipW, tooltipH);
}

export function ProductTour({
  language,
  accentColor = "#0b1530",
  active,
  onNavigateTab,
  onNavigateAccountsSection,
  onComplete,
  onSkip,
}: ProductTourProps) {
  const tt = useT(language);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>({
    top: window.innerHeight / 2,
    left: window.innerWidth / 2,
    placement: "center",
  });
  const [ready, setReady] = useState(false);
  const [tooltipHeight, setTooltipHeight] = useState(TOOLTIP_EST_HEIGHT);
  const rafRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const step = TOUR_STEPS[stepIndex];
  const totalSteps = TOUR_STEPS.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const isCentered = !step.target || step.placement === "center";

  const tooltipWidth = Math.min(TOOLTIP_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);

  const recalc = useCallback(() => {
    if (!step.target) {
      setSpotlight(null);
      setTooltipPos({
        top: window.innerHeight / 2,
        left: window.innerWidth / 2,
        placement: "center",
      });
      setReady(true);
      return;
    }

    const rect = queryTargetRect(step.target);
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      setSpotlight(null);
      setReady(false);
      return;
    }

    const spot = toSpotlight(rect);
    const measuredH = tooltipRef.current?.offsetHeight ?? tooltipHeight;
    const h = Math.max(measuredH, TOOLTIP_EST_HEIGHT);
    setSpotlight(spot);
    setTooltipPos(computeTooltipPos(spot, step.placement, tooltipWidth, h));
    setReady(true);
  }, [step, tooltipHeight, tooltipWidth]);

  const applyStepNavigation = useCallback(
    (s: TourStep) => {
      if (s.tab) onNavigateTab(s.tab);
      if (s.accountsSection) onNavigateAccountsSection(s.accountsSection);
    },
    [onNavigateTab, onNavigateAccountsSection],
  );

  useEffect(() => {
    if (!active) return;
    setStepIndex(0);
    setReady(false);
    setTooltipHeight(TOOLTIP_EST_HEIGHT);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    setReady(false);
    applyStepNavigation(step);
    const delay = step.accountsSection ? 350 : step.tab === "accounts" ? 220 : 140;
    const t = window.setTimeout(() => recalc(), delay);
    return () => window.clearTimeout(t);
  }, [active, step, applyStepNavigation, recalc]);

  useLayoutEffect(() => {
    if (!active) return;

    const schedule = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => recalc());
    };

    schedule();
    window.addEventListener("resize", schedule);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : null;
    ro?.observe(document.documentElement);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [active, recalc, stepIndex]);

  useLayoutEffect(() => {
    if (!active) return;
    const el = tooltipRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > 0) setTooltipHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, stepIndex]);

  useLayoutEffect(() => {
    if (!active || !ready) return;
    recalc();
  }, [active, ready, tooltipHeight, recalc]);

  const goNext = () => {
    if (isLast) {
      onComplete();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    if (!isFirst) setStepIndex((i) => i - 1);
  };

  if (!active) return null;

  const title = tt(`productTour.steps.${step.id}.title`);
  const body = tt(`productTour.steps.${step.id}.body`);

  return createPortal(
    <div className="fixed inset-0 z-[400]" role="dialog" aria-modal="true" aria-label={title}>
      {spotlight && ready ? (
        <div
          className="pointer-events-none fixed rounded-2xl transition-all duration-300 ease-out"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.82)",
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 bg-black/82 transition-opacity duration-300" />
      )}

      {spotlight && ready ? (
        <motion.div
          key={step.id}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="pointer-events-none fixed rounded-2xl"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            border: "2px solid rgba(255,255,255,0.85)",
            boxShadow: `0 0 0 1px ${accentColor}88, 0 0 24px ${accentColor}66, inset 0 0 20px rgba(255,255,255,0.06)`,
          }}
        >
          <div
            className="absolute inset-0 rounded-2xl animate-pulse"
            style={{
              boxShadow: `0 0 18px 2px ${accentColor}55`,
            }}
          />
        </motion.div>
      ) : null}

      <div className="pointer-events-auto fixed inset-0" onClick={(e) => e.stopPropagation()} />

      <AnimatePresence mode="wait">
        <motion.div
          ref={tooltipRef}
          key={step.id}
          initial={{ opacity: 0, y: isCentered ? 12 : 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="pointer-events-auto fixed z-[401] max-h-[min(70vh,520px)] overflow-y-auto"
          style={
            isCentered
              ? {
                  top: "50%",
                  left: "50%",
                  width: tooltipWidth,
                  transform: "translate(-50%, -50%)",
                }
              : {
                  top: tooltipPos.top,
                  left: tooltipPos.left,
                  width: tooltipWidth,
                }
          }
        >
          <div
            className="overflow-hidden rounded-2xl border border-white/15 bg-[#0c0e14]/95 shadow-2xl backdrop-blur-xl"
            style={{
              boxShadow: `0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px ${accentColor}33`,
            }}
          >
            <div
              className="h-1 w-full"
              style={{
                background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88, transparent)`,
              }}
            />
            <div className="p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                  {tt("productTour.progress", { current: stepIndex + 1, total: totalSteps })}
                </span>
                <button
                  type="button"
                  onClick={onSkip}
                  className="interactive-press text-[11px] font-medium text-white/45 transition-colors hover:text-white/75"
                >
                  {tt("productTour.skip")}
                </button>
              </div>

              <h2 className="text-lg font-bold leading-snug text-white">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/72 whitespace-pre-line">{body}</p>

              <div className="mt-5 flex items-center gap-2">
                {!isFirst ? (
                  <button
                    type="button"
                    onClick={goBack}
                    className="interactive-press rounded-xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/75 hover:bg-white/10"
                  >
                    {tt("productTour.back")}
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={goNext}
                  className="interactive-press ml-auto rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 accent-bg"
                >
                  {isLast ? tt("productTour.finish") : tt("productTour.next")}
                </button>
              </div>

              <div className="mt-4 flex justify-center gap-1.5">
                {TOUR_STEPS.map((s, i) => (
                  <span
                    key={s.id}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      i === stepIndex ? "w-5 accent-bg" : "w-1.5 bg-white/20"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}
