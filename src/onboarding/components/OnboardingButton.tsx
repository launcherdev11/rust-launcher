import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "microsoft" | "ely";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
  fullWidth?: boolean;
};

const variantClasses: Record<Variant, string> = {
  primary:
    "accent-bg text-white shadow-soft hover:opacity-90 focus-visible:ring-white/35",
  secondary:
    "border border-white/20 bg-white/10 text-white shadow-soft hover:bg-white/20 hover:border-white/30",
  ghost:
    "border border-transparent bg-transparent text-white/70 hover:bg-white/10 hover:text-white",
  microsoft:
    "border border-[#0078d4]/60 bg-[#0078d4] text-white shadow-soft hover:bg-[#106ebe]",
  ely: "border border-emerald-500/35 bg-[#2d7d46] text-white shadow-soft hover:bg-[#248338]",
};

export function OnboardingButton({
  variant = "primary",
  children,
  fullWidth = false,
  className = "",
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={[
        "interactive-press rounded-full px-12 py-3 text-sm font-semibold tracking-wide transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none",
        fullWidth ? "w-full max-w-md" : "min-w-[9rem]",
        variantClasses[variant],
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
