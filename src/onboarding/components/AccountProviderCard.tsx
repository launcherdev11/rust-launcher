import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import type { AccountProvider } from "../types";
import { OnboardingCard } from "./OnboardingCard";

type Props = {
  provider: AccountProvider;
  icon: ReactNode;
  titleKey: string;
  descriptionKey: string;
  language: Language;
  onSelect: (provider: AccountProvider) => void;
};

export function AccountProviderCard({
  provider,
  icon,
  titleKey,
  descriptionKey,
  language,
  onSelect,
}: Props) {
  const tt = useT(language);

  return (
    <OnboardingCard onClick={() => onSelect(provider)} className="w-full text-left">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-white">{tt(titleKey)}</h3>
          <p className="mt-1 text-sm leading-snug text-white/70">{tt(descriptionKey)}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-white/35" aria-hidden />
      </div>
    </OnboardingCard>
  );
}
