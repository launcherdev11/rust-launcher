import type { ForgeVersionSummary, NeoForgeVersionSummary, VersionItem } from "./types";

export function isForgeVersion(v: VersionItem): v is ForgeVersionSummary {
  return "forge_build" in v && "installer_url" in v;
}

export function isNeoForgeVersion(v: VersionItem): v is NeoForgeVersionSummary {
  return "neoforge_build" in v && "installer_url" in v;
}

export function neoForgeInstallVersionId(v: NeoForgeVersionSummary): string {
  const fromId = v.id?.trim();
  if (fromId) return fromId;
  const mc = v.mc_version?.trim();
  const build = v.neoforge_build?.trim();
  if (mc && build) return `${mc}-neoforge-${build}`;
  throw new Error("invalid NeoForge version");
}

export function versionInstallJobId(versionId: string) {
  return `version:${versionId}`;
}

export function getVersionLabel(v: VersionItem): string {
  if (isForgeVersion(v)) {
    return `Forge ${v.mc_version}-${v.forge_build}`;
  }
  if (isNeoForgeVersion(v)) {
    return `NeoForge ${v.mc_version}-${v.neoforge_build}`;
  }
  return v.id;
}
