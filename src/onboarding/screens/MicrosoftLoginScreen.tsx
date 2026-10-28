import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { AssetIcon } from "../../components/asset_icon";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { LoginErrorNotice } from "../components/LoginErrorNotice";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLayout } from "../components/OnboardingLayout";

type Props = {
  language: Language;
  loading?: boolean;
  error?: string | null;
  success?: boolean;
  authUrl?: string | null;
  onBack: () => void;
  onLogin: () => void;
  onSkip: () => void;
};

export function MicrosoftLoginScreen({
  language,
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
    <OnboardingLayout language={language} onBack={onBack}>
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
              <AssetIcon name="brand/microsoft" className="h-4 w-4" />
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
