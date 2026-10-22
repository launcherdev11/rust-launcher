import type { Language } from "../../../i18n";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ExportErrorPayload,
  type ExportFinishedPayload,
  type ExportProgressPayload,
  type FileNode,
  type InstanceProfile,
  type NotificationKind,
  type PreviewResult,
} from "../types";
import {
  DEFAULT_EXPORT_IGNORES,
  EXPORT_QUICK_FOLDERS,
  filterExportFileTree,
  MINIMAL_EXPORT_TOP,
  RECOMMENDED_EXPORT_TOP,
} from "../exportTree";
import { formatByteSize } from "../../../i18n";
import { invoke } from "@tauri-apps/api/core";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { subscribeTauriEvent } from "../../../lib/tauriEvents";

type ExportFlowDeps = {
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  selectedProfile: InstanceProfile | null;
  language: Language;
};

export function useExportFlow(deps: ExportFlowDeps) {
  const {
    showNotification,
    tt,
    selectedProfile,
    language,
  } = deps;

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"mrpack" | "zip">("mrpack");
  const [exportTree, setExportTree] = useState<FileNode[] | null>(null);
  const [exportTreeProfileId, setExportTreeProfileId] = useState<string | null>(null);
  const [exportTreeLoading, setExportTreeLoading] = useState(false);
  const [selectedExportPaths, setSelectedExportPaths] = useState<Set<string>>(new Set());
  const [ignorePatternsText, setIgnorePatternsText] = useState(DEFAULT_EXPORT_IGNORES);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgressPayload | null>(null);
  const [exportResultPath, setExportResultPath] = useState<string | null>(null);
  const [exportSkippedFiles, setExportSkippedFiles] = useState<string[]>([]);
  const [exportResolvedCount, setExportResolvedCount] = useState(0);
  const [exportOverrideCount, setExportOverrideCount] = useState(0);
  const [exportSpeedLabel, setExportSpeedLabel] = useState<string>("");
  const [collapsedExportPaths, setCollapsedExportPaths] = useState<Set<string>>(new Set());
  const [exportSearchQuery, setExportSearchQuery] = useState("");
  const lastProgressRef = useRef<{ t: number; bytes: number } | null>(null);
  const previewRequestIdRef = useRef(0);

  const exportFormatTabRefs = useRef<
    Partial<Record<"mrpack" | "zip", HTMLButtonElement | null>>

  >({});

  const [exportFormatIndicator, setExportFormatIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  function parseIgnorePatterns(text: string): string[] {
    return text
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
  }

  function flattenTreePaths(nodes: FileNode[] | null): string[] {
    if (!nodes) return [];
    const out: string[] = [];
    const stack: FileNode[] = [...nodes];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      out.push(n.path);
      if (n.children && n.children.length) {
        for (const c of n.children) stack.push(c);
      }
    }
    return out;
  }

  function collectFilePaths(node: FileNode): string[] {
    if (!node.is_dir) return [node.path];
    const out: string[] = [];
    for (const c of node.children ?? []) {
      out.push(...collectFilePaths(c));
    }
    return out;
  }

  function pathHasSelectedAncestor(path: string, selected: Set<string>): boolean {
    let cur = path;
    while (true) {
      const idx = cur.lastIndexOf("/");
      if (idx < 0) break;
      cur = cur.slice(0, idx);
      if (selected.has(cur)) return true;
    }
    return false;
  }

  function isExportPathSelected(path: string): boolean {
    if (selectedExportPaths.has(path)) return true;
    return pathHasSelectedAncestor(path, selectedExportPaths);
  }

  function findNodeByPath(nodes: FileNode[] | null, path: string): FileNode | null {
    if (!nodes) return null;
    for (const n of nodes) {
      if (n.path === path) return n;
      const nested = findNodeByPath(n.children ?? null, path);
      if (nested) return nested;
    }
    return null;
  }

  function getFolderCheckState(node: FileNode): "all" | "some" | "none" {
    const files = collectFilePaths(node);
    if (files.length === 0) {
      return isExportPathSelected(node.path) ? "all" : "none";
    }
    let selected = 0;
    for (const f of files) {
      if (isExportPathSelected(f)) selected += 1;
    }
    if (selected === 0) return "none";
    if (selected === files.length) return "all";
    return "some";
  }

  function setExportNodeChecked(node: FileNode, checked: boolean) {
    setSelectedExportPaths((prev) => {
      const next = new Set(prev);

      const expandAncestorIfNeeded = () => {
        const parts = node.path.split("/");
        for (let i = parts.length - 1; i >= 1; i -= 1) {
          const ancestorPath = parts.slice(0, i).join("/");
          if (!next.has(ancestorPath)) continue;
          const ancestor = findNodeByPath(exportTree, ancestorPath);
          if (!ancestor) continue;
          next.delete(ancestorPath);
          for (const f of collectFilePaths(ancestor)) {
            if (f === node.path || f.startsWith(`${node.path}/`)) continue;
            next.add(f);
          }
        }
      };

      if (checked) {
        expandAncestorIfNeeded();
        if (node.is_dir) {
          for (const f of collectFilePaths(node)) next.delete(f);
          for (const p of flattenTreePaths(node.children ?? null)) next.delete(p);
          next.add(node.path);
        } else {
          next.add(node.path);
        }
      } else {
        expandAncestorIfNeeded();
        next.delete(node.path);
        if (node.is_dir) {
          for (const f of collectFilePaths(node)) next.delete(f);
          for (const p of flattenTreePaths(node.children ?? null)) next.delete(p);
        }
      }
      return next;
    });
  }

  function getDefaultSelectedPaths(tree: FileNode[] | null): Set<string> {
    const next = new Set<string>();
    if (!tree) return next;
    for (const n of tree) {
      if (RECOMMENDED_EXPORT_TOP.has(n.name)) next.add(n.path);
    }
    if (next.size === 0) {
      for (const n of tree) {
        if (!["saves", "logs", "crash-reports", "screenshots"].includes(n.name)) {
          next.add(n.path);
        }
      }
    }
    return next;
  }

  function applyExportPreset(preset: "recommended" | "minimal" | "full") {
    if (!exportTree) return;
    if (preset === "full") {
      setSelectedExportPaths(new Set(exportTree.map((n) => n.path)));
      return;
    }
    const allow = preset === "minimal" ? MINIMAL_EXPORT_TOP : RECOMMENDED_EXPORT_TOP;
    const next = new Set<string>();
    for (const n of exportTree) {
      if (allow.has(n.name)) next.add(n.path);
    }
    setSelectedExportPaths(next);
  }

  async function loadExportTree(profileId: string, force = false) {
    if (!force && exportTree && exportTreeProfileId === profileId) return;
    setExportTreeLoading(true);
    try {
      const tree = await invoke<FileNode[]>("list_build_files", { buildId: profileId });
      setExportTree(tree);
      setExportTreeProfileId(profileId);
      setSelectedExportPaths(getDefaultSelectedPaths(tree));
      setCollapsedExportPaths(new Set());
      setExportSearchQuery("");
      setIgnorePatternsText(DEFAULT_EXPORT_IGNORES);
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.export.readFilesFailed"));
      setExportTree(null);
      setExportTreeProfileId(null);
    } finally {
      setExportTreeLoading(false);
    }
  }

  async function openExportModal() {
    if (!selectedProfile) return;
    setIsExportOpen(true);
    setExportResultPath(null);
    setExportProgress(null);
    setExportSkippedFiles([]);
    setExportResolvedCount(0);
    setExportOverrideCount(0);
    setExportSpeedLabel("");
    lastProgressRef.current = null;
    setPreviewResult(null);
    setExportSearchQuery("");
    await loadExportTree(selectedProfile.id, exportTreeProfileId !== selectedProfile.id);
  }

  async function handlePreviewExport(opts?: { silent?: boolean }) {
    if (!selectedProfile) return;
    const selected = Array.from(selectedExportPaths);
    if (selected.length === 0) {
      setPreviewResult(null);
      if (!opts?.silent) {
        showNotification(
          "warning",
          tt("modpacks.export.selectAtLeastOnePath"),
        );
      }
      return;
    }
    const requestId = ++previewRequestIdRef.current;
    setPreviewLoading(true);
    if (!opts?.silent) setPreviewResult(null);
    try {
      const res = await invoke<PreviewResult>("preview_export", {
        buildId: selectedProfile.id,
        selected,
        ignores: parseIgnorePatterns(ignorePatternsText),
        format: exportFormat,
      });
      if (requestId !== previewRequestIdRef.current) return;
      setPreviewResult(res);
    } catch (e) {
      if (requestId !== previewRequestIdRef.current) return;
      console.error(e);
      if (!opts?.silent) {
        showNotification(
          "error",
          tt("modpacks.export.previewFailed"),
        );
      }
    } finally {
      if (requestId === previewRequestIdRef.current) {
        setPreviewLoading(false);
      }
    }
  }

  async function handleStartExport() {
    if (!selectedProfile) return;
    const selected = Array.from(selectedExportPaths);
    if (selected.length === 0) {
      showNotification(
        "warning",
        tt("modpacks.export.selectAtLeastOnePath"),
      );
      return;
    }

    let outPath: string | null = null;
    try {
      const ext = exportFormat === "mrpack" ? "mrpack" : "zip";
      const suggested = `${selectedProfile.name}-${selectedProfile.id}.${ext}`;
      const chosen = await saveFileDialog({
        defaultPath: suggested,
        filters: [
          exportFormat === "mrpack"
            ? { name: "Modrinth pack", extensions: ["mrpack"] }
            : { name: "Zip archive", extensions: ["zip"] },
        ],
      });
      if (typeof chosen === "string" && chosen.trim()) {
        outPath = chosen;
      }
    } catch (e) {
      console.error(e);
    }
    if (!outPath) return;

    setExportBusy(true);
    setExportProgress({ bytes_written: 0, total_bytes: 0, current_file: "" });
    setExportResultPath(null);
    setExportSkippedFiles([]);
    setExportResolvedCount(0);
    setExportOverrideCount(0);
    setExportSpeedLabel("");
    lastProgressRef.current = null;

    try {
      await invoke("export_build", {
        buildId: selectedProfile.id,
        selected,
        ignores: parseIgnorePatterns(ignorePatternsText),
        format: exportFormat,
        outPath,
      });
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      showNotification(
        "error",
        tt("modpacks.export.failed", { msg }),
      );
      setExportBusy(false);
    }
  }

  useLayoutEffect(() => {
    if (!isExportOpen) return;
    const unlistenProgress = subscribeTauriEvent<ExportProgressPayload>("export-progress", (event) => {
      const p = event.payload;
      setExportProgress(p);
      const now = Date.now();
      const prev = lastProgressRef.current;
      if (prev && p.bytes_written >= prev.bytes) {
        const dt = Math.max(1, now - prev.t);
        const db = p.bytes_written - prev.bytes;
        const bps = (db * 1000) / dt;
        if (Number.isFinite(bps)) {
          setExportSpeedLabel(
            `${formatByteSize(language, bps)}${tt("modpacks.export.perSecond")}`,
          );
        }
      }
      lastProgressRef.current = { t: now, bytes: p.bytes_written };
    });

    const unlistenFinished = subscribeTauriEvent<ExportFinishedPayload>("export-finished", (event) => {
      const p = event.payload;
      setExportResultPath(p.path);
      setExportSkippedFiles(Array.isArray(p.skipped_files) ? p.skipped_files : []);
      setExportResolvedCount(
        typeof p.resolved_count === "number" ? p.resolved_count : 0,
      );
      setExportOverrideCount(
        typeof p.override_count === "number" ? p.override_count : 0,
      );
      setExportBusy(false);
      setExportProgress(null);
      showNotification(
        "success",
        tt("modpacks.export.finished"),
      );
    });

    const unlistenError = subscribeTauriEvent<ExportErrorPayload>("export-error", (event) => {
      const p = event.payload;
      const msg =
        typeof p === "string"
          ? p
          : p && typeof p.message === "string"
            ? p.message
            : tt("modpacks.export.errorGeneric");
      setExportBusy(false);
      showNotification("error", msg);
    });

    return () => {
      unlistenProgress();
      unlistenFinished();
      unlistenError();
    };
  }, [isExportOpen, language, showNotification]);

  useEffect(() => {
    if (!isExportOpen) return;
    let raf = 0;
    let cancelled = false;

    const updateIndicator = () => {
      if (cancelled) return;
      const el = exportFormatTabRefs.current[exportFormat];
      if (el) {
        setExportFormatIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateIndicator);
    };

    updateIndicator();
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [isExportOpen, exportFormat]);

  const filteredExportTree = useMemo(() => {
    if (!exportTree) return null;
    return filterExportFileTree(exportTree, exportSearchQuery);
  }, [exportTree, exportSearchQuery]);

  const exportSelectionStats = useMemo(() => {
    if (!exportTree) return { count: 0, bytes: 0 };
    let count = 0;
    let bytes = 0;
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.is_dir) {
          if (n.children?.length) walk(n.children);
        } else if (
          selectedExportPaths.has(n.path) ||
          pathHasSelectedAncestor(n.path, selectedExportPaths)
        ) {
          count += 1;
          bytes += n.size;
        }
      }
    };
    walk(exportTree);
    return { count, bytes };
  }, [exportTree, selectedExportPaths]);

  const exportQuickNodes = useMemo(() => {
    if (!exportTree) return [] as FileNode[];
    return EXPORT_QUICK_FOLDERS.map(
      (name) => exportTree.find((n) => n.name === name) ?? null,
    ).filter((n): n is FileNode => n != null);
  }, [exportTree]);

  const selectedExportPathsKey = useMemo(
    () => Array.from(selectedExportPaths).sort().join("\n"),
    [selectedExportPaths],
  );

  useEffect(() => {
    if (!isExportOpen || exportBusy || exportTreeLoading || !selectedProfile || !exportTree) {
      return;
    }
    const timer = window.setTimeout(() => {
      void handlePreviewExport({ silent: true });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    isExportOpen,
    exportBusy,
    exportTreeLoading,
    selectedProfile?.id,
    selectedExportPathsKey,
    ignorePatternsText,
    exportFormat,
    exportTree,
  ]);

  return {
    isExportOpen,
    setIsExportOpen,
    exportFormat,
    setExportFormat,
    exportTree,
    exportTreeLoading,
    setSelectedExportPaths,
    ignorePatternsText,
    setIgnorePatternsText,
    previewLoading,
    previewResult,
    exportBusy,
    exportProgress,
    exportResultPath,
    exportSkippedFiles,
    exportResolvedCount,
    exportOverrideCount,
    exportSpeedLabel,
    collapsedExportPaths,
    setCollapsedExportPaths,
    exportSearchQuery,
    setExportSearchQuery,
    exportFormatTabRefs,
    exportFormatIndicator,
    isExportPathSelected,
    getFolderCheckState,
    setExportNodeChecked,
    applyExportPreset,
    loadExportTree,
    openExportModal,
    handlePreviewExport,
    handleStartExport,
    filteredExportTree,
    exportSelectionStats,
    exportQuickNodes,
  };
}
