import { ACCENT_PRESETS } from "../tabs/settings/accentColor";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  presetLabel: (id: string) => string;
  ariaLabel: string;
  className?: string;
};

export function AccentSwatchGrid({ value, onChange, presetLabel, ariaLabel, className = "" }: Props) {
  const current = value.trim().toLowerCase();

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`grid grid-cols-9 gap-1.5 ${className}`}>
      {ACCENT_PRESETS.map((preset) => {
        const active = current === preset.hex;
        const name = presetLabel(preset.id);
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={name}
            title={name}
            onClick={() => onChange(preset.hex)}
            className={`interactive-press aspect-square w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
              active
                ? "shadow-[0_0_0_2px_var(--ink-1),0_0_0_3.5px_rgba(255,255,255,0.9)]"
                : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)]"
            }`}
            style={{ background: preset.hex }}
          />
        );
      })}
    </div>
  );
}
