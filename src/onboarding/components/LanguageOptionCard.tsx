import { Check } from "lucide-react";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import type { OnboardingLanguageOption } from "../types";
import { OnboardingCard } from "./OnboardingCard";

type Props = {
  code: OnboardingLanguageOption;
  flag: string;
  nativeName: string;
  descriptionKey: string;
  selected: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
  language: Language;
  onSelect: (code: OnboardingLanguageOption) => void;
};

export function LanguageOptionCard({
  code,
  flag,
  nativeName,
  descriptionKey,
  selected,
  disabled = false,
  comingSoon = false,
  language,
  onSelect,
}: Props) {
  const tt = useT(language);

  return (
    <OnboardingCard
      selected={selected}
      disabled={disabled}
      onClick={() => onSelect(code)}
      className="text-left"
    >
      <div className="flex items-start gap-4">
        <span className="text-3xl leading-none" aria-hidden>
          {flag}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-white">{nativeName}</span>
            {comingSoon ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/55">
                {tt("onboarding.language.comingSoon")}
              </span>
            ) : null}
            {selected && !comingSoon ? (
              <Check className="h-4 w-4 shrink-0 text-white/85" aria-hidden />
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-snug text-white/70">{tt(descriptionKey)}</p>
        </div>
      </div>
    </OnboardingCard>
  );
}
