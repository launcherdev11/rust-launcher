import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  API_AUTH_CHANGED_EVENT,
  API_NICKNAME_KEY,
  changePassword,
  deleteAccount,
  ensureValidAccessToken,
  fetchEmailVerificationStatus,
  fetchMe,
  linkIdentity,
  loginAndPersist,
  loginWithDiscordAndPersist,
  logoutAccount,
  mapAuthErrorMessage,
  registerAndPersist,
  requestPasswordReset,
  resetPasswordAndPersist,
  sendEmailVerificationCode,
  fetchDiscordAuthStatus,
  updateNickname,
  type PlatformUser,
} from "../api/auth";
import { ApiError, getStoredAccessToken } from "../api/client";
import { fetchUserProfile } from "../api/users";
import { InputClearButton } from "../components/ui";
import { ElyByIcon, MicrosoftIcon } from "../features/account/icons";
import { NicknameWithSponsor } from "../components/SponsorBadge";
import { useT, type Language } from "../i18n";
import { PRIVACY_POLICY_URL } from "../lib/legal";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };

export type LauncherProfileLite = {
  launcher_nickname: string | null;
  offline_nickname?: string | null;
  ely_username: string | null;
  microsoft_username: string | null;
  ely_uuid: string | null;
  mc_uuid: string | null;
};

type IdentityProofProfile = {
  ely_uuid?: string | null;
  ely_username?: string | null;
  ely_access_token?: string | null;
  ely_client_token?: string | null;
  mc_uuid?: string | null;
  mc_username?: string | null;
  mc_access_token?: string | null;
};

type PlatformAccountPanelProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
  launcherProfile: LauncherProfileLite;
  onMicrosoftLogin?: () => void | Promise<void>;
  onElyLogin?: () => void | Promise<void>;
  providerLoginBusy?: boolean;
  onProfileChanged?: () => void;
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

function PrivacyPolicyLink({ language }: { language: Language }) {
  const tt = useT(language);
  return (
    <button
      type="button"
      className="text-accent-hi underline decoration-accent-to/40 underline-offset-2 hover:text-white hover:decoration-accent-to/70"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void openUrl(PRIVACY_POLICY_URL);
      }}
    >
      {tt("platform.privacyPolicyLink")}
    </button>
  );
}

function PrivacyInlineText({
  language,
  messageKey,
}: {
  language: Language;
  messageKey: "platform.privacyConsent" | "platform.privacyLoginNotice";
}) {
  const tt = useT(language);
  const [before, after] = tt(messageKey).split("{{link}}");
  return (
    <span>
      {before}
      <PrivacyPolicyLink language={language} />
      {after ?? ""}
    </span>
  );
}

