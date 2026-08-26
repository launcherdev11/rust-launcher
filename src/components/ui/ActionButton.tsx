import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "sky" | "emerald";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingLabel?: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
  pill?: boolean;
};

const variantClasses: Record<Variant, string> = {
  primary:
    "accent-bg text-white shadow-soft hover:opacity-90 focus-visible:ring-white/35",
  secondary:
    "border border-white/20 bg-white/10 text-white shadow-soft hover:bg-white/20 hover:border-white/30",
  ghost:
    "border border-transparent bg-transparent text-white/70 hover:bg-white/10 hover:text-white",
  danger:
    "border border-red-500/35 bg-red-600/20 text-red-100 hover:bg-red-600/30",
  sky: "border border-sky-400/35 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25",
  emerald:
    "border border-emerald-500/40 bg-emerald-600/25 text-emerald-50 hover:bg-emerald-600/35",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-12 py-3 text-sm sm:px-16",
};

export function ActionButton({
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel,
  children,
  fullWidth = false,
  pill = false,
  className = "",
  disabled,
  ...rest
}: Props) {
  const isDisabled = Boolean(disabled || loading);

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center justify-center gap-2 font-semibold tracking-wide transition-colors duration-200",
        pill ? "rounded-full" : "rounded-xl",
        loading ? "" : "interactive-press",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none",
        fullWidth ? "w-full" : "",
        sizeClasses[size],
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
          <span>{loadingLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
