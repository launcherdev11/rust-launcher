import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
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
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
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

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="account-microsoft"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      showBack
      onBack={onBack}
      hideFooter
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-black/35">
        <MicrosoftIcon />
      </div>

      <h1 className="text-xl font-bold text-white sm:text-2xl">{tt("onboarding.microsoft.title")}</h1>
      <p className="mt-2 mb-6 max-w-sm text-sm leading-relaxed text-white/70">
        {tt("onboarding.microsoft.subtitle")}
      </p>

      <div className="mb-6 flex w-full max-w-md items-start gap-2 rounded-xl border border-white/12 bg-black/40 px-4 py-3 text-left text-xs text-white/70 shadow-soft">
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-white/55" aria-hidden />
        <span>{tt("onboarding.microsoft.externalHint")}</span>
      </div>

      {error ? (
        <div className="mb-4 flex w-full max-w-md items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-left text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div className="mb-4 flex w-full max-w-md items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>{tt("onboarding.microsoft.success")}</span>
        </div>
      ) : null}

      <div className="flex w-full max-w-md flex-col gap-3">
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
          <p className="break-all text-left text-[11px] text-white/45">{authUrl}</p>
        ) : null}

        <OnboardingButton variant="ghost" fullWidth onClick={onSkip} disabled={loading}>
          {tt("onboarding.account.skip")}
        </OnboardingButton>
      </div>
    </OnboardingLayout>
  );
}
