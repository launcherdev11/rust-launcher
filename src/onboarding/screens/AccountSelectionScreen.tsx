import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { AssetIcon } from "../../components/asset_icon";
import { AccountProviderCard } from "../components/AccountProviderCard";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLayout } from "../components/OnboardingLayout";
import { onboardingItem } from "../components/OnboardingShell";
import type { AccountProvider } from "../types";

type Props = {
  language: Language;
  onSelectProvider: (provider: AccountProvider) => void;
  onSkip: () => void;
  onBack: () => void;
};

export function AccountSelectionScreen({
  language,
  onSelectProvider,
  onSkip,
  onBack,
}: Props) {
  const tt = useT(language);

  return (
    <OnboardingLayout language={language} onBack={onBack}>
      <motion.h1 variants={onboardingItem} className="text-xl font-semibold text-white sm:text-2xl">
        {tt("onboarding.account.title")}
      </motion.h1>
      <motion.p variants={onboardingItem} className="mt-1.5 mb-5 text-sm text-white/60">
        {tt("onboarding.account.subtitle")}
      </motion.p>

      <div className="flex w-full flex-col gap-2">
        <AccountProviderCard
          provider="ely"
          icon={<AssetIcon name="brand/ely" className="h-5 w-5 text-emerald-300" />}
          titleKey="onboarding.account.elyTitle"
          descriptionKey="onboarding.account.elyDesc"
          language={language}
          onSelect={onSelectProvider}
        />
        <AccountProviderCard
          provider="microsoft"
          icon={<AssetIcon name="brand/microsoft" className="h-[1.125rem] w-[1.125rem] text-sky-300" />}
          titleKey="onboarding.account.microsoftTitle"
          descriptionKey="onboarding.account.microsoftDesc"
          language={language}
          onSelect={onSelectProvider}
        />
      </div>

      <motion.div variants={onboardingItem} className="mt-5 w-full">
        <OnboardingButton variant="ghost" fullWidth onClick={onSkip}>
          {tt("onboarding.account.skip")}
        </OnboardingButton>
      </motion.div>
    </OnboardingLayout>
  );
}
