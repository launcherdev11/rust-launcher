import { invoke } from "@tauri-apps/api/core";
import type { ScreenshotInfo } from "./types";

export function listScreenshots(): Promise<ScreenshotInfo[]> {
  return invoke<ScreenshotInfo[]>("list_screenshots");
}

export function getScreenshotDataUri(name: string): Promise<string | null> {
  return invoke<string | null>("get_screenshot_data_uri", { name });
}

export function deleteScreenshot(name: string): Promise<void> {
  return invoke("delete_screenshot", { name });
}

export function openScreenshotsFolder(): Promise<void> {
  return invoke("open_screenshots_folder");
}

export function openScreenshot(name: string): Promise<void> {
  return invoke("open_screenshot", { name });
}
