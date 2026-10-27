import { invoke } from "@tauri-apps/api/core";

export type RunOutcome = "running" | "ok" | "crashed" | "stopped" | "interrupted";

export type GameRun = {
  id: string;
  profileId: string | null;
  versionId: string;
  javaPath: string | null;
  ramMb: number | null;
  startedAtMs: number;
  endedAtMs: number | null;
  exitCode: number | null;
  outcome: RunOutcome;
  lineCount: number;
  errorLines: number;
  truncated: boolean;
};

export type RunLogLine = { line: string; stderr: boolean };

export type RunSearchHit = { runId: string; lineNo: number; line: string };

export const listGameRuns = (profileId: string) =>
  invoke<GameRun[]>("list_game_runs", { profileId });

export const readGameRunLog = (profileId: string, runId: string) =>
  invoke<RunLogLine[]>("read_game_run_log", { profileId, runId });

export const deleteGameRun = (profileId: string, runId: string) =>
  invoke<void>("delete_game_run", { profileId, runId });

export const searchGameRuns = (profileId: string, query: string) =>
  invoke<RunSearchHit[]>("search_game_runs", { profileId, query });

export const buildGameRunReport = (profileId: string, runId: string) =>
  invoke<string>("build_game_run_report", { profileId, runId });
