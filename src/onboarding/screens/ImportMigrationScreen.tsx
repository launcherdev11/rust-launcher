import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Language } from "../../i18n";
import { formatByteSize, useT } from "../../i18n";
import { EmptyState, ErrorState, Skeleton, Spinner } from "../../components/ui";
import { InputClearButton } from "../../components/ui/InputClearButton";
import { OnboardingButton } from "../components/OnboardingButton";
import { OnboardingLayout } from "../components/OnboardingLayout";

type ExternalLauncherType =
  | "auto"
  | "multimc"
  | "prism_launcher"
  | "atlauncher"
  | "gdlauncher"
  | "curseforge"
  | "unknown";

type ImportableExternalInstance = {
  id: string;
  launcher_type: ExternalLauncherType;
  path: string;
  display_name: string;
  loader: string | null;
  game_version: string | null;
  icon_path: string | null;
  icon_data_uri: string | null;
  approx_size_bytes: number | null;
  mods_count: number | null;
  last_modified: number | null;
};

type ScannedInstance = ImportableExternalInstance & {
  scanBasePath: string | null;
  scanLauncherType: ExternalLauncherType;
};

type ImportFailure = { name: string; message: string };

const LAUNCHER_OPTIONS: { id: ExternalLauncherType; labelKey?: string; label?: string }[] = [
  { id: "auto", labelKey: "onboarding.import.launcherAuto" },
  { id: "prism_launcher", label: "Prism Launcher" },
  { id: "multimc", label: "MultiMC" },
  { id: "curseforge", label: "CurseForge" },
  { id: "atlauncher", label: "ATLauncher" },
  { id: "gdlauncher", label: "GDLauncher" },
];

const AUTO_SCAN_TYPES: ExternalLauncherType[] = [
  "prism_launcher",
  "multimc",
  "curseforge",
  "atlauncher",
  "gdlauncher",
];

function launcherLabel(tt: (key: string) => string, type: ExternalLauncherType): string {
  const opt = LAUNCHER_OPTIONS.find((o) => o.id === type);
  if (opt?.label) return opt.label;
  if (opt?.labelKey) return tt(opt.labelKey);
  return tt("onboarding.import.unknownLauncher");
}

function instanceKey(inst: { launcher_type: ExternalLauncherType; path: string }): string {
  return `${inst.launcher_type}::${inst.path}`;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : JSON.stringify(e);
}

type Props = {
  language: Language;
  onBack: () => void;
  onSkip: () => void;
  onContinue: () => void;
};

