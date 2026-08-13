import {
  ApiError,
  apiFetch,
  apiRequest,
  clearApiSession,
  getApiBaseUrl,
  getStoredAccessToken,
  getStoredRefreshToken,
  persistApiSession,
} from "./client";

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

export type PlatformUser = {
  id: string;
  nickname: string;
  email: string;
  is_sponsor?: boolean;
};

export const API_AUTH_CHANGED_EVENT = "mc16launcher:api-auth-changed";
export const API_NICKNAME_KEY = "mc16launcher:api_nickname_v1";

export async function registerAccount(input: {
  nickname: string;
  email: string;
  password: string;
  verification_code?: string;
}): Promise<AuthTokens> {
  return apiFetch<AuthTokens>(
    "/auth/register",
    { method: "POST", body: JSON.stringify(input) },
    null,
  );
}

export async function fetchEmailVerificationStatus(): Promise<{
  required: boolean;
  ttl_secs: number;
}> {
  return apiFetch("/auth/email/status", { method: "GET" }, null);
}

export async function sendEmailVerificationCode(email: string): Promise<{
  success: boolean;
  ttl_secs: number;
}> {
  return apiFetch(
    "/auth/email/send-code",
    { method: "POST", body: JSON.stringify({ email }) },
    null,
  );
}

export async function loginAccount(input: {
  login: string;
  password: string;
}): Promise<AuthTokens> {
  return apiFetch<AuthTokens>(
    "/auth/login",
    { method: "POST", body: JSON.stringify(input) },
    null,
  );
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  return apiFetch<AuthTokens>(
    "/auth/refresh",
    { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) },
    null,
  );
}

export async function logoutAccount(accessToken?: string): Promise<void> {
  const token = accessToken ?? getStoredAccessToken();
  if (!token) {
    clearApiSession();
    return;
  }
  try {
    await apiFetch("/auth/logout", { method: "POST" }, token);
  } finally {
    clearApiSession();
  }
}

export async function fetchMe(accessToken?: string): Promise<PlatformUser> {
  return apiFetch<PlatformUser>("/me", { method: "GET" }, accessToken);
}

export async function updateNickname(
  nickname: string,
  accessToken?: string,
): Promise<PlatformUser> {
  return apiFetch<PlatformUser>(
    "/me",
    { method: "PATCH", body: JSON.stringify({ nickname }) },
    accessToken,
  );
}

export async function deleteAccount(
  password: string,
  accessToken?: string,
): Promise<void> {
  const token = accessToken ?? getStoredAccessToken();
  try {
    await apiFetch(
      "/auth/delete-account",
      { method: "POST", body: JSON.stringify({ password }) },
      token,
    );
  } finally {
    clearApiSession();
  }
}


export async function linkIdentity(input: {
  provider: "ely" | "minecraft";
  provider_uuid: string;
  provider_username?: string | null;
  provider_access_token: string;
  provider_client_token?: string | null;
}): Promise<void> {
  await apiFetch("/identities/link", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

function persistNickname(nickname: string) {
  try {
    window.localStorage.setItem(API_NICKNAME_KEY, nickname);
  } catch {
  }
}

export async function loginAndPersist(input: {
  login: string;
  password: string;
}): Promise<PlatformUser> {
  const tokens = await loginAccount(input);
  persistApiSession(tokens.access_token, tokens.refresh_token);
  const me = await fetchMe(tokens.access_token);
  persistNickname(me.nickname);
  return me;
}

export async function registerAndPersist(input: {
  nickname: string;
  email: string;
  password: string;
  verification_code?: string;
}): Promise<PlatformUser> {
  const tokens = await registerAccount(input);
  persistApiSession(tokens.access_token, tokens.refresh_token);
  const me = await fetchMe(tokens.access_token);
  persistNickname(me.nickname);
  return me;
}

/** Single in-flight refresh — parallel heartbeats must not rotate the same RT twice. */
let refreshInFlight: Promise<string | null> | null = null;
let refreshForcePending = false;

export async function ensureValidAccessToken(options?: {
  force?: boolean;
}): Promise<string | null> {
  const accessToken = getStoredAccessToken();
  const refreshToken = getStoredRefreshToken();
  if (!accessToken || !refreshToken) return null;

  if (!options?.force) {
    const expMs = decodeJwtExpMs(accessToken);
    if (expMs && Date.now() + 60_000 < expMs) {
      return accessToken;
    }
  } else {
    refreshForcePending = true;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const currentRefresh = getStoredRefreshToken();
      if (!currentRefresh) return null;

      const force = refreshForcePending;
      const currentAccess = getStoredAccessToken();
      if (!force && currentAccess) {
        const expMs = decodeJwtExpMs(currentAccess);
        if (expMs && Date.now() + 60_000 < expMs) {
          return currentAccess;
        }
      }

      try {
        const tokens = await refreshSession(currentRefresh);
        persistApiSession(tokens.access_token, tokens.refresh_token);
        return tokens.access_token;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 400)) {
          // Another path may have already rotated tokens while this request failed.
          const latestRefresh = getStoredRefreshToken();
          if (latestRefresh && latestRefresh !== currentRefresh) {
            return getStoredAccessToken();
          }
          clearApiSession();
        }
        return null;
      }
    } finally {
      refreshForcePending = false;
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

function decodeJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1])) as { exp?: number };
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp)) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await apiRequest(`${getApiBaseUrl()}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export function mapAuthErrorMessage(
  raw: string,
  mode: "login" | "signup",
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const lower = raw.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return t("platform.errors.connectionFailed");
  }
  if (lower.includes("unauthorized") || lower.includes("invalid login")) {
    return t("platform.errors.invalidCredentials");
  }
  if (lower.includes("invalid password") || lower === "unauthorized") {
    return t("platform.errors.invalidPassword");
  }
  if (lower.includes("email already registered")) {
    return t("platform.errors.emailTaken");
  }
  if (lower.includes("nickname already taken")) {
    return t("platform.errors.nicknameTaken");
  }
  if (lower.includes("verification code required") || lower.includes("invalid verification code")) {
    return t("platform.errors.invalidVerificationCode");
  }
  if (lower.includes("verification code expired")) {
    return t("platform.errors.verificationCodeExpired");
  }
  if (lower.includes("too many verification attempts")) {
    return t("platform.errors.tooManyVerificationAttempts");
  }
  if (lower.includes("rate limit exceeded")) {
    return t("platform.errors.rateLimited");
  }
  if (lower.includes("failed to send verification email") || lower.includes("email verification is not configured")) {
    return t("platform.errors.emailSendFailed");
  }
  if (mode === "signup" && lower.includes("password too short")) {
    return t("platform.errors.passwordTooShort");
  }
  return raw;
}
