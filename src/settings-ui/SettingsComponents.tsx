import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";

export type SettingsToggleProps = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
};

export const SettingsToggle: React.FC<SettingsToggleProps> = ({
  label,
  value,
  onChange,
  yesLabel,
  noLabel,
}) => {
  const accentVar = "var(--accent-color)";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const yesRef = useRef<HTMLButtonElement | null>(null);
  const noRef = useRef<HTMLButtonElement | null>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    let raf = 0;
    let cancelled = false;

    const updateIndicator = () => {
      if (cancelled) return;
      const btn = value ? yesRef.current : noRef.current;
      const container = containerRef.current;
      if (!btn || !container) return;

      const btnRect = btn.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateIndicator);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [value, yesLabel, noLabel]);

  return (
    <div className="flex items-center justify-between gap-4 sm:gap-6">
      <span className="min-w-0 flex-1 text-sm text-white/90">{label}</span>
      <div
        ref={containerRef}
        className="relative flex shrink-0 rounded-full bg-white/10 p-0.5 overflow-hidden"
      >
        <div
          className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-full shadow-soft transition-all duration-200 ease-out"
          style={{
            left: `${indicator.left}px`,
            width: `${indicator.width}px`,
            backgroundColor: accentVar,
          }}
        />
        <button
          ref={yesRef}
          type="button"
          onClick={() => onChange(true)}
          className={`interactive-press relative z-10 min-w-[64px] rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
            value ? "text-white" : "text-white/60 hover:text-white"
          }`}
        >
          {yesLabel ?? "Yes"}
        </button>
        <button
          ref={noRef}
          type="button"
          onClick={() => onChange(false)}
          className={`interactive-press relative z-10 min-w-[64px] rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
            !value ? "text-white" : "text-white/60 hover:text-white"
          }`}
        >
          {noLabel ?? "No"}
        </button>
      </div>
    </div>
  );
};

export type SettingsSliderProps = {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  onChangeCommitted?: (value: number) => void;
  suffix?: string;
  right?: React.ReactNode;
};

export const SettingsSlider: React.FC<SettingsSliderProps> = ({
  label,
  min,
  max,
  value,
  onChange,
  onChangeCommitted,
  suffix,
  right,
}) => {
  const normalized = Math.min(max, Math.max(min, value || min));
  const percent =
    max === min ? 100 : Math.min(100, Math.max(0, ((normalized - min) / (max - min)) * 100));

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    const val = Number((e.target as HTMLInputElement).value);
    onChangeCommitted?.(val);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-white/90">{label}</span>
        {right ?? (
          <span className="text-sm font-semibold text-white/90">
            {normalized}
            {suffix ?? ""}
          </span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={normalized}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={handlePointerUp}
        style={{
          background: `linear-gradient(to right, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.28) ${percent}%, rgba(0,0,0,0.40) ${percent}%, rgba(0,0,0,0.40) 100%)`,
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[#2f7adf]"
      />
    </div>
  );
};

export type SettingsCardProps = {
  title: string;
  children: React.ReactNode;
};

export const SettingsCard: React.FC<SettingsCardProps> = ({
  title,
  children,
}) => {
  return (
    <section className="mb-4 rounded-2xl border border-white/10 bg-white/8 px-6 py-4 shadow-soft backdrop-blur-md">
      <h2 className="mb-3 text-sm font-semibold text-white/90">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
};

