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
      <div className="flex items-center gap-3">
        <div className="glass-control flex h-10 w-10 shrink-0 items-center justify-center">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white">{tt(titleKey)}</h3>
          <p className="mt-0.5 text-xs text-white/55">{tt(descriptionKey)}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/35" aria-hidden />
      </div>
    </OnboardingCard>
  );
}
