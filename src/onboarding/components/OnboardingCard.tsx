import type { ReactNode } from "react";
import { motion } from "framer-motion";

type Props = {
  children: ReactNode;
  className?: string;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

export function OnboardingCard({
  children,
  className = "",
  selected = false,
  onClick,
  disabled = false,
}: Props) {
  const interactive = Boolean(onClick) && !disabled;

  return (
    <motion.div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      whileHover={interactive && !disabled ? { y: -2 } : undefined}
      whileTap={interactive && !disabled ? { scale: 0.98 } : undefined}
      className={[
        "rounded-2xl border px-5 py-4 backdrop-blur-xl transition-colors duration-200",
        selected
          ? "border-white/25 bg-black/70 shadow-soft"
          : "border-white/12 bg-black/65 shadow-soft hover:border-white/20 hover:bg-black/75",
        interactive ? "cursor-pointer" : "",
        disabled ? "cursor-not-allowed opacity-50" : "",
        className,
      ].join(" ")}
    >
      {children}
    </motion.div>
  );
}
