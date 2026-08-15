import { useEffect, useRef, useState } from "react";
import type {
  CatalogCategory,
  CatalogSort,
  ContentProvider,
  SideSupport,
} from "./types";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type CatalogFiltersProps = {
  tt: Tt;
  provider: ContentProvider;
  sort: CatalogSort;
  onSortChange: (sort: CatalogSort) => void;
  categories: CatalogCategory[];
  selectedCategories: string[];
  onToggleCategory: (id: string) => void;
  clientSide: SideSupport;
  serverSide: SideSupport;
  onClientSideChange: (v: SideSupport) => void;
  onServerSideChange: (v: SideSupport) => void;
  installedOnly: boolean;
  onInstalledOnlyChange: (v: boolean) => void;
  canFilterInstalled: boolean;
  onReset: () => void;
};

const SORT_OPTIONS: { id: CatalogSort; key: string }[] = [
  { id: "relevance", key: "mods.sort.relevance" },
  { id: "downloads", key: "mods.sort.downloads" },
  { id: "popularity", key: "mods.sort.popularity" },
  { id: "updated", key: "mods.sort.updated" },
  { id: "newest", key: "mods.sort.newest" },
];

const SIDE_OPTIONS: { id: SideSupport; key: string }[] = [
  { id: "any", key: "mods.environment.any" },
  { id: "required", key: "mods.environment.required" },
  { id: "optional", key: "mods.environment.optional" },
  { id: "unsupported", key: "mods.environment.unsupported" },
];

function SideChipRow({
  label,
  value,
  onChange,
  tt,
}: {
  label: string;
  value: SideSupport;
  onChange: (v: SideSupport) => void;
  tt: Tt;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {SIDE_OPTIONS.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`interactive-press rounded-lg px-2 py-0.5 text-[10px] font-semibold ${
                active
                  ? "bg-white/90 text-black"
                  : "bg-white/10 text-white/65 hover:bg-white/15"
              }`}
            >
              {tt(opt.key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SortDropdown({
  tt,
  sort,
  onSortChange,
}: {
  tt: Tt;
  sort: CatalogSort;
  onSortChange: (sort: CatalogSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current =
    SORT_OPTIONS.find((opt) => opt.id === sort) ?? SORT_OPTIONS[1];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
        {tt("mods.filters.sort")}
      </div>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="interactive-press flex w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/60 px-2.5 py-1.5 text-left text-xs font-semibold text-white shadow-soft hover:border-white/40"
        >
          <span className="truncate">{tt(current.key)}</span>
          <span className="text-[10px] text-white/45">{open ? "▴" : "▾"}</span>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-full z-[120] mt-1 overflow-hidden rounded-2xl border border-white/12 bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
            {SORT_OPTIONS.map((opt) => {
              const active = sort === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onSortChange(opt.id);
                    setOpen(false);
                  }}
                  className={`interactive-press flex w-full items-center rounded-xl px-3 py-1.5 text-left transition-colors ${
                    active
                      ? "bg-white/90 font-semibold text-black"
                      : "text-white/80 hover:bg-white/10"
                  }`}
                >
                  {tt(opt.key)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function CatalogFilters({
  tt,
  provider,
  sort,
  onSortChange,
  categories,
  selectedCategories,
  onToggleCategory,
  clientSide,
  serverSide,
  onClientSideChange,
  onServerSideChange,
  installedOnly,
  onInstalledOnlyChange,
  canFilterInstalled,
  onReset,
}: CatalogFiltersProps) {
  const hasActiveFilters =
    selectedCategories.length > 0 ||
    clientSide !== "any" ||
    serverSide !== "any" ||
    installedOnly ||
    sort !== "downloads";

  return (
    <aside className="glass-panel relative z-[40] flex w-[200px] shrink-0 flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
          {tt("mods.filters.title")}
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
            className="interactive-press rounded-lg bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70 hover:bg-white/20"
          >
            {tt("mods.filters.reset")}
          </button>
        )}
      </div>

      <SortDropdown tt={tt} sort={sort} onSortChange={onSortChange} />

      {provider === "modrinth" && (
        <div className="space-y-2.5">
          <SideChipRow
            label={tt("mods.filters.client")}
            value={clientSide}
            onChange={onClientSideChange}
            tt={tt}
          />
          <SideChipRow
            label={tt("mods.filters.server")}
            value={serverSide}
            onChange={onServerSideChange}
            tt={tt}
          />
        </div>
      )}

      {canFilterInstalled && (
        <button
          type="button"
          onClick={() => onInstalledOnlyChange(!installedOnly)}
          className={`interactive-press w-full rounded-xl px-2.5 py-1.5 text-left text-[11px] font-semibold ${
            installedOnly
              ? "bg-emerald-500/90 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          {tt("mods.filters.installedOnly")}
        </button>
      )}

      {categories.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
            {tt("mods.filters.categories")}
            {selectedCategories.length > 0
              ? ` · ${selectedCategories.length}`
              : ""}
          </div>
          <div className="custom-scrollbar flex max-h-[min(52vh,420px)] flex-col gap-0.5 overflow-y-auto pr-0.5">
            {categories.map((cat) => {
              const selected = selectedCategories.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onToggleCategory(cat.id)}
                  className={`interactive-press rounded-lg px-2 py-1 text-left text-[11px] capitalize leading-snug ${
                    selected
                      ? "bg-white/90 font-semibold text-black"
                      : "text-white/70 hover:bg-white/10"
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
