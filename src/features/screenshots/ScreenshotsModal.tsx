import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DeleteIcon } from "../../components/delete_icon";
import { formatByteSize, localeTag, useT } from "../../i18n";
import type { Language } from "../../i18n";
import { useScreenshots } from "./useScreenshots";

type ScreenshotsModalProps = {
  language: Language;
  profileId: string | null;
  open: boolean;
  onClose: () => void;
  showNotification: (
    kind: "info" | "success" | "error" | "warning",
    message: string,
  ) => void;
};

function formatDate(ts: number, language: Language): string {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toLocaleString(localeTag(language));
  } catch {
    return "—";
  }
}

type ScreenshotGridItemProps = {
  name: string;
  active: boolean;
  thumb: string | undefined;
  scrollRoot: Element | null;
  onSelect: () => void;
  onVisible: (name: string) => void;
};

function ScreenshotGridItem({
  name,
  active,
  thumb,
  scrollRoot,
  onSelect,
  onVisible,
}: ScreenshotGridItemProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible(name);
      },
      { root: scrollRoot, rootMargin: "120px", threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [name, onVisible, scrollRoot]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className={`interactive-press overflow-hidden rounded-xl border text-left transition-colors ${
        active
          ? "border-white/40 bg-white/15"
          : "border-white/10 bg-black/30 hover:bg-white/10"
      }`}
    >
      <div className="aspect-video w-full bg-black/50">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-white/40">
            …
          </div>
        )}
      </div>
      <div className="truncate px-2 py-1 text-[10px] text-white/75">{name}</div>
    </button>
  );
}

export function ScreenshotsModal({
  language,
  profileId,
  open,
  onClose,
  showNotification,
}: ScreenshotsModalProps) {
  const tt = useT(language);
  const [listScrollEl, setListScrollEl] = useState<HTMLDivElement | null>(null);
  const {
    items,
    loading,
    thumbnails,
    selectedName,
    setSelectedName,
    previewUri,
    previewLoading,
    requestThumbnail,
    refresh,
    remove,
    openFolder,
    openInSystem,
  } = useScreenshots(open, profileId);

  const selected = useMemo(
    () => items.find((s) => s.name === selectedName) ?? null,
    [items, selectedName],
  );

  if (!open) return null;

  async function handleDelete(name: string) {
    const confirmed = window.confirm(tt("modpacks.screenshots.deleteConfirm", { name }));
    if (!confirmed) return;
    try {
      await remove(name);
      showNotification("success", tt("modpacks.screenshots.deleted"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("modpacks.screenshots.deleteFailed", { msg }));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-black/70 p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.16em] text-white/50">
              {tt("modpacks.screenshots.subtitle")}
            </div>
            <div className="text-lg font-semibold text-white">
              {tt("modpacks.screenshots.title")}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="interactive-press inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {tt("modpacks.screenshots.refresh")}
            </button>
            <button
              type="button"
              className="interactive-press rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
              onClick={() => {
                void openFolder().catch((e) => {
                  const msg = e instanceof Error ? e.message : String(e);
                  showNotification("error", tt("modpacks.screenshots.openFolderFailed", { msg }));
                });
              }}
            >
              {tt("modpacks.screenshots.openFolder")}
            </button>
            <button
              type="button"
              className="interactive-press rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
              onClick={onClose}
            >
              {tt("modpacks.screenshots.close")}
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex min-h-0 flex-col rounded-2xl border border-white/12 bg-black/35 p-3">
            <div className="mb-2 text-xs font-semibold text-white/75">
              {tt("modpacks.screenshots.listTitle")} ({items.length})
            </div>
            <div
              ref={setListScrollEl}
              className="custom-scrollbar min-h-0 flex-1 overflow-y-auto"
            >
              {loading && items.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-xs text-white/55">
                  {tt("modpacks.screenshots.loading")}
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-32 items-center justify-center px-3 text-center text-xs text-white/55">
                  {tt("modpacks.screenshots.empty")}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {items.map((item) => (
                    <ScreenshotGridItem
                      key={item.name}
                      name={item.name}
                      active={item.name === selectedName}
                      thumb={thumbnails[item.name]}
                      scrollRoot={listScrollEl}
                      onSelect={() => setSelectedName(item.name)}
                      onVisible={requestThumbnail}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-2xl border border-white/12 bg-black/35 p-3">
            {selected ? (
              <>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">
                      {selected.name}
                    </div>
                    <div className="text-[11px] text-white/55">
                      {formatDate(selected.modified_at, language)} ·{" "}
                      {formatByteSize(language, selected.size_bytes, { zeroAt: "bytes" })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/20"
                      onClick={() => {
                        void openInSystem(selected.name).catch((e) => {
                          const msg = e instanceof Error ? e.message : String(e);
                          showNotification(
                            "error",
                            tt("modpacks.screenshots.openFailed", { msg }),
                          );
                        });
                      }}
                    >
                      {tt("modpacks.screenshots.open")}
                    </button>
                    <button
                      type="button"
                      className="interactive-press inline-flex items-center gap-1 rounded-full bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-100 hover:bg-red-500/30"
                      onClick={() => void handleDelete(selected.name)}
                    >
                      <DeleteIcon className="h-3 w-3" />
                      {tt("modpacks.screenshots.delete")}
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/50">
                  {previewLoading && !previewUri ? (
                    <div className="text-xs text-white/55">
                      {tt("modpacks.screenshots.loading")}
                    </div>
                  ) : previewUri ? (
                    <img
                      src={previewUri}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="text-xs text-white/55">
                      {tt("modpacks.screenshots.previewFailed")}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-white/55">
                {tt("modpacks.screenshots.selectHint")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
