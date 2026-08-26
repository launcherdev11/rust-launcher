import { useState, type ReactNode } from "react";
import { Spinner } from "../../components/ui";
import { DescriptionBody } from "./DescriptionBody";
import type {
  CatalogVersion,
  ContentProvider,
  MrpackImportProgressPayload,
  ProjectDetail,
} from "./types";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

function DownloadStatIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <img
      src="/launcher-assets/download.png"
      alt=""
      className={`shrink-0 object-contain ${className}`}
      aria-hidden="true"
    />
  );
}

type DetailTab = "overview" | "versions";

type ProjectDetailPageProps = {
  tt: Tt;
  provider: ContentProvider;
  detail: ProjectDetail | null;
  loading: boolean;
  error: string | null;
  isInstalled: boolean;
  versions: CatalogVersion[];
  versionsLoading: boolean;
  gameVersion: string;
  modpackImportBusy: boolean;
  modpackImportProgress: MrpackImportProgressPayload | null;
  contentTypeIsModpack: boolean;
  installedFilenames: Set<string>;
  onBack: () => void;
  onOpenExternal: () => void;
  onQuickInstall: () => void;
  onDownloadVersion: (v: CatalogVersion) => void;
  onCancelModpackImport: () => void;
  canQuickInstall: boolean;
  installBusy?: boolean;
};

