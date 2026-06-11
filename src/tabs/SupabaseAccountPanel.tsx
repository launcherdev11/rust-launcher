import { useEffect, useMemo, useState } from "react";
import { t, useT, type Language } from "../i18n";
type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };

export type LauncherProfileLite = {
  launcher_nickname: string | null;
  ely_username: string | null;
  microsoft_username: string | null;
  ely_uuid: string | null;
  mc_uuid: string | null;
};

type SupabaseAccountPanelProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
  launcherProfile: LauncherProfileLite;
  onMicrosoftLogin?: () => void | Promise<void>;
  onElyLogin?: () => void | Promise<void>;
  providerLoginBusy?: boolean;
  compact?: boolean;
};

type SupabaseAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  session?: { access_token?: string; refresh_token?: string };
};

type ResolveLoginResponse = {
  email?: string;
};

type EnsureProfileResponse =
  | { success: true; user: { id: string; nickname: string } }
  | { error: string; detail?: string };

const STORAGE_TOKEN_KEY = "mc16launcher:supabase_access_token_v1";
const STORAGE_REFRESH_TOKEN_KEY = "mc16launcher:supabase_refresh_token_v1";
const STORAGE_NICKNAME_KEY = "mc16launcher:supabase_nickname_v1";
const AUTH_CHANGED_EVENT = "mc16launcher:supabase-auth-changed";
const REFRESH_AHEAD_MS = 60_000;

function decodeJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1]));
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp)) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

function isTokenExpiringSoon(token: string, aheadMs = REFRESH_AHEAD_MS): boolean {
  const expMs = decodeJwtExpMs(token);
  if (!expMs) return true;
  return Date.now() + aheadMs >= expMs;
}

function jsonErrorFromBody(body: unknown): string {
  if (!body) return "Unknown error";
  if (typeof body === "string") return body;
  if (typeof body === "object") {
    const o = body as any;
    const msg = o.message ?? o.error ?? null;
    const detail = o.detail ?? o.details ?? null;
    if (msg && detail) return `${msg}: ${detail}`;
    if (msg) return String(msg);
    if (detail) return String(detail);
  }
  return "Unknown error";
}

function normalizeProviderUuid(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, "");
}

function mapAuthErrorMessage(
  raw: string,
  mode: "login" | "signup",
  lang: Language,
): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror when attempting to fetch resource")
  ) {
    return t(lang, "supabase.errors.connectionFailed");
  }
  if (mode === "login") {
    if (lower.includes("invalid login credentials")) {
      return t(lang, "supabase.errors.invalidCredentials");
    }
    if (lower.includes("invalid_credentials")) {
      return t(lang, "supabase.errors.invalidCredentials");
    }
    if (lower.includes("password")) return t(lang, "supabase.errors.invalidPassword");
  } else {
    if (lower.includes("password should be at least")) {
      return t(lang, "supabase.errors.passwordTooShort");
    }
    if (lower.includes("weak password")) return t(lang, "supabase.errors.weakPassword");
  }
  return raw;
}

function mapIdentityLinkErrorMessage(
  raw: string,
  provider: "ely" | "minecraft",
  lang: Language,
): string {
  const lower = raw.toLowerCase();
  const providerName = provider === "ely" ? "Ely.by" : "Minecraft";

  if (
    lower.includes("identity already linked to another user") ||
    lower.includes("already linked")
  ) {
    return t(lang, "supabase.errors.identityAlreadyLinked", { provider: providerName });
  }

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror when attempting to fetch resource")
  ) {
    return t(lang, "supabase.errors.linkConnectionFailed", { provider: providerName });
  }

  return raw;
}

function isExpiredSupabaseTokenError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes("token is expired") ||
    lower.includes("invalid supabase token") ||
    lower.includes("invalid jwt")
  );
}

function normalizeSupabaseProjectUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export function SupabaseAccountPanel({
  showNotification,
  language,
  launcherProfile,
  onMicrosoftLogin,
  onElyLogin,
  providerLoginBusy = false,
  compact = false,
}: SupabaseAccountPanelProps) {
  const tt = useT(language);

  const supabaseProjectUrl = normalizeSupabaseProjectUrl(
    import.meta.env.VITE_SUPABASE_PROJECT_URL as string | undefined,
  );
  const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

  const edgeAuthHeaders = useMemo(() => {
    if (!supabaseAnonKey) return null;
    return {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    };
  }, [supabaseAnonKey]);

  const [loading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState<string>("");
  const [nickname, setNickname] = useState<string>("");
  const [nicknameDraft, setNicknameDraft] = useState<string>("");
  const [authIdentifier, setAuthIdentifier] = useState("");
  const [signupNickname, setSignupNickname] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const launcherNickname = launcherProfile.launcher_nickname?.trim() || nickname.trim();
  const gameNickname =
    launcherProfile.ely_username?.trim() ||
    launcherProfile.microsoft_username?.trim() ||
    launcherNickname;

  const [linking, setLinking] = useState<null | "ely" | "minecraft">(null);
  const [linkedProviders, setLinkedProviders] = useState<{ ely: boolean; minecraft: boolean }>({
    ely: false,
    minecraft: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const t = window.localStorage.getItem(STORAGE_TOKEN_KEY);
      const r = window.localStorage.getItem(STORAGE_REFRESH_TOKEN_KEY);
      const n = window.localStorage.getItem(STORAGE_NICKNAME_KEY);
      if (t) setAccessToken(t);
      if (r) setRefreshToken(r);
      if (n) setNickname(n);
    } catch {
      // ignore
    }
  }, []);

  const persistSupabaseSession = (nextAccessToken: string, nextRefreshToken: string) => {
    window.localStorage.setItem(STORAGE_TOKEN_KEY, nextAccessToken);
    window.localStorage.setItem(STORAGE_REFRESH_TOKEN_KEY, nextRefreshToken);
    setAccessToken(nextAccessToken);
    setRefreshToken(nextRefreshToken);
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  };

  const clearSupabaseSession = () => {
    setAccessToken("");
    setRefreshToken("");
    setLinkedProviders({ ely: false, minecraft: false });
    try {
      window.localStorage.removeItem(STORAGE_TOKEN_KEY);
      window.localStorage.removeItem(STORAGE_REFRESH_TOKEN_KEY);
      window.localStorage.removeItem(STORAGE_NICKNAME_KEY);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  };

  const refreshSupabaseSession = async (currentRefreshToken: string) => {
    if (!supabaseProjectUrl || !supabaseAnonKey) {
      throw new Error(t(language, "supabase.toast.envNotConfigured"));
    }
    const res = await fetch(`${supabaseProjectUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: currentRefreshToken }),
    });
    const data = (await res.json().catch(() => ({}))) as SupabaseAuthResponse & Record<string, unknown>;
    if (!res.ok) throw new Error(jsonErrorFromBody(data));
    const nextAccessToken = data.access_token ?? data.session?.access_token;
    const nextRefreshToken = data.refresh_token ?? currentRefreshToken;
    if (!nextAccessToken) throw new Error(t(language, "supabase.toast.refreshNoToken"));
    persistSupabaseSession(nextAccessToken, nextRefreshToken);
    return nextAccessToken;
  };

  useEffect(() => {
    if (!accessToken || !refreshToken) return;
    if (!isTokenExpiringSoon(accessToken)) return;

    let cancelled = false;
    void refreshSupabaseSession(refreshToken).catch((e) => {
      if (cancelled) return;
      const rawMessage = e instanceof Error ? e.message : String(e);
      showNotification("warning", t(language, "supabase.toast.sessionExpiredWithMsg", { msg: rawMessage }));
      clearSupabaseSession();
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshToken, supabaseProjectUrl, supabaseAnonKey]);

  useEffect(() => {
    if (!accessToken || !refreshToken) return;
    const expMs = decodeJwtExpMs(accessToken);
    if (!expMs) return;
    const timeoutMs = Math.max(0, expMs - Date.now() - REFRESH_AHEAD_MS);
    const timer = window.setTimeout(() => {
      void refreshSupabaseSession(refreshToken).catch((e) => {
        const rawMessage = e instanceof Error ? e.message : String(e);
        showNotification("warning", t(language, "supabase.toast.sessionExpiredWithMsg", { msg: rawMessage }));
        clearSupabaseSession();
      });
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [accessToken, refreshToken, supabaseProjectUrl, supabaseAnonKey]);

  useEffect(() => {
    const onChanged = () => {
      try {
        const t = window.localStorage.getItem(STORAGE_TOKEN_KEY) ?? "";
        const r = window.localStorage.getItem(STORAGE_REFRESH_TOKEN_KEY) ?? "";
        setAccessToken(t);
        setRefreshToken(r);
      } catch {
        setAccessToken("");
        setRefreshToken("");
      }
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onChanged);
    window.addEventListener("storage", onChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
    };
  }, []);

  useEffect(() => {
    setNicknameDraft(nickname);
  }, [nickname]);

  const callEnsureProfile = async (token: string, nick?: string) => {
    if (!edgeAuthHeaders) throw new Error("Missing SUPABASE anon key (VITE_SUPABASE_ANON_KEY).");
    if (!supabaseProjectUrl) throw new Error("Missing SUPABASE project url (VITE_SUPABASE_PROJECT_URL).");

    const url = `${supabaseProjectUrl}/functions/v1/users_ensure_profile`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...edgeAuthHeaders },
      body: JSON.stringify({
        supabase_access_token: token,
        ...(nick && nick.trim() ? { nickname: nick.trim() } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(jsonErrorFromBody(data));
    return data as EnsureProfileResponse;
  };

  const callResolveLogin = async (login: string) => {
    if (!edgeAuthHeaders) throw new Error("Missing SUPABASE anon key (VITE_SUPABASE_ANON_KEY).");
    if (!supabaseProjectUrl) throw new Error("Missing SUPABASE project url (VITE_SUPABASE_PROJECT_URL).");

    const url = `${supabaseProjectUrl}/functions/v1/users_resolve_login`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...edgeAuthHeaders },
      body: JSON.stringify({ login }),
    });
    const data = (await res.json().catch(() => ({}))) as ResolveLoginResponse & Record<string, unknown>;
    if (res.status === 404) {
      throw new Error(t(language, "supabase.toast.nicknameLoginUnsupported"));
    }
    if (!res.ok) throw new Error(jsonErrorFromBody(data));

    const email = typeof data.email === "string" ? data.email.trim() : "";
    if (!email) throw new Error(t(language, "supabase.toast.nicknameEmailNotFound"));
    return email;
  };

  const handleAuth = async () => {
    if (!supabaseProjectUrl || !supabaseAnonKey) {
      showNotification("error", tt("supabase.toast.envNotConfigured"));
      return;
    }
    if (!authIdentifier.trim()) {
      return showNotification(
        "warning",
        mode === "signup" ? tt("supabase.enterEmail") : tt("supabase.enterNicknameOrEmail"),
      );
    }
    if (mode === "signup" && !authIdentifier.includes("@")) {
      return showNotification("warning", tt("supabase.toast.enterEmailSignup"));
    }
    if (mode === "signup" && !signupNickname.trim()) {
      return showNotification("warning", tt("supabase.toast.enterSignupNickname"));
    }
    if (!authPassword) return showNotification("warning", tt("supabase.toast.enterPassword"));
    if (mode === "signup" && authPassword.length < 6) {
      return showNotification("warning", tt("supabase.toast.passwordTooShort"));
    }

    setLoading(true);
    try {
      const headers = {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      };

      const url =
        mode === "signup"
          ? `${supabaseProjectUrl}/auth/v1/signup`
          : `${supabaseProjectUrl}/auth/v1/token?grant_type=password`;

      const identifier = authIdentifier.trim();
      let loginEmail = identifier;
      if (mode === "login" && !identifier.includes("@")) {
        try {
          loginEmail = await callResolveLogin(identifier);
        } catch (resolveErr) {
          const resolveMessage = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
          const lowerResolve = resolveMessage.toLowerCase();
          if (
            lowerResolve.includes("failed to fetch") ||
            lowerResolve.includes("networkerror when attempting to fetch resource")
          ) {
            throw new Error(tt("supabase.toast.resolveLoginFailed"));
          }
          throw resolveErr;
        }
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: loginEmail, password: authPassword }),
      });

      const data = (await res.json().catch(() => ({}))) as SupabaseAuthResponse & Record<string, unknown>;
      if (!res.ok) throw new Error(jsonErrorFromBody(data));

      const token = data.access_token ?? data.session?.access_token;
      const receivedRefreshToken = data.refresh_token ?? data.session?.refresh_token;
      if (!token) throw new Error(tt("supabase.toast.noAccessTokenResponse"));
      if (!receivedRefreshToken) throw new Error(tt("supabase.toast.noRefreshToken"));

      const nicknameForEnsure = mode === "signup" ? signupNickname.trim() : undefined;

      persistSupabaseSession(token, receivedRefreshToken);
      if (nicknameForEnsure) {
        window.localStorage.setItem(STORAGE_NICKNAME_KEY, nicknameForEnsure);
      }

      const ensure = await callEnsureProfile(token, nicknameForEnsure);
      if ("error" in ensure) {
        throw new Error(ensure.detail ? `${ensure.error}: ${ensure.detail}` : ensure.error);
      }
      setNickname(ensure.user.nickname);
      window.localStorage.setItem(STORAGE_NICKNAME_KEY, ensure.user.nickname);
      showNotification(
        "success",
        mode === "signup" ? tt("supabase.toast.accountCreated") : tt("supabase.toast.signedIn"),
      );
    } catch (e) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      showNotification("error", mapAuthErrorMessage(rawMessage, mode, language));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearSupabaseSession();
    showNotification("info", tt("supabase.toast.loggedOut"));
  };

  const handleChangeNickname = async () => {
    if (!accessToken) {
      showNotification("warning", tt("supabase.toast.signInFirst"));
      return;
    }

    const nextNickname = nicknameDraft.trim();
    if (!nextNickname) {
      showNotification("warning", tt("supabase.toast.enterNewNickname"));
      return;
    }
    if (nextNickname.length < 3) {
      showNotification("warning", tt("supabase.toast.nicknameTooShort"));
      return;
    }
    if (nextNickname === nickname.trim()) {
      showNotification("info", tt("supabase.toast.nicknameAlreadySet"));
      return;
    }

    setLoading(true);
    try {
      const ensure = await callEnsureProfile(accessToken, nextNickname);
      if ("error" in ensure) {
        throw new Error(ensure.detail ? `${ensure.error}: ${ensure.detail}` : ensure.error);
      }
      setNickname(ensure.user.nickname);
      setNicknameDraft(ensure.user.nickname);
      window.localStorage.setItem(STORAGE_NICKNAME_KEY, ensure.user.nickname);
      showNotification("success", tt("supabase.toast.nicknameUpdated"));
    } catch (e) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      if (isExpiredSupabaseTokenError(rawMessage)) {
        handleLogout();
        showNotification("warning", tt("supabase.toast.sessionExpired"));
        return;
      }
      showNotification("error", rawMessage);
    } finally {
      setLoading(false);
    }
  };

  const callLinkIdentity = async (provider: "ely" | "minecraft", providerUuidRaw: string, providerUsername?: string | null) => {
    if (!edgeAuthHeaders) throw new Error("Missing SUPABASE anon key (VITE_SUPABASE_ANON_KEY).");
    if (!supabaseProjectUrl) throw new Error("Missing SUPABASE project url (VITE_SUPABASE_PROJECT_URL).");
    if (!accessToken) throw new Error(tt("supabase.toast.noAccessToken"));

    const provider_uuid = normalizeProviderUuid(providerUuidRaw);
    if (!provider_uuid) throw new Error("provider_uuid пустой");

    const url = `${supabaseProjectUrl}/functions/v1/identities_link`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...edgeAuthHeaders },
      body: JSON.stringify({
        supabase_access_token: accessToken,
        provider,
        provider_uuid,
        provider_username: providerUsername ?? null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(jsonErrorFromBody(data));
    return data as { success: true };
  };

  const renderProviderButtons = (compactMode: boolean) => (
    <div className={`flex flex-wrap items-center justify-center gap-3 ${compactMode ? "mt-1" : ""}`}>
      <button
        type="button"
        disabled={loading || linking !== null || providerLoginBusy || !accessToken || linkedProviders.minecraft}
        onClick={async () => {
          if (!launcherProfile.mc_uuid) {
            try {
              await onMicrosoftLogin?.();
              showNotification("info", tt("supabase.toast.signInMicrosoftThenLink"));
            } catch (e) {
              showNotification("error", e instanceof Error ? e.message : String(e));
            }
            return;
          }
          setLinking("minecraft");
          try {
            await callLinkIdentity("minecraft", launcherProfile.mc_uuid, null);
            setLinkedProviders((prev) => ({ ...prev, minecraft: true }));
            showNotification("success", tt("supabase.toast.minecraftLinked"));
          } catch (e) {
            const rawMessage = e instanceof Error ? e.message : String(e);
            if (isExpiredSupabaseTokenError(rawMessage)) {
              handleLogout();
              showNotification("warning", tt("supabase.toast.sessionExpired"));
              return;
            }
            showNotification("error", mapIdentityLinkErrorMessage(rawMessage, "minecraft", language));
          } finally {
            setLinking(null);
          }
        }}
        className={`interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-[#0078d4]/90 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#106ebe] disabled:opacity-60 ${
          compactMode ? "min-w-[170px] justify-center shadow-lg" : ""
        }`}
        title={!launcherProfile.mc_uuid ? tt("supabase.linkMicrosoftTitle") : undefined}
      >
        <span>Microsoft</span>
        <span className="text-white/80">·</span>
        <span>
          {linkedProviders.minecraft
            ? tt("supabase.linked")
            : linking === "minecraft"
              ? tt("supabase.linking")
              : tt("supabase.link")}
        </span>
      </button>

      <button
        type="button"
        disabled={loading || linking !== null || providerLoginBusy || !accessToken || linkedProviders.ely}
        onClick={async () => {
          if (!launcherProfile.ely_uuid) {
            try {
              await onElyLogin?.();
              showNotification("info", tt("supabase.toast.signInElyThenLink"));
            } catch (e) {
              showNotification("error", e instanceof Error ? e.message : String(e));
            }
            return;
          }
          setLinking("ely");
          try {
            await callLinkIdentity("ely", launcherProfile.ely_uuid, launcherProfile.ely_username);
            setLinkedProviders((prev) => ({ ...prev, ely: true }));
            showNotification("success", tt("supabase.toast.elyLinked"));
          } catch (e) {
            const rawMessage = e instanceof Error ? e.message : String(e);
            if (isExpiredSupabaseTokenError(rawMessage)) {
              handleLogout();
              showNotification("warning", tt("supabase.toast.sessionExpired"));
              return;
            }
            showNotification("error", mapIdentityLinkErrorMessage(rawMessage, "ely", language));
          } finally {
            setLinking(null);
          }
        }}
        className={`interactive-press flex items-center gap-2 rounded-xl bg-[#2d7d46] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60 ${
          compactMode ? "min-w-[170px] justify-center" : ""
        }`}
        title={!launcherProfile.ely_uuid ? tt("supabase.linkElyTitle") : undefined}
      >
        <span>Ely.by</span>
        <span className="text-white/80">·</span>
        <span>
          {linkedProviders.ely
            ? tt("supabase.linked")
            : linking === "ely"
              ? tt("supabase.linking")
              : tt("supabase.link")}
        </span>
      </button>
    </div>
  );

  if (compact && accessToken) {
    return (
      <div className="flex w-full flex-col items-center gap-3">
        <div className="w-full rounded-xl border border-white/10 bg-black/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
            {tt("supabase.accountManagement")}
          </p>
          <input
            type="text"
            value={nicknameDraft}
            onChange={(e) => setNicknameDraft(e.target.value)}
            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-emerald-400/30"
            placeholder={tt("supabase.newNicknamePlaceholder")}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={loading || linking !== null || providerLoginBusy}
              onClick={() => void handleChangeNickname()}
              className="interactive-press flex-1 rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
            >
              {tt("supabase.changeNickname")}
            </button>
            <button
              type="button"
              disabled={loading || linking !== null || providerLoginBusy}
              onClick={handleLogout}
              className="interactive-press rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-xs font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
            >
              {tt("supabase.logout")}
            </button>
          </div>
        </div>
        {renderProviderButtons(true)}
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-white/10 glass-panel px-6 py-6 shadow-xl backdrop-blur-md bg-black/40">
      <div className="mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-white/45">
          {tt("supabase.accountTitle")}
        </h2>
      </div>

      {!accessToken ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={() => setMode("login")}
              className={`interactive-press rounded-xl border px-4 py-2 text-sm font-semibold ${
                mode === "login"
                  ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                  : "border-white/15 bg-black/30 text-white/70 hover:bg-black/50"
              }`}
            >
              {tt("supabase.signIn")}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setMode("signup")}
              className={`interactive-press rounded-xl border px-4 py-2 text-sm font-semibold ${
                mode === "signup"
                  ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                  : "border-white/15 bg-black/30 text-white/70 hover:bg-black/50"
              }`}
            >
              {tt("supabase.signUp")}
            </button>
          </div>

          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
            {mode === "signup" ? tt("supabase.emailLabel") : tt("supabase.emailOrNicknameLabel")}
            <input
              type="text"
              value={authIdentifier}
              onChange={(e) => setAuthIdentifier(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
              placeholder={
                mode === "signup" ? tt("supabase.enterEmail") : tt("supabase.enterNicknameOrEmail")
              }
            />
          </label>

          {mode === "signup" ? (
            <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
              {tt("supabase.nicknameLabel")}
              <input
                type="text"
                value={signupNickname}
                onChange={(e) => setSignupNickname(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
                placeholder={tt("supabase.enterNickname")}
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
            {tt("supabase.passwordLabel")}
            <div className="relative flex items-center">
              <input
                type={showPassword ? "text" : "password"}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 pr-11 text-sm text-white outline-none focus:border-emerald-400/30"
                placeholder={tt("supabase.passwordPlaceholder")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="interactive-press absolute inset-y-0 right-2 my-auto flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10"
                aria-label={showPassword ? tt("supabase.hidePassword") : tt("supabase.showPassword")}
                title={showPassword ? tt("supabase.hidePassword") : tt("supabase.showPassword")}
              >
                <img
                  src={showPassword ? "/launcher-assets/hide.png" : "/launcher-assets/show.png"}
                  alt=""
                  className="h-4 w-4 object-contain opacity-80"
                />
              </button>
            </div>
          </label>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleAuth()}
            className="interactive-press w-full rounded-xl bg-[#2d7d46] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60"
          >
            {loading
              ? tt("common.loading")
              : mode === "login"
                ? tt("supabase.signIn")
                : tt("supabase.createAccount")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
                {tt("supabase.launcherNickname")}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-emerald-100/95">{launcherNickname || "—"}</p>

              <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
                {tt("supabase.inGameNickname")}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white/90">{gameNickname || "—"}</p>
            </div>
            <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-100">
              Online
            </span>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
              {tt("supabase.accountManagement")}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={nicknameDraft}
                onChange={(e) => setNicknameDraft(e.target.value)}
                className="h-10 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-emerald-400/30"
                placeholder={tt("supabase.newNicknamePlaceholder")}
              />
              <button
                type="button"
                disabled={loading || linking !== null || providerLoginBusy}
                onClick={() => void handleChangeNickname()}
                className="interactive-press rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
              >
                {tt("supabase.changeNickname")}
              </button>
              <button
                type="button"
                disabled={loading || linking !== null || providerLoginBusy}
                onClick={handleLogout}
                className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
              >
                {tt("supabase.logout")}
              </button>
            </div>
          </div>

          <div className="h-px w-full bg-white/10" />

          {renderProviderButtons(false)}
        </div>
      )}
    </div>
  );
}

