import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

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
  showNotification: (kind: NotificationKind, message: string) => void;
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
            language === "ru"
              ? "Не удалось загрузить Java‑настройки. Будут использованы значения по умолчанию."
              : "Failed to load Java settings. Using defaults.",
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
      xmsError =
        language === "ru"
          ? "Некорректный формат. Примеры: 1024M, 2G."
          : "Invalid format. Examples: 1024M, 2G.";
    }
    if (xmxRaw && xmxMb == null) {
      xmxError =
        language === "ru"
          ? "Некорректный формат. Примеры: 2048M, 4G."
          : "Invalid format. Examples: 2048M, 4G.";
    }

    if (xmsMb != null && xmxMb != null) {
      if (xmsMb > xmxMb) {
        generalError =
          language === "ru"
            ? "MIN (Xms) не может быть больше MAX (Xmx)."
            : "MIN (Xms) cannot be greater than MAX (Xmx).";
      }
      if (xmxMb > maxAllowedMb) {
        generalError =
          language === "ru"
            ? `MAX (Xmx) превышает доступную память. Рекомендуется не больше ${
                Math.floor(maxAllowedMb / 1024)
              }ГБ.`
            : `MAX (Xmx) is above recommended limit. Use not more than ${Math.floor(
                maxAllowedMb / 1024,
              )}GB.`;
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
        language === "ru" ? "Java‑настройки сохранены." : "Java settings saved.",
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось сохранить Java‑настройки."
          : "Failed to save Java settings.",
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
            name: "Java",
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
        language === "ru"
          ? "Не удалось выбрать исполняемый файл Java."
          : "Failed to choose Java executable.",
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
          language === "ru"
            ? "Подходящие Java‑runtime не найдены. Лаунчер продолжит использовать встроенный runtime Mojang."
            : "No suitable Java runtimes found. Launcher will keep using Mojang runtime.",
        );
        return;
      }
      const preferred = runtimes[0];
      updateField("java_path", preferred.path);
      showNotification(
        "success",
        language === "ru"
          ? `Найдена Java: ${preferred.version}`
          : `Java detected: ${preferred.version}`,
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Произошла ошибка при поиске Java‑runtime."
          : "Error while detecting Java runtime.",
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
          language === "ru"
            ? "Проверка Java и JVM‑аргументов не выявила критичных ошибок."
            : "Java and JVM arguments validation passed.",
        );
      } else if (res.errors.length > 0) {
        showNotification(
          "error",
          language === "ru"
            ? "Обнаружены ошибки при проверке JVM‑аргументов."
            : "Errors detected while validating JVM arguments.",
        );
      } else if (res.warnings.length > 0) {
        showNotification(
          "warning",
          language === "ru"
            ? "Проверка завершена с предупреждениями."
            : "Validation finished with warnings.",
        );
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось выполнить проверку Java‑аргументов."
          : "Failed to validate Java arguments.",
      );
    }
  };

  const xmsMb = effectiveSettings.xms ? parseMemoryToMb(effectiveSettings.xms) : null;
  const xmxMb = effectiveSettings.xmx ? parseMemoryToMb(effectiveSettings.xmx) : null;

  const memoryHint =
    language === "ru"
      ? "Рекомендуется оставлять 1–2 ГБ ОЗУ системе и другим приложениям."
      : "It is recommended to leave 1–2 GB of RAM for the system and other apps.";

  return (
    <div className="flex max-h-[320px] flex-col gap-4 overflow-y-auto pr-1">
      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-white/70">
          {language === "ru" ? "Загрузка Java‑настроек..." : "Loading Java settings..."}
        </div>
      ) : (
        <>
          <div className="mb-1 text-xs text-white/60">
            {language === "ru"
              ? "Управляйте тем, какую Java и какие JVM‑аргументы будет использовать игра. При отключении пользовательских аргументов лаунчер применяет безопасные значения по умолчанию."
              : "Control which Java and JVM arguments the game will use. When custom arguments are disabled, the launcher applies safe default values."}
          </div>

          <div className="rounded-2xl border border-white/15 bg-black/35 px-4 py-3">
            <label className="flex items-center justify-between gap-3 text-sm text-white/90">
              <span>
                {language === "ru"
                  ? "Использовать пользовательские JVM‑аргументы"
                  : "Use custom JVM arguments"}
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
                  language === "ru"
                    ? "При выключении используются только стандартные аргументы лаунчера."
                    : "When off, only launcher defaults are used."
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
                    {language === "ru" ? "Путь к Java" : "Java path"}
                  </span>
                  <span className="text-[11px] text-white/50">
                    {language === "ru"
                      ? "Оставьте пустым, чтобы использовать встроенный runtime Mojang."
                      : "Leave empty to use Mojang built‑in runtime."}
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
                      language === "ru"
                        ? "Например: C:\\Program Files\\Java\\bin\\javaw.exe"
                        : "Example: C:\\Program Files\\Java\\bin\\javaw.exe"
                    }
                    className="flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:border-white/35 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleDetectJava}
                    disabled={detecting}
                    className="interactive-press shrink-0 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {language === "ru" ? "Обнаружить" : "Detect"}
                  </button>
                  <button
                    type="button"
                    onClick={handleBrowseJava}
                    className="interactive-press shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    {language === "ru" ? "Открыть" : "Browse"}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-1">
                <div className="space-y-2 rounded-2xl border border-white/15 bg-black/35 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white/90">
                    {language === "ru" ? "Память JVM" : "JVM memory"}
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
                      placeholder={language === "ru" ? "Напр. 1G" : "e.g. 1G"}
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
                      placeholder={language === "ru" ? "Напр. 4G" : "e.g. 4G"}
                      className="w-full rounded-xl border border-white/20 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none"
                    />
                    {validation.xmxError && (
                      <p className="mt-1 text-[11px] text-red-300">{validation.xmxError}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                  <span className="mr-1">
                    {language === "ru" ? "Быстрые пресеты:" : "Quick presets:"}
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
                      {language === "ru"
                        ? `Сейчас: ${formatMbToDisplay(xmsMb)} / ${formatMbToDisplay(xmxMb)}`
                        : `Current: ${formatMbToDisplay(xmsMb)} / ${formatMbToDisplay(xmxMb)}`}
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
                    JVM‑аргументы
                  </span>
                  <span className="text-[11px] text-white/60">
                    {language === "ru"
                      ? "Каждый флаг через пробел или с новой строки."
                      : "Flags separated by spaces or new lines."}
                  </span>
                </div>
                <textarea
                  value={effectiveSettings.jvm_args ?? ""}
                  onChange={(e) => updateField("jvm_args", e.target.value || null)}
                  rows={7}
                  className="w-full rounded-2xl border border-white/15 bg-black/50 px-3 py-2 text-xs font-mono text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none"
                  placeholder={
                    language === "ru"
                      ? "-XX:+UseG1GC\n-XX:MaxGCPauseMillis=50\n# Поддерживаются плейсхолдеры: ${classpath}, ${natives}, ${gameDir}, ${assetsDir}, ${version}"
                      : "-XX:+UseG1GC\n-XX:MaxGCPauseMillis=50\n# Placeholders supported: ${classpath}, ${natives}, ${gameDir}, ${assetsDir}, ${version}"
                  }
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/65">
                  <span className="text-white/80">
                    {language === "ru" ? "Плейсхолдеры:" : "Placeholders:"}
                  </span>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{classpath}"}</code>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{natives}"}</code>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{gameDir}"}</code>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{assetsDir}"}</code>
                  <code className="rounded-full bg-white/10 px-2 py-0.5">${"{version}"}</code>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/75">
                  <span className="mr-1">
                    {language === "ru" ? "Рекомендованные пресеты:" : "Recommended presets:"}
                  </span>
                  <button
                    type="button"
                    onClick={() => applyPreset("balanced")}
                    className="interactive-press rounded-full bg-white/10 px-3 py-0.5 text-[11px] font-semibold text-white hover:bg-white/20"
                  >
                    {language === "ru" ? "Баланс" : "Balanced"}
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("performance")}
                    className="interactive-press rounded-full bg-white/10 px-3 py-0.5 text-[11px] font-semibold text-white hover:bg-white/20"
                  >
                    {language === "ru" ? "Макс. производительность" : "Max performance"}
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("low_memory")}
                    className="interactive-press rounded-full bg-white/10 px-3 py-0.5 text-[11px] font-semibold text-white hover:bg-white/20"
                  >
                    {language === "ru" ? "Низкая память" : "Low memory"}
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
                    {language === "ru" ? "Сохранить" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="interactive-press rounded-xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    {language === "ru" ? "Отменить" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetToRecommended}
                    className="interactive-press rounded-xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    {language === "ru" ? "Сбросить к рекомендованным" : "Reset to recommended"}
                  </button>
                  <button
                    type="button"
                    onClick={handleValidateArgs}
                    className="interactive-press ml-auto rounded-xl bg-accentBlue px-4 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-sky-500"
                  >
                    {language === "ru" ? "Проверить" : "Validate"}
                  </button>
                </div>

                {validationOutput && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-white/15 bg-black/70 px-3 py-2 text-[11px] text-white/80">
                    {validationOutput.errors.length > 0 && (
                      <div className="mb-2">
                        <div className="mb-1 font-semibold text-red-300">
                          {language === "ru" ? "Ошибки:" : "Errors:"}
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
                          {language === "ru" ? "Предупреждения:" : "Warnings:"}
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
                          {language === "ru"
                            ? "Показать вывод java -version"
                            : "Show java -version output"}
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

