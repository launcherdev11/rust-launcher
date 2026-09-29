import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ActionButton } from "../../components/ui/ActionButton";

type Variant = "primary" | "secondary" | "ghost" | "microsoft" | "ely";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
  fullWidth?: boolean;
};

const providerClasses: Record<"microsoft" | "ely", string> = {
  microsoft:
    "border border-[#0078d4]/60 bg-[#0078d4] text-white shadow-soft hover:bg-[#106ebe]",
  ely: "border border-emerald-500/35 bg-[#2d7d46] text-white shadow-soft hover:bg-[#248338]",
};

const baseClasses = [
  "inline-flex items-center justify-center gap-2 font-semibold tracking-wide transition-colors duration-200",
  "rounded-xl px-4 py-2.5 text-sm",
  "interactive-press",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:ring-white/35",
  "disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none",
].join(" ");

export function OnboardingButton({
  variant = "primary",
  children,
  fullWidth = false,
  className = "",
  disabled,
  type = "button",
  ...rest
}: Props) {
  if (variant === "microsoft" || variant === "ely") {
    return (
      <button
        type={type}
        disabled={disabled}
        className={[
          baseClasses,
          fullWidth ? "w-full" : "",
          providerClasses[variant],
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {children}
      </button>
    );
  }

  return (
    <ActionButton
      type={type}
      variant={variant}
      size="md"
      fullWidth={fullWidth}
      disabled={disabled}
      className={className}
      {...rest}
    >
      {children}
    </ActionButton>
  );
}
