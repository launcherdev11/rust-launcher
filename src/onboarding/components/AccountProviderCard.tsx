import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { AssetIcon } from "../../components/asset_icon";
import type { AccountProvider } from "../types";
import { OnboardingCard } from "./OnboardingCard";
import { onboardingItem } from "./OnboardingShell";

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
    <motion.div variants={onboardingItem}>
      <OnboardingCard onClick={() => onSelect(provider)} className="group w-full text-left">
        <div className="flex items-center gap-3">
          <div className="glass-control flex h-10 w-10 shrink-0 items-center justify-center">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">{tt(titleKey)}</h3>
            <p className="mt-0.5 text-xs text-white/55">{tt(descriptionKey)}</p>
          </div>
          <AssetIcon
            name="arrow_down"
            className="h-4 w-4 -rotate-90 text-white/35 transition-[transform,color] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-white/70"
          />
        </div>
      </OnboardingCard>
    </motion.div>
  );
}
