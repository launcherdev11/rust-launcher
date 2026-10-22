import { InputClearButton } from "../../../components/ui";
import { formatByteSize } from "../../../i18n";
import {
  ExportIcon,
  FileIcon,
  FolderIcon,
  SearchIcon,
} from "../icons";
import { type FileNode } from "../types";
import { type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function ExportModal({ ctx }: Props) {
  const {
    isExportOpen,
    selectedProfile,
    exportBusy,
    setIsExportOpen,
    tt,
    exportFormatIndicator,
    exportFormatTabRefs,
    setExportFormat,
    exportFormat,
    exportTree,
    applyExportPreset,
    exportQuickNodes,
    getFolderCheckState,
    isExportPathSelected,
    setExportNodeChecked,
    ignorePatternsText,
    setIgnorePatternsText,
    exportSelectionStats,
    language,
    exportTreeLoading,
    loadExportTree,
    setSelectedExportPaths,
    exportSearchQuery,
    setExportSearchQuery,
    filteredExportTree,
    collapsedExportPaths,
    setCollapsedExportPaths,
    previewLoading,
    handlePreviewExport,
    handleStartExport,
    exportProgress,
    exportSpeedLabel,
    previewResult,
    exportResultPath,
    exportResolvedCount,
    exportOverrideCount,
    exportSkippedFiles,
  } = ctx;

  return (
    <>
      {isExportOpen && selectedProfile && (
        <div
          className="glass-overlay fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => {
            if (exportBusy) return;
            setIsExportOpen(false);
          }}
        >
          <div
            className="glass-modal w-full max-w-5xl max-h-[80vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-white/50">
                  {tt("modpacks.exportModal.title")}
                </div>
                <div className="truncate text-lg font-semibold text-white">
                  {selectedProfile.name}
                </div>
              </div>
              <button
                type="button"
                className="interactive-press rounded-xl bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20 disabled:opacity-60"
                disabled={exportBusy}
                onClick={() => setIsExportOpen(false)}
              >
                {tt("common.close")}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
                <div className="mb-2 text-xs font-semibold text-white/80">
                  {tt("modpacks.exportModal.format")}
                </div>
                <div className="relative inline-flex gap-1 seg-track p-1 overflow-hidden">
                  <div
                    className="pointer-events-none absolute top-1 bottom-1 rounded-md seg-indicator transition-all duration-200 ease-out"
                    style={{
                      left: `${exportFormatIndicator.left}px`,
                      width: `${exportFormatIndicator.width}px`,
                    }}
                  />
                  <button
                    type="button"
                    disabled={exportBusy}
                    ref={(el) => {
                      exportFormatTabRefs.current.mrpack = el;
                    }}
                    onClick={() => setExportFormat("mrpack")}
                    className={`interactive-press relative z-10 rounded-xl px-3 py-1 text-xs font-semibold transition-colors ${
                      exportFormat === "mrpack"
                        ? "text-white"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    MRPack
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy}
                    ref={(el) => {
                      exportFormatTabRefs.current.zip = el;
                    }}
                    onClick={() => setExportFormat("zip")}
                    className={`interactive-press relative z-10 rounded-xl px-3 py-1 text-xs font-semibold transition-colors ${
                      exportFormat === "zip"
                        ? "text-white"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    ZIP
                  </button>
                </div>
                <div className="mt-3 text-[0.8125rem] leading-relaxed text-white/60">
                  {exportFormat === "mrpack"
                    ? tt("modpacks.exportModal.mrpackHint")
                    : tt("modpacks.exportModal.zipHint")}
                </div>

                <div className="mt-4 text-xs font-semibold text-white/80">
                  {tt("modpacks.exportModal.presets")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={exportBusy || !exportTree}
                    onClick={() => applyExportPreset("recommended")}
                    className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-[0.8125rem] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                  >
                    {tt("modpacks.exportModal.presetRecommended")}
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy || !exportTree}
                    onClick={() => applyExportPreset("minimal")}
                    className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-[0.8125rem] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                  >
                    {tt("modpacks.exportModal.presetMinimal")}
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy || !exportTree}
                    onClick={() => applyExportPreset("full")}
                    className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-[0.8125rem] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                  >
                    {tt("modpacks.exportModal.presetFull")}
                  </button>
                </div>

                {exportQuickNodes.length > 0 && (
                  <>
                    <div className="mt-4 text-xs font-semibold text-white/80">
                      {tt("modpacks.exportModal.quickFolders")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {exportQuickNodes.map((node) => {
                        const folderState = node.is_dir ? getFolderCheckState(node) : null;
                        const active = node.is_dir
                          ? folderState === "all"
                          : isExportPathSelected(node.path);
                        const partial = folderState === "some";
                        return (
                          <button
                            key={node.path}
                            type="button"
                            disabled={exportBusy}
                            onClick={() => setExportNodeChecked(node, !active)}
                            className={`interactive-press rounded-xl px-3 py-1 text-[0.8125rem] font-semibold transition-colors disabled:opacity-60 ${
                              active
                                ? "text-white"
                                : partial
                                  ? "text-white"
                                  : "bg-white/10 text-white/75 hover:bg-white/20 hover:text-white"
                            }`}
                            style={
                              active
                                ? {
                                    backgroundColor: "var(--accent-color)",
                                  }
                                : partial
                                  ? {
                                      backgroundColor:
                                        "color-mix(in srgb, var(--accent-color) 35%, transparent)",
                                      boxShadow:
                                        "inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 55%, transparent)",
                                    }
                                  : undefined
                            }
                          >
                            {node.name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="mt-4 text-xs font-semibold text-white/80">
                  {tt("modpacks.exportModal.ignorePatterns")}
                </div>
                <div className="relative mt-2">
                  <textarea
                    value={ignorePatternsText}
                    disabled={exportBusy}
                    onChange={(e) => setIgnorePatternsText(e.target.value)}
                    placeholder={"*.log\ncache/\nsaves/"}
                    className={`glass-control custom-scrollbar h-28 w-full resize-none rounded-2xl border px-3 py-2 text-xs text-white/85 placeholder:text-white/35 focus:outline-none ${
                      ignorePatternsText ? "pr-9" : ""
                    }`}
                  />
                  <InputClearButton
                    value={ignorePatternsText}
                    onClear={() => setIgnorePatternsText("")}
                    disabled={exportBusy}
                    className="absolute right-2 top-2"
                    aria-label={tt("common.clear")}
                  />
                </div>
                <div className="mt-2 text-[0.8125rem] text-white/55">
                  {tt("modpacks.exportModal.ignoreHint")}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 lg:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white/80">
                      {tt("modpacks.exportModal.buildFiles")}
                    </div>
                    <div className="mt-0.5 text-[0.8125rem] text-white/55">
                      {tt("modpacks.exportModal.selectedSummary", {
                        count: String(exportSelectionStats.count),
                        size: formatByteSize(language, exportSelectionStats.bytes),
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={exportBusy || exportTreeLoading || !selectedProfile}
                      onClick={() =>
                        selectedProfile && void loadExportTree(selectedProfile.id, true)
                      }
                      className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-[0.8125rem] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                    >
                      {tt("modpacks.exportModal.refresh")}
                    </button>
                    <button
                      type="button"
                      disabled={exportBusy || exportTreeLoading || !exportTree}
                      onClick={() => applyExportPreset("full")}
                      className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-[0.8125rem] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                    >
                      {tt("modpacks.exportModal.selectAll")}
                    </button>
                    <button
                      type="button"
                      disabled={exportBusy}
                      onClick={() => setSelectedExportPaths(new Set())}
                      className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-[0.8125rem] font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60"
                    >
                      {tt("modpacks.exportModal.clearAll")}
                    </button>
                  </div>
                </div>

                <div className="mb-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                  <SearchIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <input
                    type="search"
                    value={exportSearchQuery}
                    disabled={exportBusy || exportTreeLoading}
                    onChange={(e) => setExportSearchQuery(e.target.value)}
                    placeholder={tt("modpacks.exportModal.searchPlaceholder")}
                    className="min-w-0 flex-1 bg-transparent text-xs text-white/90 placeholder:text-white/35 focus:outline-none disabled:opacity-60"
                  />
                  <InputClearButton
                    value={exportSearchQuery}
                    onClear={() => setExportSearchQuery("")}
                    disabled={exportBusy || exportTreeLoading}
                    aria-label={tt("common.clear")}
                  />
                </div>

                <div className="custom-scrollbar max-h-[360px] overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2">
                  {exportTreeLoading ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {tt("modpacks.exportModal.scanning")}
                    </div>
                  ) : !exportTree || !filteredExportTree ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {tt("modpacks.exportModal.noData")}
                    </div>
                  ) : exportTree.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {tt("modpacks.exportModal.emptyFolder")}
                    </div>
                  ) : filteredExportTree.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-xs text-white/60">
                      {tt("modpacks.exportModal.noSearchResults")}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {(function renderNodes(nodes: FileNode[], depth: number): ReactNode[] {
                        const searchActive = exportSearchQuery.trim().length > 0;
                        return nodes.flatMap((n) => {
                          const folderState = n.is_dir ? getFolderCheckState(n) : null;
                          const checked = n.is_dir
                            ? folderState === "all"
                            : isExportPathSelected(n.path);
                          const rowHighlighted = n.is_dir
                            ? folderState === "all" || folderState === "some"
                            : checked;
                          const rowPartial = folderState === "some";
                          const isCollapsed =
                            !searchActive && collapsedExportPaths.has(n.path);
                          const row = (
                            <label
                              key={n.path}
                              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 transition-colors ${
                                rowHighlighted ? "" : "hover:bg-white/5"
                              }`}
                              style={{
                                paddingLeft: 8 + depth * 14,
                                ...(rowHighlighted
                                  ? {
                                      backgroundColor: rowPartial
                                        ? "color-mix(in srgb, var(--accent-color) 14%, transparent)"
                                        : "color-mix(in srgb, var(--accent-color) 26%, transparent)",
                                      boxShadow: rowPartial
                                        ? "inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 28%, transparent)"
                                        : "inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 45%, transparent)",
                                    }
                                  : {}),
                              }}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                {n.is_dir ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setCollapsedExportPaths((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(n.path)) next.delete(n.path);
                                        else next.add(n.path);
                                        return next;
                                      });
                                    }}
                                    className="interactive-press mr-0.5 flex h-4 w-4 items-center justify-center rounded-lg bg-white/5 text-white/70 hover:bg-white/15"
                                  >
                                    <ChevronDown
                                      className={`h-3 w-3 transition-transform ${
                                        isCollapsed ? "-rotate-90" : "rotate-0"
                                      }`}
                                    />
                                  </button>
                                ) : (
                                  <span className="mr-0.5 h-4 w-4" />
                                )}
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  ref={
                                    n.is_dir
                                      ? (el) => {
                                          if (el) el.indeterminate = folderState === "some";
                                        }
                                      : undefined
                                  }
                                  disabled={exportBusy}
                                  onChange={(e) => {
                                    setExportNodeChecked(n, e.target.checked);
                                  }}
                                  className="accent-checkbox"
                                />
                                {n.is_dir ? (
                                  <FolderIcon
                                    className={`h-4 w-4 ${rowHighlighted ? "opacity-100" : "opacity-80"}`}
                                  />
                                ) : (
                                  <FileIcon
                                    className={`h-4 w-4 ${rowHighlighted ? "opacity-100" : "opacity-80"}`}
                                  />
                                )}
                                <span
                                  className={`truncate text-xs ${
                                    rowHighlighted ? "font-medium text-white" : "text-white/85"
                                  }`}
                                >
                                  {n.name}
                                </span>
                              </span>
                              <span
                                className={`shrink-0 text-[0.8125rem] ${
                                  rowHighlighted ? "text-white/70" : "text-white/55"
                                }`}
                              >
                                {formatByteSize(language, n.size)}
                              </span>
                            </label>
                          );

                          const children =
                            n.children && n.children.length && !isCollapsed
                              ? renderNodes(n.children, depth + 1)
                              : [];
                          return [row, ...children];
                        });
                      })(filteredExportTree, 0)}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={exportBusy || previewLoading}
                    onClick={() => void handlePreviewExport()}
                    className="interactive-press inline-flex items-center gap-2 rounded-xl bg-white/15 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
                  >
                    {previewLoading
                      ? tt("modpacks.exportModal.previewing")
                      : tt("modpacks.exportModal.preview")}
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy}
                    onClick={() => void handleStartExport()}
                    className="interactive-press inline-flex items-center gap-2 rounded-xl accent-bg px-3.5 py-2 text-xs font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-60"
                  >
                    <ExportIcon className="h-4 w-4" />
                    <span>{tt("modpacks.exportModal.export")}</span>
                  </button>

                  {exportBusy && exportProgress && (
                    <div className="ml-auto flex min-w-[260px] flex-1 flex-col gap-1 rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-[0.8125rem] text-white/70">
                        <span className="truncate">
                          {exportProgress.current_file || tt("modpacks.exportModal.exporting")}
                        </span>
                        <span className="shrink-0">
                          {exportSpeedLabel || ""}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                        <div
                          className="progress-fill h-full rounded-full transition-all duration-200"
                          style={{
                            width:
                              exportProgress.total_bytes > 0
                                ? `${Math.min(
                                    100,
                                    Math.round(
                                      (exportProgress.bytes_written / exportProgress.total_bytes) * 100,
                                    ),
                                  )}%`
                                : "8%",
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[0.8125rem] text-white/55">
                        <span>
                          {formatByteSize(language, exportProgress.bytes_written)} /{" "}
                          {formatByteSize(language, exportProgress.total_bytes)}
                        </span>
                        <span>
                          {exportProgress.total_bytes > 0
                            ? `${Math.round(
                                (exportProgress.bytes_written / exportProgress.total_bytes) * 100,
                              )}%`
                            : ""}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {previewResult && (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-white/80">
                        {tt("modpacks.exportModal.finalContents")}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-white/70">
                        {exportFormat === "mrpack" && (previewResult.resolved_count ?? 0) > 0 && (
                          <span>
                            {tt("modpacks.exportModal.linkedMods", {
                              count: String(previewResult.resolved_count ?? 0),
                            })}
                          </span>
                        )}
                        {(previewResult.override_count ?? 0) > 0 && (
                          <span>
                            {tt("modpacks.exportModal.overrideFiles", {
                              count: String(previewResult.override_count ?? 0),
                            })}
                          </span>
                        )}
                        <span>
                          {tt("modpacks.exportModal.packSize")}{" "}
                          <span className="font-semibold text-white/90">
                            {formatByteSize(language, previewResult.total_bytes)}
                          </span>
                        </span>
                        {exportFormat === "mrpack" && (previewResult.download_bytes ?? 0) > 0 && (
                          <span>
                            {tt("modpacks.exportModal.downloadSize")}{" "}
                            <span className="font-semibold text-white/90">
                              {formatByteSize(language, previewResult.download_bytes ?? 0)}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="custom-scrollbar mt-2 max-h-40 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2 text-[0.8125rem] text-white/75">
                      {previewResult.files.length === 0 ? (
                        <div className="py-6 text-center text-white/55">
                          {tt("modpacks.exportModal.nothingIncluded")}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {previewResult.files.slice(0, 400).map((f) => (
                            <div key={`${f.source ?? "x"}:${f.path}`} className="flex items-center justify-between gap-3 px-2 py-0.5">
                              <span className="min-w-0 truncate">
                                {f.source === "modrinth" ? (
                                  <span className="mr-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[0.75rem] font-semibold text-emerald-200">
                                    CDN
                                  </span>
                                ) : null}
                                {f.path}
                              </span>
                              <span className="shrink-0 text-white/50">
                                {formatByteSize(language, f.size)}
                              </span>
                            </div>
                          ))}
                          {previewResult.files.length > 400 && (
                            <div className="px-2 py-1 text-white/50">
                              {`… +${previewResult.files.length - 400}`}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {exportResultPath && (
                  <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-emerald-200">
                        {tt("modpacks.exportModal.done")}
                        {[
                          exportResolvedCount > 0
                            ? tt("modpacks.exportModal.linkedMods", {
                                count: String(exportResolvedCount),
                              })
                            : "",
                          exportOverrideCount > 0
                            ? tt("modpacks.exportModal.overrideFiles", {
                                count: String(exportOverrideCount),
                              })
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                          .replace(/^/, exportResolvedCount > 0 || exportOverrideCount > 0 ? " · " : "")}
                      </div>
                      <button
                        type="button"
                        onClick={() => void revealItemInDir(exportResultPath)}
                        className="interactive-press rounded-xl accent-bg px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                      >
                        {tt("modpacks.exportModal.openFolder")}
                      </button>
                    </div>
                    <div className="break-all text-[0.8125rem] text-emerald-100/90">{exportResultPath}</div>
                    {exportSkippedFiles.length > 0 && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[0.8125rem] text-white/70">
                        <div className="mb-1 font-semibold text-white/80">
                          ({exportSkippedFiles.length})
                        </div>
                        <div className="custom-scrollbar max-h-20 overflow-y-auto">
                          {exportSkippedFiles.slice(0, 80).map((p) => (
                            <div key={p} className="truncate">{p}</div>
                          ))}
                          {exportSkippedFiles.length > 80 && (
                            <div className="text-white/50">
                              {`… +${exportSkippedFiles.length - 80}`}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
