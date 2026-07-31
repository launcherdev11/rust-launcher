import { useEffect } from "react";
import { startPlatformWsLifecycle } from "../api/ws";

/** Keeps the platform WebSocket connected while the launcher is open. */
export function usePlatformWebSocket() {
  useEffect(() => startPlatformWsLifecycle(), []);
}
