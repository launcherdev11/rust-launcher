import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { AssetIcon } from "../../components/asset_icon";
import { OnboardingButton } from "./OnboardingButton";
import { onboardingItem } from "./OnboardingShell";

type Props = {
  children: ReactNode;
  language: Language;
  onBack?: () => void;
  backDisabled?: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
};

export function OnboardingLayout({
  children,
  language,
  onBack,
  backDisabled = false,
  nextLabel,
  nextDisabled = false,
  onNext,
}: Props) {
  const tt = useT(language);

  return (
    <>
      {onBack ? (
        <motion.button
          variants={onboardingItem}
          type="button"
          onClick={onBack}
          disabled={backDisabled}
          className="interactive-press mb-3 inline-flex items-center gap-1.5 self-start text-xs font-semibold text-white/60 hover:text-white disabled:opacity-45"
        >
          <AssetIcon name="back" className="h-3.5 w-3.5" />
          {tt("onboarding.nav.back")}
        </motion.button>
      ) : null}

      {children}

      {onNext ? (
        <motion.div variants={onboardingItem} className="mt-6 border-t border-white/10 pt-4">
          <OnboardingButton
            variant="primary"
            fullWidth
            onClick={onNext}
            disabled={nextDisabled}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              {nextLabel ?? tt("onboarding.nav.next")}
              <AssetIcon name="back" className="h-3.5 w-3.5 rotate-180" />
            </span>
          </OnboardingButton>
        </motion.div>
      ) : null}
    </>
  );
}
