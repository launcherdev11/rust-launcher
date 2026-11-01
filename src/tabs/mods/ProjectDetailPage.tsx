import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssetIcon } from "../../components/asset_icon";
import { ErrorState, Spinner } from "../../components/ui";
import { DescriptionBody } from "./DescriptionBody";
import { GalleryLightbox } from "./GalleryLightbox";
import type {
  CatalogVersion,
  ContentProvider,
  GalleryItem,
  MrpackImportProgressPayload,
  ProjectDetail,
  VersionChannel,
} from "./types";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type DetailTab = "overview" | "gallery" | "versions";

const PROJECT_TYPES = new Set(["mod", "modpack", "resourcepack", "shader", "datapack", "plugin"]);

function projectTypeLabel(tt: Tt, type: string): string {
  return PROJECT_TYPES.has(type) ? tt(`mods.projectType.${type}`) : type;
}

function formatCount(value: number): string {
  return value.toLocaleString("ru-RU");
}

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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { root, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [detail]);

  const gallery = detail?.gallery ?? [];

  useEffect(() => {
    if (tab === "gallery" && gallery.length === 0) setTab("overview");
  }, [tab, gallery.length]);

  const switchTab = (next: DetailTab) => {
    setTab(next);
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (root && sentinel && root.scrollTop > sentinel.offsetTop) {
      root.scrollTop = sentinel.offsetTop + 1;
    }
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading && !detail) {
    return (
      <div className="glass-panel flex min-h-0 flex-1 flex-col gap-5 p-5" aria-busy="true">
        <div className="h-8 w-28 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="flex items-end gap-4">
          <div className="h-24 w-24 animate-pulse rounded-2xl bg-white/10" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="h-7 w-64 max-w-full animate-pulse rounded-lg bg-white/10" />
            <div className="h-3.5 w-32 animate-pulse rounded-lg bg-white/[0.07]" />
            <div className="h-3.5 w-96 max-w-full animate-pulse rounded-lg bg-white/[0.07]" />
          </div>
        </div>
        <div className="h-9 w-72 animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="flex gap-5">
          <div className="h-64 flex-1 animate-pulse rounded-2xl bg-white/5" />
          <div className="hidden h-64 w-72 animate-pulse rounded-2xl bg-white/5 lg:block" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
        <button type="button" onClick={onBack} className="btn btn-ghost btn-sm -ml-1 self-start">
          <AssetIcon name="back" className="h-3.5 w-3.5" />
          {tt("mods.backToList")}
        </button>
        <ErrorState
          compact
          title={tt("common.state.loadFailed")}
          description={error || tt("mods.detail.loadFailed")}
        />
      </div>
    );
  }

  const showInstall = canQuickInstall && !isInstalled;
  const renderPrimaryAction = (size: "sm" | "lg") => {
    if (isInstalled && !contentTypeIsModpack) {
      return (
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/10 font-semibold text-emerald-200 ${
            size === "lg" ? "h-11 px-5 text-sm" : "h-8 px-3 text-xs"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
          {tt("mods.installed")}
        </span>
      );
    }
    if (!showInstall) return null;
    return (
      <button
        type="button"
        onClick={onQuickInstall}
        disabled={modpackImportBusy || installBusy}
        aria-busy={installBusy || undefined}
        className={`btn btn-accent ${size === "lg" ? "btn-lg" : "btn-sm"}`}
      >
        {installBusy ? (
          <Spinner className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
        ) : (
          <AssetIcon name="download" className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
        )}
        {installBusy ? tt("mods.installing") : tt("mods.quickInstall")}
      </button>
    );
  };

  const tabs: { id: DetailTab; label: string; count?: number }[] = [
    { id: "overview", label: tt("mods.detail.description") },
    ...(gallery.length > 0
      ? [{ id: "gallery" as const, label: tt("mods.detail.gallery"), count: gallery.length }]
      : []),
    {
      id: "versions",
      label: tt("mods.detail.versions"),
      count: versions.length > 0 ? versions.length : undefined,
    },
  ];

  const heroImage = gallery[0]?.url ?? null;

  return (
    <div className="glass-panel mods-detail-panel-animate relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {lightboxIndex !== null && gallery.length > 0 ? (
        <GalleryLightbox
          tt={tt}
          items={gallery}
          index={Math.min(lightboxIndex, gallery.length - 1)}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}

      <div ref={scrollRef} className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto">
        <header className="relative overflow-hidden px-5 pb-5 pt-4">
          <HeroBackdrop image={heroImage} icon={detail.icon_url} />

          <div className="relative flex items-center justify-between gap-2">
            <button type="button" onClick={onBack} className="btn btn-ghost btn-sm -ml-2">
              <AssetIcon name="back" className="h-3.5 w-3.5" />
              {tt("mods.backToList")}
            </button>
            <button type="button" onClick={onOpenExternal} className="btn btn-soft btn-sm">
              <AssetIcon
                name={provider === "modrinth" ? "modrinth" : "curseforge"}
                className="h-3.5 w-3.5"
              />
              {provider === "modrinth" ? tt("mods.openOnModrinth") : tt("mods.openOnCurseforge")}
            </button>
          </div>

          <div className="relative mt-5 flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-soft">
              {detail.icon_url ? (
                <img src={detail.icon_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <AssetIcon name="mods" className="h-9 w-9 text-white/30" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words text-2xl font-semibold leading-tight text-white">
                  {detail.title}
                </h2>
                <span className="rounded-md bg-white/[0.08] px-2 py-0.5 text-xs font-semibold text-white/65">
                  {projectTypeLabel(tt, detail.project_type)}
                </span>
              </div>
              <div className="mt-1 text-[0.8125rem] text-white/50">
                {tt("mods.byAuthor", { author: detail.author })}
              </div>
              {detail.summary ? (
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/75">
                  {detail.summary}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem] text-white/65">
                <span
                  className="inline-flex items-center gap-1.5 tabular-nums"
                  title={tt("mods.detail.downloads")}
                >
                  <AssetIcon name="download" className="h-3.5 w-3.5 text-white/45" />
                  {formatCount(detail.downloads)}
                </span>
                {provider === "modrinth" && detail.follows > 0 ? (
                  <span
                    className="inline-flex items-center gap-1.5 tabular-nums"
                    title={tt("mods.detail.followers")}
                  >
                    <AssetIcon name="favorite" className="h-3.5 w-3.5 text-white/45" />
                    {formatCount(detail.follows)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">{renderPrimaryAction("lg")}</div>
          </div>
        </header>

        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        <div
          className={`sticky top-0 z-20 flex items-center gap-3 border-b px-5 py-2 transition-[background-color,border-color] duration-200 ${
            collapsed
              ? "border-white/[0.07] bg-ink-900/95 backdrop-blur-md"
              : "border-transparent bg-transparent"
          }`}
        >
          <div
            className={`flex min-w-0 items-center gap-2 overflow-hidden transition-[max-width,opacity] duration-200 ${
              collapsed ? "max-w-[18rem] opacity-100" : "pointer-events-none max-w-0 opacity-0"
            }`}
            aria-hidden={!collapsed}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
              {detail.icon_url ? (
                <img src={detail.icon_url} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <span className="truncate text-sm font-semibold text-white">{detail.title}</span>
          </div>

          <div className="seg-track flex h-9 shrink-0 items-center gap-0.5 p-0.5" role="tablist">
            {tabs.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchTab(item.id)}
                  className={`interactive-press inline-flex h-full items-center gap-1.5 rounded-lg px-4 text-[0.8125rem] font-semibold transition-colors ${
                    active ? "seg-on" : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  {item.label}
                  {item.count !== undefined ? (
                    <span className={`tabular-nums ${active ? "text-white/55" : "text-white/35"}`}>
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div
            className={`ml-auto flex items-center gap-1.5 transition-opacity duration-200 ${
              collapsed ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            aria-hidden={!collapsed}
          >
            {renderPrimaryAction("sm")}
            <button
              type="button"
              onClick={scrollToTop}
              className="icon-btn"
              tabIndex={collapsed ? 0 : -1}
              title={tt("mods.detail.scrollTop")}
              aria-label={tt("mods.detail.scrollTop")}
            >
              <AssetIcon name="arrow_down" className="h-3.5 w-3.5 rotate-180" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-6 pt-5">
          {tab === "overview" ? (
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <DescriptionBody body={detail.body} format={detail.bodyFormat} />
              </div>
              <aside className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-16 lg:w-72">
                {gallery.length > 0 ? (
                  <GalleryPreview
                    tt={tt}
                    items={gallery}
                    onOpen={setLightboxIndex}
                    onShowAll={() => switchTab("gallery")}
                  />
                ) : null}
                <DetailFacts tt={tt} detail={detail} />
                <DetailLinks tt={tt} detail={detail} />
              </aside>
            </div>
          ) : tab === "gallery" ? (
            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {gallery.map((g, i) => (
                <button
                  key={g.url}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="group interactive-press overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900/90 text-left transition hover:border-white/15"
                >
                  <div className="aspect-video overflow-hidden bg-black/30">
                    <img
                      src={g.url}
                      alt={g.title || ""}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </div>
                  {g.title || g.description ? (
                    <div className="px-3.5 py-3">
                      {g.title ? (
                        <div className="truncate text-sm font-semibold text-white">{g.title}</div>
                      ) : null}
                      {g.description ? (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-white/55">
                          {g.description}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-4xl">
              {contentTypeIsModpack && modpackImportBusy ? (
                <ModpackImportProgress
                  tt={tt}
                  progress={modpackImportProgress}
                  onCancel={onCancelModpackImport}
                />
              ) : null}
              <VersionsList
                tt={tt}
                versions={versions}
                versionsLoading={versionsLoading}
                gameVersion={gameVersion}
                contentTypeIsModpack={contentTypeIsModpack}
                installedFilenames={installedFilenames}
                modpackImportBusy={modpackImportBusy}
                onDownloadVersion={onDownloadVersion}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroBackdrop({ image, icon }: { image: string | null; icon: string | null }) {
  if (image) {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={image}
          alt=""
          className="mods-hero-fade h-full w-full scale-105 object-cover opacity-25 blur-[2px]"
        />
      </div>
    );
  }
  if (!icon) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src={icon}
        alt=""
        className="mods-hero-fade absolute -left-10 -top-24 h-80 w-80 object-cover opacity-30 blur-3xl"
      />
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-900/70 p-4">
      <h3 className="text-[0.8125rem] font-semibold text-white/50">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function GalleryPreview({
  tt,
  items,
  onOpen,
  onShowAll,
}: {
  tt: Tt;
  items: GalleryItem[];
  onOpen: (index: number) => void;
  onShowAll: () => void;
}) {
  const thumbs = items.slice(1, 4);
  const hidden = items.length - 1 - thumbs.length;
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-900/70 p-2">
      <button
        type="button"
        onClick={() => onOpen(0)}
        className="group interactive-press block aspect-video w-full overflow-hidden rounded-xl bg-black/30"
        title={items[0].title || undefined}
      >
        <img
          src={items[0].url}
          alt={items[0].title || ""}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </button>
      {thumbs.length > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {thumbs.map((g, i) => {
            const index = i + 1;
            const isLast = i === thumbs.length - 1 && hidden > 0;
            return (
              <button
                key={g.url}
                type="button"
                onClick={() => (isLast ? onShowAll() : onOpen(index))}
                className="group interactive-press relative aspect-video overflow-hidden rounded-lg bg-black/30"
                title={g.title || undefined}
              >
                <img
                  src={g.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {isLast ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
                    +{hidden}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <button type="button" onClick={onShowAll} className="btn btn-ghost btn-sm mt-1.5 w-full">
        {tt("mods.detail.showAll", { count: items.length })}
      </button>
    </section>
  );
}

function DetailFacts({ tt, detail }: { tt: Tt; detail: ProjectDetail }) {
  return (
    <SideCard title={tt("mods.detail.details")}>
      <dl className="space-y-2 text-[0.8125rem]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-white/45">{tt("mods.detail.type")}</dt>
          <dd className="truncate font-semibold text-white/85">
            {projectTypeLabel(tt, detail.project_type)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-white/45">{tt("mods.detail.author")}</dt>
          <dd className="truncate font-semibold text-white/85">{detail.author}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-white/45">{tt("mods.detail.downloads")}</dt>
          <dd className="font-semibold tabular-nums text-white/85">
            {formatCount(detail.downloads)}
          </dd>
        </div>
      </dl>
      {detail.categories.length > 0 ? (
        <div className="mt-4">
          <div className="text-[0.75rem] text-white/45">{tt("mods.detail.categories")}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {detail.categories.map((cat) => (
              <span
                key={cat}
                className="rounded-md bg-white/[0.07] px-2 py-0.5 text-xs capitalize text-white/70"
              >
                {cat.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </SideCard>
  );
}

function DetailLinks({ tt, detail }: { tt: Tt; detail: ProjectDetail }) {
  const links: { label: string; url: string; icon: string }[] = [];
  if (detail.links.wiki) links.push({ label: tt("mods.detail.wiki"), url: detail.links.wiki, icon: "file" });
  if (detail.links.issues)
    links.push({ label: tt("mods.detail.issues"), url: detail.links.issues, icon: "help" });
  if (detail.links.source)
    links.push({ label: tt("mods.detail.source"), url: detail.links.source, icon: "github" });
  if (detail.links.discord)
    links.push({ label: tt("mods.detail.discord"), url: detail.links.discord, icon: "discord" });
  if (links.length === 0) return null;
  return (
    <SideCard title={tt("mods.detail.links")}>
      <div className="-mx-2 flex flex-col">
        {links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noreferrer noopener"
            className="interactive-press flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[0.8125rem] font-semibold text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <AssetIcon name={l.icon} className="h-3.5 w-3.5 text-accent-hi" />
            <span className="truncate">{l.label}</span>
          </a>
        ))}
      </div>
    </SideCard>
  );
}

function ModpackImportProgress({
  tt,
  progress,
  onCancel,
}: {
  tt: Tt;
  progress: MrpackImportProgressPayload | null;
  onCancel: () => void;
}) {
  const percent =
    progress?.total && progress.total > 0
      ? Math.round(((progress.current ?? 0) / progress.total) * 100)
      : 0;
  const phase = progress?.phase;
  const phaseLabel = !progress
    ? ""
    : phase === "start"
      ? tt("mods.modpackImport.start")
      : phase === "overrides"
        ? tt("mods.modpackImport.overrides")
        : phase === "files" || phase === "mods"
          ? tt("mods.modpackImport.files")
          : phase === "done"
            ? tt("mods.modpackImport.done")
            : phase ?? "";
  return (
    <div className="mb-4 rounded-2xl border border-white/[0.07] bg-ink-900/80 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[0.8125rem] font-semibold text-white/85">
            {tt("mods.modpackImport.title")}
          </div>
          <div className="mt-0.5 truncate text-xs text-white/55">
            {phaseLabel}
            {progress?.message ? `: ${progress.message}` : ""}
          </div>
        </div>
        <button type="button" onClick={onCancel} className="btn btn-soft btn-sm">
          {tt("common.cancel")}
        </button>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="progress-fill h-full rounded-full transition-[width] duration-200"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}

const CHANNELS: VersionChannel[] = ["release", "beta", "alpha"];

const CHANNEL_BADGE: Record<VersionChannel, string> = {
  release: "bg-emerald-500/15 text-emerald-200",
  beta: "bg-warn/15 text-warn-hi",
  alpha: "bg-danger/15 text-danger-hi",
};

function ChannelBadge({ tt, channel }: { tt: Tt; channel: VersionChannel }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-[0.75rem] font-semibold ${CHANNEL_BADGE[channel]}`}
    >
      {tt(`mods.channel.${channel}`)}
    </span>
  );
}

function VersionsList({
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
}) {
  const [channel, setChannel] = useState<VersionChannel | "all">("all");
  const counts = useMemo(() => {
    const out: Record<VersionChannel, number> = { release: 0, beta: 0, alpha: 0 };
    for (const v of versions) out[v.channel] += 1;
    return out;
  }, [versions]);
  const presentChannels = CHANNELS.filter((c) => counts[c] > 0);
  const activeChannel = channel !== "all" && counts[channel] === 0 ? "all" : channel;
  const visible =
    activeChannel === "all" ? versions : versions.filter((v) => v.channel === activeChannel);

  if (versionsLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/60">
        <Spinner className="h-4 w-4" />
        {tt("mods.versionsLoading")}
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-white/55">{tt("mods.noAvailableVersions")}</div>
    );
  }
  const filters: { id: VersionChannel | "all"; count: number }[] = [
    { id: "all", count: versions.length },
    ...presentChannels.map((c) => ({ id: c, count: counts[c] })),
  ];

  return (
    <div className="flex flex-col gap-2">
      {presentChannels.length > 1 ? (
        <div className="mb-2 flex">
          <div className="seg-track flex h-9 items-center gap-0.5 p-0.5" role="tablist">
            {filters.map((f) => {
              const active = activeChannel === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setChannel(f.id)}
                  className={`interactive-press inline-flex h-full items-center gap-1.5 rounded-lg px-3.5 text-[0.8125rem] font-semibold transition-colors ${
                    active ? "seg-on" : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  {f.id !== "all" ? (
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${
                        f.id === "release"
                          ? "bg-emerald-400"
                          : f.id === "beta"
                            ? "bg-warn-hi"
                            : "bg-danger-hi"
                      }`}
                    />
                  ) : null}
                  {tt(`mods.channel.${f.id}`)}
                  <span className={`tabular-nums ${active ? "text-white/55" : "text-white/35"}`}>
                    {f.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {visible.map((v) => {
        const installed =
          !contentTypeIsModpack && Boolean(v.filename) && installedFilenames.has(v.filename);
        const canDownload = Boolean(v.filename);
        const gameVersions = gameVersion
          ? [gameVersion]
          : v.game_versions.slice(0, 4).concat(v.game_versions.length > 4 ? ["…"] : []);
        return (
          <div
            key={v.id}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
              installed
                ? "border-emerald-400/25 bg-emerald-500/[0.06]"
                : "border-white/[0.07] bg-ink-900/80"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-white/90">
                  {v.version_number}
                </span>
                <ChannelBadge tt={tt} channel={v.channel} />
                {installed ? (
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[0.75rem] font-semibold text-emerald-200">
                    {tt("mods.installed")}
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-white/55">
                {gameVersions.length > 0 ? (
                  <span className="rounded-md bg-white/[0.07] px-2 py-0.5 tabular-nums">
                    {gameVersion ? `MC ${gameVersion}` : gameVersions.join(", ")}
                  </span>
                ) : null}
                {v.loaders.map((loader) => (
                  <span key={loader} className="rounded-md bg-white/[0.07] px-2 py-0.5 capitalize">
                    {loader}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={!canDownload || modpackImportBusy}
              onClick={() => onDownloadVersion(v)}
              className={`btn btn-sm ${installed ? "btn-soft" : "btn-accent"}`}
            >
              <AssetIcon name="download" className="h-3.5 w-3.5" />
              {tt("mods.download")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
