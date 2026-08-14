import { useEffect } from "react";
import { startPlatformWsLifecycle } from "../api/ws";

export function usePlatformWebSocket() {
  useEffect(() => startPlatformWsLifecycle(), []);
}
