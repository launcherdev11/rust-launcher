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
  const progress = Math.min(100, (currentStep / ONBOARDING_TOTAL_STEPS) * 100);

  return (
    <div className="flex w-full items-center gap-3">
      <p className="shrink-0 text-xs font-medium text-white/50">
        {tt("onboarding.progress", {
          current: currentStep,
          total: ONBOARDING_TOTAL_STEPS,
        })}
      </p>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full accent-bg"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
