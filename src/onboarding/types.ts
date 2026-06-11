import type { Language } from "../i18n";

export type OnboardingStep =
  | "welcome"
  | "language"
  | "account-select"
  | "account-ely"
  | "account-microsoft"
  | "finish";

export type AccountProvider = "ely" | "microsoft";

export type OnboardingLanguageOption = Language;

export const ONBOARDING_STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "language",
  "account-select",
  "account-ely",
  "finish",
];

export const ONBOARDING_TOTAL_STEPS = 5;

export function stepProgressIndex(step: OnboardingStep): number {
  switch (step) {
    case "welcome":
      return 1;
    case "language":
      return 2;
    case "account-select":
      return 3;
    case "account-ely":
    case "account-microsoft":
      return 4;
    case "finish":
      return 5;
    default:
      return 1;
  }
}
