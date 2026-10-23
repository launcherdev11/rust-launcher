import { ErrorState } from "../../components/ui";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
import { LOGIN_ERROR_HINT_KEY, classifyLoginError } from "../loginErrors";
import { OnboardingButton } from "./OnboardingButton";

type Props = {
  language: Language;
  message: string;
  allowCredentialsHint?: boolean;
  onRetry: () => void;
  retryDisabled?: boolean;
};

export function LoginErrorNotice({
  language,
  message,
  allowCredentialsHint = false,
  onRetry,
  retryDisabled = false,
}: Props) {
  const tt = useT(language);
  const kind = classifyLoginError(message, allowCredentialsHint);

  return (
    <ErrorState
      compact
      className="w-full"
      title={tt("onboarding.errors.loginFailed")}
      description={tt(LOGIN_ERROR_HINT_KEY[kind])}
      details={message}
      action={
        <OnboardingButton variant="secondary" disabled={retryDisabled} onClick={onRetry}>
          {tt("common.state.retry")}
        </OnboardingButton>
      }
    />
  );
}
