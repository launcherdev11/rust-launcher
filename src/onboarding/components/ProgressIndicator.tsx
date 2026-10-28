import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { ONBOARDING_TOTAL_STEPS } from "../types";

type Props = {
  currentStep: number;
  language: Language;
};

export function ProgressIndicator({ currentStep, language }: Props) {
  const tt = useT(language);

  return (
    <div className="flex w-full items-center gap-3">
      <p className="shrink-0 text-xs font-medium tabular-nums text-white/50">
        {tt("onboarding.progress", {
          current: currentStep,
          total: ONBOARDING_TOTAL_STEPS,
        })}
      </p>
      <div className="flex min-w-0 flex-1 gap-1">
        {Array.from({ length: ONBOARDING_TOTAL_STEPS }, (_, i) => (
          <span key={i} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
            <motion.span
              className="block h-full origin-left rounded-full accent-bg"
              initial={false}
              animate={{ scaleX: i < currentStep ? 1 : 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
