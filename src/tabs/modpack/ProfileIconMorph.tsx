import type { ReactNode } from "react";
import { motion } from "framer-motion";

const MORPH_TRANSITION = { type: "spring", stiffness: 520, damping: 40, mass: 0.7 } as const;

// при CSS zoom координаты framer-motion расходятся, поэтому там переход выключают через enabled
export function ProfileIconMorph({
  profileId,
  enabled,
  className,
  children,
}: {
  profileId: string;
  enabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      layoutId={enabled ? `profile-icon-${profileId}` : undefined}
      transition={MORPH_TRANSITION}
      className={className}
    >
      {children}
    </motion.div>
  );
}
