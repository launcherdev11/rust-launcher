import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { API_AUTH_CHANGED_EVENT, API_NICKNAME_KEY } from "../api/auth";
import type { Language } from "../i18n";
import type { ProfileAvatarInput } from "../lib/avatar";
import type { NotificationKind } from "../app/notifications";
import {
  NECO_ARC_SECRET_SOUND_SRC,
  NECO_ARC_SECRET_SOUND_VOLUME,
  normalizeNicknameForSecretCheck,
} from "../app/accountHelpers";
import type { LauncherAccountSummary, Profile, SidebarItemId, Tt } from "../app/types";

type UseLauncherAccountsOptions = {
  activeItem: SidebarItemId;
  language: Language;
  showNotification: (kind: NotificationKind, message: string) => void;
  tt: Tt;
};

export function useLauncherAccounts({
  activeItem,
  language,
  showNotification,
  tt,
}: UseLauncherAccountsOptions) {
  const [profile, setProfile] = useState<Profile>({
    nickname: "",
    ely_username: null,
    ely_uuid: null,
    ms_id_token: null,
    mc_uuid: null,
    mc_username: null,
  });
  const [elyLoading, setElyLoading] = useState(false);
  const [elyAuthUrl, setElyAuthUrl] = useState<string | null>(null);
  const [msLoading, setMsLoading] = useState(false);
  const [msAuthUrl, setMsAuthUrl] = useState<string | null>(null);
  const [launcherAccounts, setLauncherAccounts] = useState<LauncherAccountSummary[]>([]);
  const [addingAccount, setAddingAccount] = useState(false);
  const [pendingRemoveAccountId, setPendingRemoveAccountId] = useState<string | null>(null);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const accountSwitcherRef = useRef<HTMLDivElement | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const nicknameInputFocusedRef = useRef(false);
  const prevActiveAccountIdRef = useRef<string | null>(null);
  const prevActiveItemRef = useRef<SidebarItemId>(activeItem);
  const lastPersistedNickNormRef = useRef<string | null>(null);

  const refreshLauncherAccounts = useCallback(async () => {
    try {
      const list = await invoke<LauncherAccountSummary[]>("list_launcher_accounts");
      setLauncherAccounts(list);
    } catch {
      setLauncherAccounts([]);
    }
  }, []);

  useEffect(() => {
    void refreshLauncherAccounts();
  }, [refreshLauncherAccounts]);

  useEffect(() => {
    if (!accountSwitcherOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = accountSwitcherRef.current;
      if (el && !el.contains(e.target as Node)) setAccountSwitcherOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [accountSwitcherOpen]);

  const accountKindShortLabel = useCallback(
    (kind: string) => {
      if (kind === "microsoft") return tt("app.accounts.kindMicrosoft");
      if (kind === "ely") return tt("app.accounts.kindEly");
      return tt("app.accounts.kindOffline");
    },
    [tt],
  );

  const isAuthorized = !!profile.ely_username?.trim() || !!profile.mc_username?.trim();
  const displayedNickname =
    profile.ely_username?.trim() ||
    profile.mc_username?.trim() ||
    profile.nickname.trim() ||
    "";
  const activeAccountFromList = launcherAccounts.find((a) => a.is_active);
  const activeAccountId = activeAccountFromList?.id ?? null;
  const activeAccountLabel =
    activeAccountFromList?.label ?? (displayedNickname.trim() || "—");

  useEffect(() => {
    const accountChanged = prevActiveAccountIdRef.current !== activeAccountId;
    prevActiveAccountIdRef.current = activeAccountId;
    if (accountChanged || !nicknameInputFocusedRef.current) {
      setNicknameDraft(profile.nickname);
      if (accountChanged) nicknameInputFocusedRef.current = false;
    }
  }, [profile.nickname, activeAccountId]);
  const activeAccountKind = activeAccountFromList?.kind ?? "offline";

  const [platformNickname, setPlatformNickname] = useState(() => {
    try {
      return window.localStorage.getItem(API_NICKNAME_KEY)?.trim() ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    const sync = () => {
      try {
        setPlatformNickname(window.localStorage.getItem(API_NICKNAME_KEY)?.trim() ?? "");
      } catch {
        setPlatformNickname("");
      }
    };
    window.addEventListener(API_AUTH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(API_AUTH_CHANGED_EVENT, sync);
  }, []);

  const profileAvatarInput = useMemo<ProfileAvatarInput>(
    () => ({
      nickname: profile.nickname,
      ely_username: profile.ely_username,
      ely_uuid: profile.ely_uuid,
      mc_uuid: profile.mc_uuid,
    }),
    [profile.nickname, profile.ely_username, profile.ely_uuid, profile.mc_uuid],
  );

  const maybePlayNecoArcSecret = useCallback((trimmedNickname: string) => {
    const norm = normalizeNicknameForSecretCheck(trimmedNickname);
    const prev = lastPersistedNickNormRef.current;
    lastPersistedNickNormRef.current = norm;
    if (norm !== "neco arc" || prev === "neco arc") return;
    try {
      const audio = new Audio(NECO_ARC_SECRET_SOUND_SRC);
      audio.volume = Math.min(1, Math.max(0, NECO_ARC_SECRET_SOUND_VOLUME));
      void audio.play().catch(() => {});
    } catch {
      //ignore
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const p = await invoke<Profile & { mc_username?: string | null }>("get_profile");
      const nick = p.nickname ?? "";
      setProfile({
        nickname: nick,
        ely_username: p.ely_username ?? null,
        ely_uuid: p.ely_uuid ?? null,
        ms_id_token: p.ms_id_token ?? null,
        mc_uuid: p.mc_uuid ?? null,
        mc_username: p.mc_username ?? null,
      });
      lastPersistedNickNormRef.current = normalizeNicknameForSecretCheck(nick);
    } catch {
      setProfile({
        nickname: "",
        ely_username: null,
        ely_uuid: null,
        ms_id_token: null,
        mc_uuid: null,
        mc_username: null,
      });
      lastPersistedNickNormRef.current = "";
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen("active-account-changed", () => {
      void loadProfile();
      void refreshLauncherAccounts();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadProfile, refreshLauncherAccounts]);

  useEffect(() => {
    if (activeItem === "accounts") {
      loadProfile();
      void refreshLauncherAccounts();
    }
  }, [activeItem, loadProfile, refreshLauncherAccounts]);

  useEffect(() => {
    const prev = prevActiveItemRef.current;
    prevActiveItemRef.current = activeItem;
    const trimmed = profile.nickname.trim();
    if (prev === "accounts" && activeItem !== "accounts" && trimmed) {
      invoke("set_profile", { nickname: trimmed })
        .then(() => maybePlayNecoArcSecret(trimmed))
        .catch(console.error);
    }
  }, [activeItem, profile.nickname, maybePlayNecoArcSecret]);

  useEffect(() => {
    if (isAuthorized) return;
    const t = setTimeout(() => {
      const nick = nicknameDraft.trim();
      if (!nick) return;
      void invoke("set_profile", { nickname: nick })
        .then(() => maybePlayNecoArcSecret(nick))
        .catch(console.error);
    }, 700);
    return () => clearTimeout(t);
  }, [nicknameDraft, isAuthorized, maybePlayNecoArcSecret]);

  const handleSaveNickname = async (nickname: string) => {
    try {
      await invoke("set_profile", { nickname });
      setProfile((prev) => ({ ...prev, nickname }));
      maybePlayNecoArcSecret(nickname);
      showNotification(
        "success",
        tt("app.accounts.toast.nicknameSaved"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("app.accounts.toast.nicknameSaveFailed"),
      );
    }
  };

  const handleElyLogin = async () => {
    setElyLoading(true);
    setElyAuthUrl(null);
    let unlistenOk: (() => void) | undefined;
    let unlistenFail: (() => void) | undefined;
    const cleanupElyListeners = () => {
      unlistenOk?.();
      unlistenFail?.();
    };
    try {
      unlistenOk = await listen<Profile & { mc_username?: string | null }>("ely-login-complete", (e) => {
        const p = e.payload;
        setProfile({
          nickname: p.nickname ?? "",
          ely_username: p.ely_username ?? null,
          ely_uuid: p.ely_uuid ?? null,
          ms_id_token: p.ms_id_token ?? null,
          mc_uuid: p.mc_uuid ?? null,
          mc_username: p.mc_username ?? null,
        });
        void refreshLauncherAccounts();
        setElyLoading(false);
        setElyAuthUrl(null);
        cleanupElyListeners();
      });

      unlistenFail = await listen<string>("ely-login-failed", (e) => {
        showNotification("error", e.payload);
        setElyLoading(false);
        setElyAuthUrl(null);
        cleanupElyListeners();
      });

      const url = await invoke<string>("start_ely_oauth");
      setElyAuthUrl(url);
      try {
        await openUrl(url);
      } catch (e) {
        console.error("Не удалось открыть браузер для Ely.by OAuth:", e);
        cleanupElyListeners();
        setElyLoading(false);
        setElyAuthUrl(null);
        showNotification(
          "error",
          tt("app.accounts.toast.elyOpenBrowserFailed"),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", msg);
      cleanupElyListeners();
      setElyLoading(false);
      setElyAuthUrl(null);
    }
  };

  const handleElyLogout = async () => {
    try {
      await invoke("ely_logout");
      await loadProfile();
      void refreshLauncherAccounts();
      showNotification(
        "info",
        tt("app.accounts.toast.elyLoggedOut"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("app.accounts.toast.elyLogoutFailed"),
      );
    }
  };

  const handleMicrosoftLogin = async () => {
    if (msLoading) return;
    setMsLoading(true);
    setMsAuthUrl(null);

    let unlistenComplete: (() => void) | null = null;
    try {
      unlistenComplete = await listen("ms-login-complete", async () => {
        unlistenComplete?.();
        unlistenComplete = null;
        setMsLoading(false);
        setMsAuthUrl(null);
        await loadProfile();
        void refreshLauncherAccounts();
        showNotification("success", tt("app.accounts.toast.msLoggedIn"));
      });

      const url = await invoke<string>("start_ms_oauth", { language });
      setMsAuthUrl(url);
      try {
        await openUrl(url);
      } catch (e) {
        console.error("Не удалось открыть браузер для Microsoft OAuth:", e);
        unlistenComplete?.();
        unlistenComplete = null;
        setMsLoading(false);
        setMsAuthUrl(null);
        showNotification("error", tt("app.accounts.toast.msOpenBrowserFailed"));
      }
    } catch (e) {
      console.error(e);
      unlistenComplete?.();
      unlistenComplete = null;
      setMsLoading(false);
      setMsAuthUrl(null);
      showNotification("error", tt("app.accounts.toast.msLoginFailed"));
    }
  };

  const handleMicrosoftLogout = async () => {
    try {
      await invoke("ms_logout");
      await loadProfile();
      void refreshLauncherAccounts();
      showNotification(
        "info",
        tt("app.accounts.toast.msLoggedOut"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("app.accounts.toast.msLogoutFailed"),
      );
    }
  };

  const handleSwitchLauncherAccount = async (accountId: string) => {
    try {
      await invoke("switch_launcher_account", { accountId });
      await loadProfile();
      await refreshLauncherAccounts();
      setAccountSwitcherOpen(false);
      showNotification("success", tt("app.accounts.toast.switched"));
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    }
  };

  const requestRemoveLauncherAccount = (accountId: string) => {
    setAccountSwitcherOpen(false);
    setPendingRemoveAccountId(accountId);
  };

  const removeLauncherAccount = async (accountId: string) => {
    try {
      await invoke("remove_launcher_account", { accountId });
      await loadProfile();
      await refreshLauncherAccounts();
      setAccountSwitcherOpen(false);
      showNotification("info", tt("app.accounts.toast.removed"));
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    }
  };

  const confirmRemoveLauncherAccount = async () => {
    const accountId = pendingRemoveAccountId;
    if (!accountId) return;
    setPendingRemoveAccountId(null);
    await removeLauncherAccount(accountId);
  };

  const handleAddLauncherAccount = async () => {
    if (addingAccount) return;
    setAddingAccount(true);
    try {
      const nick = `${tt("app.accounts.newAccountNameBase")} ${launcherAccounts.length + 1}`;
      await invoke("add_launcher_account", { nickname: nick });
      await loadProfile();
      await refreshLauncherAccounts();
      setAccountSwitcherOpen(false);
      showNotification("success", tt("app.accounts.toast.added"));
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setAddingAccount(false);
    }
  };

  return {
    profile,
    setProfile,
    launcherAccounts,
    refreshLauncherAccounts,
    addingAccount,
    pendingRemoveAccountId,
    setPendingRemoveAccountId,
    accountSwitcherOpen,
    setAccountSwitcherOpen,
    accountSwitcherRef,
    nicknameDraft,
    setNicknameDraft,
    elyLoading,
    msLoading,
    elyAuthUrl,
    msAuthUrl,
    accountKindShortLabel,
    isAuthorized,
    displayedNickname,
    activeAccountId,
    activeAccountLabel,
    activeAccountKind,
    profileAvatarInput,
    platformNickname,
    loadProfile,
    handleSaveNickname,
    handleElyLogin,
    handleElyLogout,
    handleMicrosoftLogin,
    handleMicrosoftLogout,
    handleSwitchLauncherAccount,
    requestRemoveLauncherAccount,
    confirmRemoveLauncherAccount,
    removeLauncherAccount,
    handleAddLauncherAccount,
  };
}
