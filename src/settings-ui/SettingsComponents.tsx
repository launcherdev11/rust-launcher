import type React from "react";

export type SettingsToggleProps = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

export const SettingsToggle: React.FC<SettingsToggleProps> = ({
  label,
  value,
  onChange,
}) => {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-white/90">{label}</span>
      <div className="flex rounded-full bg-white/10 p-0.5">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`interactive-press min-w-[64px] rounded-full px-4 py-1.5 text-xs font-semibold ${
            value
              ? "bg-[#4b9dff] text-white shadow-soft"
              : "text-white/60 hover:text-white"
          }`}
        >
          Да
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`interactive-press min-w-[64px] rounded-full px-4 py-1.5 text-xs font-semibold ${
            !value
              ? "bg-[#3a3f4a] text-white shadow-soft"
              : "text-white/60 hover:text-white"
          }`}
        >
          Нет
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
  suffix?: string;
};

export const SettingsSlider: React.FC<SettingsSliderProps> = ({
  label,
  min,
  max,
  value,
  onChange,
  suffix = "ГБ",
}) => {
  const normalized = Math.min(max, Math.max(min, value || min));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-white/90">{label}</span>
        <span className="text-sm font-semibold text-white/90">
          {normalized}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={normalized}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/40 accent-[#2f7adf]"
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

