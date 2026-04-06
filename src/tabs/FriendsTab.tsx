import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";

type Language = "ru" | "en";
type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };

type FriendsTabProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
};

type FriendRow = {
  user_id: string;
  nickname: string;
};

type IncomingRequestRow = {
  request_id: string;
  from_user_id: string;
  from_nickname: string;
  created_at?: string;
};

const STORAGE_TOKEN_KEY = "mc16launcher:supabase_access_token_v1";
const STORAGE_NICKNAME_KEY = "mc16launcher:supabase_nickname_v1";

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

export function FriendsTab({ showNotification, language }: FriendsTabProps) {
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
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [accessToken, setAccessToken] = useState<string>("");
  const [profileNickname, setProfileNickname] = useState<string>("");

  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequestRow[]>([]);
  const [friendNickToAdd, setFriendNickToAdd] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const t = window.localStorage.getItem(STORAGE_TOKEN_KEY);
      const n = window.localStorage.getItem(STORAGE_NICKNAME_KEY);
      if (t) setAccessToken(t);
      if (n) setProfileNickname(n);
    } catch {
      // ignore
    }
  }, []);

  const loadFriends = async (token: string) => {
    if (!edgeAuthHeaders) throw new Error("Missing SUPABASE anon key (VITE_SUPABASE_ANON_KEY).");
    if (!supabaseProjectUrl) throw new Error("Missing SUPABASE project url (VITE_SUPABASE_PROJECT_URL).");

    const url = `${supabaseProjectUrl}/functions/v1/friends_list_friends`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...edgeAuthHeaders,
      },
      body: JSON.stringify({ supabase_access_token: token }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(jsonErrorFromBody(data));
    return data as { friends: FriendRow[] };
  };

  const loadIncomingRequests = async (token: string) => {
    if (!edgeAuthHeaders) throw new Error("Missing SUPABASE anon key (VITE_SUPABASE_ANON_KEY).");
    if (!supabaseProjectUrl) throw new Error("Missing SUPABASE project url (VITE_SUPABASE_PROJECT_URL).");

    const url = `${supabaseProjectUrl}/functions/v1/friends_list_requests`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...edgeAuthHeaders,
      },
      body: JSON.stringify({ supabase_access_token: token }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(jsonErrorFromBody(data));
    return data as { incoming_requests: IncomingRequestRow[] };
  };

  const handleLoadFriends = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await loadFriends(accessToken);
      setFriends(res.friends ?? []);
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadIncomingRequests = async () => {
    if (!accessToken) return;
    setRequestsLoading(true);
    try {
      const res = await loadIncomingRequests(accessToken);
      setIncomingRequests(res.incoming_requests ?? []);
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    if (!accessToken) return;
    setRequestsLoading(true);
    try {
      const url = `${supabaseProjectUrl}/functions/v1/friends_accept_request`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(edgeAuthHeaders ?? {}),
        },
        body: JSON.stringify({
          supabase_access_token: accessToken,
          request_id: requestId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(jsonErrorFromBody(data));
      showNotification("success", "Заявка принята");
      const [reqRes, friendsRes] = await Promise.all([
        loadIncomingRequests(accessToken),
        loadFriends(accessToken),
      ]);
      setIncomingRequests(reqRes.incoming_requests ?? []);
      setFriends(friendsRes.friends ?? []);
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!accessToken) return;
    setRequestsLoading(true);
    try {
      const url = `${supabaseProjectUrl}/functions/v1/friends_reject_request`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(edgeAuthHeaders ?? {}),
        },
        body: JSON.stringify({
          supabase_access_token: accessToken,
          request_id: requestId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(jsonErrorFromBody(data));
      showNotification("info", "Заявка отклонена");
      const reqRes = await loadIncomingRequests(accessToken);
      setIncomingRequests(reqRes.incoming_requests ?? []);
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleSendRequest = async () => {
    if (!accessToken) {
      showNotification("warning", "Сначала войдите во вкладке «Аккаунты»");
      return;
    }
    const toNick = friendNickToAdd.trim();
    if (!toNick) return;
    if (toNick === profileNickname.trim()) {
      showNotification("warning", "Нельзя отправить заявку самому себе");
      return;
    }

    setLoading(true);
    try {
      const url = `${supabaseProjectUrl}/functions/v1/friends_send_request`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(edgeAuthHeaders ?? {}),
        },
        body: JSON.stringify({
          supabase_access_token: accessToken,
          to_nickname: toNick,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(jsonErrorFromBody(data));

      if (data?.already_exists) {
        showNotification("info", "Заявка уже существует или вы уже друзья.");
      } else {
        showNotification("success", "Заявка отправлена");
      }

      setFriendNickToAdd("");
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6 py-6">
      <div className="w-full text-center">
        <h1 className="text-lg font-bold tracking-tight text-white/95">{tt("app.sidebar.friends")}</h1>
        <p className="mt-1.5 text-sm text-white/50">
          {accessToken ? "Управляйте друзьями по nickname." : "Войдите в Supabase во вкладке «Аккаунты», чтобы пользоваться друзьями."}
        </p>
      </div>

      <div className="w-full rounded-2xl border border-white/10 glass-panel px-6 py-6 shadow-xl backdrop-blur-md bg-black/40">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={friendNickToAdd}
              onChange={(e) => setFriendNickToAdd(e.target.value)}
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30 disabled:opacity-60"
              placeholder="Никнейм друга"
              disabled={!accessToken}
            />
            <button
              type="button"
              disabled={!accessToken || loading || !friendNickToAdd.trim()}
              onClick={() => void handleSendRequest()}
              className="interactive-press rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
            >
              Добавить
            </button>
            <button
              type="button"
              disabled={!accessToken || loading}
              onClick={() => void handleLoadFriends()}
              className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
            >
              Обновить
            </button>
            <button
              type="button"
              disabled={!accessToken || requestsLoading}
              onClick={() => void handleLoadIncomingRequests()}
              className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
            >
              Заявки
            </button>
          </div>

          <div className="h-px w-full bg-white/10" />

          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wider text-white/45">Входящие заявки</p>
            {!accessToken ? (
              <p className="text-sm text-white/60">Сначала войдите во вкладке «Аккаунты».</p>
            ) : incomingRequests.length === 0 ? (
              <p className="text-sm text-white/60">Нет входящих заявок.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {incomingRequests.map((r) => (
                  <li
                    key={r.request_id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white/90">{r.from_nickname}</p>
                      <p className="text-[11px] text-white/45 truncate">{r.from_user_id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={requestsLoading}
                        onClick={() => void handleAcceptRequest(r.request_id)}
                        className="interactive-press rounded-lg border border-emerald-500/35 bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
                      >
                        Принять
                      </button>
                      <button
                        type="button"
                        disabled={requestsLoading}
                        onClick={() => void handleRejectRequest(r.request_id)}
                        className="interactive-press rounded-lg border border-white/20 bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/75 hover:bg-black/60 disabled:opacity-60"
                      >
                        Отклонить
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="h-px w-full bg-white/10" />

          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wider text-white/45">Ваши друзья</p>
            {!accessToken ? (
              <p className="text-sm text-white/60">Сначала войдите во вкладке «Аккаунты».</p>
            ) : friends.length === 0 ? (
              <p className="text-sm text-white/60">Пока никого нет. Отправьте заявку по nickname.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {friends.map((f) => (
                  <li
                    key={f.user_id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <span className="text-sm font-semibold text-white/90">{f.nickname}</span>
                    <span className="text-[11px] text-white/40 truncate max-w-[160px]">{f.user_id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

