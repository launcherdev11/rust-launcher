import { ArrowLeft, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { LoginErrorNotice } from "../components/LoginErrorNotice";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLayout } from "../components/OnboardingLayout";

type Props = {
  language: Language;
  stepIndex: number;
  accentColor?: string;
  backgroundImageUrl?: string;
  loading?: boolean;
  error?: string | null;
  success?: boolean;
  authUrl?: string | null;
  onBack: () => void;
  onLogin: () => void;
  onSkip: () => void;
};

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="13" width="10" height="10" fill="#00a4ef" />
      <rect x="13" y="13" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

export function MicrosoftLoginScreen({
  language,
  stepIndex,
  accentColor,
  backgroundImageUrl,
  loading = false,
  error = null,
  success = false,
  authUrl = null,
  onBack,
  onLogin,
  onSkip,
}: Props) {
  const tt = useT(language);
  const [linkCopied, setLinkCopied] = useState(false);

  const copyAuthUrl = async () => {
    if (!authUrl) return;
    setLinkCopied(await copyTextToClipboard(authUrl));
  };

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="account-microsoft"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      hideFooter
    >
      <button
        type="button"
        onClick={onBack}
        className="interactive-press mb-3 inline-flex items-center gap-1.5 self-start text-xs font-semibold text-white/60 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {tt("onboarding.nav.back")}
      </button>

      <h1 className="text-xl font-semibold text-white sm:text-2xl">{tt("onboarding.microsoft.title")}</h1>
      <p className="mt-1.5 mb-4 text-sm text-white/60">{tt("onboarding.microsoft.subtitle")}</p>

      <div className="glass-inset mb-5 flex w-full items-start gap-2 px-3 py-2.5 text-xs text-white/60">
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" aria-hidden />
        <span>{tt("onboarding.microsoft.externalHint")}</span>
      </div>

      {error ? (
        <div className="mb-3 w-full">
          <LoginErrorNotice
            language={language}
            message={error}
            retryDisabled={loading}
            onRetry={onLogin}
          />
        </div>
      ) : null}

      {success ? (
        <div className="mb-3 flex w-full items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>{tt("onboarding.microsoft.success")}</span>
        </div>
      ) : null}

      <div className="flex w-full flex-col gap-2">
        <OnboardingButton
          variant="microsoft"
          fullWidth
          onClick={onLogin}
          disabled={loading || success}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {tt("onboarding.microsoft.waiting")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <MicrosoftIcon />
              {tt("onboarding.microsoft.cta")}
            </span>
          )}
        </OnboardingButton>

        {authUrl && loading ? (
          <div className="glass-inset flex flex-col gap-2 px-3 py-2.5">
            <p className="text-xs text-white/55">{tt("onboarding.microsoft.linkHint")}</p>
            <OnboardingButton variant="secondary" onClick={() => void copyAuthUrl()}>
              {linkCopied ? tt("common.state.copied") : tt("onboarding.microsoft.copyLink")}
            </OnboardingButton>
          </div>
        ) : null}

        <OnboardingButton variant="ghost" fullWidth onClick={onSkip}>
          {tt("onboarding.account.skip")}
        </OnboardingButton>
      </div>
    </OnboardingLayout>
  );
}
