import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import type { Language } from "../../i18n";
import { LauncherGradientBackground } from "../../components/LauncherGradientBackground";
import { accentTweenStyle, DEFAULT_ACCENT_COLOR } from "../../tabs/settings/accentColor";
import { ProgressIndicator } from "./ProgressIndicator";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const stepVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 20 }),
  center: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.28, ease: EASE_OUT, staggerChildren: 0.04, delayChildren: 0.02 },
  },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir * -14,
    transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  }),
};

export const onboardingItem: Variants = {
  enter: { opacity: 0, y: 8 },
  center: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } },
};

type Props = {
  language: Language;
  accentColor?: string;
  stepIndex: number;
  stepKey: string;
  direction: number;
  children: ReactNode;
};

export function OnboardingShell({
  language,
  accentColor,
  stepIndex,
  stepKey,
  direction,
  children,
}: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="accent-tween relative flex min-h-screen w-full flex-col overflow-hidden text-white"
      style={accentTweenStyle(accentColor ?? DEFAULT_ACCENT_COLOR)}
    >
      <div className="pointer-events-none fixed inset-0">
        <LauncherGradientBackground />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 py-6 sm:px-8">
        <motion.div
          className="mx-auto w-full max-w-lg shrink-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <ProgressIndicator currentStep={stepIndex} language={language} />
        </motion.div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-5">
          <motion.div
            className="glass-panel w-full max-w-lg"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, ease: EASE_OUT }}
          >
            <motion.div
              initial={false}
              animate={{ height: height ?? "auto" }}
              transition={{ duration: 0.32, ease: EASE_OUT }}
              style={{ overflow: resizing ? "hidden" : "visible" }}
              onAnimationStart={() => setResizing(true)}
              onAnimationComplete={() => setResizing(false)}
            >
              <div ref={contentRef} className="p-5 sm:p-6">
                <AnimatePresence mode="wait" custom={direction}>
                  <motion.div
                    key={stepKey}
                    custom={direction}
                    variants={stepVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="flex flex-col text-left"
                  >
                    {children}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
