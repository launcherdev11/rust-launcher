import { useMemo } from "react";
import { type ExternalLauncherType } from "../types";
import { Skeleton, TextField } from "../../../components/ui";
import { formatByteSize } from "../../../i18n";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

const LAUNCHERS: { id: ExternalLauncherType; label: string | null }[] = [
  { id: "auto", label: null },
  { id: "prism_launcher", label: "Prism" },
  { id: "multimc", label: "MultiMC" },
  { id: "curseforge", label: "CurseForge" },
  { id: "atlauncher", label: "ATLauncher" },
  { id: "gdlauncher", label: "GDLauncher" },
];

const SORTS: { id: "name" | "date" | "size"; key: string }[] = [
  { id: "name", key: "modpacks.externalImport.sortName" },
  { id: "date", key: "modpacks.externalImport.sortDate" },
  { id: "size", key: "modpacks.externalImport.sortSize" },
];

const segClass = (active: boolean) =>
  `h-8 rounded-lg px-3 text-[0.8125rem] font-medium transition-colors ${
    active ? "seg-on" : "text-white/65 hover:bg-white/[0.06] hover:text-white"
  }`;

export function ImportView({ ctx }: Props) {
  const {
    tt,
    setActiveView,
    mrpackBusy,
    mrpackProgress,
    importDragActive,
    handleCancelMrpackImport,
    handleImportMrpack,
    externalImportBusy,
    externalImportProgress,
    externalImportLauncher,
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
    externalImportSort,
    language,
    handleImportExternalInstance,
  } = ctx;

  const visibleInstances = useMemo(() => {
    const q = externalImportSearch.trim().toLowerCase();
    const filtered = q
      ? externalImportInstances.filter(
          (p) =>
            p.display_name.toLowerCase().includes(q) ||
            p.path.toLowerCase().includes(q) ||
            (p.loader ?? "").toLowerCase().includes(q) ||
            (p.game_version ?? "").toLowerCase().includes(q),
        )
      : externalImportInstances.slice();
    return filtered.sort((a, b) => {
      if (externalImportSort === "size") return (b.approx_size_bytes ?? 0) - (a.approx_size_bytes ?? 0);
      if (externalImportSort === "date") return (b.last_modified ?? 0) - (a.last_modified ?? 0);
      return a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase());
    });
  }, [externalImportInstances, externalImportSearch, externalImportSort]);

  const fileProgressLabel =
    mrpackProgress?.phase === "start"
      ? tt("modpacks.import.progress.preparing")
      : mrpackProgress?.phase === "overrides"
        ? tt("modpacks.import.progress.extractingOverrides")
        : mrpackProgress?.phase === "files" && mrpackProgress.total != null && mrpackProgress.total > 0
          ? tt("modpacks.import.progress.downloading", {
              current: mrpackProgress.current ?? 0,
              total: mrpackProgress.total,
              msg: "",
            })
          : tt("modpacks.import.progress.importing");
  const fileProgressPercent =
    mrpackProgress?.total != null && mrpackProgress.total > 0 && mrpackProgress.current != null
      ? Math.round((mrpackProgress.current / mrpackProgress.total) * 100)
      : null;

  const scanDisabled = externalImportScanBusy || externalImportBusy;

  return (
    <div className="glass-panel flex w-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--seam)] px-6 py-4">
        <h2 className="ui-title">{tt("modpacks.import.title")}</h2>
        <button type="button" onClick={() => setActiveView("list")} className="btn btn-ghost btn-sm">
          {tt("modpacks.common.backToList")}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="flex flex-col gap-3 px-6 py-5">
          <h3 className="ui-section">{tt("modpacks.import.fileSection")}</h3>

          {mrpackBusy ? (
            <div className="glass-inset flex flex-col gap-3 px-4 py-4" aria-live="polite">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{fileProgressLabel}</p>
                  {mrpackProgress?.message ? (
                    <p className="ui-caption mt-0.5 truncate">{mrpackProgress.message}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCancelMrpackImport()}
                  className="btn btn-soft btn-sm"
                >
                  {tt("common.cancel")}
                </button>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                {fileProgressPercent != null ? (
                  <div
                    className="progress-fill h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${fileProgressPercent}%` }}
                  />
                ) : (
                  <div className="progress-fill download-bar-indeterminate h-full rounded-full" />
                )}
              </div>
            </div>
          ) : (
            <div
              className={`flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-8 text-center transition-colors ${
                importDragActive
                  ? "border-[color:var(--accent-line)] bg-accent-from/10"
                  : "border-[color:var(--seam-strong)] bg-white/[0.02]"
              }`}
            >
              <img
                src="/launcher-assets/import.svg"
                alt=""
                className={`h-8 w-8 object-contain transition-opacity ${importDragActive ? "opacity-100" : "opacity-60"}`}
                draggable={false}
              />
              <p className="text-sm font-semibold text-white">
                {importDragActive
                  ? tt("modpacks.import.dropzone.active")
                  : tt("modpacks.import.dropzone.title")}
              </p>
              <button type="button" onClick={() => void handleImportMrpack()} className="btn btn-accent">
                {tt("modpacks.import.chooseFile")}
              </button>
            </div>
          )}

          <p className="ui-meta">{tt("modpacks.import.dropzone.hint")}</p>
        </section>

        <section className="flex min-w-0 flex-col gap-3 border-t border-[color:var(--seam)] px-6 py-5 lg:border-l lg:border-t-0">
          <h3 className="ui-section">{tt("modpacks.externalImport.title")}</h3>

          <div
            role="radiogroup"
            aria-label={tt("modpacks.externalImport.launcher")}
            className="seg-track flex flex-wrap gap-1 self-start p-1"
          >
            {LAUNCHERS.map((opt) => {
              const active = externalImportLauncher === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    if (active) return;
                    setExternalImportLauncher(opt.id);
                    setExternalImportPath("");
                    setExternalImportInstances([]);
                    setExternalImportScanError(null);
                    setExternalImportSearch("");
                    setExternalImportSort("name");
                  }}
                  className={segClass(active)}
                >
                  {opt.label ?? tt("modpacks.externalImport.auto")}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TextField
              className="min-w-[14rem] flex-1"
              value={externalImportPath}
              onChange={(e) => setExternalImportPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !scanDisabled) void handleScanExternalInstances();
              }}
              aria-label={tt("modpacks.externalImport.path")}
              placeholder={
                externalImportLauncher === "auto"
                  ? tt("modpacks.externalImport.pathAutoPlaceholder")
                  : tt("modpacks.externalImport.pathPlaceholder")
              }
            />
            <button
              type="button"
              disabled={scanDisabled}
              onClick={() => void handleBrowseExternalImportPath()}
              className="btn btn-soft"
            >
              <img src="/launcher-assets/folder.svg" alt="" className="h-4 w-4 object-contain opacity-80" draggable={false} />
              {tt("common.browse")}
            </button>
            <button
              type="button"
              disabled={scanDisabled}
              onClick={() => void handleScanExternalInstances()}
              className="btn btn-tint"
            >
              {externalImportScanBusy
                ? tt("modpacks.externalImport.scanning")
                : tt("modpacks.externalImport.scan")}
            </button>
          </div>

          {externalImportBusy ? (
            <div className="glass-inset flex flex-col gap-2 px-4 py-3" aria-live="polite">
              <p className="text-[0.8125rem] font-medium text-white">
                {externalImportProgress?.phase === "copy"
                  ? tt("modpacks.externalImport.copying")
                  : tt("modpacks.externalImport.importing")}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="progress-fill download-bar-indeterminate h-full rounded-full" />
              </div>
            </div>
          ) : null}

          {externalImportScanBusy ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[3.75rem] w-full rounded-2xl" />
              ))}
            </div>
          ) : externalImportScanError ? (
            <p className="locked-hint w-full" role="status">
              {externalImportScanError}
            </p>
          ) : externalImportInstances.length === 0 ? (
            <p className="ui-meta">{tt("modpacks.externalImport.hint")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ui-meta mr-auto">
                  {tt("modpacks.externalImport.found", { count: externalImportInstances.length })}
                </span>
                <TextField
                  className="max-w-[13rem]"
                  value={externalImportSearch}
                  onChange={(e) => setExternalImportSearch(e.target.value)}
                  placeholder={tt("common.search")}
                  aria-label={tt("common.search")}
                />
                <div
                  role="radiogroup"
                  aria-label={tt("modpacks.externalImport.sort")}
                  className="seg-track flex gap-1 p-1"
                >
                  {SORTS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={externalImportSort === opt.id}
                      onClick={() => setExternalImportSort(opt.id)}
                      className={segClass(externalImportSort === opt.id)}
                    >
                      {tt(opt.key)}
                    </button>
                  ))}
                </div>
              </div>

              {visibleInstances.length === 0 ? (
                <p className="ui-meta py-3">{tt("modpacks.externalImport.nothingMatches")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {visibleInstances.map((p) => (
                    <li
                      key={`${p.launcher_type}:${p.id}:${p.path}`}
                      className="flex items-center gap-3 rounded-2xl border border-[color:var(--seam)] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.05]"
                    >
                      <img
                        src={p.icon_data_uri || p.icon_path || "/launcher-assets/modpack_icon.svg"}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-xl bg-black/40 object-contain"
                        draggable={false}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">{p.display_name}</span>
                          {p.game_version ? <span className="tag shrink-0">{p.game_version}</span> : null}
                          {p.loader ? <span className="tag shrink-0 capitalize">{p.loader}</span> : null}
                        </div>
                        <div className="ui-caption mt-0.5 flex min-w-0 items-center gap-3">
                          {p.mods_count != null ? (
                            <span className="shrink-0">{tt("common.format.modsMeta", { count: p.mods_count })}</span>
                          ) : null}
                          {p.approx_size_bytes != null ? (
                            <span className="shrink-0">{formatByteSize(language, p.approx_size_bytes)}</span>
                          ) : null}
                          <span className="truncate" title={p.path}>
                            {p.path}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={externalImportBusy}
                        onClick={() => void handleImportExternalInstance(p)}
                        className="btn btn-soft btn-sm"
                      >
                        {tt("modpacks.actions.import")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
