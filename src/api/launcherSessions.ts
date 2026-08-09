import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type LauncherSession = {
  id: string;
  user_id: string;
  device_name?: string | null;
  platform?: string | null;
  launcher_version?: string | null;
  created_at: string;
  last_ping: string;
  closed_at?: string | null;
};

const SESSION_ID_KEY = "mc16launcher:launcher_session_id_v1";

export function getStoredLauncherSessionId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_ID_KEY);
  } catch {
    return null;
  }
}

function storeSessionId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(SESSION_ID_KEY, id);
    else window.localStorage.removeItem(SESSION_ID_KEY);
  } catch {
    //ignore
  }
}

export async function createLauncherSession(input?: {
  device_name?: string;
  platform?: string;
  launcher_version?: string;
}): Promise<LauncherSession> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ session: LauncherSession }>("/launcher/sessions", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
  storeSessionId(data.session.id);
  return data.session;
}

export async function pingLauncherSession(sessionId: string): Promise<LauncherSession> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ session: LauncherSession }>(
    `/launcher/sessions/${sessionId}/ping`,
    { method: "POST" },
  );
  return data.session;
}

export async function closeLauncherSession(sessionId: string): Promise<void> {
  await ensureValidAccessToken();
  await apiFetch(`/launcher/sessions/${sessionId}/close`, { method: "POST" });
  storeSessionId(null);
}
