import { invoke } from "@tauri-apps/api/core";
import type { ScreenshotInfo } from "./types";

export function listScreenshots(profileId: string): Promise<ScreenshotInfo[]> {
  return invoke<ScreenshotInfo[]>("list_screenshots", { profileId });
}

export function getScreenshotThumbnail(
  profileId: string,
  name: string,
  maxSize?: number,
): Promise<string | null> {
  return invoke<string | null>("get_screenshot_thumbnail", {
    profileId,
    name,
    maxSize,
  });
}

export function getScreenshotDataUri(
  profileId: string,
  name: string,
): Promise<string | null> {
  return invoke<string | null>("get_screenshot_data_uri", { profileId, name });
}

export function deleteScreenshot(profileId: string, name: string): Promise<void> {
  return invoke("delete_screenshot", { profileId, name });
}

export function openScreenshotsFolder(profileId: string): Promise<void> {
  return invoke("open_screenshots_folder", { profileId });
}

export function openScreenshot(profileId: string, name: string): Promise<void> {
  return invoke("open_screenshot", { profileId, name });
}
