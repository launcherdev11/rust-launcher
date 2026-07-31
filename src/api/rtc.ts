import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type IceServer = {
  urls: string[];
  username?: string | null;
  credential?: string | null;
};

export type TurnCredentials = {
  username: string;
  password: string;
  ttl: number;
  urls: string[];
};

/** Short-lived TURN credentials (HMAC REST / coturn). */
export async function fetchTurnCredentials(): Promise<TurnCredentials> {
  await ensureValidAccessToken();
  return apiFetch<TurnCredentials>("/network/turn");
}

/** Legacy ICE servers helper (STUN + TURN). Prefer fetchTurnCredentials for P2P. */
export async function fetchIceServers(): Promise<{ ice_servers: IceServer[]; ttl_secs: number }> {
  await ensureValidAccessToken();
  return apiFetch<{ ice_servers: IceServer[]; ttl_secs: number }>("/rtc/ice-servers");
}
