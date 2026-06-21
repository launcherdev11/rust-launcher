import { useEffect, useRef, useState } from "react";
import {
  API_AUTH_CHANGED_EVENT,
  API_NICKNAME_KEY,
  ensureValidAccessToken,
  fetchMe,
  linkIdentity,
  loginAndPersist,
  logoutAccount,
  mapAuthErrorMessage,
  registerAndPersist,
  updateNickname,
  type PlatformUser,
} from "../api/auth";
import { ApiError, getStoredAccessToken } from "../api/client";
import { useT, type Language } from "../i18n";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };

export type LauncherProfileLite = {
  launcher_nickname: string | null;
  ely_username: string | null;
  microsoft_username: string | null;
  ely_uuid: string | null;
  mc_uuid: string | null;
};

type PlatformAccountPanelProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
  launcherProfile: LauncherProfileLite;
  onMicrosoftLogin?: () => void | Promise<void>;
  onElyLogin?: () => void | Promise<void>;
  providerLoginBusy?: boolean;
  compact?: boolean;
};

const REFRESH_AHEAD_MS = 60_000;

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

function isTokenExpiringSoon(token: string, aheadMs = REFRESH_AHEAD_MS): boolean {
  const expMs = decodeJwtExpMs(token);
  if (!expMs) return true;
  return Date.now() + aheadMs >= expMs;
}

function normalizeProviderUuid(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, "");
}

