import type { ReactNode } from "react";
import type {
  CatalogSort,
  CatalogSourceTab,
  ContentProvider,
  LoaderFilter,
  ModrinthContentType,
  SideSupport,
} from "./types";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type CatalogToolbarProps = {
  tt: Tt;
  contentProvider: ContentProvider;
  onProviderChange: (p: ContentProvider) => void;
  contentType: ModrinthContentType;
  onContentTypeChange: (t: ModrinthContentType) => void;
  contentTypeIndicator: { left: number; width: number };
  contentTypeTabRefs: React.MutableRefObject<
    Partial<Record<ModrinthContentType, HTMLButtonElement | null>>
  >;
  contentTypeTabsRef: React.RefObject<HTMLDivElement | null>;
  sourceTab: CatalogSourceTab;
  onSourceTabChange: (tab: CatalogSourceTab) => void;
  onClearRecent?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  gameVersion: string;
  gameVersions: string[];
  loader: LoaderFilter;
  versionLoaderLocked: boolean;
  isVersionDropdownOpen: boolean;
  isLoaderDropdownOpen: boolean;
  setIsVersionDropdownOpen: (v: boolean | ((c: boolean) => boolean)) => void;
  setIsLoaderDropdownOpen: (v: boolean | ((c: boolean) => boolean)) => void;
  onGameVersionChange: (v: string) => void;
  onLoaderChange: (v: LoaderFilter) => void;
  onRequestUnlock: () => void;
  activeProfileId?: string | null;
  layout: "list" | "grid";
  onLayoutChange: (layout: "list" | "grid") => void;
};

