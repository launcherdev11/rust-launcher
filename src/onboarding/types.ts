import type { Language } from "../i18n";

export type OnboardingStep =
  | "welcome"
  | "appearance"
  | "account-select"
  | "account-ely"
  | "account-microsoft"
  | "import-migration"
  | "finish";

export type AccountProvider = "ely" | "microsoft";

export type OnboardingLanguageOption = Language;
export const ONBOARDING_TOTAL_STEPS = 5;

export function stepProgressIndex(step: OnboardingStep): number {
  switch (step) {
    case "welcome":
      return 1;
    case "appearance":
      return 2;
    case "account-select":
    case "account-ely":
    case "account-microsoft":
      return 3;
    case "import-migration":
      return 4;
    case "finish":
      return 5;
    default:
      return 1;
  }
}

export function stepOrder(step: OnboardingStep): number {
  return step === "account-ely" || step === "account-microsoft"
    ? 3.5
    : stepProgressIndex(step);
}
