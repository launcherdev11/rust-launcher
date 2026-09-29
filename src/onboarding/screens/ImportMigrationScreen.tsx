import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown } from "lucide-react";
import type { Language } from "../../i18n";
import { useT } from "../../i18n";
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

const LAUNCHER_OPTIONS: { id: ExternalLauncherType; labelKey?: string; label?: string }[] = [
  { id: "auto", labelKey: "onboarding.import.launcherAuto" },
  { id: "prism_launcher", label: "Prism Launcher" },
  { id: "multimc", label: "MultiMC" },
  { id: "curseforge", label: "CurseForge" },
  { id: "atlauncher", label: "ATLauncher" },
  { id: "gdlauncher", label: "GDLauncher" },
];

function launcherLabel(
  tt: (key: string) => string,
  type: ExternalLauncherType,
): string {
  const opt = LAUNCHER_OPTIONS.find((o) => o.id === type);
  if (opt?.label) return opt.label;
  if (opt?.labelKey) return tt(opt.labelKey);
  return tt("onboarding.import.unknownLauncher");
}

function instanceKey(inst: ImportableExternalInstance): string {
  return `${inst.launcher_type}::${inst.path}`;
}

type Props = {
  language: Language;
  stepIndex: number;
  accentColor?: string;
  backgroundImageUrl?: string;
  onBack: () => void;
  onSkip: () => void;
  onContinue: () => void;
};

