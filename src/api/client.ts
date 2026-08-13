import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

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

const DEFAULT_API_BASE_URL = "https://api.16-launcher.ru";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function apiRequest(input: string, init?: RequestInit): Promise<Response> {
  if (isTauriRuntime()) {
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (raw?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
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
    //ignore
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
    //ignore
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

  const res = await apiRequest(`${getApiBaseUrl()}${path}`, { ...init, headers });
  // Shared single-flight refresh (auth.ts) — do not POST /auth/refresh here again.
  if (res.status === 401 && token && accessToken === undefined) {
    if (getStoredRefreshToken()) {
      const { ensureValidAccessToken } = await import("./auth");
      const newToken = await ensureValidAccessToken({ force: true });
      if (newToken) {
        return apiFetch<T>(path, init, newToken);
      }
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
