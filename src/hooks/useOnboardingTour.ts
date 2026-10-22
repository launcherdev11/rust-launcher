import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ONBOARDING_COMPLETED_STORAGE_KEY, ONBOARDING_FORCE_STORAGE_KEY } from "../onboarding";
import { PRODUCT_TOUR_COMPLETED_STORAGE_KEY, PRODUCT_TOUR_FORCE_STORAGE_KEY } from "../product-tour";
import type { TourAccountsSection } from "../product-tour/types";
import type { Settings, SidebarItemId } from "../app/types";

type UseOnboardingTourOptions = {
  settings: Settings | null;
  setActiveItemWithSound: (next: SidebarItemId) => void;
  closeHelp: () => void;
};

export function useOnboardingTour({
  settings,
  setActiveItemWithSound,
  closeHelp,
}: UseOnboardingTourOptions) {
  const [onboardingVisible, setOnboardingVisible] = useState<boolean | null>(null);
  const [productTourActive, setProductTourActive] = useState(false);
  const [tourAccountsSection, setTourAccountsSection] = useState<TourAccountsSection>("accounts");
  const pendingProductTourRef = useRef(false);

  const completeProductTour = useCallback(() => {
    try {
      window.localStorage.setItem(PRODUCT_TOUR_COMPLETED_STORAGE_KEY, "1");
    } catch {
    }
    setProductTourActive(false);
    setTourAccountsSection("accounts");
  }, []);

  const startProductTour = useCallback(() => {
    closeHelp();
    setActiveItemWithSound("play");
    setTourAccountsSection("accounts");
    setProductTourActive(true);
  }, [setActiveItemWithSound]);

  useEffect(() => {
    if (!settings) return;

    try {
      if (window.localStorage.getItem(ONBOARDING_FORCE_STORAGE_KEY) === "1") {
        setOnboardingVisible(true);
        return;
      }
    } catch {
    }

    if (settings.onboarding_completed) {
      setOnboardingVisible(false);
      return;
    }

    try {
      if (window.localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "1") {
        setOnboardingVisible(false);
        void invoke("set_settings", {
          settings: { ...settings, onboarding_completed: true },
        }).catch(() => {});
        return;
      }
    } catch {
    }

    setOnboardingVisible(true);
  }, [settings]);

  useEffect(() => {
    if (onboardingVisible !== false) return;

    if (pendingProductTourRef.current) {
      pendingProductTourRef.current = false;
      try {
        if (window.localStorage.getItem(PRODUCT_TOUR_COMPLETED_STORAGE_KEY) !== "1") {
          setProductTourActive(true);
        }
      } catch {
      }
      return;
    }

    try {
      if (window.localStorage.getItem(PRODUCT_TOUR_FORCE_STORAGE_KEY) === "1") {
        window.localStorage.removeItem(PRODUCT_TOUR_FORCE_STORAGE_KEY);
        setProductTourActive(true);
      }
    } catch {
    }
  }, [onboardingVisible]);

  return {
    onboardingVisible,
    setOnboardingVisible,
    productTourActive,
    tourAccountsSection,
    setTourAccountsSection,
    pendingProductTourRef,
    completeProductTour,
    startProductTour,
  };
}
