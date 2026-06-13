import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
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
  onBack: () => void;
  onLogin: (username: string, password: string) => void;
  onOAuth?: () => void;
  onSkip: () => void;
};

export function ElyLoginScreen({
  language,
  stepIndex,
  accentColor,
  backgroundImageUrl,
  loading = false,
  error = null,
  success = false,
  onBack,
  onLogin,
  onOAuth,
  onSkip,
}: Props) {
  const tt = useT(language);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = username.trim().length > 0 && password.length > 0 && !loading && !success;

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="account-ely"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      showBack
      onBack={onBack}
      hideFooter
    >
      <h1 className="text-xl font-bold text-white sm:text-2xl">{tt("onboarding.ely.title")}</h1>
      <p className="mt-2 mb-6 max-w-sm text-sm text-white/70">{tt("onboarding.ely.subtitle")}</p>

      <form
        className="flex w-full max-w-md flex-col gap-4 text-left"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onLogin(username.trim(), password);
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-white/55">{tt("onboarding.ely.loginLabel")}</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading || success}
            className="rounded-xl border border-white/12 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/15 disabled:opacity-50"
            placeholder={tt("onboarding.ely.loginPlaceholder")}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-white/55">{tt("onboarding.ely.passwordLabel")}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading || success}
            className="rounded-xl border border-white/12 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/15 disabled:opacity-50"
            placeholder={tt("onboarding.ely.passwordPlaceholder")}
          />
        </label>

        <p className="text-[11px] leading-relaxed text-white/45">{tt("onboarding.ely.securityHint")}</p>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-left text-sm text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {success ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-100">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            <span>{tt("onboarding.ely.success")}</span>
          </div>
        ) : null}

        <OnboardingButton
          type="submit"
          variant="ely"
          fullWidth
          disabled={!canSubmit}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {tt("common.loading")}
            </span>
          ) : (
            tt("onboarding.ely.submit")
          )}
        </OnboardingButton>

        {onOAuth ? (
          <OnboardingButton
            type="button"
            variant="secondary"
            fullWidth
            disabled={loading || success}
            onClick={onOAuth}
          >
            <span className="inline-flex items-center justify-center gap-2">
              <ExternalLink className="h-4 w-4" aria-hidden />
              {tt("onboarding.ely.oauth")}
            </span>
          </OnboardingButton>
        ) : null}

        <OnboardingButton type="button" variant="ghost" fullWidth onClick={onSkip} disabled={loading}>
          {tt("onboarding.account.skip")}
        </OnboardingButton>
      </form>
    </OnboardingLayout>
  );
}
