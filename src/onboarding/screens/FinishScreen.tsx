import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLauncherIcon } from "../components/OnboardingLauncherIcon";
import { OnboardingLayout } from "../components/OnboardingLayout";

type Props = {
  language: Language;
  stepIndex: number;
  accentColor?: string;
  backgroundImageUrl?: string;
  finishing?: boolean;
  onFinish: () => void;
};

export function FinishScreen({
  language,
  stepIndex,
  accentColor,
  backgroundImageUrl,
  finishing = false,
  onFinish,
}: Props) {
  const tt = useT(language);

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="finish"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      hideFooter
    >
      <motion.div
        className="mx-auto"
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
      >
        <OnboardingLauncherIcon size="finish" />
      </motion.div>

      <h1 className="mt-1 text-center text-xl font-semibold text-white sm:text-2xl">{tt("onboarding.finish.title")}</h1>
      <p className="mx-auto mt-2 max-w-md text-center text-sm text-white/60">{tt("onboarding.finish.subtitle")}</p>

      <div className="mt-6 w-full">
        <OnboardingButton variant="primary" fullWidth onClick={onFinish} disabled={finishing}>
          {finishing ? tt("common.loading") : tt("onboarding.finish.cta")}
        </OnboardingButton>
      </div>
    </OnboardingLayout>
  );
}