export function ProjectDetailPage({
  tt,
  provider,
  detail,
  loading,
  error,
  isInstalled,
  versions,
  versionsLoading,
  gameVersion,
  modpackImportBusy,
  modpackImportProgress,
  contentTypeIsModpack,
  installedFilenames,
  onBack,
  onOpenExternal,
  onQuickInstall,
  onDownloadVersion,
  onCancelModpackImport,
  canQuickInstall,
  installBusy = false,
}: ProjectDetailPageProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");

  const modpackImportPercent =
    modpackImportProgress?.total && modpackImportProgress.total > 0
      ? Math.round(
          ((modpackImportProgress.current ?? 0) / modpackImportProgress.total) *
            100,
        )
      : null;

  const modpackImportPhaseLabel = (() => {
    if (!modpackImportProgress) return "";
    const phase = modpackImportProgress.phase;
    if (phase === "start") return tt("mods.modpackImport.start");
    if (phase === "overrides") return tt("mods.modpackImport.overrides");
    if (phase === "files") return tt("mods.modpackImport.files");
    return phase;
  })();

  if (loading && !detail) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 rounded-2xl border border-white/12 bg-black/65 p-5 shadow-soft backdrop-blur-xl"
        aria-busy="true"
      >
        <div className="flex items-center gap-3">
          <div className="h-16 w-16 animate-pulse rounded-2xl bg-white/10" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-48 animate-pulse rounded-lg bg-white/10" />
            <div className="h-3 w-72 max-w-full animate-pulse rounded-lg bg-white/10" />
            <div className="h-3 w-40 animate-pulse rounded-lg bg-white/10" />
          </div>
        </div>
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
        <button
          type="button"
          onClick={onBack}
          className="interactive-press self-start rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/20"
        >
          {tt("mods.backToList")}
        </button>
        <div className="text-sm text-rose-300">
          {error || tt("mods.detail.loadFailed")}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel mods-detail-panel-animate flex min-h-0 flex-1 flex-col overflow-hidden">
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-full max-w-full rounded-2xl object-contain shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="shrink-0 border-b border-white/10 px-4 pb-3 pt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="interactive-press rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/20"
          >
            {tt("mods.backToList")}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canQuickInstall && !isInstalled && (
              <button
                type="button"
                onClick={onQuickInstall}
                disabled={modpackImportBusy || installBusy}
                aria-busy={installBusy || undefined}
                className="interactive-press inline-flex items-center gap-2 rounded-full accent-bg px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-40"
              >
                {installBusy ? <Spinner className="h-4 w-4" /> : null}
                {installBusy ? tt("mods.installing") : tt("mods.quickInstall")}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenExternal}
              className="interactive-press rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-violet-200 hover:bg-white/20"
            >
              {provider === "modrinth"
                ? tt("mods.openOnModrinth")
                : tt("mods.openOnCurseforge")}
            </button>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/5">
            {detail.icon_url ? (
              <img
                src={detail.icon_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-[10px] text-white/50">{tt("mods.noIcon")}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-white">
                {detail.title}
              </h2>
              {isInstalled && (
                <span className="rounded-full bg-emerald-500/80 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  {tt("mods.installed")}
                </span>
              )}
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] uppercase tracking-[0.14em] text-gray-300">
                {detail.project_type}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-white/55">by {detail.author}</div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/65">
              <span className="inline-flex items-center gap-1.5">
                <DownloadStatIcon />
                {detail.downloads.toLocaleString("ru-RU")}
              </span>
              {provider === "modrinth" && detail.follows > 0 && (
                <span>★ {detail.follows.toLocaleString("ru-RU")}</span>
              )}
            </div>
          </div>
        </div>

        {detail.summary && (
          <p className="mt-3 text-sm text-white/75">{detail.summary}</p>
        )}

        {detail.categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {detail.categories.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] capitalize text-white/70"
              >
                {cat.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex h-10 items-center gap-1 rounded-2xl border border-white/12 bg-black/40 p-1">
          {(
            [
              ["overview", "mods.detail.description"],
              ["versions", "mods.detail.versions"],
            ] as [DetailTab, string][]
          ).map(([id, key]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`interactive-press flex-1 rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-white/90 text-black"
                    : "text-white/65 hover:bg-white/10 hover:text-white"
                }`}
              >
                {tt(key)}
                {id === "versions" && versions.length > 0
                  ? ` (${versions.length})`
                  : ""}
              </button>
            );
          })}
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "overview" ? (
          <div className="mx-auto w-full max-w-4xl">
            {detail.gallery.length > 0 && (
              <div className="mb-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  {tt("mods.detail.gallery")}
                </div>
                <div className="custom-scrollbar flex gap-2 overflow-x-auto pb-1">
                  {detail.gallery.map((g) => (
                    <button
                      key={g.url}
                      type="button"
                      onClick={() => setLightboxUrl(g.url)}
                      className="interactive-press h-28 w-44 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40"
                      title={g.title || undefined}
                    >
                      <img
                        src={g.url}
                        alt={g.title || ""}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <DescriptionBody body={detail.body} format={detail.bodyFormat} />
            <div className="mt-4">
              <DetailLinks tt={tt} detail={detail} />
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl">
            {contentTypeIsModpack && modpackImportBusy && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white/80">
                      {tt("mods.modpackImport.title")}
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">
                      {modpackImportPhaseLabel}
                      {modpackImportProgress?.message
                        ? `: ${modpackImportProgress.message}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onCancelModpackImport}
                    className="interactive-press shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20"
                  >
                    {tt("common.cancel")}
                  </button>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full accent-bg transition-[width] duration-200"
                    style={{
                      width: `${Math.max(0, Math.min(100, modpackImportPercent ?? 0))}%`,
                    }}
                  />
                </div>
              </div>
            )}
            {renderVersionsList({
              tt,
              versions,
              versionsLoading,
              gameVersion,
              contentTypeIsModpack,
              installedFilenames,
              modpackImportBusy,
              onDownloadVersion,
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailLinks({
  tt,
  detail,
}: {
  tt: Tt;
  detail: ProjectDetail;
}): ReactNode {
  const links: { label: string; url: string }[] = [];
  if (detail.links.wiki) links.push({ label: tt("mods.detail.wiki"), url: detail.links.wiki });
  if (detail.links.issues)
    links.push({ label: tt("mods.detail.issues"), url: detail.links.issues });
  if (detail.links.source)
    links.push({ label: tt("mods.detail.source"), url: detail.links.source });
  if (detail.links.discord)
    links.push({ label: tt("mods.detail.discord"), url: detail.links.discord });
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer noopener"
          className="interactive-press rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-violet-200 hover:bg-white/20"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

function renderVersionsList({
  tt,
  versions,
  versionsLoading,
  gameVersion,
  contentTypeIsModpack,
  installedFilenames,
  modpackImportBusy,
  onDownloadVersion,
}: {
  tt: Tt;
  versions: CatalogVersion[];
  versionsLoading: boolean;
  gameVersion: string;
  contentTypeIsModpack: boolean;
  installedFilenames: Set<string>;
  modpackImportBusy: boolean;
  onDownloadVersion: (v: CatalogVersion) => void;
}): ReactNode {
  if (versionsLoading) {
    return (
      <div className="py-8 text-center text-sm text-white/70">
        {tt("mods.versionsLoading")}
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-white/60">
        {tt("mods.noAvailableVersions")}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {versions.map((v) => {
        const isInstalled =
          !contentTypeIsModpack &&
          Boolean(v.filename) &&
          installedFilenames.has(v.filename);
        const canDownload = Boolean(v.filename);
        return (
          <div
            key={v.id}
            className="flex items-center gap-3 rounded-2xl bg-black/35 px-4 py-3 text-sm text-white/80"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold">{v.version_number}</span>
                {isInstalled && (
                  <span className="shrink-0 rounded-full bg-emerald-500/80 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    {tt("mods.installed")}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/55">
                {gameVersion ? (
                  <span className="rounded-lg bg-white/10 px-2 py-0.5">
                    MC {gameVersion}
                  </span>
                ) : (
                  v.game_versions.length > 0 && (
                    <span className="rounded-lg bg-white/10 px-2 py-0.5">
                      {v.game_versions.slice(0, 4).join(", ")}
                      {v.game_versions.length > 4 ? "…" : ""}
                    </span>
                  )
                )}
                {v.loaders.map((loader) => (
                  <span
                    key={loader}
                    className="rounded-lg bg-white/10 px-2 py-0.5 capitalize"
                  >
                    {loader}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={!canDownload || modpackImportBusy}
              onClick={() => onDownloadVersion(v)}
              className="interactive-press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl accent-bg px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:opacity-90 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
            >
              <DownloadStatIcon className="h-4 w-4" />
              <span>{tt("mods.download")}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
