import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useT } from "../i18n";

type Language = "ru" | "en";
type NotificationKind = "info" | "success" | "error" | "warning";

type JavaSettings = {
  use_custom_jvm_args: boolean;
  java_path: string | null;
  xms: string | null;
  xmx: string | null;
  jvm_args: string | null;
  preset: string | null;
};

type JavaRuntimeInfo = {
  path: string;
  version: string;
  source: string;
};

type JavaSettingsProps = {
  language: Language;
  systemMemoryGb: number;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean }) => void;
  profileId?: string | null;
};

type ValidationState = {
  xmsError: string | null;
  xmxError: string | null;
  generalError: string | null;
};

function parseMemoryToMb(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const match = s.match(/^(\d+)\s*([GgMm])?[Bb]?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const suffix = (match[2] ?? "M").toUpperCase();
  if (suffix === "G") return value * 1024;
  return value;
}

function formatMbToDisplay(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return "";
  if (mb % 1024 === 0) return `${mb / 1024}G`;
  return `${mb}M`;
}

export function JavaSettingsTab({
  language,
  systemMemoryGb,
  showNotification,
  profileId,
}: JavaSettingsProps) {
  const tt = useT(language);
  const [settings, setSettings] = useState<JavaSettings | null>(null);
  const [initialSettings, setInitialSettings] = useState<JavaSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [validation, setValidation] = useState<ValidationState>({
    xmsError: null,
    xmxError: null,
    generalError: null,
  });
  const [validationOutput, setValidationOutput] = useState<{
    ok: boolean;
    warnings: string[];
    errors: string[];
    output: string;
  } | null>(null);

  const effectiveSettings: JavaSettings = useMemo(
    () => settings ?? {
      use_custom_jvm_args: false,
      java_path: null,
      xms: null,
      xmx: null,
      jvm_args: null,
      preset: "balanced",
    },
    [settings],
  );

  const maxAllowedMb = Math.max(1024, (systemMemoryGb - 2) * 1024);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = profileId
          ? await invoke<JavaSettings>("get_profile_java_settings", { id: profileId })
          : await invoke<JavaSettings>("get_java_settings");
        if (cancelled) return;
        setSettings(data);
        setInitialSettings(data);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          showNotification(
            "error",
            tt("javaSettings.toast.loadFailedUsingDefaults"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language, showNotification]);

  const updateField = <K extends keyof JavaSettings>(key: K, value: JavaSettings[K]) => {
    setSettings((prev) => ({
      ...(prev ?? {
        use_custom_jvm_args: false,
        java_path: null,
        xms: null,
        xmx: null,
        jvm_args: null,
        preset: "balanced",
      }),
      [key]: value,
    }));
  };

  const applyPreset = (preset: "balanced" | "performance" | "low_memory") => {
    let xms: string;
    let xmx: string;
    let jvm: string;

    if (preset === "balanced") {
      xms = "2G";
      xmx = "4G";
      jvm = "-XX:+UseG1GC -XX:MaxGCPauseMillis=50";
    } else if (preset === "performance") {
      xms = "4G";
      xmx = "8G";
      jvm = "-XX:+UseG1GC -XX:MaxGCPauseMillis=40 -XX:+UnlockExperimentalVMOptions";
    } else {
      xms = "1G";
      xmx = "2G";
      jvm = "-XX:+UseG1GC";
    }

    updateField("xms", xms);
    updateField("xmx", xmx);
    updateField("jvm_args", jvm);
    updateField("preset", preset);
  };

  const validateMemory = (): boolean => {
    let xmsError: string | null = null;
    let xmxError: string | null = null;
    let generalError: string | null = null;

    const xmsRaw = effectiveSettings.xms ?? "";
    const xmxRaw = effectiveSettings.xmx ?? "";
    const xmsMb = xmsRaw ? parseMemoryToMb(xmsRaw) : null;
    const xmxMb = xmxRaw ? parseMemoryToMb(xmxRaw) : null;

    if (xmsRaw && xmsMb == null) {
      xmsError = tt("javaSettings.validation.invalidFormatXms");
    }
    if (xmxRaw && xmxMb == null) {
      xmxError = tt("javaSettings.validation.invalidFormatXmx");
    }

    if (xmsMb != null && xmxMb != null) {
      if (xmsMb > xmxMb) {
        generalError = tt("javaSettings.validation.minGreaterThanMax");
      }
      if (xmxMb > maxAllowedMb) {
        generalError = tt("javaSettings.validation.maxAboveRecommended", {
          gb: Math.floor(maxAllowedMb / 1024),
        });
      }
    }

    setValidation({ xmsError, xmxError, generalError });
    return !xmsError && !xmxError && !generalError;
  };

  const handleSave = async () => {
    if (!validateMemory()) return;
    if (!settings) return;
    setSaving(true);
    try {
      if (profileId) {
        await invoke("set_profile_java_settings", { id: profileId, settings });
      } else {
        await invoke("set_java_settings", { settings });
      }
      setInitialSettings(settings);
      showNotification(
        "success",
        tt("javaSettings.toast.saved"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("javaSettings.toast.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleResetToRecommended = () => {
    const next: JavaSettings = {
      use_custom_jvm_args: false,
      java_path: null,
      xms: null,
      xmx: null,
      jvm_args: null,
      preset: "balanced",
    };
    setSettings(next);
    setValidation({ xmsError: null, xmxError: null, generalError: null });
    setValidationOutput(null);
  };

  const handleCancel = () => {
    setSettings(initialSettings);
    setValidation({ xmsError: null, xmxError: null, generalError: null });
    setValidationOutput(null);
  };

  const handleBrowseJava = async () => {
    try {
      const path = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: tt("javaSettings.dialog.javaFilterName"),
            extensions: ["exe", "bat", "cmd", "sh", "bin", "jar"],
          },
        ],
      });
      if (typeof path === "string" && path.trim()) {
        updateField("java_path", path);
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("javaSettings.toast.chooseJavaFailed"),
      );
    }
  };

  const handleDetectJava = async () => {
    setDetecting(true);
    try {
      const runtimes = await invoke<JavaRuntimeInfo[]>("detect_java_runtimes");
      if (!runtimes || runtimes.length === 0) {
        showNotification(
          "warning",
          tt("javaSettings.toast.noSuitableRuntimes"),
        );
        return;
      }
      const preferred = runtimes[0];
      updateField("java_path", preferred.path);
      showNotification(
        "success",
        tt("javaSettings.toast.detected", { version: preferred.version }),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("javaSettings.toast.detectFailed"),
      );
    } finally {
      setDetecting(false);
    }
  };

  const handleValidateArgs = async () => {
    if (!settings) return;
    try {
      const javaPath = settings.java_path ?? null;
      const args = settings.jvm_args ?? "";
      const res = await invoke<{
        ok: boolean;
        warnings: string[];
        errors: string[];
        output: string;
      }>("validate_java_args", {
        java_path: javaPath,
        args,
      });
      setValidationOutput(res);
      if (res.ok && res.errors.length === 0) {
        showNotification(
          "success",
          tt("javaSettings.toast.validateOk"),
        );
      } else if (res.errors.length > 0) {
        showNotification(
          "error",
          tt("javaSettings.toast.validateErrors"),
        );
      } else if (res.warnings.length > 0) {
        showNotification(
          "warning",
          tt("javaSettings.toast.validateWarnings"),
        );
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("javaSettings.toast.validateFailed"),
      );
    }
  };

  const xmsMb = effectiveSettings.xms ? parseMemoryToMb(effectiveSettings.xms) : null;
  const xmxMb = effectiveSettings.xmx ? parseMemoryToMb(effectiveSettings.xmx) : null;

  const memoryHint = tt("javaSettings.memory.hint");

  return (
    <div className="flex max-h-[clamp(240px,45vh,520px)] flex-col gap-4 overflow-y-auto pr-1">
      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-white/70">
          {tt("javaSettings.loading")}
        </div>
      ) : (
        <>
          <div className="mb-1 text-xs text-white/60">
            {tt("javaSettings.description")}
          </div>

          <div className="rounded-2xl border border-white/15 bg-black/35 px-4 py-3">
            <label className="flex items-center justify-between gap-3 text-sm text-white/90">
              <span>
                {tt("javaSettings.useCustomArgs.label")}
              </span>
              <button
                type="button"
                onClick={() =>
                  updateField("use_custom_jvm_args", !effectiveSettings.use_custom_jvm_args)
                }
                className={`interactive-press relative inline-flex h-6 w-11 items-center rounded-full border px-0.5 transition ${
                  effectiveSettings.use_custom_jvm_args
                    ? "border-emerald-400 bg-emerald-500/60"
                    : "border-white/25 bg-white/10"
                }`}
                title={
                  tt("javaSettings.useCustomArgs.hint")
                }
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    effectiveSettings.use_custom_jvm_args ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </label>
          </div>

          {effectiveSettings.use_custom_jvm_args && (
            <>
              <div className="mt-4 space-y-2 rounded-2xl border border-white/15 bg-black/35 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white/90">
                    {tt("javaSettings.javaPath.label")}
                  </span>
                  <span className="text-[11px] text-white/50">
                    {tt("javaSettings.javaPath.hint")}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-nowrap">
                  <input
                    type="text"
                    value={effectiveSettings.java_path ?? ""}
                    onChange={(e) =>
                      updateField(
                        "java_path",
                        e.target.value.trim().length === 0 ? null : e.target.value,
                      )
                    }
                    placeholder={
                      tt("javaSettings.javaPath.placeholder")
                    }
                    className="flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:border-white/35 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleDetectJava}
                    disabled={detecting}
                    className="interactive-press shrink-0 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {tt("javaSettings.actions.detect")}
                  </button>
                  <button
                    type="button"
                    onClick={handleBrowseJava}
                    className="interactive-press shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    {tt("javaSettings.actions.browse")}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-1">
                <div className="space-y-2 rounded-2xl border border-white/15 bg-black/35 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white/90">
                    {tt("javaSettings.memory.title")}
                  </span>
                  <span className="text-[11px] text-white/60">{memoryHint}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-white/60">
                      MIN (Xms)
                    </label>
                    <input
                      type="text"
                      value={effectiveSettings.xms ?? ""}
                      onChange={(e) => updateField("xms", e.target.value || null)}
                      placeholder={tt("javaSettings.memory.xmsPlaceholder")}
                      className="w-full rounded-xl border border-white/20 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none"
                    />
                    {validation.xmsError && (
                      <p className="mt-1 text-[11px] text-red-300">{validation.xmsError}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-white/60">
                      MAX (Xmx)
                    </label>
                    <input
                      type="text"
                      value={effectiveSettings.xmx ?? ""}
                      onChange={(e) => updateField("xmx", e.target.value || null)}
                      placeholder={tt("javaSettings.memory.xmxPlaceholder")}
                      className="w-full rounded-xl border border-white/20 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none"
                    />
                    {validation.xmxError && (
                      <p className="mt-1 text-[11px] text-red-300">{validation.xmxError}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                  <span className="mr-1">
                    {tt("javaSettings.memory.quickPresets")}
                  </span>
                  {["1G", "2G", "4G", "8G"].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className="interactive-press rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-white/20"
                      onClick={() => {
                        updateField("xms", v);
                        updateField("xmx", v);
                      }}
                    >
                      {v}
                    </button>
                  ))}
                  {xmsMb != null && xmxMb != null && (
                    <span className="ml-auto text-[11px] text-white/60">
                      {tt("javaSettings.memory.currentPair", {
                        xms: formatMbToDisplay(xmsMb),
                        xmx: formatMbToDisplay(xmxMb),
                      })}
                    </span>
                  )}
                </div>
                {validation.generalError && (
                  <p className="mt-1 text-[11px] text-amber-300">{validation.generalError}</p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/15 bg-black/35 px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white/90">
                    {tt("javaSettings.jvmArgs.title")}
                  </span>
                  <span className="text-[11px] text-white/60">
                    {tt("javaSettings.jvmArgs.hint")}
                  </span>
                </div>
                <textarea
                  value={effectiveSettings.jvm_args ?? ""}
                  onChange={(e) => updateField("jvm_args", e.target.value || null)}
                  rows={7}
                  className="w-full rounded-2xl border border-white/15 bg-black/50 px-3 py-2 text-xs font-mono text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none"
                  placeholder={
                    tt("javaSettings.jvmArgs.placeholder")
                  }
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/65">
                  <span className="text-white/80">
                    {tt("javaSettings.jvmArgs.placeholdersLabel")}
                  </span>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{classpath}"}</code>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{natives}"}</code>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{gameDir}"}</code>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{assetsDir}"}</code>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{version}"}</code>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/75">
                  <span className="mr-1">
                    {tt("javaSettings.jvmArgs.recommendedPresets")}
                  </span>
                  <button
                    type="button"
                    onClick={() => applyPreset("balanced")}
                    className="interactive-press rounded-full bg-white/10 px-3 py-0.5 text-[11px] font-semibold text-white hover:bg-white/20"
                  >
                    {tt("javaSettings.presets.balanced")}
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("performance")}
                    className="interactive-press rounded-full bg-white/10 px-3 py-0.5 text-[11px] font-semibold text-white hover:bg-white/20"
                  >
                    {tt("javaSettings.presets.performance")}
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("low_memory")}
                    className="interactive-press rounded-full bg-white/10 px-3 py-0.5 text-[11px] font-semibold text-white hover:bg-white/20"
                  >
                    {tt("javaSettings.presets.lowMemory")}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/15 bg-black/40 px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="interactive-press rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {tt("javaSettings.actions.save")}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="interactive-press rounded-xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    {tt("javaSettings.actions.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetToRecommended}
                    className="interactive-press rounded-xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    {tt("javaSettings.actions.resetRecommended")}
                  </button>
                  <button
                    type="button"
                    onClick={handleValidateArgs}
                    className="interactive-press ml-auto rounded-xl accent-bg px-4 py-1.5 text-xs font-semibold text-white shadow-soft hover:opacity-90"
                  >
                    {tt("javaSettings.actions.validate")}
                  </button>
                </div>

                {validationOutput && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-white/15 bg-black/70 px-3 py-2 text-[11px] text-white/80">
                    {validationOutput.errors.length > 0 && (
                      <div className="mb-2">
                        <div className="mb-1 font-semibold text-red-300">
                          {tt("javaSettings.validationOutput.errors")}
                        </div>
                        <ul className="list-disc space-y-0.5 pl-4">
                          {validationOutput.errors.map((e, i) => (
                            <li key={`e-${i}`}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {validationOutput.warnings.length > 0 && (
                      <div className="mb-2">
                        <div className="mb-1 font-semibold text-amber-300">
                          {tt("javaSettings.validationOutput.warnings")}
                        </div>
                        <ul className="list-disc space-y-0.5 pl-4">
                          {validationOutput.warnings.map((w, i) => (
                            <li key={`w-${i}`}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {validationOutput.output && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-white/60">
                          {tt("javaSettings.validationOutput.showJavaVersion")}
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap text-[11px] text-white/70">
                          {validationOutput.output}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

