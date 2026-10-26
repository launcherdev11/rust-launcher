import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLauncherIcon } from "../components/OnboardingLauncherIcon";
import { OnboardingLayout } from "../components/OnboardingLayout";
import { ACCENT_VIOLET, ACCENT_WHITE } from "../../tabs/settings/accentColor";

const LANGUAGE_OPTIONS: { code: Language; nativeName: string }[] = [
  { code: "ru", nativeName: "Русский" },
  { code: "en", nativeName: "English" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
];

const ACCENT_OPTIONS = [
  { color: ACCENT_WHITE, labelKey: "onboarding.welcome.colorWhite" },
  { color: ACCENT_VIOLET, labelKey: "onboarding.welcome.colorViolet" },
] as const;

type Props = {
  language: Language;
  stepIndex: number;
  accentColor?: string;
  backgroundImageUrl?: string;
  onSelectLanguage: (code: Language) => void;
  onSelectAccent: (color: string) => void;
  onStart: () => void;
};

export function WelcomeScreen({
  language,
  stepIndex,
  accentColor,
  backgroundImageUrl,
  onSelectLanguage,
  onSelectAccent,
  onStart,
}: Props) {
  const tt = useT(language);

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="welcome"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      hideFooter
    >
      <motion.div
        className="mx-auto"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <OnboardingLauncherIcon size="welcome" />
      </motion.div>

      <motion.h1
        className="mt-1 text-center text-xl font-semibold text-white sm:text-2xl"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.05, ease: "easeOut" }}
      >
        {tt("onboarding.welcome.title")}
      </motion.h1>
      <motion.p
        className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-white/60"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.1, ease: "easeOut" }}
      >
        {tt("onboarding.welcome.subtitle")}
      </motion.p>

      <motion.div
        className="mt-6 w-full"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.16, ease: "easeOut" }}
      >
        <p id="onboarding-language-label" className="mb-1.5 text-xs font-medium text-white/50">
          {tt("onboarding.welcome.languageLabel")}
        </p>
        <div
          role="radiogroup"
          aria-labelledby="onboarding-language-label"
          className="seg-track flex flex-wrap gap-1 p-1"
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
                className={`interactive-press min-w-[5.5rem] flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                  active ? "seg-on" : "text-white/70 hover:text-white"
                }`}
              >
                {opt.nativeName}
              </button>
            );
          })}
        </div>

        <p id="onboarding-accent-label" className="mb-1.5 mt-4 text-xs font-medium text-white/50">
          {tt("onboarding.welcome.colorLabel")}
        </p>
        <div
          role="radiogroup"
          aria-labelledby="onboarding-accent-label"
          className="seg-track flex gap-1 p-1"
        >
          {ACCENT_OPTIONS.map((opt) => {
            const active = (accentColor ?? ACCENT_WHITE).toLowerCase() === opt.color;
            return (
              <button
                key={opt.color}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelectAccent(opt.color)}
                className={`interactive-press flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                  active ? "seg-on" : "text-white/70 hover:text-white"
                }`}
              >
                <span
                  className="h-3 w-3 rounded-md border border-white/25"
                  style={{ backgroundColor: opt.color }}
                  aria-hidden
                />
                {tt(opt.labelKey)}
              </button>
            );
          })}
        </div>

        <OnboardingButton variant="primary" fullWidth onClick={onStart} className="mt-5">
          {tt("onboarding.welcome.cta")}
        </OnboardingButton>
      </motion.div>
    </OnboardingLayout>
  );
}
