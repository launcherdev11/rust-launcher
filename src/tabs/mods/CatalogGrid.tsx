import { useRef } from "react";
import { CatalogCardSkeleton, EmptyState, Spinner } from "../../components/ui";
import { useMarqueeSelection } from "../../hooks/useMarqueeSelection";
import type { CatalogProject, ContentProvider } from "./types";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

function DownloadStatIcon() {
  return (
    <img
      src="/launcher-assets/download.png"
      alt=""
      className="h-3 w-3 shrink-0 object-contain"
      aria-hidden="true"
    />
  );
}

function HeartStatIcon() {
  return (
    <img
      src="/launcher-assets/favorite.png"
      alt=""
      className="h-4 w-4 shrink-0 object-contain"
      aria-hidden="true"
    />
  );
}

type CatalogGridProps = {
  tt: Tt;
  projects: CatalogProject[];
  layout: "list" | "grid";
  loading: boolean;
  error: string | null;
  provider: ContentProvider;
  selectedKey: string | null;
  installedKeys: Set<string>;
  installingKeys?: Set<string>;
  batchSelectedKeys?: Set<string>;
  batchInstalling?: boolean;
  allowBatchSelect?: boolean;
  contentTypeIsModpack: boolean;
  activeProfileId?: string | null;
  onSelect: (key: string) => void;
  onQuickInstall?: (key: string) => void;
  onToggleBatchSelect?: (key: string) => void;
  onSetBatchSelection?: (keys: Set<string>) => void;
  onClearBatchSelection?: () => void;
  onBatchInstall?: () => void;
  page: number;
  totalHits: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  emptyMessage: string;
};

