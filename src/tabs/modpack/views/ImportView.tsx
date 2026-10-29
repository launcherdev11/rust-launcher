import { ChevronDown, Download, UploadCloud } from "lucide-react";
import { type ExternalLauncherType } from "../types";
import { InputClearButton } from "../../../components/ui";
import { formatByteSize } from "../../../i18n";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function ImportView({ ctx }: Props) {
  const {
    tt,
    setActiveView,
    mrpackBusy,
    mrpackProgress,
    handleCancelMrpackImport,
    handleImportMrpack,
    externalImportBusy,
    externalImportProgress,
    externalLauncherDropdownRef,
    setIsExternalLauncherDropdownOpen,
    setIsExternalSortDropdownOpen,
    externalImportLauncher,
    isExternalLauncherDropdownOpen,
    setExternalImportLauncher,
    setExternalImportPath,
    setExternalImportInstances,
    setExternalImportScanError,
    setExternalImportSearch,
    setExternalImportSort,
    externalImportPath,
    externalImportScanBusy,
    handleBrowseExternalImportPath,
    handleScanExternalInstances,
    externalImportScanError,
    externalImportInstances,
    externalImportSearch,
    externalSortDropdownRef,
    externalImportSort,
    isExternalSortDropdownOpen,
    language,
    handleImportExternalInstance,
  } = ctx;

  return (
    <div className="glass-panel flex w-full max-w-2x2 flex-col gap-3">
      <div className="mb-2 flex items-center justify-between pl-2">
        <h2 className="text-lg font-semibold text-white">
          {tt("modpacks.import.title")}
        </h2>
        <button
          type="button"
          onClick={() => setActiveView("list")}
          className="interactive-press rounded-xl bg-white/10 px-3.5 py-1 text-xs font-medium text-white/80 hover:bg-white/20"
        >
          {tt("modpacks.common.backToList")}
        </button>
      </div>

      {mrpackBusy && (
        <div className="flex flex-col gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-white">
              {mrpackProgress?.phase === "start"
                ? tt("modpacks.import.progress.preparing")
                : mrpackProgress?.phase === "overrides"
                  ? tt("modpacks.import.progress.extractingOverrides")
                  : mrpackProgress?.phase === "files" &&
                      mrpackProgress.total != null &&
                      mrpackProgress.total > 0
                    ? tt("modpacks.import.progress.downloading", {
                        current: mrpackProgress.current ?? 0,
                        total: mrpackProgress.total,
                        msg: mrpackProgress.message ? ` — ${mrpackProgress.message}` : "",
                      })
                    : tt("modpacks.import.progress.importing")}
            </p>
            <button
              type="button"
              onClick={() => void handleCancelMrpackImport()}
              className="interactive-press shrink-0 rounded-xl bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 hover:bg-white/20"
            >
              {tt("common.cancel")}
            </button>
          </div>
          {mrpackProgress?.total != null &&
            mrpackProgress.total > 0 &&
            mrpackProgress.current != null && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="progress-fill h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round(
                      (mrpackProgress.current / mrpackProgress.total) * 100,
                    )}%`,
                  }}
                />
              </div>
            )}
        </div>
      )}

      <div
        className="glass-inset flex flex-col items-center justify-center gap-3 border-dashed px-6 py-10 text-center text-sm text-white/70"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
        }}
      >
        <UploadCloud className="mb-2 h-10 w-10 text-white/70" />
        <p className="text-sm font-medium text-white">
          {tt("modpacks.import.dropzone.title")}
        </p>
        <p className="max-w-md text-xs text-white/60">
          {tt("modpacks.import.dropzone.hint")}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={mrpackBusy}
            onClick={() => void handleImportMrpack()}
            className="interactive-press inline-flex items-center gap-2 rounded-xl bg-white/15 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            <span>{tt("modpacks.import.chooseFile")}</span>
          </button>
        </div>
      </div>

      <div className="glass-inset rounded-[1.25rem] px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {tt("modpacks.externalImport.title")}
            </h3>
            <p className="mt-1 text-xs text-white/60">
              {tt("modpacks.externalImport.hint")}
            </p>
          </div>
        </div>

        {externalImportBusy && (
          <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
            <p className="text-xs font-medium text-white">
              {externalImportProgress?.phase === "copy"
                ? tt("modpacks.externalImport.copying")
                : tt("modpacks.externalImport.importing")}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div className="progress-fill h-full w-1/2 rounded-full" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className="mb-1 block text-[0.8125rem] font-semibold text-white/70">
              {tt("modpacks.externalImport.launcher")}
            </label>
            <div ref={externalLauncherDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsExternalLauncherDropdownOpen((v) => !v);
                  setIsExternalSortDropdownOpen(false);
                }}
                className="interactive-press flex w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-left text-xs text-white hover:border-white/20 focus:outline-none"
              >
                <span className="truncate">
                  {externalImportLauncher === "auto"
                    ? tt("modpacks.externalImport.auto")
                    : externalImportLauncher === "multimc"
                      ? "MultiMC"
                      : externalImportLauncher === "prism_launcher"
                        ? "PrismLauncher"
                        : externalImportLauncher === "atlauncher"
                          ? "ATLauncher"
                          : externalImportLauncher === "gdlauncher"
                            ? "GDLauncher"
                            : externalImportLauncher === "curseforge"
                              ? "CurseForge"
                              : tt("modpacks.externalImport.auto")}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-white/50 transition-transform ${
                    isExternalLauncherDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isExternalLauncherDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-[120] mt-1 overflow-hidden rounded-2xl border border-white/10 bg-black/95 p-1 text-xs shadow-soft">
                  {(
                    [
                      { id: "auto", label: tt("modpacks.externalImport.auto") },
                      { id: "multimc", label: "MultiMC" },
                      { id: "prism_launcher", label: "PrismLauncher" },
                      { id: "atlauncher", label: "ATLauncher" },
                      { id: "gdlauncher", label: "GDLauncher" },
                      { id: "curseforge", label: "CurseForge" },
                    ] as { id: ExternalLauncherType; label: string }[]
                  ).map((opt) => {
                    const active = externalImportLauncher === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setExternalImportLauncher(opt.id);
                          setExternalImportPath("");
                          setExternalImportInstances([]);
                          setExternalImportScanError(null);
                          setExternalImportSearch("");
                          setExternalImportSort("name");
                          setIsExternalLauncherDropdownOpen(false);
                        }}
                        className={`interactive-press flex w-full items-center rounded-xl px-3 py-1.5 text-left transition-colors ${
                          active
                            ? "seg-on font-semibold"
                            : "text-white/80 hover:bg-white/10"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-[0.8125rem] font-semibold text-white/70">
              {tt("modpacks.externalImport.path")}
            </label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  type="text"
                  value={externalImportPath}
                  onChange={(e) => setExternalImportPath(e.target.value)}
                  placeholder={
                    tt("modpacks.externalImport.pathPlaceholder")
                  }
                  className={`glass-control min-w-0 w-full rounded-2xl border px-3 py-2 text-xs text-white/90 placeholder:text-white/35 focus:outline-none ${
                    externalImportPath ? "pr-9" : ""
                  }`}
                />
                <InputClearButton
                  value={externalImportPath}
                  onClear={() => setExternalImportPath("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  aria-label={tt("common.clear")}
                />
              </div>
              <button
                type="button"
                disabled={externalImportScanBusy || externalImportBusy}
                onClick={() => void handleBrowseExternalImportPath()}
                className="interactive-press shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/85 hover:bg-white/20 disabled:opacity-60"
              >
                {tt("common.browse")}
              </button>
              <button
                type="button"
                disabled={externalImportScanBusy || externalImportBusy}
                onClick={() => void handleScanExternalInstances()}
                className="interactive-press shrink-0 rounded-xl accent-bg px-3.5 py-2 text-xs font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-60"
              >
                {externalImportScanBusy
                  ? tt("modpacks.externalImport.scanning")
                  : tt("modpacks.externalImport.scan")}
              </button>
            </div>
            {externalImportScanError && (
              <p className="mt-2 text-xs text-warn-fg/90">{externalImportScanError}</p>
            )}
          </div>
        </div>

        {externalImportInstances.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  value={externalImportSearch}
                  onChange={(e) => setExternalImportSearch(e.target.value)}
                  placeholder={tt("common.search")}
                  className={`glass-control w-full rounded-2xl border px-3 py-2 text-xs text-white/90 placeholder:text-white/35 focus:outline-none ${
                    externalImportSearch ? "pr-9" : ""
                  }`}
                />
                <InputClearButton
                  value={externalImportSearch}
                  onClear={() => setExternalImportSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  aria-label={tt("common.clear")}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[0.8125rem] font-semibold text-white/60">
                  {tt("modpacks.externalImport.sort")}
                </span>
                <div ref={externalSortDropdownRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setIsExternalSortDropdownOpen((v) => !v);
                      setIsExternalLauncherDropdownOpen(false);
                    }}
                    className="interactive-press flex min-w-[7.5rem] items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-left text-xs text-white hover:border-white/20 focus:outline-none"
                  >
                    <span className="truncate">
                      {externalImportSort === "name"
                        ? tt("modpacks.externalImport.sortName")
                        : externalImportSort === "date"
                          ? tt("modpacks.externalImport.sortDate")
                          : tt("modpacks.externalImport.sortSize")}
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-white/50 transition-transform ${
                        isExternalSortDropdownOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {isExternalSortDropdownOpen && (
                    <div className="absolute right-0 top-full z-[120] mt-1 min-w-full overflow-hidden rounded-2xl border border-white/10 bg-black/95 p-1 text-xs shadow-soft">
                      {(
                        [
                          { id: "name", key: "modpacks.externalImport.sortName" },
                          { id: "date", key: "modpacks.externalImport.sortDate" },
                          { id: "size", key: "modpacks.externalImport.sortSize" },
                        ] as { id: "name" | "date" | "size"; key: string }[]
                      ).map((opt) => {
                        const active = externalImportSort === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setExternalImportSort(opt.id);
                              setIsExternalSortDropdownOpen(false);
                            }}
                            className={`interactive-press flex w-full items-center rounded-xl px-3 py-1.5 text-left transition-colors ${
                              active
                                ? "seg-on font-semibold"
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
            </div>

            <div className="flex flex-col gap-2">
              {externalImportInstances
                .filter((p) => {
                  const q = externalImportSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    p.display_name.toLowerCase().includes(q) ||
                    p.path.toLowerCase().includes(q) ||
                    (p.loader ?? "").toLowerCase().includes(q) ||
                    (p.game_version ?? "").toLowerCase().includes(q)
                  );
                })
                .slice()
                .sort((a, b) => {
                  if (externalImportSort === "size") {
                    return (b.approx_size_bytes ?? 0) - (a.approx_size_bytes ?? 0);
                  }
                  if (externalImportSort === "date") {
                    return (b.last_modified ?? 0) - (a.last_modified ?? 0);
                  }
                  return a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase());
                })
                .map((p) => {
                  const iconSrc = p.icon_data_uri || p.icon_path || "/launcher-assets/modpack_icon.svg";
                  const meta = [
                    p.loader ? p.loader : null,
                    p.game_version ? p.game_version : null,
                    p.mods_count != null
                      ? tt("common.format.modsMeta", { count: p.mods_count })
                      : null,
                    p.approx_size_bytes != null ? formatByteSize(language, p.approx_size_bytes) : null,
                  ].filter(Boolean) as string[];

                  return (
                    <div
                      key={`${p.launcher_type}:${p.id}:${p.path}`}
                      className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <img
                          src={iconSrc}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-xl bg-black/40 object-contain ring-1 ring-white/10"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">
                            {p.display_name}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-white/60">
                            {meta.length > 0 && <span>{meta.join(" • ")}</span>}
                            <span className="truncate">{p.path}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={externalImportBusy}
                          onClick={() => void handleImportExternalInstance(p)}
                          className="interactive-press rounded-xl accent-bg px-3.5 py-2 text-xs font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-60"
                        >
                          {tt("modpacks.actions.import")}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
