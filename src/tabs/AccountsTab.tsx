import { useEffect, useRef, useState } from "react";
import { AccountAvatar } from "../components/account_avatar";
import { AccountSkinPreview } from "../components/account_skin_preview";
import { DeleteIcon } from "../components/delete_icon";
import { InputClearButton } from "../components/ui";
import { useT, type Language } from "../i18n";
import type { ProfileAvatarInput } from "../lib/avatar";
import { PlatformAccountPanel } from "./PlatformAccountPanel";
import { AchievementsPanel } from "../components/AchievementsPanel";
import { PlatformNotificationsPanel } from "../components/PlatformNotificationsPanel";
import { API_AUTH_CHANGED_EVENT, API_NICKNAME_KEY, fetchMe } from "../api/auth";
import { NicknameWithSponsor } from "../components/SponsorBadge";
import { getStoredAccessToken } from "../api/client";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };
type SettingsSection = "accounts" | "platform" | "notifications";

export type LauncherAccountSummary = {
  id: string;
  label: string;
  kind: string;
  is_active: boolean;
};

export type LauncherProfile = {
  nickname: string;
  ely_username: string | null;
  ely_uuid: string | null;
  ms_id_token: string | null;
  mc_uuid: string | null;
  mc_username: string | null;
};

type AccountsTabProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
  profile: LauncherProfile;
  setProfile: React.Dispatch<React.SetStateAction<LauncherProfile>>;
  launcherAccounts: LauncherAccountSummary[];
  nicknameDraft: string;
  setNicknameDraft: (value: string) => void;
  isAuthorized: boolean;
  displayedNickname: string;
  profileAvatarInput: ProfileAvatarInput;
  activeAccountKind: string;
  activeAccountId: string | null;
  elyLoading: boolean;
  msLoading: boolean;
  elyAuthUrl: string | null;
  msAuthUrl: string | null;
  addingAccount: boolean;
  accountKindShortLabel: (kind: string) => string;
  onSaveNickname: (nickname: string) => Promise<void>;
  onMicrosoftLogin: () => void | Promise<void>;
  onMicrosoftLogout: () => void | Promise<void>;
  onElyLogin: () => void | Promise<void>;
  onElyLogout: () => void | Promise<void>;
  onSwitchAccount: (accountId: string) => Promise<void>;
  onRemoveAccount: (accountId: string) => Promise<void>;
  onAddAccount: () => Promise<void>;
  tourAccountsSection?: SettingsSection | null;
  tourForceSettingsOpen?: boolean;
};

function accountKindAvatarClass(kind: string): string {
  if (kind === "microsoft") return "bg-sky-600/35 text-sky-100 ring-1 ring-sky-400/25";
  if (kind === "ely") return "bg-emerald-700/40 text-emerald-100 ring-1 ring-emerald-400/20";
  return "bg-white/10 text-white/80 ring-1 ring-white/10";
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-current" aria-hidden="true">
      <path d="M16.84 2.73a2.5 2.5 0 0 1 3.54 3.54l-1.06 1.06-3.54-3.54 1.06-1.06ZM4.92 14.49l9.19-9.19 3.54 3.54-9.19 9.19-3.82.42.42-3.96Z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path fill="#f25022" d="M2 2h9.5v9.5H2V2z" />
      <path fill="#7fba00" d="M12.5 2H22v9.5h-9.5V2z" />
      <path fill="#00a4ef" d="M2 12.5H11.5V22H2v-9.5z" />
      <path fill="#ffb900" d="M12.5 12.5H22V22h-9.5v-9.5z" />
    </svg>
  );
}

function ElyByIcon() {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#2d7d46] text-[9px] font-bold text-white">
      E
    </span>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="currentColor" d="M11 5v6H5v2h6v6h2v-6h6v-2h-6V5h-2Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.77 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
    </svg>
  );
}

