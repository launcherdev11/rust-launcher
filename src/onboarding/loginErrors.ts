export type LoginErrorKind = "network" | "timeout" | "credentials" | "other";

const TIMEOUT = /время ожидания|таймаут|timeout|timed out/i;
const NETWORK =
  /сеть|сети|подключ|соединен|network|connection|dns|error sending request|failed to fetch|unreachable/i;
const CREDENTIALS =
  /парол|логин|неверн|credentials|invalid|incorrect|unauthori[sz]ed|forbidden|\b40[13]\b/i;

export function classifyLoginError(message: string, allowCredentials: boolean): LoginErrorKind {
  if (TIMEOUT.test(message)) return "timeout";
  if (NETWORK.test(message)) return "network";
  if (allowCredentials && CREDENTIALS.test(message)) return "credentials";
  return "other";
}

export const LOGIN_ERROR_HINT_KEY: Record<LoginErrorKind, string> = {
  network: "onboarding.errors.hintNetwork",
  timeout: "onboarding.errors.hintTimeout",
  credentials: "onboarding.errors.hintCredentials",
  other: "onboarding.errors.hintOther",
};
