import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { AccountProviderCard } from "../components/AccountProviderCard";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLayout } from "../components/OnboardingLayout";
import type { AccountProvider } from "../types";

function ElyByIcon() {
  return (
    <span className="text-lg font-bold text-emerald-300" aria-hidden>
      Ely
    </span>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="13" width="10" height="10" fill="#00a4ef" />
      <rect x="13" y="13" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

type Props = {
  language: Language;
  stepIndex: number;
  accentColor?: string;
  backgroundImageUrl?: string;
  onSelectProvider: (provider: AccountProvider) => void;
  onSkip: () => void;
  onBack: () => void;
};

export function AccountSelectionScreen({
  language,
  stepIndex,
  accentColor,
  backgroundImageUrl,
  onSelectProvider,
  onSkip,
  onBack,
}: Props) {
  const tt = useT(language);

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="account-select"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      showBack
      onBack={onBack}
      hideFooter
    >
      <h1 className="text-xl font-bold text-white sm:text-2xl">{tt("onboarding.account.title")}</h1>
      <p className="mt-2 mb-6 max-w-sm text-sm text-white/70">{tt("onboarding.account.subtitle")}</p>

      <div className="flex w-full max-w-md flex-col gap-3">
        <AccountProviderCard
          provider="ely"
          icon={<ElyByIcon />}
          titleKey="onboarding.account.elyTitle"
          descriptionKey="onboarding.account.elyDesc"
          language={language}
          onSelect={onSelectProvider}
        />
        <AccountProviderCard
          provider="microsoft"
          icon={<MicrosoftIcon />}
          titleKey="onboarding.account.microsoftTitle"
          descriptionKey="onboarding.account.microsoftDesc"
          language={language}
          onSelect={onSelectProvider}
        />
      </div>

      <div className="mt-8 flex w-full max-w-md flex-col items-center gap-3">
        <OnboardingButton variant="ghost" onClick={onSkip}>
          {tt("onboarding.account.skip")}
        </OnboardingButton>
      </div>
    </OnboardingLayout>
  );
}
