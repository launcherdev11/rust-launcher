import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "../i18n";
import { useT } from "../i18n";
import { AccountSelectionScreen } from "./screens/AccountSelectionScreen";
import { AppearanceScreen } from "./screens/AppearanceScreen";
import { ElyLoginScreen } from "./screens/ElyLoginScreen";
import { FinishScreen } from "./screens/FinishScreen";
import { ImportMigrationScreen } from "./screens/ImportMigrationScreen";
import { MicrosoftLoginScreen } from "./screens/MicrosoftLoginScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { OnboardingBackgroundAnimatedProvider } from "./backgroundAnimatedContext";
import { OnboardingShell } from "./components/OnboardingShell";
import type { AccountProvider, OnboardingStep } from "./types";
import { stepOrder, stepProgressIndex } from "./types";

type Profile = {
  nickname: string;
  ely_username: string | null;
  ely_uuid: string | null;
  ms_id_token: string | null;
  mc_uuid: string | null;
};

export type OnboardingFlowProps = {
  language: Language;
  accentColor?: string;
  backgroundAnimated?: boolean;
  onLanguagePersist: (lang: Language) => void;
  onAccentPersist: (color: string) => void;
  onComplete: (options: { tour: boolean }) => void | Promise<void>;
  onProfileUpdated?: () => void | Promise<void>;
};

export function OnboardingFlow({
  language,
  accentColor,
  backgroundAnimated = false,
  onLanguagePersist,
  onAccentPersist,
  onComplete,
  onProfileUpdated,
}: OnboardingFlowProps) {
  const tt = useT(language);
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [direction, setDirection] = useState(1);
  const [linkedAccount, setLinkedAccount] = useState<AccountProvider | null>(null);

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

  const stepRef = useRef(step);
  stepRef.current = step;

  const go = useCallback((next: OnboardingStep) => {
    setDirection(stepOrder(next) >= stepOrder(stepRef.current) ? 1 : -1);
    setStep(next);
  }, []);

  const goImport = useCallback(() => go("import-migration"), [go]);

  const goFinish = useCallback(() => go("finish"), [go]);

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
      setLinkedAccount("ely");
      await onProfileUpdated?.();
      window.setTimeout(() => goImport(), 600);
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
        setLinkedAccount("ely");
        await onProfileUpdated?.();
        window.setTimeout(() => goImport(), 600);
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
        setLinkedAccount("microsoft");
        await onProfileUpdated?.();
        window.setTimeout(() => goImport(), 600);
      });

      const url = await invoke<string>("start_ms_oauth", { language });
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

  const handleFinish = async (options: { tour: boolean }) => {
    setFinishing(true);
    try {
      await onComplete(options);
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
            onSelectLanguage={onLanguagePersist}
            onStart={() => go("appearance")}
          />
        );
      case "appearance":
        return (
          <AppearanceScreen
            language={language}
            accentColor={accentColor}
            onSelectAccent={onAccentPersist}
            onBack={() => go("welcome")}
            onNext={() => go("account-select")}
          />
        );
      case "account-select":
        return (
          <AccountSelectionScreen
            language={language}
            onSelectProvider={(provider: AccountProvider) => {
              setElyError(null);
              setMsError(null);
              setElySuccess(false);
              setMsSuccess(false);
              go(provider === "ely" ? "account-ely" : "account-microsoft");
            }}
            onSkip={goImport}
            onBack={() => go("appearance")}
          />
        );
      case "account-ely":
        return (
          <ElyLoginScreen
            language={language}
            loading={elyLoading}
            error={elyError}
            success={elySuccess}
            onBack={() => go("account-select")}
            onLogin={(u, p) => void handleElyPasswordLogin(u, p)}
            onOAuth={() => void handleElyOAuth()}
            onSkip={goImport}
          />
        );
      case "account-microsoft":
        return (
          <MicrosoftLoginScreen
            language={language}
            loading={msLoading}
            error={msError}
            success={msSuccess}
            authUrl={msAuthUrl}
            onBack={() => {
              cleanupMsListener();
              setMsLoading(false);
              setMsAuthUrl(null);
              go("account-select");
            }}
            onLogin={() => void handleMicrosoftLogin()}
            onSkip={() => {
              cleanupMsListener();
              setMsLoading(false);
              setMsAuthUrl(null);
              goImport();
            }}
          />
        );
      case "import-migration":
        return (
          <ImportMigrationScreen
            language={language}
            onBack={() => go("account-select")}
            onSkip={goFinish}
            onContinue={goFinish}
          />
        );
      case "finish":
        return (
          <FinishScreen
            language={language}
            accentColor={accentColor}
            account={linkedAccount}
            finishing={finishing}
            onFinish={(options) => void handleFinish(options)}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <OnboardingBackgroundAnimatedProvider value={backgroundAnimated}>
      <OnboardingShell
        language={language}
        accentColor={accentColor}
        stepIndex={stepIndex}
        stepKey={step}
        direction={direction}
      >
        {stepView}
      </OnboardingShell>
    </OnboardingBackgroundAnimatedProvider>
  );
}
