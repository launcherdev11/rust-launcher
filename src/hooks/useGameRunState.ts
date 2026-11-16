import { useMemo, useRef, useState } from "react";
import { useActivitySharing } from "../lib/activityPrivacy";
import {
  derivePresenceActivity,
  HIDDEN_PRESENCE_ACTIVITY,
  type LaunchPresenceContext,
  type RoomPresenceContext,
} from "../lib/socialActivity";
import { usePresenceHeartbeat } from "./usePresenceHeartbeat";
import type { GameStatus, SidebarItemId } from "../app/types";

type UseGameRunStateOptions = {
  activeItem: SidebarItemId;
  activeInstanceName: string | null;
};

export function useGameRunState({ activeItem, activeInstanceName }: UseGameRunStateOptions) {
  const [gameStatus, setGameStatus] = useState<GameStatus>("idle");
  const [isLaunching, setIsLaunching] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const lastRunningRef = useRef(false);
  const gameLaunchStartedAtRef = useRef<number | null>(null);
  const [roomPresenceContext, setRoomPresenceContext] = useState<RoomPresenceContext | null>(null);
  const [launchPresenceContext, setLaunchPresenceContext] = useState<LaunchPresenceContext | null>(null);

  const shareActivity = useActivitySharing();
  const presenceActivity = useMemo(
    () =>
      shareActivity
        ? derivePresenceActivity({
            gameStatus,
            activeItem,
            activeInstanceName,
            roomContext: roomPresenceContext,
            launchContext: launchPresenceContext,
          })
        : HIDDEN_PRESENCE_ACTIVITY,
    [activeItem, activeInstanceName, gameStatus, launchPresenceContext, roomPresenceContext, shareActivity],
  );
  usePresenceHeartbeat(presenceActivity);

  return {
    gameStatus,
    setGameStatus,
    isLaunching,
    setIsLaunching,
    isStopping,
    setIsStopping,
    lastRunningRef,
    gameLaunchStartedAtRef,
    roomPresenceContext,
    setRoomPresenceContext,
    launchPresenceContext,
    setLaunchPresenceContext,
  };
}

export type GameRunState = ReturnType<typeof useGameRunState>;
