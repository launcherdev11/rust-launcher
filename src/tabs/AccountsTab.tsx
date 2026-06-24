import { useCallback, useEffect, useRef, useState } from "react";
import { AccountAvatar } from "../components/account_avatar";
import { AccountSkinPreview } from "../components/account_skin_preview";
import { DeleteIcon } from "../components/delete_icon";
import { listBuilds, type BuildRow } from "../api/builds";
import { getStoredAccessToken } from "../api/client";
import { API_AUTH_CHANGED_EVENT } from "../api/auth";
import { useT, type Language } from "../i18n";
import type { ProfileAvatarInput } from "../lib/avatar";
import { PlatformAccountPanel } from "./PlatformAccountPanel";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };

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
};

function accountKindAvatarClass(kind: string): string {
  if (kind === "microsoft") return "bg-sky-600/35 text-sky-100 ring-1 ring-sky-400/25";
  if (kind === "ely") return "bg-emerald-700/40 text-emerald-100 ring-1 ring-emerald-400/20";
  return "bg-white/10 text-white/80 ring-1 ring-white/10";
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true">
      <path d="M16.84 2.73a2.5 2.5 0 0 1 3.54 3.54l-1.06 1.06-3.54-3.54 1.06-1.06ZM4.92 14.49l9.19-9.19 3.54 3.54-9.19 9.19-3.82.42.42-3.96Z" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5 fill-current"} aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 .001 7.001A3.5 3.5 0 0 0 12 8.5Zm9 3.25-1.8-1.04.16-2.08-2.12-.84-.84-2.12-2.08.16L12 2.75l-1.32 1.88-2.08-.16-.84 2.12-2.12.84.16 2.08L3 11.75v2.5l1.8 1.04-.16 2.08 2.12.84.84 2.12 2.08-.16L12 21.25l1.32-1.88 2.08.16.84-2.12 2.12-.84-.16-2.08L21 14.25v-2.5Z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path fill="#f25022" d="M2 2h9.5v9.5H2V2z" />
      <path fill="#00a4ef" d="M12.5 2H22v9.5h-9.5V2z" />
      <path fill="#7fba00" d="M2 12.5H11.5V22H2v-9.5z" />
      <path fill="#ffb900" d="M12.5 12.5H22V22h-9.5v-9.5z" />
    </svg>
  );
}