export function ImportMigrationScreen({
  language,
  onBack,
  onSkip,
  onContinue,
}: Props) {
  const tt = useT(language);
  const [launcherType, setLauncherType] = useState<ExternalLauncherType>("auto");
  const [basePath, setBasePath] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [instances, setInstances] = useState<ScannedInstance[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(
    null,
  );
  const [failures, setFailures] = useState<ImportFailure[] | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const [launcherMenuOpen, setLauncherMenuOpen] = useState(false);
  const launcherMenuRef = useRef<HTMLDivElement | null>(null);
  const didAutoScanRef = useRef(false);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!launcherMenuRef.current?.contains(e.target as Node)) {
        setLauncherMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const addInstances = useCallback((found: ScannedInstance[]) => {
    setInstances((prev) => {
      const seen = new Set(prev.map(instanceKey));
      const merged = [...prev];
      for (const inst of found) {
        const key = instanceKey(inst);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(inst);
      }
      merged.sort((a, b) =>
        a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase()),
      );
      return merged;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const inst of found) next.add(instanceKey(inst));
      return next;
    });
  }, []);

  const scanAuto = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const results = await Promise.all(
        AUTO_SCAN_TYPES.map(async (lt) => {
          try {
            const list = await invoke<ImportableExternalInstance[]>("list_importable_instances", {
              launcherType: lt,
              basePath: null,
            });
            return (list ?? []).map<ScannedInstance>((inst) => ({
              ...inst,
              scanBasePath: null,
              scanLauncherType: lt,
            }));
          } catch {
            return [];
          }
        }),
      );
      addInstances(results.flat());
    } finally {
      setScanning(false);
      setHasScanned(true);
    }
  }, [addInstances]);

  const scanManual = useCallback(async () => {
    const trimmed = basePath.trim();
    if (launcherType === "auto" && !trimmed) {
      await scanAuto();
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      const list = await invoke<ImportableExternalInstance[]>("list_importable_instances", {
        launcherType,
        basePath: trimmed.length ? trimmed : null,
      });
      addInstances(
        (list ?? []).map<ScannedInstance>((inst) => ({
          ...inst,
          scanBasePath: trimmed.length ? trimmed : null,
          scanLauncherType: launcherType,
        })),
      );
    } catch (e) {
      setScanError(errorText(e) || tt("onboarding.import.scanFailed"));
    } finally {
      setScanning(false);
      setHasScanned(true);
    }
  }, [addInstances, basePath, launcherType, scanAuto, tt]);

  useEffect(() => {
    if (didAutoScanRef.current) return;
    didAutoScanRef.current = true;
    void scanAuto();
  }, [scanAuto]);

  const selectedList = useMemo(
    () => instances.filter((i) => selected.has(instanceKey(i))),
    [instances, selected],
  );

  const groups = useMemo(() => {
    const byType = new Map<ExternalLauncherType, ScannedInstance[]>();
    for (const inst of instances) {
      const list = byType.get(inst.launcher_type) ?? [];
      list.push(inst);
      byType.set(inst.launcher_type, list);
    }
    return [...byType.entries()];
  }, [instances]);

  const toggle = (inst: ScannedInstance) => {
    const key = instanceKey(inst);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allSelected = instances.length > 0 && selectedList.length === instances.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(instances.map(instanceKey)));
  };

  const handleLauncherChange = async (type: ExternalLauncherType) => {
    setLauncherType(type);
    setLauncherMenuOpen(false);
    setScanError(null);
    if (type === "auto" || type === "unknown") {
      setBasePath("");
      return;
    }
    try {
      const p = await invoke<string | null>("default_external_launcher_path", {
        launcherType: type,
      });
      setBasePath(p ?? "");
    } catch {
      setBasePath("");
    }
  };

  const handleBrowse = async () => {
    try {
      const p = await openFileDialog({ directory: true, multiple: false });
      if (typeof p === "string") {
        setBasePath(p);
        setScanError(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleImport = async () => {
    if (selectedList.length === 0 || importing) return;
    const queue = selectedList;
    const failed: ImportFailure[] = [];
    setImporting(true);
    setFailures(null);
    setProgress({ done: 0, total: queue.length, name: queue[0].display_name });
    let done = 0;
    for (const inst of queue) {
      setProgress({ done, total: queue.length, name: inst.display_name });
      const type =
        inst.launcher_type !== "unknown" && inst.launcher_type !== "auto"
          ? inst.launcher_type
          : inst.scanLauncherType;
      try {
        await invoke("import_selected_external_instance", {
          launcherType: type,
          basePath: inst.scanBasePath,
          instancePath: inst.path,
          displayName: inst.display_name,
          loader: inst.loader,
          gameVersion: inst.game_version,
          iconPath: inst.icon_path,
        });
      } catch (e) {
        failed.push({
          name: inst.display_name,
          message: errorText(e) || tt("onboarding.import.errorGeneric"),
        });
      }
      done += 1;
    }
    setImporting(false);
    setProgress(null);
    if (failed.length === 0) {
      onContinue();
      return;
    }
    setImportedCount(queue.length - failed.length);
    setFailures(failed);
  };

  const showResult = failures !== null && !importing;
  const showList = !importing && !showResult;
  const showSkeleton = scanning && instances.length === 0;
  const showEmpty =
    showList && !scanning && hasScanned && instances.length === 0 && !scanError;
  const percent = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <OnboardingLayout language={language} onBack={onBack} backDisabled={importing}>
      <h1 className="text-xl font-semibold text-white sm:text-2xl">{tt("onboarding.import.title")}</h1>

      <div className="mt-1.5 mb-4 min-h-[2.5rem] text-sm text-white/60" aria-live="polite">
        {importing ? (
          <p>{tt("onboarding.import.importing")}</p>
        ) : showResult ? (
          <p className="font-semibold text-white/85">
            {tt("onboarding.import.resultTitle", {
              done: importedCount,
              total: importedCount + (failures?.length ?? 0),
            })}
          </p>
        ) : scanning ? (
          <p className="inline-flex items-center gap-2">
            <Spinner className="h-3.5 w-3.5" />
            <span>{tt("onboarding.import.subtitle")}</span>
          </p>
        ) : instances.length > 0 ? (
          <>
            <p className="font-semibold text-white/85">
              {tt("onboarding.import.foundTitle", { count: instances.length })}
            </p>
            <p className="mt-0.5">{tt("onboarding.import.foundHint")}</p>
          </>
        ) : (
          <p>{tt("onboarding.import.subtitle")}</p>
        )}
      </div>

      {showSkeleton ? (
        <div className="flex w-full flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-inset flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-9 w-9 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {showList && instances.length > 0 ? (
        <>
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-white/55">
            <span>
              {tt("onboarding.import.selectedCount", {
                count: selectedList.length,
                total: instances.length,
              })}
            </span>
            <button type="button" onClick={toggleAll} className="btn btn-ghost btn-sm">
              {allSelected ? tt("onboarding.import.selectNone") : tt("onboarding.import.selectAll")}
            </button>
          </div>

          <div className="custom-scrollbar flex max-h-[min(34vh,260px)] w-full flex-col gap-3 overflow-y-auto pr-1">
            {groups.map(([type, list]) => (
              <section key={type} className="flex flex-col gap-1.5">
                <p className="flex items-center gap-2 text-xs font-semibold text-white/55">
                  {launcherLabel(tt, type)}
                  <span className="tag">{list.length}</span>
                </p>
                {list.map((inst) => {
                  const key = instanceKey(inst);
                  const isSelected = selected.has(key);
                  const meta = [
                    inst.game_version,
                    inst.loader,
                    inst.mods_count != null && inst.mods_count > 0
                      ? tt("common.format.modsCount", { count: inst.mods_count })
                      : null,
                    inst.approx_size_bytes
                      ? formatByteSize(language, inst.approx_size_bytes)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <button
                      key={key}
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      onClick={() => toggle(inst)}
                      className={[
                        "interactive-press flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
                        isSelected ? "glass-panel" : "glass-inset hover:bg-white/8",
                      ].join(" ")}
                    >
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${
                          isSelected ? "accent-bg border-transparent" : "border-white/25"
                        }`}
                      >
                        {isSelected ? <Check className="h-3 w-3 text-white" /> : null}
                      </span>
                      <div className="glass-control flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
                        <img
                          src={inst.icon_data_uri || "/launcher-assets/modpack_icon.png"}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-white">
                          {inst.display_name}
                        </h3>
                        {meta ? <p className="mt-0.5 truncate text-xs text-white/55">{meta}</p> : null}
                      </div>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </>
      ) : null}

      {showEmpty ? (
        <EmptyState
          compact
          title={tt("onboarding.import.emptyTitle")}
          description={tt("onboarding.import.emptyHint")}
        />
      ) : null}

      {showList && scanError ? (
        <ErrorState
          compact
          title={tt("onboarding.import.scanFailed")}
          details={scanError}
          action={
            <OnboardingButton variant="secondary" onClick={() => void scanManual()}>
              {tt("common.state.retry")}
            </OnboardingButton>
          }
        />
      ) : null}

      {importing && progress ? (
        <div className="glass-inset flex w-full flex-col gap-2.5 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3 text-xs text-white/70">
            <span className="min-w-0 truncate">
              {tt("onboarding.import.progress", {
                current: Math.min(progress.done + 1, progress.total),
                total: progress.total,
                name: progress.name,
              })}
            </span>
            <span className="shrink-0 tabular-nums">{percent}%</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-md bg-white/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="progress-fill h-full rounded-md transition-[width] duration-200"
              style={{ width: `${Math.max(percent, 4)}%` }}
            />
          </div>
        </div>
      ) : null}

      {showResult && failures ? (
        <div className="glass-inset w-full px-4 py-3">
          <p className="mb-2 text-xs font-semibold text-amber-200/90">
            {tt("onboarding.import.resultFailed")}
          </p>
          <ul className="custom-scrollbar flex max-h-36 flex-col gap-2 overflow-y-auto pr-1">
            {failures.map((f) => (
              <li key={f.name} className="text-xs">
                <p className="truncate font-semibold text-white/85">{f.name}</p>
                <p className="break-words text-white/50">{f.message}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showList ? (
        <div className="mt-3 flex w-full flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            aria-expanded={manualOpen}
            className="interactive-press inline-flex items-center gap-1.5 self-start text-xs font-semibold text-white/60 hover:text-white"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${manualOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
            {manualOpen ? tt("onboarding.import.manualHide") : tt("onboarding.import.manual")}
          </button>

          {manualOpen ? (
            <div className="flex w-full flex-col gap-2.5 text-left">
              <div>
                <label className="mb-1 block text-[0.8125rem] font-semibold text-white/55">
                  {tt("onboarding.import.launcher")}
                </label>
                <div ref={launcherMenuRef} className="relative">
                  <button
                    type="button"
                    disabled={scanning}
                    onClick={() => setLauncherMenuOpen((v) => !v)}
                    className="interactive-press glass-control flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-white hover:bg-white/10 disabled:opacity-60"
                  >
                    <span className="truncate">{launcherLabel(tt, launcherType)}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
                  </button>
                  {launcherMenuOpen && (
                    <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden glass-popover p-1">
                      {LAUNCHER_OPTIONS.map((opt) => {
                        const active = launcherType === opt.id;
                        const label = opt.label ?? (opt.labelKey ? tt(opt.labelKey) : opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => void handleLauncherChange(opt.id)}
                            className={`interactive-press flex w-full items-center rounded-xl px-4 py-2 text-left text-sm transition-colors ${
                              active ? "seg-on font-semibold" : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[0.8125rem] font-semibold text-white/55">
                  {tt("onboarding.import.path")}
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <input
                      type="text"
                      value={basePath}
                      disabled={scanning}
                      onChange={(e) => {
                        setBasePath(e.target.value);
                        setScanError(null);
                      }}
                      placeholder={tt("onboarding.import.pathPlaceholder")}
                      className={`glass-control ui-body w-full px-3 py-2.5 text-white/90 placeholder:text-white/35 focus:outline-none focus:border-white/25 disabled:opacity-60 ${
                        basePath ? "pr-9" : ""
                      }`}
                    />
                    <InputClearButton
                      value={basePath}
                      onClear={() => setBasePath("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2"
                      aria-label={tt("common.clear")}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={scanning}
                    onClick={() => void handleBrowse()}
                    title={tt("onboarding.import.browse")}
                    className="interactive-press glass-control flex h-[42px] w-[42px] shrink-0 items-center justify-center hover:bg-white/10 disabled:opacity-60"
                  >
                    <img
                      src="/launcher-assets/folder.png"
                      alt=""
                      className="h-5 w-5 object-contain opacity-90"
                    />
                  </button>
                </div>
                <p className="mt-1.5 text-[0.8125rem] leading-snug text-white/40">
                  {tt("onboarding.import.pathHint")}
                </p>
              </div>

              <OnboardingButton
                variant="secondary"
                fullWidth
                disabled={scanning}
                onClick={() => void scanManual()}
              >
                {scanning ? tt("onboarding.import.scanning") : tt("onboarding.import.scan")}
              </OnboardingButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {!importing ? (
        <div className="mt-5 flex w-full flex-col items-center gap-2">
          {showResult ? (
            <OnboardingButton variant="primary" fullWidth onClick={onContinue}>
              {tt("onboarding.import.continue")}
            </OnboardingButton>
          ) : (
            <>
              {instances.length > 0 ? (
                <OnboardingButton
                  variant="primary"
                  fullWidth
                  disabled={scanning || selectedList.length === 0}
                  onClick={() => void handleImport()}
                >
                  {tt("onboarding.import.cta", { count: selectedList.length })}
                </OnboardingButton>
              ) : null}
              <OnboardingButton
                variant={instances.length === 0 && !scanning ? "primary" : "ghost"}
                fullWidth
                onClick={onSkip}
              >
                {instances.length > 0 || scanning
                  ? tt("onboarding.import.skip")
                  : tt("onboarding.import.continue")}
              </OnboardingButton>
            </>
          )}
        </div>
      ) : null}
    </OnboardingLayout>
  );
}
