import { motion } from "framer-motion";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { AccentPreview } from "../../components/AccentPreview";
import { AccentSwatchGrid } from "../../components/AccentSwatchGrid";
import { DEFAULT_ACCENT_COLOR, findAccentPreset } from "../../tabs/settings/accentColor";
import { OnboardingLayout } from "../components/OnboardingLayout";
import { onboardingItem } from "../components/OnboardingShell";

type Props = {
  language: Language;
  accentColor?: string;
  onSelectAccent: (color: string) => void;
  onBack: () => void;
  onNext: () => void;
};

export function AppearanceScreen({ language, accentColor, onSelectAccent, onBack, onNext }: Props) {
  const tt = useT(language);
  const color = (accentColor ?? DEFAULT_ACCENT_COLOR).toLowerCase();
  const preset = findAccentPreset(color);
  const colorName = preset
    ? tt(`settings.launcher.accentColor.presets.${preset.id}`)
    : tt("settings.launcher.accentColor.custom");

  return (
    <OnboardingLayout language={language} onBack={onBack} onNext={onNext}>
      <motion.h1 variants={onboardingItem} className="text-xl font-semibold text-white sm:text-2xl">
        {tt("onboarding.appearance.title")}
      </motion.h1>
      <motion.p variants={onboardingItem} className="mt-1.5 mb-4 text-sm text-white/60">
        {tt("onboarding.appearance.subtitle")}
      </motion.p>

      <motion.div variants={onboardingItem}>
        <AccentPreview color={color} playLabel={tt("modpacks.actions.play")} className="h-40" />
      </motion.div>

      <motion.div variants={onboardingItem} className="mt-4">
        <AccentSwatchGrid
          value={color}
          onChange={onSelectAccent}
          presetLabel={(id) => tt(`settings.launcher.accentColor.presets.${id}`)}
          ariaLabel={tt("onboarding.appearance.title")}
        />
        <div className="mt-3 flex items-baseline justify-between gap-3 text-xs">
          <motion.span
            key={colorName}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="font-semibold text-white/80"
          >
            {colorName}
          </motion.span>
          <span className="font-mono text-white/40">{color}</span>
        </div>
      </motion.div>
    </OnboardingLayout>
  );
}
