export type ApiErrorBody = {
  error: string;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (raw ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
}

export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("mc16launcher:api_access_token_v1");
  } catch {
    return null;
  }
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("mc16launcher:api_refresh_token_v1");
  } catch {
    return null;
  }
}

function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22
  );
}

/** Drop bulky non-essential keys so auth tokens can be saved. */
function freeDisposableLocalStorage() {
  try {
    window.localStorage.removeItem("game_console_persist_v2");
    window.localStorage.removeItem("game_console_persist_v1");
  } catch {
    // ignore
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("ely_avatar_cache_v1:")) keys.push(key);
    }
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function setLocalStorageItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    freeDisposableLocalStorage();
    window.localStorage.setItem(key, value);
  }
}

export function persistApiSession(accessToken: string, refreshToken: string) {
  setLocalStorageItem("mc16launcher:api_access_token_v1", accessToken);
  setLocalStorageItem("mc16launcher:api_refresh_token_v1", refreshToken);
  window.dispatchEvent(new CustomEvent("mc16launcher:api-auth-changed"));
}

export function clearApiSession() {
  window.localStorage.removeItem("mc16launcher:api_access_token_v1");
  window.localStorage.removeItem("mc16launcher:api_refresh_token_v1");
  window.localStorage.removeItem("mc16launcher:api_nickname_v1");
  window.dispatchEvent(new CustomEvent("mc16launcher:api-auth-changed"));
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as ApiErrorBody;
    return data.error || res.statusText;
  } catch {
    return res.statusText || "Request failed";
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const token = accessToken ?? getStoredAccessToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
  if (res.status === 401 && token && accessToken === undefined) {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      const refreshRes = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (refreshRes.ok) {
        const tokens = (await refreshRes.json()) as {
          access_token: string;
          refresh_token: string;
        };
        persistApiSession(tokens.access_token, tokens.refresh_token);
        return apiFetch<T>(path, init, tokens.access_token);
      }
      clearApiSession();
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
