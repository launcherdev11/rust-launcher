import type React from "react";

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
  yesLabel = "Да",
  noLabel = "Нет",
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
          {yesLabel}
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
          {noLabel}
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
  right?: React.ReactNode;
};

export const SettingsSlider: React.FC<SettingsSliderProps> = ({
  label,
  min,
  max,
  value,
  onChange,
  suffix = "ГБ",
  right,
}) => {
  const normalized = Math.min(max, Math.max(min, value || min));
  const percent =
    max === min ? 100 : Math.min(100, Math.max(0, ((normalized - min) / (max - min)) * 100));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-white/90">{label}</span>
        {right ?? (
          <span className="text-sm font-semibold text-white/90">
            {normalized}
            {suffix}
          </span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={normalized}
        onChange={(e) => onChange(Number(e.target.value))}
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

