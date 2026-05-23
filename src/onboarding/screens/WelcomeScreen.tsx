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
      <OnboardingLauncherIcon size="welcome" />

      <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[1.65rem]">
        {tt("onboarding.welcome.title")}
      </h1>
      <p className="mt-3 max-w-sm text-base leading-relaxed text-white/70">
        {tt("onboarding.welcome.subtitle")}
      </p>

      <div className="mt-8 w-full max-w-md">
        <OnboardingButton variant="primary" fullWidth onClick={onStart}>
          {tt("onboarding.welcome.cta")}
        </OnboardingButton>
      </div>
    </OnboardingLayout>
  );
}