export function ImportMigrationScreen({
  language,
  stepIndex,
  accentColor,
  backgroundImageUrl,
  onBack,
  onSkip,
  onContinue,
}: Props) {
  const tt = useT(language);
  const [launcherType, setLauncherType] = useState<ExternalLauncherType>("auto");
  const [basePath, setBasePath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instances, setInstances] = useState<ImportableExternalInstance[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [launcherMenuOpen, setLauncherMenuOpen] = useState(false);
  const launcherMenuRef = useRef<HTMLDivElement | null>(null);
  const didAutoScanRef = useRef(false);

  const fillDefaultPath = useCallback(async (type: ExternalLauncherType) => {
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
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!launcherMenuRef.current?.contains(e.target as Node)) {
        setLauncherMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const scanPath = useCallback(
    async (type: ExternalLauncherType, path: string) => {
      setScanning(true);
      setError(null);
      setHasScanned(true);
      try {
        const trimmed = path.trim();
        if (type === "auto" && !trimmed) {
          const found: ImportableExternalInstance[] = [];
          const seen = new Set<string>();
          for (const lt of [
            "prism_launcher",
            "multimc",
            "curseforge",
            "atlauncher",
            "gdlauncher",
          ] as ExternalLauncherType[]) {
            try {
              const list = await invoke<ImportableExternalInstance[]>(
                "list_importable_instances",
                { launcherType: lt, basePath: null },
              );
              for (const inst of list ?? []) {
                const key = instanceKey(inst);
                if (seen.has(key)) continue;
                seen.add(key);
                found.push(inst);
              }
            } catch {
            }
          }
          found.sort((a, b) =>
            a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase()),
          );
          setInstances(found);
          setSelected(new Set(found.map(instanceKey)));
          return;
        }

        const list = await invoke<ImportableExternalInstance[]>("list_importable_instances", {
          launcherType: type,
          basePath: trimmed.length ? trimmed : null,
        });
        const found = list ?? [];
        setInstances(found);
        setSelected(new Set(found.map(instanceKey)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setInstances([]);
        setSelected(new Set());
        setError(msg || tt("onboarding.import.scanFailed"));
      } finally {
        setScanning(false);
      }
    },
    [tt],
  );

  useEffect(() => {
    if (didAutoScanRef.current) return;
    didAutoScanRef.current = true;
    void scanPath("auto", "");
  }, [scanPath]);

  const selectedList = useMemo(
    () => instances.filter((i) => selected.has(instanceKey(i))),
    [instances, selected],
  );

  const toggle = (inst: ImportableExternalInstance) => {
    const key = instanceKey(inst);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleLauncherChange = async (type: ExternalLauncherType) => {
    setLauncherType(type);
    setLauncherMenuOpen(false);
    setInstances([]);
    setSelected(new Set());
    setHasScanned(false);
    setError(null);
    await fillDefaultPath(type);
  };

  const handleBrowse = async () => {
    try {
      const p = await openFileDialog({ directory: true, multiple: false });
      if (typeof p === "string") {
        setBasePath(p);
        setHasScanned(false);
        setError(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleImport = async () => {
    if (selectedList.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    let done = 0;
    const total = selectedList.length;
    const pathForImport = basePath.trim().length ? basePath.trim() : null;
    try {
      for (const inst of selectedList) {
        done += 1;
        setProgressLabel(
          tt("onboarding.import.progress", {
            current: done,
            total,
            name: inst.display_name,
          }),
        );
        const lt =
          inst.launcher_type !== "unknown" && inst.launcher_type !== "auto"
            ? inst.launcher_type
            : launcherType;
        await invoke("import_selected_external_instance", {
          launcherType: lt,
          basePath: pathForImport,
          instancePath: inst.path,
          displayName: inst.display_name,
          loader: inst.loader,
          gameVersion: inst.game_version,
          iconPath: inst.icon_path,
        });
      }
      onContinue();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || tt("onboarding.import.errorGeneric"));
    } finally {
      setImporting(false);
      setProgressLabel(null);
    }
  };

  const busy = scanning || importing;

  return (
    <OnboardingLayout
      language={language}
      stepIndex={stepIndex}
      screenKey="import-migration"
      accentColor={accentColor}
      backgroundImageUrl={backgroundImageUrl}
      hideFooter
    >
      <button
        type="button"
        onClick={onBack}
        disabled={importing}
        className="interactive-press mb-3 inline-flex items-center gap-1.5 self-start text-xs font-semibold text-white/60 hover:text-white disabled:opacity-45"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {tt("onboarding.nav.back")}
      </button>

      <h1 className="text-xl font-semibold text-white sm:text-2xl">{tt("onboarding.import.title")}</h1>
      <p className="mt-1.5 mb-4 text-sm text-white/60">{tt("onboarding.import.subtitle")}</p>

      <div className="flex w-full flex-col gap-2.5 text-left">
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-white/55">
            {tt("onboarding.import.launcher")}
          </label>
          <div ref={launcherMenuRef} className="relative">
            <button
              type="button"
              disabled={busy}
              onClick={() => setLauncherMenuOpen((v) => !v)}
              className="interactive-press glass-control flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-white hover:bg-white/10 disabled:opacity-60"
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
                      className={`interactive-press flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-white/90 font-semibold text-black"
                          : "text-white/80 hover:bg-white/10"
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
          <label className="mb-1 block text-[11px] font-semibold text-white/55">
            {tt("onboarding.import.path")}
          </label>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="text"
                value={basePath}
                disabled={busy}
                onChange={(e) => {
                  setBasePath(e.target.value);
                  setHasScanned(false);
                  setError(null);
                }}
                placeholder={tt("onboarding.import.pathPlaceholder")}
                className={`glass-control ui-body w-full px-3 py-2.5 text-white/90 placeholder:text-white/35 focus:outline-none focus:border-white/25 disabled:opacity-60 ${
                  basePath ? "pr-9" : ""
                }`}
              />
              <InputClearButton
                value={basePath}
                onClear={() => {
                  setBasePath("");
                  setHasScanned(false);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
                aria-label={tt("common.clear")}
              />
            </div>
            <button
              type="button"
              disabled={busy}
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
          <p className="mt-1.5 text-[11px] leading-snug text-white/40">
            {tt("onboarding.import.pathHint")}
          </p>
        </div>

        <OnboardingButton
          variant="secondary"
          fullWidth
          disabled={busy}
          onClick={() => void scanPath(launcherType, basePath)}
          className="!mt-0"
        >
          {scanning ? tt("onboarding.import.scanning") : tt("onboarding.import.scan")}
        </OnboardingButton>
      </div>

      <div className="mt-3 flex max-h-[min(32vh,240px)] w-full flex-col gap-2 overflow-y-auto pr-1">
        {scanning && (
          <div className="glass-inset w-full px-4 py-3 text-left">
            <p className="text-sm text-white/70">{tt("onboarding.import.scanning")}</p>
          </div>
        )}

        {!scanning && hasScanned && instances.length === 0 && (
          <div className="glass-inset w-full px-4 py-3 text-left">
            <div className="flex items-start gap-3">
              <img
                src="/launcher-assets/folder.png"
                alt=""
                className="mt-0.5 h-5 w-5 shrink-0 object-contain opacity-55"
              />
              <div>
                <p className="text-sm font-medium text-white/90">
                  {tt("onboarding.import.emptyTitle")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-white/55">
                  {tt("onboarding.import.emptyHint")}
                </p>
              </div>
            </div>
          </div>
        )}

        {!scanning &&
          instances.map((inst) => {
            const key = instanceKey(inst);
            const isSelected = selected.has(key);
            const meta = [
              launcherLabel(tt, inst.launcher_type),
              inst.game_version,
              inst.loader,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={key}
                type="button"
                disabled={busy}
                onClick={() => toggle(inst)}
                className={[
                  "interactive-press flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus:outline-none",
                  isSelected ? "glass-panel" : "glass-inset hover:bg-white/8",
                  busy ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                ].join(" ")}
              >
                <div className="glass-control relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
                  <img
                    src={inst.icon_data_uri || "/launcher-assets/modpack_icon.png"}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {isSelected ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                      <Check className="h-4 w-4 text-white" aria-hidden />
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-white">
                    {inst.display_name}
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-white/55">{meta}</p>
                </div>
              </button>
            );
          })}
      </div>

      {error && <p className="mt-3 text-xs text-amber-200/90">{error}</p>}
      {progressLabel && <p className="mt-3 text-xs text-white/60">{progressLabel}</p>}

      <div className="mt-5 flex w-full flex-col items-center gap-3">
        {instances.length > 0 ? (
          <OnboardingButton
            variant="primary"
            fullWidth
            disabled={busy || selectedList.length === 0}
            onClick={() => void handleImport()}
          >
            {importing
              ? tt("common.loading")
              : tt("onboarding.import.cta", { count: selectedList.length })}
          </OnboardingButton>
        ) : null}
        <OnboardingButton variant="ghost" fullWidth disabled={importing} onClick={onSkip}>
          {instances.length > 0
            ? tt("onboarding.import.skip")
            : tt("onboarding.import.continue")}
        </OnboardingButton>
      </div>
    </OnboardingLayout>
  );
}
