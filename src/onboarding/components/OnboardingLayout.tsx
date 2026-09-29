import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { OnboardingBackground } from "./OnboardingBackground";
import { OnboardingButton } from "./OnboardingButton";
import { ProgressIndicator } from "./ProgressIndicator";

type Props = {
  children: ReactNode;
  language: Language;
  stepIndex: number;
  screenKey: string;
  accentColor?: string;
  backgroundImageUrl?: string;
  showBack?: boolean;
  showNext?: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  onBack?: () => void;
  onNext?: () => void;
  footerExtra?: ReactNode;
  hideFooter?: boolean;
};

export function OnboardingLayout({
  children,
  language,
  stepIndex,
  screenKey,
  accentColor,
  backgroundImageUrl,
  showBack = false,
  showNext = false,
  nextLabel,
  nextDisabled = false,
  nextLoading = false,
  onBack,
  onNext,
  footerExtra,
  hideFooter = false,
}: Props) {
  const tt = useT(language);

  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-hidden text-white"
      style={{ "--accent-color": accentColor ?? "#0b1530" } as CSSProperties}
    >
      <OnboardingBackground accentColor={accentColor} backgroundImageUrl={backgroundImageUrl} />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 py-6 sm:px-8">
        <motion.div
          className="mx-auto w-full max-w-lg shrink-0"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <ProgressIndicator currentStep={stepIndex} language={language} />
        </motion.div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={screenKey}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="glass-panel flex w-full max-w-lg flex-col p-5 text-left sm:p-6"
            >
              {children}

              {!hideFooter ? (
                <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-4">
                  {footerExtra}
                  <div className="flex w-full items-center gap-2">
                    {showBack ? (
                      <OnboardingButton variant="ghost" onClick={onBack} className="!min-w-0 shrink-0 px-3">
                        <span className="inline-flex items-center gap-1.5">
                          <ArrowLeft className="h-4 w-4" aria-hidden />
                          {tt("onboarding.nav.back")}
                        </span>
                      </OnboardingButton>
                    ) : null}
                    {showNext ? (
                      <OnboardingButton
                        variant="primary"
                        fullWidth
                        onClick={onNext}
                        disabled={nextDisabled || nextLoading}
                        className="flex-1"
                      >
                        <span className="inline-flex items-center justify-center gap-1.5">
                          {nextLoading ? tt("common.loading") : (nextLabel ?? tt("onboarding.nav.next"))}
                          {!nextLoading && <ArrowRight className="h-4 w-4" aria-hidden />}
                        </span>
                      </OnboardingButton>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
