import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
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
      style={{ "--accent-color": accentColor ?? "#0b1530" } as React.CSSProperties}
    >
      <OnboardingBackground accentColor={accentColor} backgroundImageUrl={backgroundImageUrl} />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-8 pt-10">
        <div className="flex shrink-0 justify-center">
          <ProgressIndicator currentStep={stepIndex} language={language} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={screenKey}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="flex w-full max-w-lg flex-col items-center text-center"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>

        {!hideFooter && (
          <motion.footer
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex shrink-0 flex-col items-center gap-4"
          >
            {footerExtra}
            <div className="flex w-full max-w-md items-center justify-center gap-3">
              {showBack ? (
                <OnboardingButton variant="ghost" onClick={onBack} className="!min-w-0 px-4">
                  <span className="inline-flex items-center gap-1.5">
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    {tt("onboarding.nav.back")}
                  </span>
                </OnboardingButton>
              ) : (
                <span className="w-[7.5rem]" aria-hidden />
              )}
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
          </motion.footer>
        )}
      </div>
    </div>
  );
}
