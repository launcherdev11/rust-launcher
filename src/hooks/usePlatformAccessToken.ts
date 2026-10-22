import { useEffect, useState } from "react";
import { API_AUTH_CHANGED_EVENT } from "../api/auth";
import { getStoredAccessToken } from "../api/client";

export function usePlatformAccessToken(): string {
  const [token, setToken] = useState(() => getStoredAccessToken() ?? "");

  useEffect(() => {
    const sync = () => setToken(getStoredAccessToken() ?? "");
    sync();
    window.addEventListener(API_AUTH_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(API_AUTH_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return token;
}
