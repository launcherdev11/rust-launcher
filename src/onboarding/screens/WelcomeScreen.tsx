import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLauncherIcon } from "../components/OnboardingLauncherIcon";
import { OnboardingLayout } from "../components/OnboardingLayout";
import { onboardingItem } from "../components/OnboardingShell";

export const LANGUAGE_OPTIONS: { code: Language; nativeName: string }[] = [
  { code: "ru", nativeName: "Русский" },
  { code: "en", nativeName: "English" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
];

type Props = {
  language: Language;
  onSelectLanguage: (code: Language) => void;
  onStart: () => void;
};

export function WelcomeScreen({ language, onSelectLanguage, onStart }: Props) {
  const tt = useT(language);

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
        <OnboardingLauncherIcon size="welcome" />
      </motion.div>

      <motion.h1
        variants={onboardingItem}
        className="mt-1 text-center text-xl font-semibold text-white sm:text-2xl"
      >
        {tt("onboarding.welcome.title")}
      </motion.h1>
      <motion.p
        variants={onboardingItem}
        className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-white/60"
      >
        {tt("onboarding.welcome.subtitle")}
      </motion.p>

      <motion.div variants={onboardingItem} className="mt-6 w-full">
        <p id="onboarding-language-label" className="mb-1.5 text-xs font-medium text-white/50">
          {tt("onboarding.welcome.languageLabel")}
        </p>
        <div
          role="radiogroup"
          aria-labelledby="onboarding-language-label"
          className="seg-track grid grid-cols-2 gap-1 p-1 sm:grid-cols-4"
        >
          {LANGUAGE_OPTIONS.map((opt) => {
            const active = opt.code === language;
            return (
              <button
                key={opt.code}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelectLanguage(opt.code)}
                className={`relative rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  active ? "text-white" : "text-white/60 hover:text-white"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="onboarding-language-indicator"
                    className="seg-indicator absolute inset-0 rounded-lg"
                    transition={{ duration: 0.34, ease: [0.2, 0.9, 0.25, 1] }}
                  />
                )}
                <span className="relative">{opt.nativeName}</span>
              </button>
            );
          })}
        </div>
      </motion.div>

      <motion.div variants={onboardingItem} className="mt-5">
        <OnboardingButton variant="primary" fullWidth onClick={onStart}>
          {tt("onboarding.welcome.cta")}
        </OnboardingButton>
      </motion.div>
    </OnboardingLayout>
  );
}
