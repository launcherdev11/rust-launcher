import { useCallback, useEffect, useMemo, useState } from "react";
import { getBuild, listBuilds, type BuildDetail, type BuildRow } from "../api/builds";
import { ApiError } from "../api/client";
import { formatPlaytimeShort, useT, type Language } from "../i18n";
import {
  deleteCloudBuild,
  matchesProfile,
  syncProfileFullToCloud,
  type ProfileForSync,
} from "../lib/buildSync";

type NotificationKind = "info" | "success" | "error" | "warning";

type CloudBuildsModalProps = {
  language: Language;
  profiles: ProfileForSync[];
  onClose: () => void;
  onProfilesUpdated?: (profiles: ProfileForSync[]) => void;
  showNotification: (kind: NotificationKind, message: string) => void;
};

export function CloudBuildsModal({
  language,
  profiles,
  onClose,
  onProfilesUpdated,
  showNotification,
}: CloudBuildsModalProps) {
  const tt = useT(language);
  const [loading, setLoading] = useState(true);
  const [builds, setBuilds] = useState<BuildRow[]>([]);
  const [selectedBuild, setSelectedBuild] = useState<BuildDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const profileByBuildId = useMemo(() => {
    const map = new Map<string, ProfileForSync>();
    for (const build of builds) {
      const match = profiles.find((p) => matchesProfile(build, p));
      if (match) map.set(build.id, match);
    }
    return map;
  }, [builds, profiles]);

  const reloadBuilds = useCallback(async () => {
    setLoading(true);
    try {
      setBuilds(await listBuilds());
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void reloadBuilds();
  }, [reloadBuilds]);

  const handleOpenDetail = async (build: BuildRow) => {
    setDetailLoading(true);
    try {
      setSelectedBuild(await getBuild(build.id));
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSyncBuild = async (build: BuildRow) => {
    const profile = profileByBuildId.get(build.id) ?? profiles.find((p) => matchesProfile(build, p));
    if (!profile) {
      showNotification("warning", tt("modpacks.cloud.noLocalProfile"));
      return;
    }
    setActionBusy(true);
    try {
      await syncProfileFullToCloud(profile);
      showNotification("success", tt("modpacks.cloud.syncSuccess", { name: build.name }));
      await reloadBuilds();
      if (selectedBuild?.build.id === build.id) {
        setSelectedBuild(await getBuild(build.id));
      }
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteBuild = async (build: BuildRow) => {
    if (!window.confirm(tt("modpacks.cloud.deleteConfirm", { name: build.name }))) return;
    setActionBusy(true);
    try {
      await deleteCloudBuild(build.id);
      showNotification("success", tt("modpacks.cloud.deleteSuccess"));
      if (selectedBuild?.build.id === build.id) setSelectedBuild(null);
      await reloadBuilds();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const handleSyncAll = async () => {
    setActionBusy(true);
    try {
      const updated: ProfileForSync[] = [];
      for (const profile of profiles) {
        try {
          await syncProfileFullToCloud(profile);
          updated.push(profile);
        } catch (e) {
          console.warn(`[cloud] sync failed for ${profile.id}:`, e);
        }
      }
      showNotification("success", tt("modpacks.cloud.syncAllSuccess"));
      await reloadBuilds();
      onProfilesUpdated?.(updated);
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(80vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12141a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-bold text-white/95">{tt("modpacks.cloud.title")}</h2>
          <p className="mt-1 text-xs text-white/50">{tt("modpacks.cloud.subtitle")}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {selectedBuild ? (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => setSelectedBuild(null)}
                className="self-start text-xs font-semibold text-emerald-300/90 hover:text-emerald-200"
              >
                ← {tt("modpacks.cloud.back")}
              </button>
              <div>
                <p className="text-sm font-semibold text-white/95">{selectedBuild.build.name}</p>
                <p className="mt-1 text-xs text-white/55">
                  {tt("modpacks.cloud.buildMeta", {
                    version: selectedBuild.build.minecraft_version,
                    loader: selectedBuild.build.loader,
                  })}
                </p>
                <p className="mt-1 text-xs text-white/55">
                  {tt("modpacks.cloud.buildPlaytime", {
                    time: formatPlaytimeShort(language, selectedBuild.build.playtime_seconds),
                  })}
                </p>
                {selectedBuild.build.last_launch_at ? (
                  <p className="mt-1 text-xs text-white/55">
                    {tt("modpacks.cloud.buildLastLaunch", {
                      date: new Date(selectedBuild.build.last_launch_at).toLocaleString(),
                    })}
                  </p>
                ) : null}
                {profileByBuildId.get(selectedBuild.build.id) ? (
                  <p className="mt-2 text-xs text-emerald-300/80">
                    {tt("modpacks.cloud.linkedProfile", {
                      name: profileByBuildId.get(selectedBuild.build.id)!.name,
                    })}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-amber-300/80">{tt("modpacks.cloud.unlinked")}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleSyncBuild(selectedBuild.build)}
                  className="interactive-press rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
                >
                  {tt("modpacks.cloud.syncNow")}
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleDeleteBuild(selectedBuild.build)}
                  className="interactive-press rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                >
                  {tt("modpacks.cloud.delete")}
                </button>
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/45">
                  {tt("modpacks.cloud.contents")} (
                  {tt("modpacks.cloud.contentCount", { count: selectedBuild.contents.length })})
                </p>
                {detailLoading ? (
                  <p className="text-sm text-white/60">{tt("modpacks.cloud.loading")}</p>
                ) : selectedBuild.contents.length === 0 ? (
                  <p className="text-sm text-white/60">{tt("modpacks.cloud.noContents")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {selectedBuild.contents.map((item) => {
                      const title =
                        typeof item.metadata?.title === "string"
                          ? item.metadata.title
                          : item.project_id;
                      return (
                        <li
                          key={item.id}
                          className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/85"
                        >
                          <p className="font-medium">{title}</p>
                          <p className="mt-1 text-[11px] text-white/50">
                            {item.source} • {item.type} • {item.project_id}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : loading ? (
            <p className="text-sm text-white/60">{tt("modpacks.cloud.loading")}</p>
          ) : builds.length === 0 ? (
            <p className="text-sm text-white/60">{tt("modpacks.cloud.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {builds.map((build) => {
                const linked = profileByBuildId.get(build.id);
                return (
                  <li key={build.id}>
                    <button
                      type="button"
                      onClick={() => void handleOpenDetail(build)}
                      className="interactive-press w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-left hover:bg-black/45"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white/90">{build.name}</p>
                          <p className="mt-1 text-xs text-white/55">
                            {tt("modpacks.cloud.buildMeta", {
                              version: build.minecraft_version,
                              loader: build.loader,
                            })}
                          </p>
                          <p className="mt-1 text-xs text-white/50">
                            {tt("modpacks.cloud.buildPlaytime", {
                              time: formatPlaytimeShort(language, build.playtime_seconds),
                            })}
                          </p>
                          {linked ? (
                            <p className="mt-1 text-[11px] text-emerald-300/75">
                              {tt("modpacks.cloud.linkedProfile", { name: linked.name })}
                            </p>
                          ) : (
                            <p className="mt-1 text-[11px] text-white/40">
                              {tt("modpacks.cloud.unlinked")}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                          {tt("modpacks.cloud.badge")}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actionBusy || profiles.length === 0}
              onClick={() => void handleSyncAll()}
              className="interactive-press rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
            >
              {tt("modpacks.cloud.syncAll")}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void reloadBuilds()}
              className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
            >
              {tt("modpacks.cloud.refresh")}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-black/50"
          >
            {tt("modpacks.cloud.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
