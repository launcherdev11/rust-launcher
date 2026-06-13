import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  formatByteSize,
  formatPlaytimeDetailed,
  localeTag,
  useT,
  type Language,
} from "../i18n";
import { ProfileInstanceIcon } from "./profile_instance_icon";

export type ProfileInfoData = {
  id: string;
  name: string;
  icon_path?: string | null;
  game_version: string;
  loader: string;
  loader_version?: string | null;
  created_at: number;
  play_time_seconds: number | null;
  last_played_at?: number | null;
  mods_count?: number;
  resourcepacks_count?: number;
  shaderpacks_count?: number;
  total_size_bytes?: number;
  directory?: string;
};

const LOADER_LABELS: Record<string, string> = {
  vanilla: "Vanilla",
  forge: "Forge",
  fabric: "Fabric",
  quilt: "Quilt",
  neoforge: "NeoForge",
};

function formatTimestamp(ts: number | null | undefined, language: Language): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return "—";
  try {
    return new Date(ts * 1000).toLocaleString(localeTag(language), {
      dateStyle: "long",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

function formatLoaderLabel(loader: string): string {
  return LOADER_LABELS[loader.toLowerCase()] ?? loader;
}

function formatLoaderFull(loader: string, loaderVersion: string | null | undefined): string {
  const label = formatLoaderLabel(loader);
  const version = loaderVersion?.trim();
  if (!version || loader.toLowerCase() === "vanilla") return label;
  return `${label} ${version}`;
}

type ProfileInfoModalProps = {
  language: Language;
  profile: ProfileInfoData | null;
  onClose: () => void;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-white/8 bg-black/30 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm font-medium text-white/90 sm:text-right">
        {value}
      </dd>
    </div>
  );
}

export function ProfileInfoModal({ language, profile, onClose }: ProfileInfoModalProps) {
  const tt = useT(language);
  const [launcherVersion, setLauncherVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setLauncherVersion(v);
      })
      .catch(() => {
        if (!cancelled) setLauncherVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  if (!profile) return null;

  const loaderFull = formatLoaderFull(profile.loader, profile.loader_version);
  const contentParts: string[] = [];
  if (profile.mods_count != null) {
    contentParts.push(tt("modpacks.profileInfo.contentMods", { count: profile.mods_count }));
  }
  if (profile.resourcepacks_count != null) {
    contentParts.push(
      tt("modpacks.profileInfo.contentResourcepacks", { count: profile.resourcepacks_count }),
    );
  }
  if (profile.shaderpacks_count != null) {
    contentParts.push(
      tt("modpacks.profileInfo.contentShaders", { count: profile.shaderpacks_count }),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-lg rounded-3xl border border-white/15 bg-black/75 p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ProfileInstanceIcon profile={{ id: profile.id, name: profile.name }} imageFit="contain" />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.16em] text-white/50">
                {tt("modpacks.profileInfo.title")}
              </div>
              <div className="truncate text-lg font-semibold text-white">{profile.name}</div>
            </div>
          </div>
          <button
            type="button"
            className="interactive-press shrink-0 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
            onClick={onClose}
          >
            {tt("modpacks.profileInfo.close")}
          </button>
        </div>

        <dl className="flex max-h-[min(70vh,32rem)] flex-col gap-2 overflow-y-auto pr-0.5">
          <InfoRow label={tt("modpacks.profileInfo.gameVersion")} value={profile.game_version} />
          <InfoRow label={tt("modpacks.profileInfo.loader")} value={loaderFull} />
          <InfoRow
            label={tt("modpacks.profileInfo.launcherVersion")}
            value={launcherVersion ? `v${launcherVersion}` : "—"}
          />
          <InfoRow
            label={tt("modpacks.profileInfo.playtime")}
            value={formatPlaytimeDetailed(language, profile.play_time_seconds)}
          />
          <InfoRow
            label={tt("modpacks.profileInfo.lastPlayedAt")}
            value={formatTimestamp(profile.last_played_at, language)}
          />
          <InfoRow
            label={tt("modpacks.profileInfo.createdAt")}
            value={formatTimestamp(profile.created_at, language)}
          />
          {profile.total_size_bytes != null ? (
            <InfoRow
              label={tt("modpacks.profileInfo.size")}
              value={formatByteSize(language, profile.total_size_bytes, { zeroAt: "bytes" })}
            />
          ) : null}
          {contentParts.length > 0 ? (
            <InfoRow label={tt("modpacks.profileInfo.content")} value={contentParts.join(" · ")} />
          ) : null}
          {profile.directory ? (
            <InfoRow label={tt("modpacks.profileInfo.folder")} value={profile.directory} />
          ) : null}
          <InfoRow label={tt("modpacks.profileInfo.profileId")} value={profile.id} />
        </dl>
      </div>
    </div>
  );
}

export function ProfileInfoIcon({ className }: { className?: string }) {
  return (
    <img
      src="/launcher-assets/info_info.png"
      alt=""
      className={className ?? "h-4 w-4 object-contain"}
      aria-hidden
    />
  );
}
