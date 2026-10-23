import { useEffect, useState } from "react";
import { subscribeTauriEvent } from "../lib/tauriEvents";

export type LaunchStage = "version" | "libraries" | "assets" | "account" | "java" | "starting";

const KNOWN_STAGES: ReadonlySet<string> = new Set<LaunchStage>([
  "version",
  "libraries",
  "assets",
  "account",
  "java",
  "starting",
]);

export function useLaunchStage(isLaunching: boolean): LaunchStage | null {
  const [stage, setStage] = useState<LaunchStage | null>(null);

  useEffect(
    () =>
      subscribeTauriEvent<{ stage: string }>("launch-stage", (event) => {
        const next = event.payload.stage;
        if (KNOWN_STAGES.has(next)) setStage(next as LaunchStage);
      }),
    [],
  );

  useEffect(() => {
    if (!isLaunching) setStage(null);
  }, [isLaunching]);

  return stage;
}
