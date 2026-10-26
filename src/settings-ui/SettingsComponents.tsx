import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

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
        className="relative flex shrink-0 overflow-hidden rounded-xl border border-white/[0.07] bg-ink-950/70 p-0.5"
      >
        <div
          className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-md transition-all duration-200 ease-out"
          style={{
            left: `${indicator.left}px`,
            width: `${indicator.width}px`,
            background: "var(--accent-gradient)",
          }}
        />
        <button
          ref={yesRef}
          type="button"
          onClick={() => onChange(true)}
          className={`interactive-press relative z-10 min-w-[64px] rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            value ? "text-white" : "text-white/60 hover:text-white"
          }`}
        >
          {yesLabel ?? "Yes"}
        </button>
        <button
          ref={noRef}
          type="button"
          onClick={() => onChange(false)}
          className={`interactive-press relative z-10 min-w-[64px] rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
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
          background: `linear-gradient(to right, var(--accent-from) 0%, var(--accent-to) ${percent}%, rgba(255, 255, 255,0.12) ${percent}%, rgba(255, 255, 255,0.12) 100%)`,
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
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
    <section className="glass-panel mb-4 px-6 py-4">
      <h2 className="mb-3 text-sm font-semibold text-white/90">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
};

const trimLabel = (label: React.ReactNode) =>
  typeof label === "string" ? label.replace(/\s*:\s*$/, "") : label;

export type SettingsSectionProps = {
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  icon,
  actions,
  children,
}) => (
  <section className="glass-panel px-5 pb-1.5 pt-4">
    <header className="flex min-h-[2rem] items-center gap-2.5">
      {icon ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[color:var(--seam)] bg-white/[0.03] text-white/60">
          {icon}
        </span>
      ) : null}
      <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-white/90">
        {title}
      </h2>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
    <div className="mt-1.5 divide-y divide-[color:var(--seam)]">{children}</div>
  </section>
);

export type SettingsRowProps = {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  stacked?: boolean;
  children?: React.ReactNode;
};

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  hint,
  htmlFor,
  stacked = false,
  children,
}) => {
  const text = (
    <div className="min-w-0 flex-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm text-white/90">
          {trimLabel(label)}
        </label>
      ) : (
        <div className="text-sm text-white/90">{trimLabel(label)}</div>
      )}
      {hint ? <p className="ui-meta mt-0.5 max-w-prose">{hint}</p> : null}
    </div>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-3 py-3.5">
        {text}
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      {text}
      {children ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
};

export type SettingsSwitchProps = {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
};

export const SettingsSwitch: React.FC<SettingsSwitchProps> = ({
  checked,
  onChange,
  label,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label ? String(trimLabel(label)) : undefined}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`interactive-press relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
      checked ? "accent-bg" : "bg-white/[0.12] hover:bg-white/[0.18]"
    }`}
  >
    <span
      className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition-transform duration-200 ease-out ${
        checked ? "translate-x-5 bg-[var(--on-accent,#fff)]" : "translate-x-0 bg-white"
      }`}
    />
  </button>
);

export type SettingsSwitchRowProps = Omit<SettingsRowProps, "children" | "stacked"> & {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
};

export const SettingsSwitchRow: React.FC<SettingsSwitchRowProps> = ({
  value,
  onChange,
  disabled,
  ...row
}) => (
  <SettingsRow {...row}>
    <SettingsSwitch
      checked={value}
      onChange={onChange}
      disabled={disabled}
      label={typeof row.label === "string" ? row.label : undefined}
    />
  </SettingsRow>
);

export type SettingsSelectOption<T extends string> = {
  value: T;
  label: string;
};

export type SettingsSelectProps<T extends string> = {
  id?: string;
  value: T;
  options: SettingsSelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function SettingsSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className = "w-full sm:w-64",
}: SettingsSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="interactive-press launcher-select glass-control flex h-9 w-full items-center px-3 text-left text-sm outline-none disabled:opacity-60"
      >
        <span className="min-w-0 truncate">{current?.label ?? placeholder ?? ""}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            role="listbox"
            aria-labelledby={id}
            className="custom-scrollbar glass-popover absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto p-1 text-sm"
          >
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value || "__empty"}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center rounded-lg px-3 py-2 text-left transition-colors ${
                    selected ? "seg-on" : "text-white/80 hover:bg-white/10"
                  }`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type SettingsSegmentedProps<T extends string> = {
  value: T;
  options: SettingsSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
};

export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SettingsSegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="seg-track flex flex-wrap gap-0.5 p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`interactive-press min-w-[4.5rem] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              selected ? "seg-on" : "text-white/65 hover:text-white"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

