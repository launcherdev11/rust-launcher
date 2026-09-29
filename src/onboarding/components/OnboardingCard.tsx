import type { KeyboardEvent, ReactNode } from "react";
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

  const onKeyDown = interactive
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }
    : undefined;

  return (
    <motion.div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={onKeyDown}
      whileHover={interactive ? { y: -1 } : undefined}
      whileTap={interactive ? { scale: 0.985 } : undefined}
      transition={{ duration: 0.15 }}
      className={[
        "glass-panel px-4 py-3 transition-colors duration-200",
        selected ? "border-white/30" : "hover:border-white/20",
        interactive ? "cursor-pointer" : "",
        disabled ? "cursor-not-allowed opacity-50" : "",
        className,
      ].join(" ")}
    >
      {children}
    </motion.div>
  );
}
