import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback } from "react";

type Profile = {
  nickname: string;
  avatar_path: string | null;
  ely_username: string | null;
  ely_uuid: string | null;
};

type NotificationKind = "info" | "success" | "error" | "warning";

type AccountsTabProps = {
  profile: Profile;
  setProfile: React.Dispatch<React.SetStateAction<Profile>>;
  profileSaving: boolean;
  setProfileSaving: (v: boolean) => void;
  elyLoading: boolean;
  setElyLoading: (v: boolean) => void;
  elyAuthUrl: string | null;
  setElyAuthUrl: (url: string | null) => void;
  showNotification: (kind: NotificationKind, message: string) => void;
  refreshProfile: () => Promise<void>;
};

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true">
      <path d="M16.84 2.73a2.5 2.5 0 0 1 3.54 3.54l-1.06 1.06-3.54-3.54 1.06-1.06ZM4.92 14.49l9.19-9.19 3.54 3.54-9.19 9.19-3.82.42.42-3.96Z" />
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

export function AccountsTab({
  profile,
  setProfile,
  profileSaving,
  setProfileSaving,
  elyLoading,
  setElyLoading,
  elyAuthUrl,
  setElyAuthUrl,
  showNotification,
  refreshProfile,
}: AccountsTabProps) {
  const handleSaveNickname = useCallback(
    async (nickname: string) => {
      setProfileSaving(true);
      try {
        await invoke("set_profile", { nickname, avatar_path: profile.avatar_path });
        setProfile((prev) => ({ ...prev, nickname }));
        showNotification("success", "Изменения сохранены!");
      } catch (e) {
        console.error(e);
        showNotification("error", "Не удалось сохранить никнейм.");
      } finally {
        setProfileSaving(false);
      }
    },
    [profile.avatar_path, setProfile, setProfileSaving, showNotification],
  );

  const handleElyLogin = useCallback(async () => {
    setElyLoading(true);
    setElyAuthUrl(null);
    try {
      const unlisten = await listen<Profile>("ely-login-complete", (e) => {
        const p = e.payload;
        setProfile({
          nickname: p.nickname ?? "",
          avatar_path: p.avatar_path ?? null,
          ely_username: p.ely_username ?? null,
          ely_uuid: p.ely_uuid ?? null,
        });
        setElyLoading(false);
        setElyAuthUrl(null);
        unlisten();
      });

      const url = await invoke<string>("start_ely_oauth");
      setElyAuthUrl(url);
      try {
        await openUrl(url);
      } catch (e) {
        console.error("Не удалось открыть браузер для Ely.by OAuth:", e);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", msg);
      setElyLoading(false);
      setElyAuthUrl(null);
    }
  }, [setProfile, setElyLoading, setElyAuthUrl, showNotification]);

  const handleElyLogout = useCallback(async () => {
    try {
      await invoke("ely_logout");
      await refreshProfile();
      showNotification("info", "Вы вышли из аккаунта Ely.by.");
    } catch (e) {
      console.error(e);
      showNotification("error", "Не удалось выйти из аккаунта Ely.by.");
    }
  }, [refreshProfile, showNotification]);

  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-6">
      <div
        className="flex w-full items-center gap-6 rounded-2xl border border-white/10 bg-gradient-to-br from-[#1e3a5f]/95 to-[#0f2744]/95 px-6 py-5 shadow-xl backdrop-blur-sm"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
      >
        <div
          className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/90 bg-[#0f2744] text-white/90"
        >
          {profile.avatar_path ? (
            <img
              src={convertFileSrc(profile.avatar_path)}
              alt=""
              className="aspect-square h-full w-full object-cover object-center"
            />
          ) : (
            <span className="text-3xl font-light text-white/70">?</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={profile.nickname}
              onChange={(e) => setProfile((p) => ({ ...p, nickname: e.target.value }))}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== profile.nickname) handleSaveNickname(v);
              }}
              placeholder="Player"
              className="w-full min-w-0 bg-transparent text-xl font-semibold text-white placeholder:text-white/50 focus:outline-none disabled:opacity-60"
              disabled={profileSaving}
            />
            <span className="text-white/50" title="Редактировать никнейм">
              <PencilIcon />
            </span>
          </div>
          {profile.ely_username && (
            <p className="mt-0.5 text-xs text-white/60">
              Вход: {profile.ely_username}
            </p>
          )}
        </div>
      </div>
      <p className="text-center text-sm text-white/80">
        Настройте профиль и внешний вид под себя, войдя в систему.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className="interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-[#0078d4]/90 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#106ebe]"
          title="Скоро"
        >
          <MicrosoftIcon />
          <span>Microsoft</span>
        </button>
        {profile.ely_username ? (
          <button
            type="button"
            onClick={handleElyLogout}
            className="interactive-press flex items-center gap-2 rounded-xl border border-white/20 bg-black/40 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
          >
            <ElyByIcon />
            <span>Выйти из Ely.by</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleElyLogin}
            disabled={elyLoading}
            className="interactive-press flex items-center gap-2 rounded-xl bg-[#2d7d46] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#248338] disabled:opacity-60"
          >
            <ElyByIcon />
            <span>{elyLoading ? "Ожидание входа…" : "Ely.by"}</span>
          </button>
        )}
      </div>
      {elyAuthUrl && (
        <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left">
          <p className="mb-1.5 text-xs font-medium text-amber-200">
            Если страница в браузере бесконечно грузится:
          </p>
          <p className="break-all text-xs text-white/90">
            {elyAuthUrl}
          </p>
          <p className="mt-1.5 text-[11px] text-white/60">
            Лучше открыть в новой вкладке того же браузера. В другом браузере Ely.by может показать «Invalid request».
          </p>
        </div>
      )}
    </div>
  );
}

