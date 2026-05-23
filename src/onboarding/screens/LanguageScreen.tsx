import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { LanguageOptionCard } from "../components/LanguageOptionCard";
import { OnboardingLayout } from "../components/OnboardingLayout";
import type { OnboardingLanguageOption } from "../types";

const LANGUAGE_OPTIONS: {
  code: OnboardingLanguageOption;
  flag: string;
  nativeName: string;
  descriptionKey: string;
  comingSoon?: boolean;
}[] = [
  {
    code: "ru",
    flag: "🇷🇺",
    nativeName: "Русский",
    descriptionKey: "onboarding.language.ruDesc",
  },
  {
    code: "en",
    flag: "🇬🇧",
    nativeName: "English",
    descriptionKey: "onboarding.language.enDesc",
  },
  {
    code: "de",
    flag: "🇩🇪",
    nativeName: "Deutsch",
    descriptionKey: "onboarding.language.deDesc",
    comingSoon: true,
  },
];

type Props = {
  language: Language;
  selected: OnboardingLanguageOption | null;
  stepIndex: number;
  accentColor?: string;
  backgroundImageUrl?: string;
  onSelect: (code: OnboardingLanguageOption) => void;
  onBack: () => void;
  onNext: () => void;
};

export function LanguageScreen({
  language,
  selected,
  stepIndex,
  accentColor,
  backgroundImageUrl,
  onSelect,
  onBack,
  onNext,
}: Props) {
  const tt = useT(language);

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="language"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      showBack
      showNext
      nextDisabled={selected !== "ru" && selected !== "en"}
      onBack={onBack}
      onNext={onNext}
    >
      <h1 className="text-xl font-bold text-white sm:text-2xl">{tt("onboarding.language.title")}</h1>
      <p className="mt-2 mb-6 max-w-sm text-sm text-white/70">{tt("onboarding.language.subtitle")}</p>

      <div className="flex w-full max-w-md flex-col gap-3">
        {LANGUAGE_OPTIONS.map((opt) => (
          <LanguageOptionCard
            key={opt.code}
            code={opt.code}
            flag={opt.flag}
            nativeName={opt.nativeName}
            descriptionKey={opt.descriptionKey}
            selected={selected === opt.code}
            disabled={opt.comingSoon}
            comingSoon={opt.comingSoon}
            language={language}
            onSelect={onSelect}
          />
        ))}
      </div>
    </OnboardingLayout>
  );
}
