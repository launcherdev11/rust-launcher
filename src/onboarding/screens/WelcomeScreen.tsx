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
  onStart: () => void;
};

export function WelcomeScreen({
  language,
  stepIndex,
  accentColor,
  backgroundImageUrl,
  onStart,
}: Props) {
  const tt = useT(language);

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="welcome"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      hideFooter
    >
      <motion.div
        className="mx-auto"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <OnboardingLauncherIcon size="welcome" />
      </motion.div>

      <motion.h1
        className="mt-1 text-center text-xl font-semibold text-white sm:text-2xl"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.05, ease: "easeOut" }}
      >
        {tt("onboarding.welcome.title")}
      </motion.h1>
      <motion.p
        className="mx-auto mt-2 max-w-md text-center text-sm text-white/60"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.1, ease: "easeOut" }}
      >
        {tt("onboarding.welcome.subtitle")}
      </motion.p>

      <motion.div
        className="mt-6 w-full"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.16, ease: "easeOut" }}
      >
        <OnboardingButton variant="primary" fullWidth onClick={onStart}>
          {tt("onboarding.welcome.cta")}
        </OnboardingButton>
      </motion.div>
    </OnboardingLayout>
  );
}