export function CatalogToolbar({
  tt,
  contentProvider,
  onProviderChange,
  contentType,
  onContentTypeChange,
  contentTypeIndicator,
  contentTypeTabRefs,
  contentTypeTabsRef,
  sourceTab,
  onSourceTabChange,
  onClearRecent,
  search,
  onSearchChange,
  gameVersion,
  gameVersions,
  loader,
  versionLoaderLocked,
  isVersionDropdownOpen,
  isLoaderDropdownOpen,
  setIsVersionDropdownOpen,
  setIsLoaderDropdownOpen,
  onGameVersionChange,
  onLoaderChange,
  onRequestUnlock,
  activeProfileId,
  layout,
  onLayoutChange,
}: CatalogToolbarProps) {
  return (
    <div className="relative z-[80] mb-3 mt-2 flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-white/12 bg-black/50 p-1 shadow-soft backdrop-blur-xl">
          {(["modrinth", "curseforge"] as ContentProvider[]).map((provider) => (
            <button
              key={provider}
              type="button"
              onClick={() => onProviderChange(provider)}
              className={`interactive-press rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                contentProvider === provider
                  ? "bg-white/90 text-black"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              {provider === "modrinth"
                ? tt("mods.provider.modrinth")
                : tt("mods.provider.curseforge")}
            </button>
          ))}
        </div>
        <div
          ref={contentTypeTabsRef}
          className="relative grid h-10 min-w-0 flex-1 grid-cols-4 items-center overflow-hidden rounded-2xl border border-white/12 bg-black/50 p-1 shadow-soft backdrop-blur-xl"
        >
          <div
            className="pointer-events-none absolute top-1 bottom-1 rounded-lg bg-white/90 transition-all duration-200 ease-out"
            style={{
              left: `${contentTypeIndicator.left}px`,
              width: `${contentTypeIndicator.width}px`,
            }}
          />
          {(
            ["mod", "resourcepack", "shader", "modpack"] as ModrinthContentType[]
          ).map((kind) => {
            const label =
              kind === "mod"
                ? tt("mods.tab.mods")
                : kind === "resourcepack"
                  ? tt("mods.tab.resources")
                  : kind === "shader"
                    ? tt("mods.tab.shaders")
                    : tt("mods.tab.modpacks");
            const active = contentType === kind;
            return (
              <button
                key={kind}
                type="button"
                ref={(el) => {
                  contentTypeTabRefs.current[kind] = el;
                }}
                onClick={() => onContentTypeChange(kind)}
                className={`interactive-press relative z-10 rounded-xl px-2 py-1.5 text-center text-xs font-semibold whitespace-nowrap transition-colors ${
                  active ? "text-black" : "text-white/70 hover:text-white"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <VersionLoaderControls
          tt={tt}
          gameVersion={gameVersion}
          gameVersions={gameVersions}
          loader={loader}
          versionLoaderLocked={versionLoaderLocked}
          isVersionDropdownOpen={isVersionDropdownOpen}
          isLoaderDropdownOpen={isLoaderDropdownOpen}
          setIsVersionDropdownOpen={setIsVersionDropdownOpen}
          setIsLoaderDropdownOpen={setIsLoaderDropdownOpen}
          onGameVersionChange={onGameVersionChange}
          onLoaderChange={onLoaderChange}
          onRequestUnlock={onRequestUnlock}
          activeProfileId={activeProfileId}
        />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-white/12 bg-black/40 p-1">
          {(
            [
              ["catalog", "mods.source.catalog"],
              ["recent", "mods.source.recent"],
            ] as [CatalogSourceTab, string][]
          ).map(([tab, key]) => (
            <button
              key={tab}
              type="button"
              onClick={() => onSourceTabChange(tab)}
              className={`interactive-press rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                sourceTab === tab
                  ? "bg-white/90 text-black"
                  : "text-white/65 hover:bg-white/10 hover:text-white"
              }`}
            >
              {tt(key)}
            </button>
          ))}
        </div>
        {sourceTab === "recent" && onClearRecent && (
          <button
            type="button"
            onClick={onClearRecent}
            className="interactive-press h-10 shrink-0 rounded-2xl border border-white/12 bg-black/40 px-3 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
          >
            {tt("mods.recent.clear")}
          </button>
        )}
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/15 bg-black/40 px-3 shadow-soft backdrop-blur-xl">
          <img
            src="/launcher-assets/search.png"
            alt=""
            className="h-4 w-4 shrink-0 object-contain"
          />
          <input
            type="text"
            placeholder={tt("mods.searchPlaceholder")}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-white placeholder:text-white/40 focus:outline-none"
          />
        </div>
        <div className="flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-white/20 bg-black/40 p-1">
          <button
            type="button"
            onClick={() => onLayoutChange("list")}
            className={`interactive-press rounded-xl p-1.5 ${
              layout === "list"
                ? "bg-white text-black shadow-soft"
                : "text-white/70 hover:bg-white/10"
            }`}
            title={tt("mods.layout.list")}
          >
            <img
              src={
                layout === "list"
                  ? "/launcher-assets/list-black.png"
                  : "/launcher-assets/list.png"
              }
              alt=""
              className="h-4 w-4 object-contain"
            />
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange("grid")}
            className={`interactive-press rounded-xl p-1.5 ${
              layout === "grid"
                ? "bg-white text-black shadow-soft"
                : "text-white/70 hover:bg-white/10"
            }`}
            title={tt("mods.layout.grid")}
          >
            <img
              src={
                layout === "grid"
                  ? "/launcher-assets/grid-black.png"
                  : "/launcher-assets/grid.png"
              }
              alt=""
              className="h-4 w-4 object-contain"
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionLoaderControls({
  tt,
  gameVersion,
  gameVersions,
  loader,
  versionLoaderLocked,
  isVersionDropdownOpen,
  isLoaderDropdownOpen,
  setIsVersionDropdownOpen,
  setIsLoaderDropdownOpen,
  onGameVersionChange,
  onLoaderChange,
  onRequestUnlock,
  activeProfileId,
}: {
  tt: Tt;
  gameVersion: string;
  gameVersions: string[];
  loader: LoaderFilter;
  versionLoaderLocked: boolean;
  isVersionDropdownOpen: boolean;
  isLoaderDropdownOpen: boolean;
  setIsVersionDropdownOpen: (v: boolean | ((c: boolean) => boolean)) => void;
  setIsLoaderDropdownOpen: (v: boolean | ((c: boolean) => boolean)) => void;
  onGameVersionChange: (v: string) => void;
  onLoaderChange: (v: LoaderFilter) => void;
  onRequestUnlock: () => void;
  activeProfileId?: string | null;
}): ReactNode {
  return (
    <div className="relative ml-auto flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-white/12 bg-black/40 px-3 shadow-soft backdrop-blur-xl">
      <span className="mr-1 text-[11px] uppercase tracking-[0.16em] text-gray-400">
        {tt("mods.version")}
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            if (versionLoaderLocked) onRequestUnlock();
            else setIsVersionDropdownOpen((c) => !c);
          }}
          disabled={versionLoaderLocked}
          className={`interactive-press inline-flex min-w-[88px] items-center gap-2 rounded-full border border-white/25 bg-black/70 px-3 py-1 text-xs font-semibold text-white shadow-soft ${
            versionLoaderLocked
              ? "cursor-not-allowed opacity-70"
              : "hover:border-white/60"
          }`}
          title={versionLoaderLocked ? tt("mods.syncedHint") : undefined}
        >
          <span className="truncate">{gameVersion || "—"}</span>
          {!versionLoaderLocked && (
            <span className="text-[10px] text-gray-400">▾</span>
          )}
        </button>
        {isVersionDropdownOpen && gameVersions.length > 0 && (
          <div className="absolute left-0 top-full z-[100] mt-1 max-h-64 w-32 overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
            {gameVersions.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  onGameVersionChange(v);
                  setIsVersionDropdownOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                  gameVersion === v
                    ? "bg-white/90 text-black"
                    : "text-white/80 hover:bg-white/10"
                }`}
              >
                <span>{v}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            if (versionLoaderLocked) onRequestUnlock();
            else setIsLoaderDropdownOpen((c) => !c);
          }}
          disabled={versionLoaderLocked}
          className={`interactive-press inline-flex min-w-[96px] items-center gap-2 rounded-full border border-white/25 bg-black/70 px-3 py-1 text-xs font-semibold text-white shadow-soft ${
            versionLoaderLocked
              ? "cursor-not-allowed opacity-70"
              : "hover:border-white/60"
          }`}
        >
          <span>
            {loader === "any"
              ? tt("mods.loaderAny")
              : loader === "forge"
                ? "Forge"
                : loader === "fabric"
                  ? "Fabric"
                  : loader === "quilt"
                    ? "Quilt"
                    : "NeoForge"}
          </span>
          {!versionLoaderLocked && (
            <span className="text-[10px] text-gray-400">▾</span>
          )}
        </button>
        {versionLoaderLocked && activeProfileId && (
          <button
            type="button"
            onClick={onRequestUnlock}
            className="interactive-press ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80 hover:bg-white/20"
          >
            {tt("common.change")}
          </button>
        )}
        {isLoaderDropdownOpen && (
          <div className="absolute left-0 top-full z-[100] mt-1 max-h-64 w-36 overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
            {[
              { id: "forge" as const, label: "Forge" },
              { id: "fabric" as const, label: "Fabric" },
              { id: "quilt" as const, label: "Quilt" },
              { id: "neoforge" as const, label: "NeoForge" },
              { id: "any" as const, label: tt("mods.loaderAll") },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onLoaderChange(opt.id);
                  setIsLoaderDropdownOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                  loader === opt.id
                    ? "bg-white/90 text-black"
                    : "text-white/80 hover:bg-white/10"
                }`}
              >
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type { CatalogSort, SideSupport };