export function PlatformAccountPanel({
  showNotification,
  language,
  launcherProfile,
  onMicrosoftLogin,
  onElyLogin,
  providerLoginBusy = false,
  compact = false,
}: PlatformAccountPanelProps) {
  const tt = useT(language);

  const [loading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [platformUser, setPlatformUser] = useState<PlatformUser | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const nicknameDraftFocusedRef = useRef(false);
  const [authIdentifier, setAuthIdentifier] = useState("");
  const [signupNickname, setSignupNickname] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [linking, setLinking] = useState<null | "ely" | "minecraft">(null);
  const [linkedProviders, setLinkedProviders] = useState({ ely: false, minecraft: false });

  const launcherNickname = launcherProfile.launcher_nickname?.trim() || platformUser?.nickname || "";
  const gameNickname =
    launcherProfile.ely_username?.trim() ||
    launcherProfile.microsoft_username?.trim() ||
    launcherNickname;

  const syncFromStorage = () => {
    const token = getStoredAccessToken() ?? "";
    setAccessToken(token);
    if (!token) {
      setPlatformUser(null);
      return;
    }
    void fetchMe(token)
      .then((me) => {
        setPlatformUser(me);
        setNicknameDraft(me.nickname);
        window.localStorage.setItem(API_NICKNAME_KEY, me.nickname);
      })
      .catch(() => {
        setPlatformUser(null);
        setAccessToken("");
      });
  };

  useEffect(() => {
    syncFromStorage();
    const onChanged = () => syncFromStorage();
    window.addEventListener(API_AUTH_CHANGED_EVENT, onChanged);
    window.addEventListener("storage", onChanged);
    return () => {
      window.removeEventListener(API_AUTH_CHANGED_EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
    };
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    if (!isTokenExpiringSoon(accessToken)) return;
    void ensureValidAccessToken().then((token) => {
      if (token) setAccessToken(token);
      else {
        setPlatformUser(null);
        setAccessToken("");
      }
    });
  }, [accessToken]);

  useEffect(() => {
    if (nicknameDraftFocusedRef.current) return;
    setNicknameDraft(platformUser?.nickname ?? "");
  }, [platformUser?.nickname]);

  const handleAuth = async () => {
    if (!authIdentifier.trim()) {
      return showNotification(
        "warning",
        mode === "signup" ? tt("platform.enterEmail") : tt("platform.enterNicknameOrEmail"),
      );
    }
    if (mode === "signup" && !authIdentifier.includes("@")) {
      return showNotification("warning", tt("platform.toast.enterEmailSignup"));
    }
    if (mode === "signup" && !signupNickname.trim()) {
      return showNotification("warning", tt("platform.toast.enterSignupNickname"));
    }
    if (!authPassword) return showNotification("warning", tt("platform.toast.enterPassword"));
    if (authPassword.length < 8) {
      return showNotification("warning", tt("platform.toast.passwordTooShort"));
    }

    setLoading(true);
    try {
      const me =
        mode === "signup"
          ? await registerAndPersist({
              nickname: signupNickname.trim(),
              email: authIdentifier.trim(),
              password: authPassword,
            })
          : await loginAndPersist({ login: authIdentifier.trim(), password: authPassword });

      setPlatformUser(me);
      setAccessToken(getStoredAccessToken() ?? "");
      showNotification(
        "success",
        mode === "signup" ? tt("platform.toast.accountCreated") : tt("platform.toast.signedIn"),
      );
    } catch (e) {
      const rawMessage = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      showNotification("error", mapAuthErrorMessage(rawMessage, mode, tt));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await logoutAccount(accessToken || undefined);
    } finally {
      setAccessToken("");
      setPlatformUser(null);
      setLoading(false);
      showNotification("info", tt("platform.toast.loggedOut"));
    }
  };

  const handleChangeNickname = async () => {
    if (!accessToken) {
      showNotification("warning", tt("platform.toast.signInFirst"));
      return;
    }
    const nextNickname = nicknameDraft.trim();
    if (!nextNickname) {
      showNotification("warning", tt("platform.toast.enterNewNickname"));
      return;
    }
    if (nextNickname.length < 3) {
      showNotification("warning", tt("platform.toast.nicknameTooShort"));
      return;
    }
    if (nextNickname === platformUser?.nickname) {
      showNotification("info", tt("platform.toast.nicknameAlreadySet"));
      return;
    }

    setLoading(true);
    try {
      const me = await updateNickname(nextNickname, accessToken);
      setPlatformUser(me);
      setNicknameDraft(me.nickname);
      window.localStorage.setItem(API_NICKNAME_KEY, me.nickname);
      showNotification("success", tt("platform.toast.nicknameUpdated"));
    } catch (e) {
      const rawMessage = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      if (e instanceof ApiError && e.status === 401) {
        await handleLogout();
        showNotification("warning", tt("platform.toast.sessionExpired"));
        return;
      }
      showNotification("error", rawMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async (provider: "ely" | "minecraft") => {
    if (!accessToken) {
      showNotification("warning", tt("platform.toast.signInFirst"));
      return;
    }
    const uuid = provider === "ely" ? launcherProfile.ely_uuid : launcherProfile.mc_uuid;
    if (!uuid) {
      try {
        if (provider === "minecraft") {
          await onMicrosoftLogin?.();
          showNotification("info", tt("platform.toast.signInMicrosoftThenLink"));
        } else {
          await onElyLogin?.();
          showNotification("info", tt("platform.toast.signInElyThenLink"));
        }
      } catch (e) {
        showNotification("error", e instanceof Error ? e.message : String(e));
      }
      return;
    }

    setLinking(provider);
    try {
      await linkIdentity({
        provider,
        provider_uuid: normalizeProviderUuid(uuid),
        provider_username: provider === "ely" ? launcherProfile.ely_username : null,
      });
      setLinkedProviders((prev) => ({ ...prev, [provider]: true }));
      showNotification(
        "success",
        provider === "minecraft" ? tt("platform.toast.minecraftLinked") : tt("platform.toast.elyLinked"),
      );
    } catch (e) {
      const rawMessage = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      if (e instanceof ApiError && e.status === 401) {
        await handleLogout();
        showNotification("warning", tt("platform.toast.sessionExpired"));
        return;
      }
      if (rawMessage.toLowerCase().includes("already linked")) {
        showNotification(
          "error",
          tt("platform.errors.identityAlreadyLinked", {
            provider: provider === "ely" ? "Ely.by" : "Minecraft",
          }),
        );
      } else {
        showNotification("error", rawMessage);
      }
    } finally {
      setLinking(null);
    }
  };

  const renderProviderButtons = (compactMode: boolean) => (
    <div className={`flex flex-wrap items-center justify-center gap-3 ${compactMode ? "mt-1" : ""}`}>
      <button
        type="button"
        disabled={loading || linking !== null || providerLoginBusy || !accessToken || linkedProviders.minecraft}
        onClick={() => void handleLink("minecraft")}
        className={`interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-[#0078d4]/90 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#106ebe] disabled:opacity-60 ${
          compactMode ? "min-w-[170px] justify-center shadow-lg" : ""
        }`}
        title={!launcherProfile.mc_uuid ? tt("platform.linkMicrosoftTitle") : undefined}
      >
        <span>Microsoft</span>
        <span className="text-white/80">·</span>
        <span>
          {linkedProviders.minecraft
            ? tt("platform.linked")
            : linking === "minecraft"
              ? tt("platform.linking")
              : tt("platform.link")}
        </span>
      </button>
      <button
        type="button"
        disabled={loading || linking !== null || providerLoginBusy || !accessToken || linkedProviders.ely}
        onClick={() => void handleLink("ely")}
        className={`interactive-press flex items-center gap-2 rounded-xl bg-[#2d7d46] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60 ${
          compactMode ? "min-w-[170px] justify-center" : ""
        }`}
        title={!launcherProfile.ely_uuid ? tt("platform.linkElyTitle") : undefined}
      >
        <span>Ely.by</span>
        <span className="text-white/80">·</span>
        <span>
          {linkedProviders.ely
            ? tt("platform.linked")
            : linking === "ely"
              ? tt("platform.linking")
              : tt("platform.link")}
        </span>
      </button>
    </div>
  );

  if (compact && accessToken) {
    return (
      <div className="flex w-full flex-col items-center gap-3">
        <div className="w-full rounded-xl border border-white/10 bg-black/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
            {tt("platform.accountManagement")}
          </p>
          <input
            type="text"
            value={nicknameDraft}
            onChange={(e) => setNicknameDraft(e.target.value)}
            onFocus={() => {
              nicknameDraftFocusedRef.current = true;
            }}
            onBlur={() => {
              nicknameDraftFocusedRef.current = false;
            }}
            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-emerald-400/30"
            placeholder={tt("platform.newNicknamePlaceholder")}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={loading || linking !== null || providerLoginBusy}
              onClick={() => void handleChangeNickname()}
              className="interactive-press flex-1 rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
            >
              {tt("platform.changeNickname")}
            </button>
            <button
              type="button"
              disabled={loading || linking !== null || providerLoginBusy}
              onClick={() => void handleLogout()}
              className="interactive-press rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-xs font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
            >
              {tt("platform.logout")}
            </button>
          </div>
        </div>
        {renderProviderButtons(true)}
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-white/10 glass-panel bg-black/40 px-6 py-6 shadow-xl backdrop-blur-md">
      <div className="mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-white/45">
          {tt("platform.accountTitle")}
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
              {tt("platform.signIn")}
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
              {tt("platform.signUp")}
            </button>
          </div>

          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
            {mode === "signup" ? tt("platform.emailLabel") : tt("platform.emailOrNicknameLabel")}
            <input
              type="text"
              value={authIdentifier}
              onChange={(e) => setAuthIdentifier(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
              placeholder={
                mode === "signup" ? tt("platform.enterEmail") : tt("platform.enterNicknameOrEmail")
              }
            />
          </label>

          {mode === "signup" ? (
            <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
              {tt("platform.nicknameLabel")}
              <input
                type="text"
                value={signupNickname}
                onChange={(e) => setSignupNickname(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
                placeholder={tt("platform.enterNickname")}
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-white/45">
            {tt("platform.passwordLabel")}
            <div className="relative flex items-center">
              <input
                type={showPassword ? "text" : "password"}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 pr-11 text-sm text-white outline-none focus:border-emerald-400/30"
                placeholder={tt("platform.passwordPlaceholder")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="interactive-press absolute inset-y-0 right-2 my-auto flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10"
                aria-label={showPassword ? tt("platform.hidePassword") : tt("platform.showPassword")}
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
                ? tt("platform.signIn")
                : tt("platform.createAccount")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
                {tt("platform.launcherNickname")}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-emerald-100/95">
                {launcherNickname || "—"}
              </p>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
                {tt("platform.inGameNickname")}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white/90">{gameNickname || "—"}</p>
            </div>
            <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-100">
              Online
            </span>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
              {tt("platform.accountManagement")}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={nicknameDraft}
                onChange={(e) => setNicknameDraft(e.target.value)}
                onFocus={() => {
                  nicknameDraftFocusedRef.current = true;
                }}
                onBlur={() => {
                  nicknameDraftFocusedRef.current = false;
                }}
                className="h-10 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-emerald-400/30"
                placeholder={tt("platform.newNicknamePlaceholder")}
              />
              <button
                type="button"
                disabled={loading || linking !== null || providerLoginBusy}
                onClick={() => void handleChangeNickname()}
                className="interactive-press rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
              >
                {tt("platform.changeNickname")}
              </button>
              <button
                type="button"
                disabled={loading || linking !== null || providerLoginBusy}
                onClick={() => void handleLogout()}
                className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
              >
                {tt("platform.logout")}
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