export function AccountsTab({
  showNotification,
  language,
  profile,
  setProfile,
  launcherAccounts,
  nicknameDraft,
  setNicknameDraft,
  isAuthorized,
  displayedNickname,
  profileAvatarInput,
  activeAccountKind,
  activeAccountId,
  elyLoading,
  msLoading,
  elyAuthUrl,
  msAuthUrl,
  addingAccount,
  accountKindShortLabel,
  onSaveNickname,
  onMicrosoftLogin,
  onMicrosoftLogout,
  onElyLogin,
  onElyLogout,
  onSwitchAccount,
  onRemoveAccount,
  onAddAccount,
  tourAccountsSection = null,
  tourForceSettingsOpen = false,
}: AccountsTabProps) {
  const tt = useT(language);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("platform");
  const [pendingRemoveAccountId, setPendingRemoveAccountId] = useState<string | null>(null);
  const [headerNicknameEditing, setHeaderNicknameEditing] = useState(false);
  const nicknameInputFocusedRef = useRef(false);
  const [systemNickname, setSystemNickname] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(API_NICKNAME_KEY)?.trim() || "";
  });
  const [systemIsSponsor, setSystemIsSponsor] = useState(false);

  useEffect(() => {
    if (!tourAccountsSection) return;
    setSettingsSection(tourAccountsSection);
  }, [tourAccountsSection]);

  useEffect(() => {
    if (tourForceSettingsOpen) setSettingsOpen(true);
  }, [tourForceSettingsOpen]);

  useEffect(() => {
    const syncSystemNickname = () => {
      const token = getStoredAccessToken();
      if (!token) {
        setSystemIsSponsor(false);
        setSystemNickname("");
        return;
      }
      const cached = window.localStorage.getItem(API_NICKNAME_KEY)?.trim() || "";
      if (cached) setSystemNickname(cached);
      void fetchMe(token)
        .then((me) => {
          setSystemNickname(me.nickname?.trim() || "");
          setSystemIsSponsor(!!me.is_sponsor);
          if (me.nickname) window.localStorage.setItem(API_NICKNAME_KEY, me.nickname);
        })
        .catch(() => {});
    };
    syncSystemNickname();
    window.addEventListener(API_AUTH_CHANGED_EVENT, syncSystemNickname);
    window.addEventListener("storage", syncSystemNickname);
    return () => {
      window.removeEventListener(API_AUTH_CHANGED_EVENT, syncSystemNickname);
      window.removeEventListener("storage", syncSystemNickname);
    };
  }, []);

  const openSettings = (section: SettingsSection = "platform") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  const confirmRemoveAccount = async () => {
    const accountId = pendingRemoveAccountId;
    if (!accountId) return;
    setPendingRemoveAccountId(null);
    await onRemoveAccount(accountId);
  };

  const handleHeaderNicknameBlur = async (value: string) => {
    nicknameInputFocusedRef.current = false;
    setHeaderNicknameEditing(false);
    if (isAuthorized) return;
    const trimmed = value.trim();
    const prevNick = profile.nickname.trim();
    setNicknameDraft(trimmed);
    setProfile((p) => ({ ...p, nickname: trimmed }));
    if (trimmed !== prevNick) await onSaveNickname(trimmed);
  };

  const offlineNickname = profile.nickname.trim();
  const gameNicknameDisplay =
    displayedNickname.trim() || tt("app.accounts.nicknamePlaceholder");

  const settingsTabs: { id: SettingsSection; label: string }[] = [
    { id: "platform", label: tt("app.accounts.settingsTabPlatform") },
    { id: "notifications", label: tt("app.accounts.settingsTabNotifications") },
  ];

  const providerBusy = elyLoading || msLoading;

  return (
    <>
      <div className="flex min-h-0 w-full max-w-none flex-1 flex-col gap-3 overflow-y-auto py-1 xl:gap-4 xl:overflow-hidden">
        <header className="glass-panel relative shrink-0 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.2),transparent_55%)]" />
          <div className="relative flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={() => openSettings("platform")}
              className="interactive-press relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-[#0f2744] shadow-lg transition hover:border-emerald-400/40 hover:bg-[#1e3a5f]"
              title={tt("app.accounts.accountSettingsTitle")}
            >
              <AccountAvatar
                username={displayedNickname}
                profile={profileAvatarInput}
                kind={activeAccountKind}
                size={56}
                className="h-full w-full rounded-2xl"
              />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {systemNickname ? (
                  <NicknameWithSponsor
                    nickname={systemNickname}
                    isSponsor={systemIsSponsor}
                    sponsorTitle={tt("common.sponsor")}
                    className="truncate text-lg font-semibold text-emerald-100/90"
                    as="p"
                  />
                ) : (
                  <p className="truncate text-lg text-white/40">
                    {tt("app.accounts.systemNicknameSignedOut")}
                  </p>
                )}
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                    activeAccountKind === "microsoft"
                      ? "bg-sky-500/25 text-sky-100"
                      : activeAccountKind === "ely"
                        ? "bg-[#2d7d46]/35 text-emerald-100"
                        : "bg-white/10 text-white/55"
                  }`}
                >
                  {accountKindShortLabel(activeAccountKind)}
                </span>
              </div>

              <div className="mt-1 flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/40">
                  {tt("platform.inGameNickname")}
                </span>
                {headerNicknameEditing && !isAuthorized ? (
                  <div className="relative min-w-0 flex-1">
                    <input
                      type="text"
                      autoFocus
                      value={nicknameDraft}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNicknameDraft(v);
                        setProfile((p) => ({ ...p, nickname: v }));
                      }}
                      onFocus={() => {
                        nicknameInputFocusedRef.current = true;
                      }}
                      onBlur={(e) => void handleHeaderNicknameBlur(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          setNicknameDraft(offlineNickname);
                          setProfile((p) => ({ ...p, nickname: offlineNickname }));
                          setHeaderNicknameEditing(false);
                        }
                      }}
                      className={`min-w-0 w-full bg-transparent text-sm font-semibold text-white placeholder:text-white/50 focus:outline-none ${
                        nicknameDraft ? "pr-7" : ""
                      }`}
                      placeholder={tt("app.accounts.nicknamePlaceholder")}
                    />
                    <InputClearButton
                      value={nicknameDraft}
                      onClear={() => {
                        setNicknameDraft("");
                        setProfile((p) => ({ ...p, nickname: "" }));
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2"
                      aria-label={tt("common.clear")}
                    />
                  </div>
                ) : (
                  <p className="truncate text-sm font-semibold text-white/90">{gameNicknameDisplay}</p>
                )}
                {!isAuthorized && !headerNicknameEditing ? (
                  <button
                    type="button"
                    onClick={() => setHeaderNicknameEditing(true)}
                    className="interactive-press rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
                    title={tt("app.accounts.editNickname")}
                  >
                    <PencilIcon />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={providerBusy}
                onClick={() => {
                  if (profile.ms_id_token) void onMicrosoftLogout();
                  else void onMicrosoftLogin();
                }}
                className={`interactive-press flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition disabled:opacity-60 ${
                  profile.ms_id_token
                    ? "border-sky-400/35 bg-sky-500/15 text-sky-50 hover:bg-sky-500/25"
                    : "border-white/10 bg-black/35 text-white/70 hover:bg-black/55 hover:text-white"
                }`}
                title={
                  profile.ms_id_token
                    ? tt("app.accounts.microsoftLogout")
                    : tt("app.accounts.microsoftSignIn")
                }
              >
                <MicrosoftIcon />
                <span className="hidden sm:inline">
                  {profile.ms_id_token ? tt("app.accounts.linkedShort") : "Microsoft"}
                </span>
              </button>
              <button
                type="button"
                disabled={providerBusy}
                onClick={() => {
                  if (profile.ely_username) void onElyLogout();
                  else void onElyLogin();
                }}
                className={`interactive-press flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition disabled:opacity-60 ${
                  profile.ely_username
                    ? "border-emerald-400/35 bg-[#2d7d46]/90 text-white hover:bg-[#248338]"
                    : "border-white/10 bg-black/35 text-white/70 hover:bg-black/55 hover:text-white"
                }`}
                title={
                  profile.ely_username ? tt("app.accounts.elyLogout") : tt("app.accounts.elyWaiting")
                }
              >
                <ElyByIcon />
                <span className="hidden sm:inline">
                  {profile.ely_username ? tt("app.accounts.linkedShort") : "Ely.by"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => openSettings("platform")}
                className="interactive-press flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/35 text-white/70 transition hover:bg-black/55 hover:text-white"
                title={tt("app.accounts.accountSettingsTitle")}
              >
                <GearIcon />
              </button>
            </div>
          </div>
        </header>

        {(elyAuthUrl || msAuthUrl) && (
          <div className="shrink-0 space-y-2">
            {elyAuthUrl ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left">
                <p className="mb-1.5 text-xs font-medium text-amber-200">
                  {tt("app.accounts.elyDialogTitle")}
                </p>
                <p className="break-all text-xs text-white/90">{elyAuthUrl}</p>
                <p className="mt-1.5 text-[11px] text-white/60">{tt("app.accounts.elyDialogTip")}</p>
              </div>
            ) : null}
            {msAuthUrl ? (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-left">
                <p className="mb-1.5 text-xs font-medium text-blue-200">
                  {tt("app.accounts.microsoftSignIn")}
                </p>
                <p className="break-all text-xs text-white/90">{msAuthUrl}</p>
              </div>
            ) : null}
          </div>
        )}

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(220px,280px)_minmax(0,1.15fr)_minmax(240px,1fr)] xl:items-stretch xl:overflow-hidden xl:gap-4">
          <aside className="glass-panel flex min-h-0 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3.5 py-3">
              <div className="min-w-0">
                <h2 className="text-xs font-bold uppercase tracking-wider text-white/45">
                  {tt("app.accounts.savedListTitle")}
                </h2>
                <p className="mt-0.5 truncate text-[11px] text-white/35">
                  {tt("app.accounts.savedListHintShort")}
                </p>
              </div>
              <button
                type="button"
                disabled={addingAccount}
                onClick={() => void onAddAccount()}
                className="interactive-press flex h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-600/20 px-2.5 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50"
                title={tt("app.accounts.addAccount")}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline xl:inline">{tt("app.accounts.addShort")}</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {launcherAccounts.length === 0 ? (
                <div className="px-2 py-8 text-center">
                  <p className="text-sm text-white/45">{tt("app.accounts.emptyList")}</p>
                  <button
                    type="button"
                    disabled={addingAccount}
                    onClick={() => void onAddAccount()}
                    className="interactive-press mt-3 rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50"
                  >
                    {tt("app.accounts.addAccount")}
                  </button>
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {launcherAccounts.map((acc) => (
                    <li key={acc.id}>
                      <div
                        className={`group flex items-center gap-2 rounded-xl border px-2 py-2 transition ${
                          acc.is_active
                            ? "border-emerald-400/35 bg-emerald-500/10"
                            : "border-transparent bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                        }`}
                      >
                        <AccountAvatar
                          username={acc.label}
                          profile={acc.is_active ? profileAvatarInput : undefined}
                          kind={acc.kind}
                          size={72}
                          className={`h-10 w-10 shrink-0 rounded-xl ${accountKindAvatarClass(acc.kind)}`}
                        />
                        <button
                          type="button"
                          disabled={acc.is_active}
                          onClick={() => {
                            if (!acc.is_active) void onSwitchAccount(acc.id);
                          }}
                          className="min-w-0 flex-1 rounded-lg text-left transition enabled:cursor-pointer enabled:active:scale-[0.99] disabled:cursor-default"
                        >
                          <span className="block truncate text-sm font-semibold text-white/95">
                            {acc.label}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                                acc.kind === "microsoft"
                                  ? "bg-sky-500/25 text-sky-100"
                                  : acc.kind === "ely"
                                    ? "bg-[#2d7d46]/35 text-emerald-100"
                                    : "bg-white/10 text-white/55"
                              }`}
                            >
                              {accountKindShortLabel(acc.kind)}
                            </span>
                            {acc.is_active ? (
                              <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-300/90">
                                {tt("app.accounts.activeBadge")}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingRemoveAccountId(acc.id)}
                          className="interactive-press shrink-0 rounded-lg p-2 text-white/25 opacity-70 transition hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                          title={tt("app.accounts.removeTitle")}
                        >
                          <DeleteIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!isAuthorized ? (
              <p className="shrink-0 border-t border-white/10 px-3.5 py-2.5 text-[11px] leading-snug text-white/45">
                {tt("app.accounts.hint")}
              </p>
            ) : null}
          </aside>

          <div className="flex min-h-[min(380px,48vh)] min-w-0 flex-col xl:min-h-0">
            <AccountSkinPreview
              key={`${activeAccountId ?? ""}:${profile.ely_username ?? ""}:${profile.mc_uuid ?? ""}:${profile.nickname}`}
              profile={profileAvatarInput}
              username={displayedNickname}
              showCapePicker={activeAccountKind === "microsoft" && !!profile.mc_uuid?.trim()}
              onSettingsClick={() => openSettings("platform")}
              settingsTitle={tt("app.accounts.accountSettingsTitle")}
              capePickerTitle={tt("app.accounts.cape.title")}
              capeNoneLabel={tt("app.accounts.cape.none")}
              capeEmptyHint={tt("app.accounts.cape.empty")}
              capeLoadingLabel={tt("app.accounts.cape.loading")}
              capeErrorHint={tt("app.accounts.cape.error")}
              skinByUsernameTitle={tt("app.accounts.skinByUsername.title")}
              skinByUsernamePlaceholder={tt("app.accounts.skinByUsername.placeholder")}
              skinByUsernameApply={tt("app.accounts.skinByUsername.apply")}
              skinByUsernameReset={tt("app.accounts.skinByUsername.reset")}
              skinByUsernameLoading={tt("app.accounts.skinByUsername.loading")}
              skinByUsernameError={tt("app.accounts.skinByUsername.error")}
              skinByUsernameNotFound={tt("app.accounts.skinByUsername.notFound")}
              skinUploadTitle={tt("app.accounts.skinUpload.title")}
              skinUploadPick={tt("app.accounts.skinUpload.pick")}
              skinUploadApply={tt("app.accounts.skinUpload.apply")}
              skinUploadLoading={tt("app.accounts.skinUpload.loading")}
              skinUploadError={tt("app.accounts.skinUpload.error")}
              skinModelStandard={tt("app.accounts.skinUpload.standard")}
              skinModelSlim={tt("app.accounts.skinUpload.slim")}
              skinLibraryTitle={tt("app.accounts.skinLibrary.title")}
              skinLibraryEmpty={tt("app.accounts.skinLibrary.empty")}
              skinLibraryLoading={tt("app.accounts.skinLibrary.loading")}
              skinLibraryError={tt("app.accounts.skinLibrary.error")}
              animationTitle={tt("app.accounts.animation.title")}
              animationLabels={{
                idle: tt("app.accounts.animation.idle"),
                walk: tt("app.accounts.animation.walk"),
                run: tt("app.accounts.animation.run"),
                wave: tt("app.accounts.animation.wave"),
                crouch: tt("app.accounts.animation.crouch"),
                fly: tt("app.accounts.animation.fly"),
                look: tt("app.accounts.animation.look"),
              }}
            />
          </div>

          <div className="flex min-h-[220px] min-w-0 flex-col xl:min-h-0 xl:overflow-hidden">
            <AchievementsPanel
              language={language}
              className="glass-panel flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
            />
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <div
          className="glass-overlay pointer-events-auto fixed inset-0 z-[340] flex items-center justify-center p-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="glass-modal pointer-events-auto flex max-h-[min(90vh,820px)] w-[min(96vw,44rem)] flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-settings-title"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <h2 id="account-settings-title" className="text-base font-semibold text-white/95">
                  {tt("app.accounts.accountSettingsTitle")}
                </h2>
                <p className="mt-0.5 text-xs text-white/45">{tt("app.accounts.settingsSubtitleShort")}</p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="interactive-press rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
                aria-label={tt("common.close")}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex shrink-0 gap-1 border-b border-white/10 px-3 pt-3">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSettingsSection(tab.id)}
                  className={`interactive-press rounded-t-xl px-3.5 py-2 text-xs font-semibold transition ${
                    settingsSection === tab.id
                      ? "bg-white/10 text-white"
                      : "text-white/45 hover:bg-white/5 hover:text-white/75"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {settingsSection === "accounts" || settingsSection === "platform" ? (
                <PlatformAccountPanel
                  showNotification={showNotification}
                  language={language}
                  launcherProfile={{
                    launcher_nickname: null,
                    offline_nickname: profile.nickname?.trim() || null,
                    ely_username: profile.ely_username,
                    microsoft_username: profile.mc_username,
                    ely_uuid: profile.ely_uuid,
                    mc_uuid: profile.mc_uuid,
                  }}
                  onMicrosoftLogin={onMicrosoftLogin}
                  onElyLogin={onElyLogin}
                  providerLoginBusy={providerBusy}
                />
              ) : null}

              {settingsSection === "notifications" ? (
                <PlatformNotificationsPanel
                  showNotification={showNotification}
                  language={language}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {pendingRemoveAccountId !== null ? (
        <div
          className="glass-overlay pointer-events-auto fixed inset-0 z-[350] flex items-center justify-center"
          onClick={() => setPendingRemoveAccountId(null)}
        >
          <div
            className="glass-modal pointer-events-auto w-[min(90vw,24rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-remove-confirm-title"
          >
            <p id="account-remove-confirm-title" className="mb-5 text-sm leading-relaxed text-white/90">
              {tt("app.accounts.removeConfirm")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRemoveAccountId(null)}
                className="interactive-press rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/18"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void confirmRemoveAccount()}
                className="interactive-press rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-amber-400"
              >
                {tt("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
