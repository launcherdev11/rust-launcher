import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { ArrowLeft } from "lucide-react";
import { AccountProviderCard } from "../components/AccountProviderCard";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLayout } from "../components/OnboardingLayout";
import type { AccountProvider } from "../types";

function ElyByIcon() {
  return (
    <span className="text-xs font-bold text-emerald-300" aria-hidden>
      Ely
    </span>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
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
      hideFooter
    >
      <button
        type="button"
        onClick={onBack}
        className="interactive-press mb-3 inline-flex items-center gap-1.5 self-start text-xs font-semibold text-white/60 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {tt("onboarding.nav.back")}
      </button>

      <h1 className="text-xl font-semibold text-white sm:text-2xl">{tt("onboarding.account.title")}</h1>
      <p className="mt-1.5 mb-5 text-sm text-white/60">{tt("onboarding.account.subtitle")}</p>

      <div className="flex w-full flex-col gap-2">
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

      <div className="mt-5 w-full">
        <OnboardingButton variant="ghost" fullWidth onClick={onSkip}>
          {tt("onboarding.account.skip")}
        </OnboardingButton>
      </div>
    </OnboardingLayout>
  );
}