export function PlatformAccountPanel({
  showNotification,
  language,
  launcherProfile,
  onMicrosoftLogin,
  onElyLogin,
  providerLoginBusy = false,
  onProfileChanged,
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
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [signupStep, setSignupStep] = useState<"form" | "verify">("form");
  const [verificationCode, setVerificationCode] = useState("");
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [linking, setLinking] = useState<null | "ely" | "minecraft">(null);
  const [linkedProviders, setLinkedProviders] = useState({ ely: false, minecraft: false });
  const [linkedIdentity, setLinkedIdentity] = useState<{ ely: string | null; minecraft: boolean }>({
    ely: null,
    minecraft: false,
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [privacyHighlight, setPrivacyHighlight] = useState(false);
  const [resetStep, setResetStep] = useState<null | "request" | "confirm">(null);
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showChangePasswords, setShowChangePasswords] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [modeTabIndicator, setModeTabIndicator] = useState({ left: 0, width: 0 });
  const codeInputRef = useRef<HTMLInputElement>(null);
  const resetCodeInputRef = useRef<HTMLInputElement>(null);
  const privacyCheckboxRef = useRef<HTMLInputElement>(null);
  const modeTabsRef = useRef<HTMLDivElement>(null);
  const modeTabButtonRefs = useRef<Partial<Record<"login" | "signup", HTMLButtonElement | null>>>({});

  const launcherNickname = platformUser?.nickname?.trim() || launcherProfile.launcher_nickname?.trim() || "";
  const gameNickname =
    launcherProfile.ely_username?.trim() ||
    launcherProfile.microsoft_username?.trim() ||
    launcherProfile.offline_nickname?.trim() ||
    "";

  const syncFromStorage = () => {
    const token = getStoredAccessToken() ?? "";
    setAccessToken(token);
    if (!token) {
      setPlatformUser(null);
      return;
    }
    void fetchMe()
      .then((me) => {
        setPlatformUser(me);
        setNicknameDraft(me.nickname);
        window.localStorage.setItem(API_NICKNAME_KEY, me.nickname);
        const fresh = getStoredAccessToken() ?? token;
        if (fresh !== token) setAccessToken(fresh);
        void fetchUserProfile(me.id)
          .then((pub) =>
            setLinkedIdentity({
              ely: pub.ely_username?.trim() || null,
              minecraft: Boolean(pub.mc_uuid?.trim()),
            }),
          )
          .catch(() => {});
      })
      .catch(() => {
        if (!getStoredAccessToken()) {
          setPlatformUser(null);
          setAccessToken("");
        }
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
    void fetchEmailVerificationStatus()
      .then((status) => setEmailVerificationRequired(Boolean(status.required)))
      .catch(() => setEmailVerificationRequired(false));
    void fetchDiscordAuthStatus()
      .then((status) => setDiscordEnabled(Boolean(status.enabled)))
      .catch(() => setDiscordEnabled(false));
  }, []);

  useEffect(() => {
    setVerificationCode("");
    setCodeSent(false);
    setSignupStep("form");
    setPrivacyAccepted(false);
    setPrivacyHighlight(false);
  }, [mode]);

  useEffect(() => {
    if (signupStep !== "verify") return;
    const id = window.setTimeout(() => codeInputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [signupStep]);

  useEffect(() => {
    if (resetStep !== "confirm") return;
    const id = window.setTimeout(() => resetCodeInputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [resetStep]);

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

  useEffect(() => {
    if (privacyAccepted) setPrivacyHighlight(false);
  }, [privacyAccepted]);

  useEffect(() => {
    let raf = 0;
    const updateModeTabIndicator = () => {
      const container = modeTabsRef.current;
      const btn = modeTabButtonRefs.current[mode];
      if (!container || !btn) return;
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setModeTabIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      });
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateModeTabIndicator);
    };
    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    const containerEl = modeTabsRef.current;
    let resizeObserver: ResizeObserver | undefined;
    if (containerEl && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(containerEl);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [mode, accessToken, signupStep, resetStep]);

  const highlightPrivacyConsent = () => {
    setPrivacyHighlight(true);
    privacyCheckboxRef.current?.focus({ preventScroll: true });
    privacyCheckboxRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const validateSignupForm = (): boolean => {
    if (!authIdentifier.trim() || !authIdentifier.includes("@")) {
      showNotification("warning", tt("platform.toast.enterEmailSignup"));
      return false;
    }
    if (!signupNickname.trim()) {
      showNotification("warning", tt("platform.toast.enterSignupNickname"));
      return false;
    }
    if (!authPassword) {
      showNotification("warning", tt("platform.toast.enterPassword"));
      return false;
    }
    if (authPassword.length < 8) {
      showNotification("warning", tt("platform.toast.passwordTooShort"));
      return false;
    }
    if (!privacyAccepted) {
      highlightPrivacyConsent();
      showNotification("warning", tt("platform.toast.acceptPrivacy"));
      return false;
    }
    return true;
  };

  const handleSendVerificationCode = async (opts?: { silentSuccess?: boolean }) => {
    if (!authIdentifier.trim() || !authIdentifier.includes("@")) {
      showNotification("warning", tt("platform.toast.enterEmailSignup"));
      return false;
    }
    setSendingCode(true);
    try {
      await sendEmailVerificationCode(authIdentifier.trim());
      setCodeSent(true);
      if (!opts?.silentSuccess) {
        showNotification("success", tt("platform.toast.verificationCodeSent"));
      }
      return true;
    } catch (e) {
      const rawMessage = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      showNotification("error", mapAuthErrorMessage(rawMessage, "signup", tt));
      return false;
    } finally {
      setSendingCode(false);
    }
  };

  const handleSignupNext = async () => {
    if (!validateSignupForm()) return;

    if (!emailVerificationRequired) {
      await handleAuth();
      return;
    }

    setLoading(true);
    try {
      const sent = await handleSendVerificationCode({ silentSuccess: true });
      if (!sent) return;
      setVerificationCode("");
      setSignupStep("verify");
      showNotification("success", tt("platform.toast.verificationCodeSent"));
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async () => {
    if (mode === "login") {
      if (!authIdentifier.trim()) {
        return showNotification("warning", tt("platform.enterNicknameOrEmail"));
      }
      if (!authPassword) return showNotification("warning", tt("platform.toast.enterPassword"));
      if (authPassword.length < 8) {
        return showNotification("warning", tt("platform.toast.passwordTooShort"));
      }
    } else {
      if (!validateSignupForm()) return;
      if (emailVerificationRequired && !verificationCode.trim()) {
        return showNotification("warning", tt("platform.toast.enterVerificationCode"));
      }
      if (emailVerificationRequired && verificationCode.trim().length !== 6) {
        return showNotification("warning", tt("platform.toast.enterVerificationCode"));
      }
    }

    setLoading(true);
    try {
      const me =
        mode === "signup"
          ? await registerAndPersist({
              nickname: signupNickname.trim(),
              email: authIdentifier.trim(),
              password: authPassword,
              verification_code: emailVerificationRequired
                ? verificationCode.trim()
                : undefined,
            })
          : await loginAndPersist({ login: authIdentifier.trim(), password: authPassword });

      setPlatformUser(me);
      setAccessToken(getStoredAccessToken() ?? "");
      setSignupStep("form");
      setVerificationCode("");
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

  const handleDiscordAuth = async () => {
    if (mode === "signup" && !privacyAccepted) {
      highlightPrivacyConsent();
      showNotification("warning", tt("platform.toast.acceptPrivacy"));
      return;
    }
    setDiscordBusy(true);
    try {
      const { user, isNewUser } = await loginWithDiscordAndPersist();
      setPlatformUser(user);
      setAccessToken(getStoredAccessToken() ?? "");
      setSignupStep("form");
      setVerificationCode("");
      showNotification(
        "success",
        isNewUser ? tt("platform.toast.accountCreated") : tt("platform.toast.signedIn"),
      );
    } catch (e) {
      const rawMessage = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      showNotification("error", mapAuthErrorMessage(rawMessage, mode, tt));
    } finally {
      setDiscordBusy(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await logoutAccount(accessToken || undefined);
    } finally {
      setAccessToken("");
      setPlatformUser(null);
      setDeleteOpen(false);
      setDeletePassword("");
      closeChangePassword();
      setLoading(false);
      showNotification("info", tt("platform.toast.loggedOut"));
    }
  };

  const passwordErrorMessage = (e: unknown): string => {
    if (e instanceof ApiError && e.status === 404) return tt("platform.errors.serverOutdated");
    const rawMessage = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
    return mapAuthErrorMessage(rawMessage, "login", tt);
  };

  const openPasswordReset = () => {
    setResetEmail(authIdentifier.includes("@") ? authIdentifier.trim() : "");
    setResetCode("");
    setResetNewPassword("");
    setShowResetPassword(false);
    setResetStep("request");
  };

  const closePasswordReset = () => {
    setResetStep(null);
    setResetCode("");
    setResetNewPassword("");
  };

  const handleRequestPasswordReset = async () => {
    const email = resetEmail.trim();
    if (!email || !email.includes("@")) {
      showNotification("warning", tt("platform.toast.enterEmailReset"));
      return;
    }
    setResetBusy(true);
    try {
      await requestPasswordReset(email);
      setResetStep("confirm");
      showNotification("success", tt("platform.toast.resetCodeSent"));
    } catch (e) {
      showNotification("error", passwordErrorMessage(e));
    } finally {
      setResetBusy(false);
    }
  };

  const handleConfirmPasswordReset = async () => {
    if (resetCode.trim().length !== 6) {
      showNotification("warning", tt("platform.toast.enterVerificationCode"));
      return;
    }
    if (resetNewPassword.length < 8) {
      showNotification("warning", tt("platform.toast.passwordTooShort"));
      return;
    }
    setResetBusy(true);
    try {
      const me = await resetPasswordAndPersist({
        email: resetEmail.trim(),
        code: resetCode.trim(),
        new_password: resetNewPassword,
      });
      setPlatformUser(me);
      setAccessToken(getStoredAccessToken() ?? "");
      setAuthPassword("");
      closePasswordReset();
      showNotification("success", tt("platform.toast.passwordReset"));
    } catch (e) {
      showNotification("error", passwordErrorMessage(e));
    } finally {
      setResetBusy(false);
    }
  };

  const closeChangePassword = () => {
    setChangePasswordOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setShowChangePasswords(false);
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      showNotification("warning", tt("platform.toast.enterCurrentPassword"));
      return;
    }
    if (newPassword.length < 8) {
      showNotification("warning", tt("platform.toast.passwordTooShort"));
      return;
    }
    if (newPassword === currentPassword) {
      showNotification("warning", tt("platform.errors.samePassword"));
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(
        { current_password: currentPassword, new_password: newPassword },
        accessToken || undefined,
      );
      setAccessToken(getStoredAccessToken() ?? "");
      closeChangePassword();
      showNotification("success", tt("platform.toast.passwordChanged"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await handleLogout();
        showNotification("warning", tt("platform.toast.sessionExpired"));
        return;
      }
      showNotification("error", passwordErrorMessage(e));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      showNotification("warning", tt("platform.toast.enterPassword"));
      return;
    }
    if (deletePassword.length < 8) {
      showNotification("warning", tt("platform.toast.passwordTooShort"));
      return;
    }
    setDeletingAccount(true);
    try {
      await deleteAccount(deletePassword, accessToken || undefined);
      setPlatformUser(null);
      setAccessToken("");
      setDeleteOpen(false);
      setDeletePassword("");
      showNotification("success", tt("platform.toast.accountDeleted"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await handleLogout();
        showNotification("warning", tt("platform.toast.sessionExpired"));
        return;
      }
      showNotification("error", passwordErrorMessage(e));
    } finally {
      setDeletingAccount(false);
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
      onProfileChanged?.();
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
      const fullProfile = await invoke<IdentityProofProfile>("get_profile");
      const providerAccessToken =
        provider === "ely"
          ? fullProfile.ely_access_token?.trim()
          : fullProfile.mc_access_token?.trim();
      if (!providerAccessToken) {
        showNotification(
          "warning",
          provider === "ely"
            ? tt("platform.toast.signInElyThenLink")
            : tt("platform.toast.signInMicrosoftThenLink"),
        );
        return;
      }

      await linkIdentity({
        provider,
        provider_uuid: normalizeProviderUuid(uuid),
        provider_username:
          provider === "ely"
            ? fullProfile.ely_username ?? launcherProfile.ely_username
            : fullProfile.mc_username ?? null,
        provider_access_token: providerAccessToken,
        provider_client_token:
          provider === "ely" ? fullProfile.ely_client_token?.trim() || null : null,
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

  const inputClassName =
    "glass-control h-12 w-full rounded-2xl border px-4 text-[1rem] text-white outline-none transition placeholder:text-white/30";

  if (!accessToken) {
    return (
      <div
        data-tour-id="tour-platform-register"
        className="mx-auto flex w-full max-w-lg flex-col gap-6 px-1 py-2"
      >
        <div className="min-h-[3.25rem] text-center">
          <h2 className="text-xl font-semibold tracking-tight text-white">
            {tt("platform.accountTitle")}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-white/50">
            {resetStep
              ? tt("platform.reset.authHint")
              : mode === "signup"
                ? tt("platform.authHintSignup")
                : tt("platform.authHintLogin")}
          </p>
        </div>

        {resetStep ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void (resetStep === "request" ? handleRequestPasswordReset() : handleConfirmPasswordReset());
            }}
          >
            <div className="rounded-2xl border border-accent-to/25 bg-accent-from/10 px-5 py-6 shadow-inner">
              <h3 className="text-center text-lg font-semibold text-white">{tt("platform.reset.title")}</h3>
              <p className="mt-2 text-center text-sm leading-relaxed text-white/65">
                {resetStep === "request"
                  ? tt("platform.reset.requestHint")
                  : tt("platform.reset.confirmHint", { email: resetEmail.trim() })}
              </p>
              {resetStep === "confirm" ? (
                <p className="mt-1 text-center text-xs text-white/45">{tt("platform.emailSpamHint")}</p>
              ) : null}

              {resetStep === "request" ? (
                <label className="mt-5 flex flex-col gap-2 text-[0.8125rem] font-semibold text-white/45">
                  {tt("platform.emailLabel")}
                  <div className="relative">
                    <input
                      type="email"
                      autoFocus
                      autoComplete="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className={`${inputClassName} ${resetEmail ? "pr-10" : ""}`}
                      placeholder={tt("platform.enterEmail")}
                    />
                    <InputClearButton
                      value={resetEmail}
                      onClear={() => setResetEmail("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      aria-label={tt("common.clear")}
                    />
                  </div>
                </label>
              ) : (
                <div className="mt-5 flex flex-col gap-4">
                  <label className="flex flex-col gap-2 text-[0.8125rem] font-semibold text-white/45">
                    {tt("platform.verificationCodeLabel")}
                    <input
                      ref={resetCodeInputRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="h-14 w-full rounded-2xl border border-accent-to/30 bg-ink-950/70 px-3 text-center text-2xl font-semibold tracking-[0.55em] text-white outline-none transition focus:bg-black/55"
                      placeholder="••••••"
                      maxLength={6}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-[0.8125rem] font-semibold text-white/45">
                    {tt("platform.reset.newPasswordLabel")}
                    <PasswordInput
                      value={resetNewPassword}
                      onChange={setResetNewPassword}
                      visible={showResetPassword}
                      onToggleVisible={() => setShowResetPassword((prev) => !prev)}
                      placeholder={tt("platform.reset.newPasswordPlaceholder")}
                      autoComplete="new-password"
                      showLabel={tt("platform.showPassword")}
                      hideLabel={tt("platform.hidePassword")}
                      clearLabel={tt("common.clear")}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={resetBusy}
                    onClick={() => void handleRequestPasswordReset()}
                    className="interactive-press self-center text-sm font-semibold text-accent-hi/90 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
                  >
                    {tt("platform.resendVerificationCode")}
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                disabled={resetBusy}
                onClick={() => (resetStep === "confirm" ? setResetStep("request") : closePasswordReset())}
                className="btn btn-soft btn-lg h-12 flex-1 rounded-2xl"
              >
                {tt("platform.back")}
              </button>
              <button
                type="submit"
                disabled={resetBusy || (resetStep === "confirm" && resetCode.length !== 6)}
                className="btn btn-accent btn-lg h-12 flex-[1.5] rounded-2xl"
              >
                {resetBusy
                  ? tt("common.loading")
                  : resetStep === "request"
                    ? tt("platform.sendVerificationCode")
                    : tt("platform.reset.submit")}
              </button>
            </div>
          </form>
        ) : mode === "signup" && signupStep === "verify" ? (
          <div className="flex flex-col gap-5">
            <div className="rounded-2xl border border-accent-to/25 bg-accent-from/10 px-5 py-7 text-center shadow-inner">
              <p className="text-[0.75rem] font-bold text-accent-hi/70">
                {tt("platform.verificationStepLabel")}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                {tt("platform.verificationTitle")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                {tt("platform.verificationHint", { email: authIdentifier.trim() })}
              </p>
              <p className="mt-1 text-xs text-white/45">{tt("platform.emailSpamHint")}</p>

              <div className="mx-auto mt-6 max-w-[300px]">
                <label className="sr-only" htmlFor="signup-verification-code">
                  {tt("platform.verificationCodeLabel")}
                </label>
                <div className="relative">
                  <input
                    id="signup-verification-code"
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={verificationCode}
                    onChange={(e) =>
                      setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && verificationCode.length === 6) {
                        void handleAuth();
                      }
                    }}
                    className={`h-14 w-full rounded-2xl border border-accent-to/30 bg-ink-950/70 px-3 text-center text-2xl font-semibold tracking-[0.55em] text-white outline-none transition focus:bg-black/55 ${
                      verificationCode ? "pr-10" : ""
                    }`}
                    placeholder="••••••"
                    maxLength={6}
                  />
                  <InputClearButton
                    value={verificationCode}
                    onClear={() => setVerificationCode("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    aria-label={tt("common.clear")}
                  />
                </div>
                <div className="mt-3 flex justify-center gap-1.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-7 rounded-full transition ${
                        verificationCode.length > i ? "bg-emerald-400" : "bg-white/15"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={loading || sendingCode}
                onClick={() => void handleSendVerificationCode()}
                className="interactive-press mt-5 text-sm font-semibold text-accent-hi/90 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
              >
                {sendingCode
                  ? tt("common.loading")
                  : codeSent
                    ? tt("platform.resendVerificationCode")
                    : tt("platform.sendVerificationCode")}
              </button>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                disabled={loading || sendingCode}
                onClick={() => {
                  setSignupStep("form");
                  setVerificationCode("");
                }}
                className="interactive-press h-12 flex-1 rounded-2xl border border-white/15 bg-black/30 px-4 text-sm font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
              >
                {tt("platform.back")}
              </button>
              <button
                type="button"
                disabled={loading || sendingCode || verificationCode.length !== 6}
                onClick={() => void handleAuth()}
                className="interactive-press h-12 flex-[1.5] rounded-2xl bg-[#2d7d46] px-4 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60"
              >
                {loading ? tt("common.loading") : tt("platform.createAccount")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div
              ref={modeTabsRef}
              role="tablist"
              aria-label={tt("platform.accountTitle")}
              className="seg-track relative grid h-11 grid-cols-2 items-center overflow-hidden p-1"
            >
              <div
                className="pointer-events-none absolute top-1 bottom-1 rounded-md seg-indicator transition-all duration-200 ease-out"
                style={{
                  left: `${modeTabIndicator.left}px`,
                  width: `${modeTabIndicator.width}px`,
                  opacity: modeTabIndicator.width > 0 ? 1 : 0,
                }}
              />
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                disabled={loading || sendingCode}
                ref={(el) => {
                  modeTabButtonRefs.current.login = el;
                }}
                onClick={() => {
                  setMode("login");
                  setSignupStep("form");
                }}
                className={`interactive-press relative z-10 h-full rounded-xl text-sm font-semibold transition-colors ${
                  mode === "login" ? "text-white" : "text-white/70 hover:text-white"
                }`}
              >
                {tt("platform.signIn")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                disabled={loading || sendingCode}
                ref={(el) => {
                  modeTabButtonRefs.current.signup = el;
                }}
                onClick={() => {
                  setMode("signup");
                  setSignupStep("form");
                }}
                className={`interactive-press relative z-10 h-full rounded-xl text-sm font-semibold transition-colors ${
                  mode === "signup" ? "text-white" : "text-white/70 hover:text-white"
                }`}
              >
                {tt("platform.signUp")}
              </button>
            </div>

            <div className="flex flex-col">
              <label className="flex flex-col gap-2 text-[0.8125rem] font-semibold text-white/45">
                {mode === "signup" ? tt("platform.emailLabel") : tt("platform.emailOrNicknameLabel")}
                <div className="relative">
                  <input
                    type="text"
                    value={authIdentifier}
                    onChange={(e) => setAuthIdentifier(e.target.value)}
                    className={`${inputClassName} ${authIdentifier ? "pr-10" : ""}`}
                    placeholder={
                      mode === "signup" ? tt("platform.enterEmail") : tt("platform.enterNicknameOrEmail")
                    }
                  />
                  <InputClearButton
                    value={authIdentifier}
                    onClear={() => setAuthIdentifier("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    aria-label={tt("common.clear")}
                  />
                </div>
                <span
                  className={`text-[0.8125rem] font-normal normal-case tracking-normal text-white/45 transition-opacity duration-200 ${
                    mode === "signup" && emailVerificationRequired
                      ? "opacity-100"
                      : "pointer-events-none h-0 overflow-hidden opacity-0"
                  }`}
                  aria-hidden={!(mode === "signup" && emailVerificationRequired)}
                >
                  {tt("platform.emailSpamHint")}
                </span>
              </label>

              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                  mode === "signup" ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <label
                    className={`mt-5 flex flex-col gap-2 text-[0.8125rem] font-semibold text-white/45 transition-opacity duration-200 ${
                      mode === "signup" ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    {tt("platform.nicknameLabel")}
                    <div className="relative">
                      <input
                        type="text"
                        value={signupNickname}
                        onChange={(e) => setSignupNickname(e.target.value)}
                        tabIndex={mode === "signup" ? 0 : -1}
                        className={`${inputClassName} ${signupNickname ? "pr-10" : ""}`}
                        placeholder={tt("platform.enterNickname")}
                      />
                      <InputClearButton
                        value={signupNickname}
                        onClear={() => setSignupNickname("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        aria-label={tt("common.clear")}
                      />
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <label className="flex flex-col gap-2 text-[0.8125rem] font-semibold text-white/45">
              {tt("platform.passwordLabel")}
              <div className="relative flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && mode === "login") {
                      void handleAuth();
                    }
                  }}
                  className={`${inputClassName} ${authPassword ? "pr-[4.75rem]" : "pr-12"}`}
                  placeholder={tt("platform.passwordPlaceholder")}
                />
                <InputClearButton
                  value={authPassword}
                  onClear={() => setAuthPassword("")}
                  className="absolute right-11 top-1/2 -translate-y-1/2"
                  aria-label={tt("common.clear")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="interactive-press absolute inset-y-0 right-2 my-auto flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10"
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
            {mode === "login" && emailVerificationRequired ? (
              <button
                type="button"
                disabled={loading}
                onClick={openPasswordReset}
                className="interactive-press -mt-3 self-end text-[0.8125rem] font-semibold text-accent-hi/85 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
              >
                {tt("platform.reset.forgotLink")}
              </button>
            ) : null}

            <div className="relative min-h-[3.25rem]">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl px-2 py-1.5 text-sm leading-relaxed transition-all duration-200 ${
                  mode === "signup"
                    ? "relative z-10 opacity-100"
                    : "pointer-events-none absolute inset-0 opacity-0"
                } ${
                  privacyHighlight
                    ? "bg-warn/15 text-warn-fg ring-2 ring-warn-line/70"
                    : "text-white/65"
                }`}
              >
                <input
                  ref={privacyCheckboxRef}
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => {
                    setPrivacyAccepted(e.target.checked);
                    if (e.target.checked) setPrivacyHighlight(false);
                  }}
                  tabIndex={mode === "signup" ? 0 : -1}
                  className={`accent-checkbox mt-0.5 h-4 w-4 shrink-0 transition ${
                    privacyHighlight ? "outline outline-2 outline-offset-2 outline-warn-line" : ""
                  }`}
                />
                <span>
                  <PrivacyInlineText language={language} messageKey="platform.privacyConsent" />
                </span>
              </label>
              <div
                className={`flex flex-col gap-1 transition-opacity duration-200 ${
                  mode === "login"
                    ? "relative z-10 opacity-100"
                    : "pointer-events-none absolute inset-0 opacity-0"
                }`}
              >
                <p className="text-xs leading-relaxed text-white/45">
                  <PrivacyInlineText language={language} messageKey="platform.privacyLoginNotice" />
                </p>
                {emailVerificationRequired ? (
                  <p className="text-xs leading-relaxed text-white/45">{tt("platform.emailSpamHint")}</p>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              disabled={loading || sendingCode}
              onClick={() => {
                if (mode === "signup") {
                  if (!privacyAccepted) {
                    highlightPrivacyConsent();
                    showNotification("warning", tt("platform.toast.acceptPrivacy"));
                    return;
                  }
                  void handleSignupNext();
                } else {
                  void handleAuth();
                }
              }}
              className="interactive-press mt-1 h-12 w-full rounded-2xl bg-[#2d7d46] px-4 text-[1rem] font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60"
            >
              {loading || sendingCode
                ? tt("common.loading")
                : mode === "login"
                  ? tt("platform.signIn")
                  : emailVerificationRequired
                    ? tt("platform.next")
                    : tt("platform.createAccount")}
            </button>

            {discordEnabled ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-xs font-medium lowercase tracking-wide text-white/40">
                    {tt("platform.orDivider")}
                  </span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
                <button
                  type="button"
                  disabled={loading || sendingCode || discordBusy}
                  onClick={() => void handleDiscordAuth()}
                  className="interactive-press flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-[#5865F2]/40 bg-[#5865F2]/18 px-4 text-[1rem] font-semibold text-[#d7dbff] transition hover:bg-[#5865F2]/28 disabled:opacity-60"
                >
                  <img
                    src="/launcher-assets/ds.png"
                    alt=""
                    className="h-5 w-5 object-contain"
                    aria-hidden="true"
                  />
                  {discordBusy ? tt("common.loading") : tt("platform.continueWithDiscord")}
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const nicknameUnchanged = nicknameDraft.trim() === (platformUser?.nickname ?? "").trim();
  const busy = loading || linking !== null || providerLoginBusy;
  const isMinecraftLinked = linkedProviders.minecraft || linkedIdentity.minecraft;
  const isElyLinked = linkedProviders.ely || Boolean(linkedIdentity.ely);
  const elyLinkedName = linkedIdentity.ely || (linkedProviders.ely ? launcherProfile.ely_username : null);

  return (
    <div data-tour-id="tour-platform-register" className="mx-auto grid w-full max-w-4xl gap-4 lg:grid-cols-2">
      <section className="glass-panel px-5 py-5 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-white/45">{tt("platform.accountTitle")}</p>
            <NicknameWithSponsor
              nickname={launcherNickname || "—"}
              isSponsor={platformUser?.is_sponsor}
              sponsorTitle={tt("common.sponsor")}
              className="mt-1 truncate text-lg font-semibold text-white"
              as="p"
            />
            <p className="mt-0.5 truncate text-sm text-white/45">{platformUser?.email?.trim() || "—"}</p>
          </div>
          <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[0.75rem] font-semibold text-emerald-100">
            {tt("platform.settings.online")}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[0.75rem] font-bold text-white/45">{tt("platform.launcherNickname")}</p>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleChangeNickname();
              }}
            >
              <div className="relative min-w-0 flex-1">
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
                  className={`h-10 w-full glass-control rounded-xl px-3 text-sm text-white outline-none ${
                    nicknameDraft ? "pr-9" : ""
                  }`}
                  placeholder={tt("platform.newNicknamePlaceholder")}
                />
                <InputClearButton
                  value={nicknameDraft}
                  onClear={() => setNicknameDraft("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  aria-label={tt("common.clear")}
                />
              </div>
              <button
                type="submit"
                disabled={busy || nicknameUnchanged}
                className="interactive-press rounded-xl border border-accent-to/40 bg-accent-from/20 px-4 py-2 text-sm font-semibold text-accent-hi hover:bg-accent-from/30 disabled:opacity-50"
              >
                {tt("common.save")}
              </button>
            </form>
            <p className="mt-2 text-[0.75rem] text-white/40">{tt("platform.settings.nicknameHint")}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[0.75rem] font-bold text-white/45">{tt("platform.inGameNickname")}</p>
            <p className="mt-2 flex h-10 items-center truncate text-sm font-semibold text-white/90">
              {gameNickname || "—"}
            </p>
            <p className="mt-2 text-[0.75rem] text-white/40">{tt("platform.settings.gameNicknameHint")}</p>
          </div>
        </div>
      </section>

      <section className="glass-panel flex flex-col gap-3 px-5 py-5">
        <div>
          <p className="text-xs font-bold text-white/45">{tt("platform.settings.linkedTitle")}</p>
          <p className="mt-1 text-[0.8125rem] text-white/40">{tt("platform.settings.linkedHint")}</p>
        </div>
        <ProviderRow
          icon={<MicrosoftIcon className="h-5 w-5" />}
          name="Microsoft"
          status={isMinecraftLinked ? tt("platform.linked") : tt("platform.settings.notLinked")}
          linked={isMinecraftLinked}
          linking={linking === "minecraft"}
          disabled={busy}
          linkLabel={tt("platform.link")}
          linkingLabel={tt("platform.linking")}
          title={!launcherProfile.mc_uuid ? tt("platform.linkMicrosoftTitle") : undefined}
          onLink={() => void handleLink("minecraft")}
        />
        <ProviderRow
          icon={<ElyByIcon className="h-5 w-5 text-[0.8125rem]" />}
          name="Ely.by"
          status={
            isElyLinked
              ? elyLinkedName
                ? tt("platform.settings.linkedAs", { name: elyLinkedName })
                : tt("platform.linked")
              : tt("platform.settings.notLinked")
          }
          linked={isElyLinked}
          linking={linking === "ely"}
          disabled={busy}
          linkLabel={tt("platform.link")}
          linkingLabel={tt("platform.linking")}
          title={!launcherProfile.ely_uuid ? tt("platform.linkElyTitle") : undefined}
          onLink={() => void handleLink("ely")}
        />
      </section>

      <section className="glass-panel flex flex-col gap-3 px-5 py-5">
        <div>
          <p className="text-xs font-bold text-white/45">{tt("platform.settings.sessionTitle")}</p>
          <p className="mt-1 text-[0.8125rem] text-white/40">{tt("platform.settings.sessionHint")}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleLogout()}
          className="interactive-press self-start rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
        >
          {tt("platform.logout")}
        </button>

        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
          <p className="text-[0.75rem] font-bold text-white/45">{tt("platform.changePassword.title")}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">{tt("platform.changePassword.hint")}</p>
          {!changePasswordOpen ? (
            <button
              type="button"
              disabled={busy || changingPassword}
              onClick={() => setChangePasswordOpen(true)}
              className="btn btn-tint btn-sm mt-3"
            >
              {tt("platform.changePassword.open")}
            </button>
          ) : (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleChangePassword();
              }}
            >
              <PasswordInput
                size="sm"
                autoFocus
                value={currentPassword}
                onChange={setCurrentPassword}
                visible={showChangePasswords}
                onToggleVisible={() => setShowChangePasswords((prev) => !prev)}
                placeholder={tt("platform.changePassword.currentPlaceholder")}
                autoComplete="current-password"
                showLabel={tt("platform.showPassword")}
                hideLabel={tt("platform.hidePassword")}
                clearLabel={tt("common.clear")}
              />
              <PasswordInput
                size="sm"
                value={newPassword}
                onChange={setNewPassword}
                visible={showChangePasswords}
                onToggleVisible={() => setShowChangePasswords((prev) => !prev)}
                placeholder={tt("platform.reset.newPasswordPlaceholder")}
                autoComplete="new-password"
                showLabel={tt("platform.showPassword")}
                hideLabel={tt("platform.hidePassword")}
                clearLabel={tt("common.clear")}
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="submit" disabled={changingPassword || loading} className="btn btn-accent btn-sm">
                  {changingPassword ? tt("common.loading") : tt("common.save")}
                </button>
                <button
                  type="button"
                  disabled={changingPassword}
                  onClick={closeChangePassword}
                  className="btn btn-ghost btn-sm"
                >
                  {tt("platform.back")}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-auto rounded-xl border border-danger/25 bg-danger/[0.06] px-3 py-3">
          <p className="text-[0.75rem] font-bold text-danger-fg/70">{tt("platform.dangerZone")}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">{tt("platform.deleteAccountHint")}</p>
          {!deleteOpen ? (
            <button
              type="button"
              disabled={busy || deletingAccount}
              onClick={() => setDeleteOpen(true)}
              className="interactive-press mt-3 rounded-xl border border-danger/35 bg-danger-strong/15 px-4 py-2 text-sm font-semibold text-danger-fg hover:bg-danger-strong/25 disabled:opacity-60"
            >
              {tt("platform.deleteAccount")}
            </button>
          ) : (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
            >
              <div className="relative flex items-center">
                <input
                  type={showDeletePassword ? "text" : "password"}
                  autoFocus
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className={`h-10 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white outline-none focus:border-danger-line/40 ${
                    deletePassword ? "pr-[4.5rem]" : "pr-11"
                  }`}
                  placeholder={tt("platform.passwordPlaceholder")}
                  autoComplete="current-password"
                />
                <InputClearButton
                  value={deletePassword}
                  onClear={() => setDeletePassword("")}
                  className="absolute right-10 top-1/2 -translate-y-1/2"
                  aria-label={tt("common.clear")}
                />
                <button
                  type="button"
                  onClick={() => setShowDeletePassword((prev) => !prev)}
                  className="interactive-press absolute inset-y-0 right-2 my-auto flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10"
                  aria-label={showDeletePassword ? tt("platform.hidePassword") : tt("platform.showPassword")}
                >
                  <img
                    src={showDeletePassword ? "/launcher-assets/hide.png" : "/launcher-assets/show.png"}
                    alt=""
                    className="h-4 w-4 object-contain opacity-80"
                  />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={deletingAccount || loading}
                  className="interactive-press rounded-xl bg-danger-strong px-4 py-2 text-sm font-semibold text-white hover:bg-danger disabled:opacity-60"
                >
                  {deletingAccount ? tt("common.loading") : tt("platform.deleteAccountConfirm")}
                </button>
                <button
                  type="button"
                  disabled={deletingAccount}
                  onClick={() => {
                    setDeleteOpen(false);
                    setDeletePassword("");
                  }}
                  className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
                >
                  {tt("platform.back")}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  visible,
  onToggleVisible,
  placeholder,
  autoComplete,
  autoFocus,
  showLabel,
  hideLabel,
  clearLabel,
  size = "lg",
}: {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  showLabel: string;
  hideLabel: string;
  clearLabel: string;
  size?: "sm" | "lg";
}) {
  const sizeClassName =
    size === "lg" ? "h-12 rounded-2xl px-4 text-[1rem]" : "h-10 rounded-xl px-3 text-sm";
  return (
    <div className="relative flex items-center">
      <input
        type={visible ? "text" : "password"}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`glass-control w-full border text-white outline-none transition placeholder:text-white/30 ${sizeClassName} ${
          value ? "pr-[4.75rem]" : "pr-12"
        }`}
        placeholder={placeholder}
      />
      <InputClearButton
        value={value}
        onClear={() => onChange("")}
        className="absolute right-11 top-1/2 -translate-y-1/2"
        aria-label={clearLabel}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        className="interactive-press absolute inset-y-0 right-2 my-auto flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10"
        aria-label={visible ? hideLabel : showLabel}
      >
        <img
          src={visible ? "/launcher-assets/hide.png" : "/launcher-assets/show.png"}
          alt=""
          className="h-4 w-4 object-contain opacity-80"
        />
      </button>
    </div>
  );
}

function ProviderRow({
  icon,
  name,
  status,
  linked,
  linking,
  disabled,
  linkLabel,
  linkingLabel,
  title,
  onLink,
}: {
  icon: ReactNode;
  name: string;
  status: string;
  linked: boolean;
  linking: boolean;
  disabled: boolean;
  linkLabel: string;
  linkingLabel: string;
  title?: string;
  onLink: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white/90">{name}</p>
        <p className={`truncate text-[0.75rem] ${linked ? "text-emerald-300/85" : "text-white/45"}`}>{status}</p>
      </div>
      {linked ? null : (
        <button
          type="button"
          disabled={disabled}
          onClick={onLink}
          title={title}
          className="interactive-press shrink-0 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
        >
          {linking ? linkingLabel : linkLabel}
        </button>
      )}
    </div>
  );
}
