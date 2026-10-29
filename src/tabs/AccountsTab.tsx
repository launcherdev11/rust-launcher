import { useEffect, useRef, useState } from "react";
import { AccountAvatar } from "../components/account_avatar";
import { AccountSkinPreview } from "../components/LazyAccountSkinPreview";
import { AchievementsPanel } from "../components/AchievementsPanel";
import { PlatformNotificationsPanel } from "../components/PlatformNotificationsPanel";
import { NicknameWithSponsor } from "../components/SponsorBadge";
import { InputClearButton, Modal, Skeleton } from "../components/ui";
import {
  OverviewNotificationsCard,
  OverviewProgressCard,
  SavedAccountsList,
  SignedOutCard,
} from "../features/account/AccountOverview";
import { AssetIcon, ElyByIcon, MicrosoftIcon, accountKindTagClass } from "../features/account/icons";
import { useWardrobe } from "../features/account/useWardrobe";
import { WardrobePanel, WearingSummary } from "../features/account/WardrobePanel";
import { useAchievements } from "../hooks/useAchievements";
import { usePlatformNotifications } from "../hooks/usePlatformNotifications";
import { usePlatformSelf } from "../hooks/usePlatformSelf";
import { formatPlaytimeShort, useT, type Language } from "../i18n";
import type { ProfileAvatarInput } from "../lib/avatar";
import { sanitizeNicknameInput } from "../lib/nickname";
import { PlatformAccountPanel } from "./PlatformAccountPanel";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };
type SettingsSection = "accounts" | "platform" | "notifications";
type AccountsSubTab = "overview" | "wardrobe" | "achievements" | "notifications" | "settings";

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
  const [subTab, setSubTab] = useState<AccountsSubTab>("overview");
  const [pendingRemoveAccountId, setPendingRemoveAccountId] = useState<string | null>(null);
  const [headerNicknameEditing, setHeaderNicknameEditing] = useState(false);
  const [nicknameHintVisible, setNicknameHintVisible] = useState(false);
  const nicknameInputFocusedRef = useRef(false);

  const self = usePlatformSelf();
  const achievements = useAchievements();
  const notifications = usePlatformNotifications({
    onError: (message) => showNotification("error", message),
  });
  const wardrobeEnabled = activeAccountKind === "microsoft" && !!profile.mc_uuid?.trim();
  const wardrobe = useWardrobe(wardrobeEnabled, `${activeAccountId ?? ""}:${profile.mc_uuid ?? ""}`);

  useEffect(() => {
    if (!tourAccountsSection) return;
    setSubTab(tourAccountsSection === "accounts" ? "overview" : "settings");
  }, [tourAccountsSection]);

  useEffect(() => {
    if (tourForceSettingsOpen) setSubTab("settings");
  }, [tourForceSettingsOpen]);

  const confirmRemoveAccount = async () => {
    const accountId = pendingRemoveAccountId;
    if (!accountId) return;
    setPendingRemoveAccountId(null);
    await onRemoveAccount(accountId);
  };

  const handleHeaderNicknameBlur = async (value: string) => {
    nicknameInputFocusedRef.current = false;
    setHeaderNicknameEditing(false);
    setNicknameHintVisible(false);
    if (isAuthorized) return;
    const trimmed = value.trim();
    const prevNick = profile.nickname.trim();
    setNicknameDraft(trimmed);
    setProfile((p) => ({ ...p, nickname: trimmed }));
    if (trimmed !== prevNick) await onSaveNickname(trimmed);
  };

  const offlineNickname = profile.nickname.trim();
  const gameNicknameDisplay = displayedNickname.trim() || tt("app.accounts.nicknamePlaceholder");
  const providerBusy = elyLoading || msLoading;
  const viewerKey = `${activeAccountId ?? ""}:${profile.ely_username ?? ""}:${profile.mc_uuid ?? ""}:${profile.nickname}`;
  const unlockedCount = achievements.achievements.filter((a) => a.unlocked).length;
  const pendingRemoveAccount = launcherAccounts.find((a) => a.id === pendingRemoveAccountId) ?? null;

  const subTabs: { id: AccountsSubTab; label: string; badge?: number }[] = [
    { id: "overview", label: tt("app.accounts.subTab.overview") },
    { id: "wardrobe", label: tt("app.accounts.subTab.wardrobe") },
    { id: "achievements", label: tt("app.accounts.subTab.achievements") },
    { id: "notifications", label: tt("app.accounts.subTab.notifications"), badge: notifications.unread },
    { id: "settings", label: tt("app.accounts.subTab.settings") },
  ];

  const statsLine = [
    self.stats
      ? `${tt("app.accounts.stats.playtime")} ${formatPlaytimeShort(language, self.stats.playtime_seconds)}`
      : null,
    self.stats ? `${tt("app.accounts.stats.launches")}: ${self.stats.launch_count}` : null,
    achievements.achievements.length > 0
      ? `${tt("app.accounts.stats.achievements")}: ${unlockedCount}/${achievements.achievements.length}`
      : null,
  ].filter(Boolean);

  return (
    <>
      <div className="flex min-h-0 w-full max-w-none flex-1 flex-col gap-3 overflow-y-auto py-1 md:gap-4 md:overflow-hidden">
        <header className="glass-panel relative shrink-0 overflow-hidden">
          <div className="relative flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={() => setSubTab("wardrobe")}
              className="interactive-press relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-[#0f2744] shadow-lg transition hover:border-emerald-400/40"
              title={tt("app.accounts.subTab.wardrobe")}
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
                {self.signedIn ? (
                  self.nickname ? (
                    <NicknameWithSponsor
                      nickname={self.nickname}
                      isSponsor={!!self.user?.is_sponsor}
                      sponsorTitle={tt("common.sponsor")}
                      className="truncate text-lg font-semibold text-white"
                      as="p"
                    />
                  ) : (
                    <Skeleton className="h-6 w-36 rounded-lg" />
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => setSubTab("settings")}
                    className="truncate text-lg text-white/40 transition hover:text-white/70"
                  >
                    {tt("app.accounts.systemNicknameSignedOut")}
                  </button>
                )}
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[0.75rem] font-semibold ${accountKindTagClass(activeAccountKind)}`}
                >
                  {accountKindShortLabel(activeAccountKind)}
                </span>
              </div>

              <div className="mt-1 flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-[0.75rem] font-bold text-white/40">
                  {tt("platform.inGameNickname")}
                </span>
                {headerNicknameEditing && !isAuthorized ? (
                  <div className="relative min-w-0 flex-1">
                    <input
                      type="text"
                      autoFocus
                      value={nicknameDraft}
                      onChange={(e) => {
                        const { value: v, changed } = sanitizeNicknameInput(e.target.value);
                        setNicknameHintVisible(changed);
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
                    className="interactive-press rounded-lg p-1 opacity-50 transition hover:bg-white/10 hover:opacity-90"
                    title={tt("app.accounts.editNickname")}
                  >
                    <AssetIcon name="edit" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {headerNicknameEditing && nicknameHintVisible ? (
                <p className="mt-1 text-[0.75rem] text-warn-hi/80">
                  {tt("app.accounts.nicknameRules")}
                </p>
              ) : null}

              {statsLine.length > 0 ? (
                <p className="mt-1 truncate text-[0.8125rem] text-white/40">{statsLine.join(" · ")}</p>
              ) : null}
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
                title={profile.ms_id_token ? tt("app.accounts.microsoftLogout") : tt("app.accounts.microsoftSignIn")}
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
                title={profile.ely_username ? tt("app.accounts.elyLogout") : tt("app.accounts.elySignIn")}
              >
                <ElyByIcon />
                <span className="hidden sm:inline">
                  {profile.ely_username ? tt("app.accounts.linkedShort") : "Ely.by"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab("settings")}
                className="interactive-press flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/35 transition hover:bg-black/55"
                title={tt("app.accounts.accountSettingsTitle")}
              >
                <img src="/launcher-assets/settings.svg" alt="" aria-hidden="true" draggable={false} className="h-4 w-4 shrink-0 object-contain opacity-80" />
              </button>
            </div>
          </div>
        </header>

        {elyAuthUrl || msAuthUrl ? (
          <div className="shrink-0 space-y-2">
            {elyAuthUrl ? (
              <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-left">
                <p className="mb-1.5 text-xs font-medium text-warn-fg">{tt("app.accounts.elyDialogTitle")}</p>
                <p className="break-all text-xs text-white/90">{elyAuthUrl}</p>
                <p className="mt-1.5 text-[0.8125rem] text-white/60">{tt("app.accounts.elyDialogTip")}</p>
              </div>
            ) : null}
            {msAuthUrl ? (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-left">
                <p className="mb-1.5 text-xs font-medium text-blue-200">{tt("app.accounts.microsoftSignIn")}</p>
                <p className="break-all text-xs text-white/90">{msAuthUrl}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="glass-toolbar flex h-10 w-fit max-w-full shrink-0 items-center gap-1 overflow-x-auto p-1">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`interactive-press flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                subTab === tab.id ? "seg-on" : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              {tab.label}
              {tab.badge ? (
                <span className="rounded-md bg-accent-from/30 px-1.5 text-[0.6875rem] text-accent-hi">
                  {tab.badge > 99 ? "99+" : tab.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {subTab === "overview" ? (
          <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(190px,240px)_minmax(0,1fr)_minmax(250px,330px)] md:gap-4">
            <SavedAccountsList
              language={language}
              accounts={launcherAccounts}
              activeAvatar={profileAvatarInput}
              addingAccount={addingAccount}
              accountKindShortLabel={accountKindShortLabel}
              onSwitch={(id) => void onSwitchAccount(id)}
              onRemove={setPendingRemoveAccountId}
              onAdd={() => void onAddAccount()}
            />

            <div className="flex min-h-[min(340px,44vh)] min-w-0 flex-col md:min-h-0">
              <AccountSkinPreview
                key={viewerKey}
                profile={profileAvatarInput}
                username={displayedNickname}
                skinUrl={wardrobe.appliedSkinUrl}
                capeUrl={wardrobe.appliedCapeUrl}
              >
                <button
                  type="button"
                  onClick={() => setSubTab("wardrobe")}
                  className="interactive-press glass-control absolute right-3 top-3 z-10 flex h-9 items-center px-3 text-xs font-semibold text-white/90 transition hover:border-white/20"
                >
                  {tt("app.accounts.subTab.wardrobe")}
                </button>
                {wardrobe.enabled ? (
                  <div className="absolute inset-x-3 bottom-3 z-10">
                    <WearingSummary
                      language={language}
                      skinLabel={wardrobe.activeSkin?.alias ?? null}
                      capeLabel={wardrobe.activeCape?.alias ?? null}
                    />
                  </div>
                ) : null}
              </AccountSkinPreview>
            </div>

            <div className="custom-scrollbar flex min-w-0 flex-col gap-3 md:min-h-0 md:overflow-y-auto md:gap-4">
              {self.signedIn ? (
                <>
                  <OverviewProgressCard
                    language={language}
                    achievements={achievements}
                    stats={self.stats}
                    onOpenAchievements={() => setSubTab("achievements")}
                  />
                  <OverviewNotificationsCard
                    language={language}
                    notifications={notifications}
                    showNotification={showNotification}
                    onOpenNotifications={() => setSubTab("notifications")}
                  />
                </>
              ) : (
                <SignedOutCard language={language} onSignIn={() => setSubTab("settings")} />
              )}
            </div>
          </div>
        ) : null}

        {subTab === "wardrobe" ? (
          <WardrobePanel
            language={language}
            wardrobe={wardrobe}
            accountKind={activeAccountKind}
            profile={profileAvatarInput}
            username={displayedNickname}
            viewerKey={viewerKey}
            msLoading={msLoading}
            onMicrosoftLogin={onMicrosoftLogin}
            showNotification={showNotification}
          />
        ) : null}

        {subTab === "achievements" ? (
          <section className="glass-panel custom-scrollbar min-h-[320px] p-4 sm:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <AchievementsPanel
              language={language}
              state={achievements}
              stats={self.stats}
              onSignIn={() => setSubTab("settings")}
            />
          </section>
        ) : null}

        {subTab === "notifications" ? (
          <section className="glass-panel custom-scrollbar min-h-[320px] p-4 sm:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <PlatformNotificationsPanel
              language={language}
              showNotification={showNotification}
              state={notifications}
              onSignIn={() => setSubTab("settings")}
              className="mx-auto w-full max-w-3xl"
            />
          </section>
        ) : null}

        {subTab === "settings" ? (
          <div className="custom-scrollbar md:min-h-0 md:flex-1 md:overflow-y-auto">
            <div className={self.signedIn ? "" : "glass-panel mx-auto w-full max-w-lg px-5 py-6 sm:px-7"}>
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
                onProfileChanged={() => void self.reload()}
              />
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={pendingRemoveAccountId !== null}
        title={tt("app.accounts.removeTitle")}
        subtitle={pendingRemoveAccount?.label}
        onClose={() => setPendingRemoveAccountId(null)}
        closeLabel={tt("common.close")}
        footer={
          <>
            <button type="button" className="btn btn-soft" onClick={() => setPendingRemoveAccountId(null)}>
              {tt("common.cancel")}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void confirmRemoveAccount()}>
              {tt("common.delete")}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-white/80">{tt("app.accounts.removeConfirm")}</p>
      </Modal>
    </>
  );
}
