import { localeTag, t, type Language } from "../../i18n";
import type { ContentTab, LoaderId, LoaderVersionOption } from "./types";

export const loaderLabels: Record<LoaderId, string> = {
  vanilla: "Vanilla",
  forge: "Forge",
  fabric: "Fabric",
  quilt: "Quilt",
  neoforge: "NeoForge",
};

export function shortGameVersionLabel(gameVersion: string): string {
  const parts = gameVersion.split(".");
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return `${parts[0]}.${parts[1]}`;
  }
  return gameVersion;
}

export function defaultProfileName(loader: LoaderId, gameVersion: string): string {
  return `${loaderLabels[loader]} ${shortGameVersionLabel(gameVersion)}`.slice(0, 50);
}

export function pickDefaultLoaderVersion(options: LoaderVersionOption[]): string {
  const stable = options.find((o) => o.channel === "stable");
  return stable?.version ?? options[0]?.version ?? "";
}

export function countLabel(count: number, language: Language): string {
  return t(language, "common.format.modsCount", { count });
}

export function formatLastPlayedAt(ts: number | null | undefined, language: Language): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return "—";
  try {
    return new Date(ts * 1000).toLocaleString(localeTag(language), {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

export const CONTENT_TAB_KEYS: Record<ContentTab, string> = {
  mods: "modpacks.contentTabs.mods",
  resourcepacks: "modpacks.contentTabs.resourcepacks",
  shaderpacks: "modpacks.contentTabs.shaderpacks",
};

export function filterPathsForContentTab(tab: ContentTab, paths: string[]): string[] {
  const okExt = (p: string, exts: string[]) => {
    const lower = p.toLowerCase();
    const dot = lower.lastIndexOf(".");
    if (dot < 0) return false;
    const ext = lower.slice(dot + 1);
    return exts.includes(ext);
  };
  if (tab === "mods") return paths.filter((p) => okExt(p, ["jar"]));
  if (tab === "shaderpacks") return paths.filter((p) => okExt(p, ["zip"]));
  return paths.filter((p) => okExt(p, ["zip", "rar", "7z", "mcpack"]));
}

export const MANAGE_ACTION_BTN_CLASS =
  "interactive-press inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl px-3 text-xs font-semibold text-white";

export const MANAGE_ICON_BTN_CLASS =
  "interactive-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-white";

export const CONTENT_SEG_BTN_CLASS =
  "interactive-press inline-flex h-full shrink-0 items-center gap-1.5 rounded-[0.5rem] px-3 text-xs font-semibold leading-none transition-colors";

export function computeTabUiScale(width: number): number {
  const t = Math.min(1, Math.max(0, (width - 1280) / 1280));
  return Math.round((1 + t * 0.25) * 100) / 100;
}

export const MODPACK_MANAGE_SPLIT_STORAGE_KEY = "modpack_manage_main_width_frac";
export const MODPACK_MANAGE_SPLIT_MIN = 0.22;
export const MODPACK_MANAGE_SPLIT_MAX = 0.9;
export const MODPACK_MANAGE_SPLIT_DEFAULT = 0.68;

export const BUILD_PRESETS_UI_ENABLED = false;