export function CatalogGrid({
  tt,
  projects,
  layout,
  loading,
  error,
  provider,
  selectedKey,
  installedKeys,
  installingKeys = new Set(),
  batchSelectedKeys = new Set(),
  batchInstalling = false,
  allowBatchSelect = false,
  contentTypeIsModpack,
  activeProfileId,
  onSelect,
  onQuickInstall,
  onToggleBatchSelect,
  onSetBatchSelection,
  onClearBatchSelection,
  onBatchInstall,
  page,
  totalHits,
  pageSize,
  onPageChange,
  emptyMessage,
}: CatalogGridProps) {
  const totalPages =
    totalHits > 0 ? Math.max(1, Math.ceil(totalHits / pageSize)) : 1;
  const currentPage = page + 1;
  const canPrevPage = currentPage > 1;
  const canNextPage = currentPage < totalPages;
  const showSkeletons = loading && projects.length === 0;
  const skeletonCount = layout === "grid" ? 8 : 5;
  const batchCount = batchSelectedKeys.size;
  const showBatchBar = allowBatchSelect && batchCount > 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handleMarqueePointerDown = useMarqueeSelection({
    containerRef: scrollRef,
    selected: batchSelectedKeys,
    onChange: (keys) => onSetBatchSelection?.(keys),
    enabled: allowBatchSelect && Boolean(onSetBatchSelection) && !batchInstalling,
  });

  return (
    <div className="glass-panel relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-white/60">
        <div className="flex items-center gap-2">
          {error ? <span className="text-rose-300">{error}</span> : null}
          {allowBatchSelect && !error ? (
            <span className="text-white/45">{tt("mods.batch.hint")}</span>
          ) : null}
        </div>
      </div>
      <div
        ref={scrollRef}
        onPointerDown={handleMarqueePointerDown}
        className="custom-scrollbar -mr-2 min-h-0 flex-1 overflow-y-auto pr-2"
      >
        {showSkeletons ? (
          <div
            className={
              layout === "grid"
                ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "flex flex-col gap-2"
            }
            aria-busy="true"
            aria-label={tt("mods.loadingPopular")}
          >
            {Array.from({ length: skeletonCount }, (_, i) => (
              <CatalogCardSkeleton key={i} layout={layout} />
            ))}
          </div>
        ) : null}

        {projects.length > 0 && (
          <div
            className={
              layout === "grid"
                ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "flex flex-col gap-2"
            }
          >
            {projects.map((p) => {
              const isActive = selectedKey === p.key;
              const isInstalledInProfile =
                activeProfileId != null &&
                !contentTypeIsModpack &&
                installedKeys.has(p.key);
              const isInstalling = installingKeys.has(p.key);
              const isBatchSelected = batchSelectedKeys.has(p.key);
              const canSelect =
                allowBatchSelect &&
                !isInstalledInProfile &&
                Boolean(onToggleBatchSelect);

              return (
                <div
                  key={p.key}
                  data-marquee-key={canSelect ? p.key : undefined}
                  className={`group relative w-full select-none rounded-2xl border text-left transition ${
                    layout === "grid" ? "flex flex-col" : "flex items-stretch"
                  } ${
                    isBatchSelected
                      ? "border-accent-to/70 bg-accent-from/15"
                      : isInstalledInProfile
                        ? isActive
                          ? "border-emerald-400/60 bg-ink-800"
                          : "border-emerald-400/30 bg-ink-900/90 hover:border-emerald-400/50 hover:bg-ink-850"
                        : isActive
                          ? "border-accent-to/60 bg-ink-800"
                          : "border-white/[0.07] bg-ink-900/90 hover:border-white/15 hover:bg-ink-850"
                  }`}
                >
                  {canSelect ? (
                    <label
                      className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isBatchSelected}
                        onChange={() => onToggleBatchSelect?.(p.key)}
                        className="accent-checkbox accent-checkbox-lg"
                        aria-label={tt("mods.batch.selectOne", { title: p.title })}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    onClick={(e) => {
                      if (canSelect && (e.ctrlKey || e.metaKey)) {
                        onToggleBatchSelect?.(p.key);
                        return;
                      }
                      onSelect(p.key);
                    }}
                    className={`interactive-press flex w-full min-w-0 flex-1 gap-0 px-3 py-3 text-left ${
                      layout === "grid" ? "flex-col" : "items-stretch"
                    } ${canSelect ? "pl-9" : ""}`}
                  >
                    <div className="mr-3 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                      {p.icon_url ? (
                        <img
                          src={p.icon_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-white/50">
                          {tt("mods.noIcon")}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">
                          {p.title}
                        </span>
                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[0.75rem] text-gray-300">
                          {p.project_type}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-white/70">
                        {p.description}
                      </p>
                      <p className="mt-1 text-[0.8125rem] text-white/50">
                        by {p.author}
                      </p>
                    </div>
                    <div className="flex flex-col items-end justify-between text-right text-[0.8125rem] text-white/70">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <DownloadStatIcon />
                          <span>{p.downloads.toLocaleString("ru-RU")}</span>
                        </div>
                        {provider === "modrinth" && p.follows > 0 && (
                          <div className="flex items-center gap-1">
                            <HeartStatIcon />
                            <span>{p.follows.toLocaleString("ru-RU")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                  {onQuickInstall && !isInstalledInProfile && (
                    <button
                      type="button"
                      title={tt("mods.quickInstall")}
                      disabled={isInstalling}
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickInstall(p.key);
                      }}
                      className={`absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-xl accent-bg px-2.5 py-1 text-[0.75rem] font-semibold text-white shadow-soft transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${
                        isInstalling
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      {isInstalling ? <Spinner className="h-3 w-3" /> : null}
                      {isInstalling
                        ? tt("mods.installing")
                        : tt("mods.quickInstall")}
                    </button>
                  )}
                  {isInstalledInProfile && (
                    <span className="absolute right-2 bottom-2 rounded-md bg-emerald-500/80 px-2 py-0.5 text-[0.75rem] font-semibold text-white">
                      {tt("mods.installed")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!loading && projects.length === 0 && (
          <EmptyState title={emptyMessage} compact />
        )}
      </div>
      {showBatchBar ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent-to/30 bg-accent-from/10 px-3 py-2 text-[0.8125rem] text-white/85">
          <span className="font-semibold">
            {tt("mods.batch.selected", { count: batchCount })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={batchInstalling}
              onClick={() => onClearBatchSelection?.()}
              className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 disabled:opacity-40"
            >
              {tt("mods.batch.clear")}
            </button>
            <button
              type="button"
              disabled={batchInstalling}
              onClick={() => onBatchInstall?.()}
              className="interactive-press inline-flex items-center gap-1.5 rounded-xl accent-bg px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
            >
              {batchInstalling ? <Spinner className="h-3 w-3" /> : null}
              {batchInstalling
                ? tt("mods.batch.installing")
                : tt("mods.batch.download", { count: batchCount })}
            </button>
          </div>
        </div>
      ) : null}
      {totalHits > pageSize && (
        <div className="mt-2 flex items-center justify-between rounded-2xl bg-black/40 px-3 py-2 text-[0.8125rem] text-white/70">
          <span>
            {tt("mods.pageOf", { current: currentPage, total: totalPages })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canPrevPage || loading}
              onClick={() => onPageChange(Math.max(0, page - 1))}
              className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tt("mods.prev")}
            </button>
            <button
              type="button"
              disabled={!canNextPage || loading}
              onClick={() => onPageChange(page + 1)}
              className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tt("mods.next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
