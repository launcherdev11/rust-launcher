import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "../i18n";
import { useT } from "../i18n";
import { AccountSelectionScreen } from "./screens/AccountSelectionScreen";
import { ElyLoginScreen } from "./screens/ElyLoginScreen";
import { FinishScreen } from "./screens/FinishScreen";
import { LanguageScreen } from "./screens/LanguageScreen";
import { MicrosoftLoginScreen } from "./screens/MicrosoftLoginScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { OnboardingBackgroundAnimatedProvider } from "./backgroundAnimatedContext";
import type { AccountProvider, OnboardingLanguageOption, OnboardingStep } from "./types";
import { stepProgressIndex } from "./types";

type Profile = {
  nickname: string;
  ely_username: string | null;
  ely_uuid: string | null;
  ms_id_token: string | null;
  mc_uuid: string | null;
};

export type OnboardingFlowProps = {
  language: Language;
  setLanguage: (lang: Language) => void;
  accentColor?: string;
  backgroundImageUrl?: string;
  backgroundAnimated?: boolean;
  onLanguagePersist: (lang: Language) => void;
  onComplete: () => void | Promise<void>;
  onProfileUpdated?: () => void | Promise<void>;
};

export function OnboardingFlow({
  language,
  setLanguage,
  accentColor,
  backgroundImageUrl,
  backgroundAnimated = false,
  onLanguagePersist,
  onComplete,
  onProfileUpdated,
}: OnboardingFlowProps) {
  const tt = useT(language);
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [selectedLanguage, setSelectedLanguage] = useState<OnboardingLanguageOption | null>(
    language,
  );

  const [elyLoading, setElyLoading] = useState(false);
  const [elyError, setElyError] = useState<string | null>(null);
  const [elySuccess, setElySuccess] = useState(false);

  const [msLoading, setMsLoading] = useState(false);
  const [msError, setMsError] = useState<string | null>(null);
  const [msSuccess, setMsSuccess] = useState(false);
  const [msAuthUrl, setMsAuthUrl] = useState<string | null>(null);

  const [finishing, setFinishing] = useState(false);

  const elyListenersRef = useRef<{ ok?: () => void; fail?: () => void }>({});
  const msListenerRef = useRef<(() => void) | null>(null);

  const stepIndex = stepProgressIndex(step);

  const goFinish = useCallback(() => {
    setStep("finish");
  }, []);

  const applyLanguage = useCallback(
    (code: OnboardingLanguageOption) => {
      if (code === "de") return;
      setSelectedLanguage(code);
      setLanguage(code);
      onLanguagePersist(code);
    },
    [onLanguagePersist, setLanguage],
  );

  const cleanupElyListeners = useCallback(() => {
    elyListenersRef.current.ok?.();
    elyListenersRef.current.fail?.();
    elyListenersRef.current = {};
  }, []);

  const cleanupMsListener = useCallback(() => {
    msListenerRef.current?.();
    msListenerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupElyListeners();
      cleanupMsListener();
    };
  }, [cleanupElyListeners, cleanupMsListener]);

  const handleElyPasswordLogin = async (username: string, password: string) => {
    setElyLoading(true);
    setElyError(null);
    setElySuccess(false);
    try {
      await invoke("ely_login_with_password", {
        username,
        password,
        totpToken: null,
      });
      setElySuccess(true);
      await onProfileUpdated?.();
      window.setTimeout(() => goFinish(), 600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setElyError(msg || tt("onboarding.ely.errorGeneric"));
    } finally {
      setElyLoading(false);
    }
  };

  const handleElyOAuth = async () => {
    setElyLoading(true);
    setElyError(null);
    setElySuccess(false);
    cleanupElyListeners();

    try {
      elyListenersRef.current.ok = await listen<Profile>("ely-login-complete", async () => {
        cleanupElyListeners();
        setElyLoading(false);
        setElySuccess(true);
        await onProfileUpdated?.();
        window.setTimeout(() => goFinish(), 600);
      });

      elyListenersRef.current.fail = await listen<string>("ely-login-failed", (e) => {
        cleanupElyListeners();
        setElyLoading(false);
        setElyError(e.payload || tt("onboarding.ely.errorGeneric"));
      });

      const url = await invoke<string>("start_ely_oauth");
      await openUrl(url);
    } catch (e) {
      cleanupElyListeners();
      setElyLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      setElyError(msg || tt("onboarding.ely.errorGeneric"));
    }
  };

  const handleMicrosoftLogin = async () => {
    if (msLoading) return;
    setMsLoading(true);
    setMsError(null);
    setMsSuccess(false);
    setMsAuthUrl(null);
    cleanupMsListener();

    try {
      msListenerRef.current = await listen("ms-login-complete", async () => {
        cleanupMsListener();
        setMsLoading(false);
        setMsAuthUrl(null);
        setMsSuccess(true);
        await onProfileUpdated?.();
        window.setTimeout(() => goFinish(), 600);
      });

      const url = await invoke<string>("start_ms_oauth");
      setMsAuthUrl(url);
      await openUrl(url);
    } catch (e) {
      cleanupMsListener();
      setMsLoading(false);
      setMsAuthUrl(null);
      const msg = e instanceof Error ? e.message : String(e);
      setMsError(msg || tt("onboarding.microsoft.errorGeneric"));
    }
  };

  const handleFinish = async () => {
    setFinishing(true);
    try {
      await onComplete();
    } finally {
      setFinishing(false);
    }
  };

  const stepView = (() => {
  switch (step) {
    case "welcome":
      return (
        <WelcomeScreen
          language={language}
          stepIndex={stepIndex}
          accentColor={accentColor}
          backgroundImageUrl={backgroundImageUrl}
          onStart={() => setStep("language")}
        />
      );
    case "language":
      return (
        <LanguageScreen
          language={language}
          selected={selectedLanguage}
          stepIndex={stepIndex}
          accentColor={accentColor}
          backgroundImageUrl={backgroundImageUrl}
          onSelect={applyLanguage}
          onBack={() => setStep("welcome")}
          onNext={() => setStep("account-select")}
        />
      );
    case "account-select":
      return (
        <AccountSelectionScreen
          language={language}
          stepIndex={stepIndex}
          accentColor={accentColor}
          backgroundImageUrl={backgroundImageUrl}
          onSelectProvider={(provider: AccountProvider) => {
            setElyError(null);
            setMsError(null);
            setElySuccess(false);
            setMsSuccess(false);
            setStep(provider === "ely" ? "account-ely" : "account-microsoft");
          }}
          onSkip={goFinish}
          onBack={() => setStep("language")}
        />
      );
    case "account-ely":
      return (
        <ElyLoginScreen
          language={language}
          stepIndex={stepIndex}
          accentColor={accentColor}
          backgroundImageUrl={backgroundImageUrl}
          loading={elyLoading}
          error={elyError}
          success={elySuccess}
          onBack={() => setStep("account-select")}
          onLogin={(u, p) => void handleElyPasswordLogin(u, p)}
          onOAuth={() => void handleElyOAuth()}
          onSkip={goFinish}
        />
      );
    case "account-microsoft":
      return (
        <MicrosoftLoginScreen
          language={language}
          stepIndex={stepIndex}
          accentColor={accentColor}
          backgroundImageUrl={backgroundImageUrl}
          loading={msLoading}
          error={msError}
          success={msSuccess}
          authUrl={msAuthUrl}
          onBack={() => {
            cleanupMsListener();
            setMsLoading(false);
            setMsAuthUrl(null);
            setStep("account-select");
          }}
          onLogin={() => void handleMicrosoftLogin()}
          onSkip={goFinish}
        />
      );
    case "finish":
      return (
        <FinishScreen
          language={language}
          stepIndex={stepIndex}
          accentColor={accentColor}
          backgroundImageUrl={backgroundImageUrl}
          finishing={finishing}
          onFinish={() => void handleFinish()}
        />
      );
    default:
      return null;
  }
  })();

  return (
    <OnboardingBackgroundAnimatedProvider value={backgroundAnimated}>
      {stepView}
    </OnboardingBackgroundAnimatedProvider>
  );
}
