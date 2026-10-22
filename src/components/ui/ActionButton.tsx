import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
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
  disabledReason?: string;
};

const variantClasses: Record<Variant, string> = {
  primary: "btn-accent",
  secondary: "btn-soft",
  ghost: "btn-ghost",
  danger: "btn-danger",
  sky: "btn-soft",
  emerald: "btn-tint",
};

const sizeClasses: Record<Size, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg sm:px-10",
};

export function ActionButton({
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel,
  children,
  fullWidth = false,
  pill: _pill,
  className = "",
  disabled,
  disabledReason,
  onClick,
  title,
  ...rest
}: Props) {
  const isDisabled = Boolean(disabled || loading);
  const explain = Boolean(disabled && !loading && disabledReason);
  const [bubble, setBubble] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (explain) {
      e.preventDefault();
      setBubble(true);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setBubble(false), 2600);
      return;
    }
    onClick?.(e);
  };

  const button = (
    <button
      type="button"
      disabled={explain ? undefined : isDisabled}
      aria-disabled={explain || undefined}
      title={explain ? disabledReason : title}
      onClick={handleClick}
      aria-busy={loading || undefined}
      className={[
        "btn",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-to/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
        "disabled:cursor-not-allowed",
        explain ? "cursor-not-allowed opacity-50" : "",
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

  if (!explain) return button;

  return (
    <span className={`relative inline-flex ${fullWidth ? "w-full" : ""}`}>
      {button}
      {bubble && (
        <span
          role="status"
          className="locked-hint pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[18rem] -translate-x-1/2 shadow-soft"
        >
          {disabledReason}
        </span>
      )}
    </span>
  );
}
