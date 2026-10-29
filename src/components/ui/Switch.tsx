type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  title?: string;
  disabled?: boolean;
  size?: "md" | "lg";
  className?: string;
};

const SIZES = {
  md: { track: "h-6 w-11", knob: "h-5 w-5" },
  lg: { track: "h-7 w-12", knob: "h-6 w-6" },
};

export function Switch({
  checked,
  onChange,
  label,
  title,
  disabled,
  size = "md",
  className = "",
}: Props) {
  const s = SIZES[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? title}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`interactive-press relative shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${s.track} ${
        checked ? "accent-bg" : "bg-white/[0.12] hover:bg-white/[0.18]"
      } ${className}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 rounded-full shadow transition-[transform,background-color] duration-200 ease-out ${s.knob} ${
          checked
            ? "translate-x-5 bg-[var(--on-accent,#fff)]"
            : "translate-x-0 bg-[color:var(--fg)]"
        }`}
      />
    </button>
  );
}
