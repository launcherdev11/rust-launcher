import { useEffect, useRef } from "react";
import { getCurrentWindow, ProgressBarStatus, UserAttentionType } from "@tauri-apps/api/window";
import type { GameStatus } from "../app/types";
import { disposeWhenResolved } from "../lib/tauriEvents";
import type { DownloadJob } from "./useDownloadJobs";

type TaskbarState = { status: ProgressBarStatus; progress?: number };

function deriveState(jobs: DownloadJob[], isLaunching: boolean, crashed: boolean): TaskbarState {
  if (jobs.length > 0) {
    const known = jobs.filter((j) => j.percent != null);
    const allPaused = jobs.every((j) => j.status === "paused");
    if (known.length === 0) {
      return { status: allPaused ? ProgressBarStatus.Paused : ProgressBarStatus.Indeterminate };
    }
    const avg = known.reduce((sum, j) => sum + (j.percent ?? 0), 0) / known.length;
    return {
      status: allPaused ? ProgressBarStatus.Paused : ProgressBarStatus.Normal,
      progress: Math.max(1, Math.min(100, Math.round(avg))),
    };
  }
  if (isLaunching) return { status: ProgressBarStatus.Indeterminate };
  if (crashed) return { status: ProgressBarStatus.Error, progress: 100 };
  return { status: ProgressBarStatus.None };
}

export function useTaskbarProgress(jobs: DownloadJob[], isLaunching: boolean, gameStatus: GameStatus) {
  const crashed = gameStatus === "crashed";
  const crashSeenRef = useRef(false);
  const lastKeyRef = useRef("");
  const hadJobsRef = useRef(false);

  useEffect(() => {
    if (!crashed) crashSeenRef.current = false;
  }, [crashed]);

  useEffect(() => {
    const state = deriveState(jobs, isLaunching, crashed && !crashSeenRef.current);
    const key = `${state.status}:${state.progress ?? ""}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    void getCurrentWindow().setProgressBar(state).catch(() => {});
  }, [jobs, isLaunching, crashed]);

  useEffect(() => {
    const hasJobs = jobs.length > 0;
    const finished = hadJobsRef.current && !hasJobs;
    hadJobsRef.current = hasJobs;
    if (!finished) return;
    const win = getCurrentWindow();
    void win
      .isFocused()
      .then((focused) => (focused ? undefined : win.requestUserAttention(UserAttentionType.Informational)))
      .catch(() => {});
  }, [jobs.length]);

  useEffect(() => {
    if (!crashed) return;
    const win = getCurrentWindow();
    const markSeen = () => {
      if (crashSeenRef.current) return;
      crashSeenRef.current = true;
      if (lastKeyRef.current.startsWith(`${ProgressBarStatus.Error}:`)) {
        lastKeyRef.current = "";
        void win.setProgressBar({ status: ProgressBarStatus.None }).catch(() => {});
      }
    };
    void win
      .isFocused()
      .then((focused) => (focused ? markSeen() : win.requestUserAttention(UserAttentionType.Critical)))
      .catch(() => {});
    return disposeWhenResolved(
      win.onFocusChanged(({ payload: focused }) => {
        if (focused) markSeen();
      }),
    );
  }, [crashed]);
}
