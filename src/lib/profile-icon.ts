import { convertFileSrc } from "@tauri-apps/api/core";

export type ProfileIconSource = {
  id: string;
  name: string;
  icon_path: string | null;
  directory: string;
};

export function resolveIconSrc(iconPath: string): string {
  if (iconPath.startsWith("http://") || iconPath.startsWith("https://") || iconPath.startsWith("data:")) {
    return iconPath;
  }

  let localPath = iconPath;
  if (localPath.startsWith("file://")) {
    localPath = localPath.replace(/^file:\/\//, "");
  }

  const normalized = localPath.replace(/\\/g, "/");
  const driveMatch = normalized.match(/^\/([a-zA-Z]:\/.*)$/);
  if (driveMatch) {
    localPath = driveMatch[1];
  }

  return convertFileSrc(localPath);
}

export function getProfileIconPath(profile: ProfileIconSource): string {
  const baseDir = profile.directory.replace(/\\/g, "/").replace(/\/$/, "");
  if (profile.icon_path) return profile.icon_path;
  return `${baseDir}/icon.png`;
}

export function profileIconInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}
