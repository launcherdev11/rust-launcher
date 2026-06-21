import {
  ApiError,
  apiFetch,
  clearApiSession,
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
};

export const API_AUTH_CHANGED_EVENT = "mc16launcher:api-auth-changed";
export const API_NICKNAME_KEY = "mc16launcher:api_nickname_v1";

export async function registerAccount(input: {
  nickname: string;
  email: string;
  password: string;
}): Promise<AuthTokens> {
  return apiFetch<AuthTokens>(
    "/auth/register",
    { method: "POST", body: JSON.stringify(input) },
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

export async function linkIdentity(input: {
  provider: "ely" | "minecraft";
  provider_uuid: string;
  provider_username?: string | null;
}): Promise<void> {
  await apiFetch("/identities/link", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loginAndPersist(input: {
  login: string;
  password: string;
}): Promise<PlatformUser> {
  const tokens = await loginAccount(input);
  persistApiSession(tokens.access_token, tokens.refresh_token);
  const me = await fetchMe(tokens.access_token);
  window.localStorage.setItem(API_NICKNAME_KEY, me.nickname);
  return me;
}

export async function registerAndPersist(input: {
  nickname: string;
  email: string;
  password: string;
}): Promise<PlatformUser> {
  const tokens = await registerAccount(input);
  persistApiSession(tokens.access_token, tokens.refresh_token);
  const me = await fetchMe(tokens.access_token);
  window.localStorage.setItem(API_NICKNAME_KEY, me.nickname);
  return me;
}

export async function ensureValidAccessToken(): Promise<string | null> {
  const accessToken = getStoredAccessToken();
  const refreshToken = getStoredRefreshToken();
  if (!accessToken || !refreshToken) return null;

  const expMs = decodeJwtExpMs(accessToken);
  if (expMs && Date.now() + 60_000 < expMs) {
    return accessToken;
  }

  try {
    const tokens = await refreshSession(refreshToken);
    persistApiSession(tokens.access_token, tokens.refresh_token);
    return tokens.access_token;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 400)) {
      clearApiSession();
    }
    return null;
  }
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
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8080"}/health`);
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
  if (lower.includes("email already registered")) {
    return t("platform.errors.emailTaken");
  }
  if (lower.includes("nickname already taken")) {
    return t("platform.errors.nicknameTaken");
  }
  if (mode === "signup" && lower.includes("password too short")) {
    return t("platform.errors.passwordTooShort");
  }
  return raw;
}
