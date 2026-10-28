import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { DEFAULT_ACCENT_COLOR, findAccentPreset } from "../../tabs/settings/accentColor";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLauncherIcon } from "../components/OnboardingLauncherIcon";
import { OnboardingLayout } from "../components/OnboardingLayout";
import { onboardingItem } from "../components/OnboardingShell";
import type { AccountProvider } from "../types";
import { LANGUAGE_OPTIONS } from "./WelcomeScreen";

type Props = {
  language: Language;
  accentColor?: string;
  account: AccountProvider | null;
  finishing?: boolean;
  onFinish: (options: { tour: boolean }) => void;
};

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <span className="text-white/50">{label}</span>
      <span className="flex min-w-0 items-center gap-2 font-semibold text-white/85">{children}</span>
    </div>
  );
}

export function FinishScreen({
  language,
  accentColor,
  account,
  finishing = false,
  onFinish,
}: Props) {
  const tt = useT(language);
  const color = (accentColor ?? DEFAULT_ACCENT_COLOR).toLowerCase();
  const preset = findAccentPreset(color);
  const languageName = LANGUAGE_OPTIONS.find((opt) => opt.code === language)?.nativeName ?? language;
  const accountName =
    account === "ely"
      ? tt("onboarding.account.elyTitle")
      : account === "microsoft"
        ? tt("onboarding.account.microsoftTitle")
        : tt("onboarding.finish.accountLater");

  return (
    <OnboardingLayout language={language}>
      <motion.div
        className="mx-auto"
        variants={{
          enter: { opacity: 0, scale: 0.96 },
          center: {
            opacity: 1,
            scale: 1,
            transition: { duration: 0.34, ease: [0.2, 0.9, 0.25, 1] },
          },
        }}
      >
        <OnboardingLauncherIcon size="finish" />
      </motion.div>

      <motion.h1
        variants={onboardingItem}
        className="mt-1 text-center text-xl font-semibold text-white sm:text-2xl"
      >
        {tt("onboarding.finish.title")}
      </motion.h1>
      <motion.p
        variants={onboardingItem}
        className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-white/60"
      >
        {tt("onboarding.finish.subtitle")}
      </motion.p>

      <motion.div variants={onboardingItem} className="glass-inset mt-5 divide-y divide-white/[0.06]">
        <SummaryRow label={tt("onboarding.finish.summaryLanguage")}>{languageName}</SummaryRow>
        <SummaryRow label={tt("onboarding.finish.summaryColor")}>
          <span
            className="h-3 w-3 shrink-0 rounded-[4px] ring-1 ring-inset ring-white/20"
            style={{ background: color }}
          />
          <span className="truncate">
            {preset
              ? tt(`settings.launcher.accentColor.presets.${preset.id}`)
              : tt("settings.launcher.accentColor.custom")}
          </span>
        </SummaryRow>
        <SummaryRow label={tt("onboarding.finish.summaryAccount")}>
          <span className={account ? "" : "font-medium text-white/45"}>{accountName}</span>
        </SummaryRow>
      </motion.div>

      <motion.div variants={onboardingItem} className="mt-5 flex w-full flex-col gap-2">
        <OnboardingButton
          variant="primary"
          fullWidth
          onClick={() => onFinish({ tour: false })}
          disabled={finishing}
        >
          {finishing ? tt("common.loading") : tt("onboarding.finish.ctaPlay")}
        </OnboardingButton>
        <OnboardingButton
          variant="secondary"
          fullWidth
          onClick={() => onFinish({ tour: true })}
          disabled={finishing}
        >
          {tt("onboarding.finish.ctaTour")}
        </OnboardingButton>
      </motion.div>
    </OnboardingLayout>
  );
}