function ElyByIcon() {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#2d7d46] text-[10px] font-bold text-white">
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
}: AccountsTabProps) {
  const tt = useT(language);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingRemoveAccountId, setPendingRemoveAccountId] = useState<string | null>(null);
  const [publishedBuilds, setPublishedBuilds] = useState<BuildRow[]>([]);
  const [buildsLoading, setBuildsLoading] = useState(false);
  const [headerNicknameEditing, setHeaderNicknameEditing] = useState(false);
  const nicknameInputFocusedRef = useRef(false);

  const loadPublishedBuilds = useCallback(async () => {
    if (!getStoredAccessToken()) {
      setPublishedBuilds([]);
      return;
    }
    setBuildsLoading(true);
    try {
      const builds = await listBuilds();
      setPublishedBuilds(builds);
    } catch {
      setPublishedBuilds([]);
    } finally {
      setBuildsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPublishedBuilds();
    const onAuthChanged = () => void loadPublishedBuilds();
    window.addEventListener(API_AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(API_AUTH_CHANGED_EVENT, onAuthChanged);
  }, [loadPublishedBuilds]);

  useEffect(() => {
    if (!settingsOpen) return;
    void loadPublishedBuilds();
  }, [settingsOpen, loadPublishedBuilds]);

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

  const gridBuilds = publishedBuilds.slice(0, 4);
  const emptySlots = Math.max(0, 4 - gridBuilds.length);

  return (
    <>
      <div className="flex min-h-0 w-full max-w-none flex-1 flex-col gap-4 overflow-y-auto py-1 lg:gap-5 lg:overflow-hidden">
        <header className="shrink-0 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 shadow-xl backdrop-blur-md glass-panel">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="interactive-press relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/90 bg-[#0f2744] transition hover:border-white hover:bg-[#1e3a5f]"
                title={tt("app.accounts.accountSettingsTitle")}
              >
                <AccountAvatar
                  username={displayedNickname}
                  profile={profileAvatarInput}
                  kind={activeAccountKind}
                  size={56}
                  className="h-full w-full rounded-full"
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {headerNicknameEditing && !isAuthorized ? (
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
                          setNicknameDraft(profile.nickname);
                          setHeaderNicknameEditing(false);
                        }
                      }}
                      className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-white placeholder:text-white/50 focus:outline-none"
                      placeholder={tt("app.accounts.nicknamePlaceholder")}
                    />
                  ) : (
                    <h1 className="truncate text-xl font-semibold text-white/95">
                      {displayedNickname.trim() || tt("app.accounts.nicknamePlaceholder")}
                    </h1>
                  )}
                  {!isAuthorized && !headerNicknameEditing ? (
                    <button
                      type="button"
                      onClick={() => setHeaderNicknameEditing(true)}
                      className="interactive-press rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white/80"
                      title={tt("app.accounts.editNickname")}
                    >
                      <PencilIcon />
                    </button>
                  ) : null}
                </div>
                {profile.ely_username && profile.ely_username !== displayedNickname ? (
                  <p className="mt-0.5 truncate text-xs text-white/55">{profile.ely_username}</p>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="interactive-press flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/35 text-white/70 transition hover:bg-black/55 hover:text-white"
                title={tt("app.accounts.accountSettingsTitle")}
              >
                <SettingsIcon />
              </button>
              <button
                type="button"
                disabled={msLoading || elyLoading}
                onClick={() => {
                  if (profile.ms_id_token) void onMicrosoftLogout();
                  else void onMicrosoftLogin();
                }}
                className={`interactive-press flex h-10 w-10 items-center justify-center rounded-xl border transition disabled:opacity-60 ${
                  profile.ms_id_token
                    ? "border-sky-400/35 bg-sky-500/15 hover:bg-sky-500/25"
                    : "border-white/10 bg-black/35 opacity-70 hover:bg-black/55 hover:opacity-100"
                }`}
                title={
                  profile.ms_id_token
                    ? tt("app.accounts.microsoftLogout")
                    : tt("app.accounts.microsoftSignIn")
                }
              >
                <MicrosoftIcon />
              </button>
              <button
                type="button"
                disabled={elyLoading || msLoading}
                onClick={() => {
                  if (profile.ely_username) void onElyLogout();
                  else void onElyLogin();
                }}
                className={`interactive-press flex h-10 min-w-10 items-center justify-center gap-1 rounded-xl border px-2 transition disabled:opacity-60 ${
                  profile.ely_username
                    ? "border-emerald-400/35 bg-[#2d7d46]/90 hover:bg-[#248338]"
                    : "border-white/10 bg-black/35 opacity-70 hover:bg-black/55 hover:opacity-100"
                }`}
                title={
                  profile.ely_username ? tt("app.accounts.elyLogout") : tt("app.accounts.elyWaiting")
                }
              >
                <ElyByIcon />
                <span className="hidden text-xs font-semibold text-white sm:inline">Ely</span>
              </button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-stretch lg:gap-5">
          <section className="flex min-h-[min(320px,38vh)] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-5 shadow-xl backdrop-blur-md glass-panel lg:min-h-0">
            <h2 className="mb-4 text-base font-semibold text-white/90">
              {tt("app.accounts.publishedBuildsTitle")}
            </h2>
            {buildsLoading ? (
              <p className="text-sm text-white/45">{tt("common.loading")}</p>
            ) : !getStoredAccessToken() ? (
              <p className="text-sm leading-relaxed text-white/50">{tt("app.accounts.publishedBuildsSignIn")}</p>
            ) : gridBuilds.length === 0 ? (
              <p className="text-sm leading-relaxed text-white/50">{tt("app.accounts.publishedBuildsEmpty")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 content-start">
                {gridBuilds.map((build) => (
                  <button
                    key={build.id}
                    type="button"
                    className="interactive-press flex min-h-[52px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] px-2 py-2 text-center transition hover:border-white/20 hover:bg-white/[0.1]"
                  >
                    <span className="line-clamp-2 text-sm font-semibold text-white/90">{build.name}</span>
                  </button>
                ))}
                {Array.from({ length: emptySlots }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="flex min-h-[52px] items-center justify-center rounded-xl border border-dashed border-white/8 bg-white/[0.02]"
                    aria-hidden
                  />
                ))}
              </div>
            )}
          </section>

          <div className="flex min-h-[min(360px,42vh)] min-w-0 flex-col lg:min-h-0">
            <AccountSkinPreview
              key={`${activeAccountId ?? ""}:${profile.ely_username ?? ""}:${profile.mc_uuid ?? ""}:${profile.nickname}`}
              profile={profileAvatarInput}
              username={displayedNickname}
              onSettingsClick={() => setSettingsOpen(true)}
              settingsTitle={tt("app.accounts.accountSettingsTitle")}
            />
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[340] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="glass-panel pointer-events-auto flex max-h-[min(90vh,820px)] w-[min(96vw,42rem)] flex-col overflow-hidden rounded-[22px] border border-white/15 bg-[#14141c]/95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-settings-title"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <h2 id="account-settings-title" className="text-base font-semibold text-white/95">
                {tt("app.accounts.accountSettingsTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="interactive-press rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
                aria-label={tt("common.close")}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white/45">
                      {tt("app.accounts.savedListTitle")}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={addingAccount}
                    onClick={() => void onAddAccount()}
                    className="interactive-press flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    {tt("app.accounts.addAccount")}
                  </button>
                </div>
                {launcherAccounts.length === 0 ? (
                  <p className="py-4 text-center text-sm text-white/45">—</p>
                ) : (
                  <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                    {launcherAccounts.map((acc) => (
                      <li
                        key={acc.id}
                        className={`flex items-stretch gap-2 rounded-xl border px-2 py-2 transition ${
                          acc.is_active
                            ? "border-emerald-400/35 bg-emerald-500/10"
                            : "border-white/10 bg-black/30 hover:bg-black/50"
                        }`}
                      >
                        <AccountAvatar
                          username={acc.label}
                          profile={acc.is_active ? profileAvatarInput : undefined}
                          kind={acc.kind}
                          size={88}
                          className={`h-11 w-11 shrink-0 self-center rounded-full ${accountKindAvatarClass(acc.kind)}`}
                        />
                        <button
                          type="button"
                          disabled={acc.is_active}
                          onClick={() => {
                            if (!acc.is_active) void onSwitchAccount(acc.id);
                          }}
                          className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left transition enabled:cursor-pointer enabled:hover:bg-white/5 enabled:active:scale-[0.99] disabled:cursor-default"
                        >
                          <span className="block truncate text-sm font-semibold text-white/95">
                            {acc.label}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
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
                          className="interactive-press shrink-0 self-center rounded-lg p-2.5 text-white/35 hover:bg-red-500/15 hover:text-red-300"
                          title={tt("app.accounts.removeTitle")}
                        >
                          <DeleteIcon className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!isAuthorized ? (
                <p className="text-center text-sm text-white/70">{tt("app.accounts.hint")}</p>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {profile.ms_id_token ? (
                  <button
                    type="button"
                    onClick={() => void onMicrosoftLogout()}
                    className="interactive-press flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-black/40 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <MicrosoftIcon />
                    <span>{tt("app.accounts.microsoftLogout")}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onMicrosoftLogin()}
                    disabled={elyLoading || msLoading}
                    className="interactive-press flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-[#0078d4]/90 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#106ebe] disabled:opacity-60"
                  >
                    <MicrosoftIcon />
                    <span>{tt("app.accounts.microsoftSignIn")}</span>
                  </button>
                )}
                {profile.ely_username ? (
                  <button
                    type="button"
                    onClick={() => void onElyLogout()}
                    className="interactive-press flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-black/40 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <ElyByIcon />
                    <span>{tt("app.accounts.elyLogout")}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onElyLogin()}
                    disabled={elyLoading}
                    className="interactive-press flex w-full items-center justify-center gap-2 rounded-xl bg-[#2d7d46] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60"
                  >
                    <ElyByIcon />
                    <span>{elyLoading ? tt("app.accounts.elyWaiting") : "Ely.by"}</span>
                  </button>
                )}
              </div>

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

              <PlatformAccountPanel
                showNotification={showNotification}
                language={language}
                launcherProfile={{
                  launcher_nickname: profile.nickname?.trim() || null,
                  ely_username: profile.ely_username,
                  microsoft_username: profile.mc_uuid ? profile.nickname : null,
                  ely_uuid: profile.ely_uuid,
                  mc_uuid: profile.mc_uuid,
                }}
                onMicrosoftLogin={onMicrosoftLogin}
                onElyLogin={onElyLogin}
                providerLoginBusy={elyLoading || msLoading}
              />
            </div>
          </div>
        </div>
      ) : null}

      {pendingRemoveAccountId !== null ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[350] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPendingRemoveAccountId(null)}
        >
          <div
            className="glass-panel pointer-events-auto w-[min(90vw,24rem)] rounded-[22px] border border-white/15 bg-[#14141c]/95 p-5 shadow-2xl"
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
