import { useEffect, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";

export function LauncherAnimationScope({
  animationsDisabled,
  children,
}: {
  animationsDisabled: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.classList.toggle("launcher-no-animations", animationsDisabled);
    return () => {
      document.documentElement.classList.remove("launcher-no-animations");
    };
  }, [animationsDisabled]);

  return (
    <MotionConfig reducedMotion={animationsDisabled ? "always" : "user"}>
      {children}
    </MotionConfig>
  );
}
