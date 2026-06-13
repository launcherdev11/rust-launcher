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
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <OnboardingLauncherIcon size="finish" className="mx-auto" />
      </motion.div>

      <h1 className="text-2xl font-bold text-white">{tt("onboarding.finish.title")}</h1>
      <p className="mt-3 max-w-sm text-base leading-relaxed text-white/70">
        {tt("onboarding.finish.subtitle")}
      </p>

      <div className="mt-8 w-full max-w-md">
        <OnboardingButton variant="primary" fullWidth onClick={onFinish} disabled={finishing}>
          {finishing ? tt("common.loading") : tt("onboarding.finish.cta")}
        </OnboardingButton>
      </div>
    </OnboardingLayout>
  );
}
