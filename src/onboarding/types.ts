import type { Language } from "../i18n";

export type OnboardingStep =
  | "welcome"
  | "account-select"
  | "account-ely"
  | "account-microsoft"
  | "import-migration"
  | "finish";

export type AccountProvider = "ely" | "microsoft";

export type OnboardingLanguageOption = Language;
export const ONBOARDING_TOTAL_STEPS = 4;

export function stepProgressIndex(step: OnboardingStep): number {
  switch (step) {
    case "welcome":
      return 1;
    case "account-select":
    case "account-ely":
    case "account-microsoft":
      return 2;
    case "import-migration":
      return 3;
    case "finish":
      return 4;
    default:
      return 1;
  }
}
