import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";

type Language = "ru" | "en";
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
  session?: { access_token?: string };
};

type EnsureProfileResponse =
  | { success: true; user: { id: string; nickname: string } }
  | { error: string; detail?: string };

const STORAGE_TOKEN_KEY = "mc16launcher:supabase_access_token_v1";
const STORAGE_NICKNAME_KEY = "mc16launcher:supabase_nickname_v1";
const AUTH_CHANGED_EVENT = "mc16launcher:supabase-auth-changed";

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

  const supabaseProjectUrl = (import.meta.env.VITE_SUPABASE_PROJECT_URL as string | undefined) ?? "";
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
  const [nickname, setNickname] = useState<string>("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
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
      const n = window.localStorage.getItem(STORAGE_NICKNAME_KEY);
      if (t) setAccessToken(t);
      if (n) setNickname(n);
    } catch {
      // ignore
    }
  }, []);

  const callEnsureProfile = async (token: string, nick: string) => {
    if (!edgeAuthHeaders) throw new Error("Missing SUPABASE anon key (VITE_SUPABASE_ANON_KEY).");
    if (!supabaseProjectUrl) throw new Error("Missing SUPABASE project url (VITE_SUPABASE_PROJECT_URL).");

    const url = `${supabaseProjectUrl}/functions/v1/users_ensure_profile`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...edgeAuthHeaders },
      body: JSON.stringify({ supabase_access_token: token, nickname: nick }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(jsonErrorFromBody(data));
    return data as EnsureProfileResponse;
  };

  const handleAuth = async () => {
    if (!supabaseProjectUrl || !supabaseAnonKey) {
      showNotification(
        "error",
        "Не настроены VITE_SUPABASE_PROJECT_URL / VITE_SUPABASE_ANON_KEY в .env",
      );
      return;
    }
    if (!authEmail.trim()) return showNotification("warning", "Введите email");
    if (!authPassword) return showNotification("warning", "Введите пароль");
    if (!nickname.trim()) return showNotification("warning", "Введите nickname (уникальный)");

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

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: authEmail.trim(), password: authPassword }),
      });

      const data = (await res.json().catch(() => ({}))) as SupabaseAuthResponse & Record<string, unknown>;
      if (!res.ok) throw new Error(jsonErrorFromBody(data));

      const token = data.access_token ?? data.session?.access_token;
      if (!token) throw new Error("Не удалось получить access_token из ответа Supabase.");

      window.localStorage.setItem(STORAGE_TOKEN_KEY, token);
      window.localStorage.setItem(STORAGE_NICKNAME_KEY, nickname.trim());
      setAccessToken(token);
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));

      const ensure = await callEnsureProfile(token, nickname.trim());
      if ("error" in ensure) {
        throw new Error(ensure.detail ? `${ensure.error}: ${ensure.detail}` : ensure.error);
      }
      setNickname(ensure.user.nickname);
      showNotification("success", mode === "signup" ? "Аккаунт создан" : "Вход выполнен");
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setAccessToken("");
    setLinkedProviders({ ely: false, minecraft: false });
    try {
      window.localStorage.removeItem(STORAGE_TOKEN_KEY);
      window.localStorage.removeItem(STORAGE_NICKNAME_KEY);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    showNotification("info", "Вы вышли из аккаунта");
  };

  const callLinkIdentity = async (provider: "ely" | "minecraft", providerUuidRaw: string, providerUsername?: string | null) => {
    if (!edgeAuthHeaders) throw new Error("Missing SUPABASE anon key (VITE_SUPABASE_ANON_KEY).");
    if (!supabaseProjectUrl) throw new Error("Missing SUPABASE project url (VITE_SUPABASE_PROJECT_URL).");
    if (!accessToken) throw new Error("Нет Supabase access_token — войдите в аккаунт.");

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
              showNotification("info", "Выполните вход Microsoft, затем снова нажмите «Привязать».");
            } catch (e) {
              showNotification("error", e instanceof Error ? e.message : String(e));
            }
            return;
          }
          setLinking("minecraft");
          try {
            await callLinkIdentity("minecraft", launcherProfile.mc_uuid, null);
            setLinkedProviders((prev) => ({ ...prev, minecraft: true }));
            showNotification("success", "Minecraft привязан к аккаунту");
          } catch (e) {
            showNotification("error", e instanceof Error ? e.message : String(e));
          } finally {
            setLinking(null);
          }
        }}
        className={`interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-[#0078d4]/90 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#106ebe] disabled:opacity-60 ${
          compactMode ? "min-w-[170px] justify-center shadow-lg" : ""
        }`}
        title={!launcherProfile.mc_uuid ? "Нажмите для входа через Microsoft и повторите привязку" : undefined}
      >
        <span>Microsoft</span>
        <span className="text-white/80">·</span>
        <span>{linkedProviders.minecraft ? "Привязан" : linking === "minecraft" ? "Привязка…" : "Привязать"}</span>
      </button>

      <button
        type="button"
        disabled={loading || linking !== null || providerLoginBusy || !accessToken || linkedProviders.ely}
        onClick={async () => {
          if (!launcherProfile.ely_uuid) {
            try {
              await onElyLogin?.();
              showNotification("info", "Выполните вход Ely.by, затем снова нажмите «Привязать».");
            } catch (e) {
              showNotification("error", e instanceof Error ? e.message : String(e));
            }
            return;
          }
          setLinking("ely");
          try {
            await callLinkIdentity("ely", launcherProfile.ely_uuid, launcherProfile.ely_username);
            setLinkedProviders((prev) => ({ ...prev, ely: true }));
            showNotification("success", "Ely.by привязан к аккаунту");
          } catch (e) {
            showNotification("error", e instanceof Error ? e.message : String(e));
          } finally {
            setLinking(null);
          }
        }}
        className={`interactive-press flex items-center gap-2 rounded-xl bg-[#2d7d46] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60 ${
          compactMode ? "min-w-[170px] justify-center" : ""
        }`}
        title={!launcherProfile.ely_uuid ? "Нажмите для входа через Ely.by и повторите привязку" : undefined}
      >
        <span>Ely.by</span>
        <span className="text-white/80">·</span>
        <span>{linkedProviders.ely ? "Привязан" : linking === "ely" ? "Привязка…" : "Привязать"}</span>
      </button>
    </div>
  );

  if (compact && accessToken) {
    return (
      <div className="flex w-full flex-col items-center gap-3">
        {renderProviderButtons(true)}
        <button
          type="button"
          disabled={loading || linking !== null || providerLoginBusy}
          onClick={handleLogout}
          className="interactive-press rounded-xl border border-white/15 bg-black/30 px-3.5 py-2 text-xs font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
        >
          Выйти из аккаунта
        </button>
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-white/10 glass-panel px-6 py-6 shadow-xl backdrop-blur-md bg-black/40">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/45">
            16launcher аккаунт
          </h2>
          <p className="mt-1 text-[11px] leading-snug text-white/45">
          </p>
        </div>
        {accessToken ? (
          <button
            type="button"
            disabled={loading}
            onClick={handleLogout}
            className="interactive-press shrink-0 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
          >
            Выйти
          </button>
        ) : null}
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
              Войти
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
              Регистрация
            </button>
          </div>

          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
            Email
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
              placeholder="you@example.com"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
            Пароль
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
              placeholder="••••••••"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
            Nickname (уникальный)
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
              placeholder={language === "ru" ? "Напр. steyy" : "e.g. steyy"}
            />
          </label>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleAuth()}
            className="interactive-press w-full rounded-xl bg-[#2d7d46] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60"
          >
            {loading ? tt("common.loading") : mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
                {language === "ru" ? "Ник лаунчера" : "Launcher nickname"}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-emerald-100/95">{launcherNickname || "—"}</p>

              <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
                {language === "ru" ? "Игровой ник" : "In-game nickname"}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white/90">{gameNickname || "—"}</p>
            </div>
            <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-100">
              Online
            </span>
          </div>

          <div className="h-px w-full bg-white/10" />

          {renderProviderButtons(false)}
        </div>
      )}
    </div>
  );
}

