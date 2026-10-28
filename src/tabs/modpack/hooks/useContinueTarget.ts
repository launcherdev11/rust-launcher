import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ContinueTarget, GameStatus } from "../types";

export function useContinueTarget(profileId: string | null, gameStatus: GameStatus) {
  const [target, setTarget] = useState<ContinueTarget | null>(null);
  const running = gameStatus === "running";

  useEffect(() => {
    if (!profileId) {
      setTarget(null);
      return;
    }
    if (running) return;
    let cancelled = false;
    void invoke<ContinueTarget | null>("get_profile_continue_target", { profileId })
      .then((next) => {
        if (!cancelled) setTarget(next ?? null);
      })
      .catch(() => {
        if (!cancelled) setTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, running]);

  return target;
}
