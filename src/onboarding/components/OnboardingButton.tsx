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
    "bg-[#0078d4] text-white hover:bg-[#106ebe]",
  ely: "bg-[#2d7d46] text-white hover:bg-[#248338]",
};

const baseClasses = [
  "btn",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 focus-visible:ring-white/35",
  "disabled:cursor-not-allowed",
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
