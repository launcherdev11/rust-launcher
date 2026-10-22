import type { VersionListItem } from "./types";

export function gameVersionFromListItem(version: VersionListItem): string {
  if (version.loader === "forge") {
    const m = /^(.+)-forge-/.exec(version.id);
    return m?.[1] ?? version.id;
  }
  if (version.loader === "neoforge") {
    const m = /^(.+)-neoforge-/.exec(version.id);
    return m?.[1] ?? version.id;
  }
  return version.id;
}

