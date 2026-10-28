import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";

type Props = {
  count: number;
  label: (count: number) => string;
  children: ReactNode;
};

const EASE_OUT = [0.2, 0.9, 0.25, 1] as const;

export function ContentSelectionBar({ count, label, children }: Props) {
  const [shown, setShown] = useState({ count, dir: 1 });
  if (count > 0 && count !== shown.count) {
    setShown({ count, dir: count > shown.count ? 1 : -1 });
  }

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          key="selection-bar"
          role="toolbar"
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.14, ease: "easeIn" } }}
          transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.8 }}
          className="pointer-events-none sticky bottom-0 z-20 mt-auto pt-2.5"
        >
          <div className="glass-popover pointer-events-auto flex flex-wrap items-center gap-1.5 py-1 pl-3 pr-1 text-xs">
            <span className="relative mr-auto overflow-hidden text-white/70">
              <AnimatePresence mode="popLayout" initial={false} custom={shown.dir}>
                <motion.span
                  key={shown.count}
                  custom={shown.dir}
                  className="block tabular-nums"
                  variants={{
                    enter: (dir: number) => ({ y: dir > 0 ? "70%" : "-70%", opacity: 0 }),
                    center: { y: 0, opacity: 1 },
                    leave: (dir: number) => ({ y: dir > 0 ? "-70%" : "70%", opacity: 0 }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="leave"
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                >
                  {label(shown.count)}
                </motion.span>
              </AnimatePresence>
            </span>
            <motion.div
              className="flex flex-wrap items-center gap-1.5"
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: 0.04, ease: EASE_OUT }}
            >
              {children}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
