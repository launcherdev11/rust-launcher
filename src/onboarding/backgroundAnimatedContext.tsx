import { createContext, useContext, type ReactNode } from "react";

const OnboardingBackgroundAnimatedContext = createContext(false);

export function OnboardingBackgroundAnimatedProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <OnboardingBackgroundAnimatedContext.Provider value={value}>
      {children}
    </OnboardingBackgroundAnimatedContext.Provider>
  );
}

export function useOnboardingBackgroundAnimated(): boolean {
  return useContext(OnboardingBackgroundAnimatedContext);
}
