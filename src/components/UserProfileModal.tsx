import { useEffect, useState } from "react";
import { fetchUserProfile, type UserPublicProfile } from "../api/users";
import { sendFriendRequest } from "../api/friends";
import { ApiError } from "../api/client";
import { AchievementsPanel } from "./AchievementsPanel";
import { AccountSkinPreview } from "./account_skin_preview";
import { NicknameWithSponsor } from "./SponsorBadge";
import { buildInitialAvatarDataUrl, getUserListAvatarSrc } from "../lib/avatar";
import { useT, type Language } from "../i18n";

export type UserProfileSeed = {
  user_id: string;
  nickname: string;
  is_sponsor?: boolean | null;
  ely_username?: string | null;
  mc_uuid?: string | null;
  online?: boolean | null;
};

type NotificationKind = "info" | "success" | "error" | "warning";

type UserProfileModalProps = {
  language: Language;
  seed: UserProfileSeed;
  onClose: () => void;
  currentUserId?: string;
  isFriend?: boolean;
  onNotify?: (kind: NotificationKind, message: string) => void;
  onFriendRequestSent?: () => void;
};

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function UserProfileModal({
  language,
  seed,
  onClose,
  currentUserId,
  isFriend = false,
  onNotify,
  onFriendRequestSent,
}: UserProfileModalProps) {
  const tt = useT(language);
  const [profile, setProfile] = useState<UserPublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarSrc, setAvatarSrc] = useState(() => buildInitialAvatarDataUrl(seed.nickname));
  const [addingFriend, setAddingFriend] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"none" | "pending" | "friend">(
    isFriend ? "friend" : "none",
  );

  const nickname = profile?.nickname ?? seed.nickname;
  const isSponsor = profile?.is_sponsor ?? seed.is_sponsor;
  const elyUsername = profile?.ely_username ?? seed.ely_username ?? null;
  const mcUuid = profile?.mc_uuid ?? seed.mc_uuid ?? null;
  const isSelf = Boolean(currentUserId && currentUserId === seed.user_id);
  const canAddFriend = Boolean(currentUserId) && !isSelf;

  useEffect(() => {
    setFriendStatus(isFriend ? "friend" : "none");
  }, [isFriend, seed.user_id]);

  const handleAddFriend = async () => {
    if (!canAddFriend || friendStatus !== "none" || addingFriend) return;
    setAddingFriend(true);
    try {
      const result = await sendFriendRequest(nickname.trim());
      if (result.already_exists) {
        setFriendStatus("pending");
        onNotify?.("info", tt("friends.toast.requestExists"));
      } else {
        setFriendStatus("pending");
        onNotify?.("success", tt("friends.toast.requestSent"));
      }
      onFriendRequestSent?.();
    } catch (e) {
      onNotify?.("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setAddingFriend(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchUserProfile(seed.user_id)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seed.user_id]);

  useEffect(() => {
    let cancelled = false;
    void getUserListAvatarSrc(
      { nickname, ely_username: elyUsername, mc_uuid: mcUuid },
      96,
    ).then((src) => {
      if (!cancelled) setAvatarSrc(src);
    });
    return () => {
      cancelled = true;
    };
  }, [nickname, elyUsername, mcUuid]);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[340] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel pointer-events-auto flex max-h-[min(92vh,860px)] w-[min(96vw,52rem)] flex-col overflow-hidden rounded-[22px] border border-white/15 bg-[#14141c]/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <h2 id="user-profile-title" className="text-base font-semibold text-white/95">
            {tt("friends.profileTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="interactive-press rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label={tt("common.close")}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="mb-3 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                  <div className="relative shrink-0">
                    <img
                      src={avatarSrc}
                      alt=""
                      className="h-14 w-14 rounded-full object-cover ring-2 ring-white/20 [image-rendering:pixelated]"
                      draggable={false}
                      onError={(event) => {
                        event.currentTarget.src = buildInitialAvatarDataUrl(nickname);
                      }}
                    />
                    {seed.online != null ? (
                      <span
                        className={`absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full ring-2 ring-[#14141c] ${
                          seed.online ? "bg-emerald-400" : "bg-white/25"
                        }`}
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <NicknameWithSponsor
                      nickname={nickname}
                      isSponsor={isSponsor}
                      sponsorTitle={tt("common.sponsor")}
                      className="truncate text-base font-semibold text-white/95"
                    />
                    {seed.online != null ? (
                      <p
                        className={`mt-0.5 text-xs ${
                          seed.online ? "text-emerald-300/80" : "text-white/40"
                        }`}
                      >
                        {seed.online ? tt("friends.online") : tt("friends.offline")}
                      </p>
                    ) : loading ? (
                      <p className="mt-0.5 text-xs text-white/40">{tt("common.loading")}</p>
                    ) : null}
                    {elyUsername ? (
                      <p className="mt-1 truncate text-[11px] text-white/45">
                        Ely.by · {elyUsername}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="h-[280px]">
                  <AccountSkinPreview
                    key={`${seed.user_id}:${elyUsername ?? ""}:${mcUuid ?? ""}`}
                    profile={{
                      nickname,
                      ely_username: elyUsername,
                      ely_uuid: null,
                      mc_uuid: mcUuid,
                    }}
                    username={nickname}
                    className="relative flex h-full w-full flex-col overflow-hidden bg-black/20"
                  />
                </div>
              </div>

              {canAddFriend ? (
                friendStatus === "friend" ? (
                  <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-center text-sm font-semibold text-emerald-200/90">
                    {tt("friends.alreadyFriends")}
                  </p>
                ) : friendStatus === "pending" ? (
                  <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center text-sm font-semibold text-white/70">
                    {tt("friends.toast.requestSent")}
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={addingFriend}
                    onClick={() => void handleAddFriend()}
                    className="interactive-press rounded-xl border border-emerald-500/40 bg-emerald-600/25 px-4 py-2.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-600/35 disabled:opacity-60"
                  >
                    {tt("friends.addFriend")}
                  </button>
                )
              ) : null}
            </div>

            <AchievementsPanel
              language={language}
              userId={seed.user_id}
              compact
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
