import { check } from "@tauri-apps/plugin-updater";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { JavaSettingsTab } from "./JavaSettings";

type SettingsTabId = "directories" | "game" | "versions" | "launcher" | "updates";

type Language = "ru" | "en";

type Settings = {
  ram_mb: number;
  show_console_on_launch: boolean;
  close_launcher_on_game_start: boolean;
  check_game_processes: boolean;
  show_snapshots: boolean;
  show_alpha_versions: boolean;
  notify_new_update: boolean;
  notify_new_message: boolean;
  notify_system_message: boolean;
  check_updates_on_start: boolean;
  auto_install_updates: boolean;
};

type NotificationKind = "info" | "success" | "error" | "warning";

type SettingsTabProps = {
  settings: Settings | null;
  settingsTab: SettingsTabId;
  setSettingsTab: (id: SettingsTabId) => void;
  systemMemoryGb: number;
  updateSettings: (patch: Partial<Settings>) => void;
  showNotification: (kind: NotificationKind, message: string) => void;
  SettingsCard: typeof import("../settings-ui/SettingsComponents").SettingsCard;
  SettingsSlider: typeof import("../settings-ui/SettingsComponents").SettingsSlider;
  SettingsToggle: typeof import("../settings-ui/SettingsComponents").SettingsToggle;
  language: Language;
  setLanguage: (lang: Language) => void;
};

export function SettingsTab({
  settings,
  settingsTab,
  setSettingsTab,
  systemMemoryGb,
  updateSettings,
  showNotification,
  SettingsCard,
  SettingsSlider,
  SettingsToggle,
  language,
  setLanguage,
}: SettingsTabProps) {
  const [gameSubTab, setGameSubTab] = useState<"general" | "java">("general");
  const [isRamEditing, setIsRamEditing] = useState(false);
  const [ramInputMb, setRamInputMb] = useState("");
  const ramInputRef = useRef<HTMLInputElement | null>(null);

  const settingsTabRefs = useRef<
    Partial<Record<SettingsTabId, HTMLButtonElement | null>>
  >({});
  const [settingsIndicator, setSettingsIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const gameSubTabRefs = useRef<
    Partial<Record<"general" | "java", HTMLButtonElement | null>>
  >({});
  const [gameSubIndicator, setGameSubIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const languageTabRefs = useRef<
    Partial<Record<Language, HTMLButtonElement | null>>
  >({});
  const [languageIndicator, setLanguageIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const el = settingsTabRefs.current[settingsTab];
      if (el) {
        setSettingsIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [settingsTab]);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const el = gameSubTabRefs.current[gameSubTab];
      if (el) {
        setGameSubIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [gameSubTab]);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const el = languageTabRefs.current[language];
      if (el) {
        setLanguageIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [language]);

  const currentRamMb = settings?.ram_mb ?? 4096;
  const currentRamGbRounded = Math.max(1, Math.round(currentRamMb / 1024));
  const ramMinMb = 1024;
  const ramMaxMb = systemMemoryGb * 1024; // Ограничение: не больше ОЗУ системы
  const ramSliderMaxGb = systemMemoryGb; // Максимум = ОЗУ системы

  const [ramSliderLocal, setRamSliderLocal] = useState<number | null>(null);
  const displayRamGb = ramSliderLocal ?? currentRamGbRounded;

  useEffect(() => {
    if (!isRamEditing) {
      setRamInputMb(String(currentRamMb));
    }
  }, [currentRamMb, isRamEditing]);

  useEffect(() => {
    setRamSliderLocal(null); // Сброс при внешнем изменении настроек
  }, [currentRamMb]);

  useEffect(() => {
    if (isRamEditing) {
      ramInputRef.current?.focus();
      ramInputRef.current?.select();
    }
  }, [isRamEditing]);

  const commitRamMb = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setRamInputMb(String(currentRamMb));
      setIsRamEditing(false);
      return;
    }
    const rounded = Math.round(parsed);
    const clamped = Math.min(ramMaxMb, Math.max(ramMinMb, rounded));
    updateSettings({ ram_mb: clamped });
    setRamInputMb(String(clamped));
    setIsRamEditing(false);
  };

  const cancelRamEditing = () => {
    setRamInputMb(String(currentRamMb));
    setIsRamEditing(false);
  };

  const handleManualUpdateCheck = async () => {
    try {
      const update = await check();
      if (!update) {
        showNotification(
          "info",
          language === "ru"
            ? "Новых обновлений не найдено."
            : "No new updates were found.",
        );
        return;
      }
      if (settings?.auto_install_updates) {
        await update.downloadAndInstall();
        showNotification(
          "success",
          language === "ru"
            ? "Обновление установлено. Перезапустите лаунчер."
            : "Update installed. Please restart the launcher.",
        );
      } else {
        showNotification(
          "info",
          language === "ru"
            ? `Доступна новая версия лаунчера: ${update.version}. Установка будет предложена при следующем запуске.`
            : `A new launcher version is available: ${update.version}. Installation will be offered on the next start.`,
        );
      }
    } catch (e) {
      console.error("Ошибка проверки обновлений:", e);
      showNotification(
        "error",
        language === "ru"
          ? "Не удалось проверить обновления."
          : "Failed to check for updates.",
      );
    }
  };

  return (
    <div className="flex w-full max-w-3xl h-[420px] flex-col">
      <div className="flex flex-1 items-center justify-center">
        <div className="glass-panel w-full px-6 py-5">
          {settingsTab === "game" && (
            <SettingsCard title={language === "ru" ? "Игра" : "Game"}>
              <div className="mb-4 flex items-center gap-2 rounded-full bg-white/10 p-1 relative overflow-hidden">
                <div
                  className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-white/90 transition-all duration-200 ease-out"
                  style={{
                    left: `${gameSubIndicator.left}px`,
                    width: `${gameSubIndicator.width}px`,
                  }}
                />
                <button
                  type="button"
                  ref={(el) => {
                    gameSubTabRefs.current.general = el;
                  }}
                  onClick={() => setGameSubTab("general")}
                  className={`interactive-press relative z-10 flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    gameSubTab === "general" ? "text-black" : "text-white/70 hover:text-white"
                  }`}
                >
                  {language === "ru" ? "Общие" : "General"}
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    gameSubTabRefs.current.java = el;
                  }}
                  onClick={() => setGameSubTab("java")}
                  className={`interactive-press relative z-10 flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    gameSubTab === "java" ? "text-black" : "text-white/70 hover:text-white"
                  }`}
                >
                  Java
                </button>
              </div>
              {gameSubTab === "general" ? (
                <>
                  <SettingsToggle
                    label={language === "ru" ? "Консоль при запуске:" : "Show console on game start:"}
                    yesLabel={language === "ru" ? "Да" : "On"}
                    noLabel={language === "ru" ? "Нет" : "Off"}
                    value={settings?.show_console_on_launch ?? false}
                    onChange={(value: boolean) => updateSettings({ show_console_on_launch: value })}
                  />
                  <SettingsToggle
                    label={language === "ru" ? "Закрывать лаунчер при запуске игры:" : "Close launcher when game starts:"}
                    yesLabel={language === "ru" ? "Да" : "Yes"}
                    noLabel={language === "ru" ? "Нет" : "No"}
                    value={settings?.close_launcher_on_game_start ?? false}
                    onChange={(value: boolean) => updateSettings({ close_launcher_on_game_start: value })}
                  />
                  <SettingsToggle
                    label={language === "ru" ? "Проверять запущенные процессы игры:" : "Check running game processes:"}
                    yesLabel={language === "ru" ? "Да" : "Yes"}
                    noLabel={language === "ru" ? "Нет" : "No"}
                    value={settings?.check_game_processes ?? true}
                    onChange={(value: boolean) => updateSettings({ check_game_processes: value })}
                  />
                </>
              ) : (
                <>
                  <SettingsSlider
                    label={language === "ru" ? "Оперативная память:" : "Memory (RAM):"}
                    min={1}
                    max={ramSliderMaxGb}
                    value={displayRamGb}
                    onChange={(value: number) => setRamSliderLocal(Math.min(ramSliderMaxGb, Math.max(1, value)))}
                    onChangeCommitted={(value: number) => {
                      const clamped = Math.min(ramSliderMaxGb, Math.max(1, value));
                      updateSettings({ ram_mb: clamped * 1024 });
                      setRamSliderLocal(null);
                    }}
                    right={
                      isRamEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            ref={ramInputRef}
                            type="number"
                            inputMode="numeric"
                            min={ramMinMb}
                            max={ramMaxMb}
                            value={ramInputMb}
                            onChange={(e) => setRamInputMb(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitRamMb(ramInputMb); if (e.key === "Escape") cancelRamEditing(); }}
                            onBlur={() => commitRamMb(ramInputMb)}
                            className="no-number-spin h-7 w-28 rounded-lg border border-white/15 bg-black/25 px-2 text-right text-sm font-semibold text-white/90 outline-none focus:border-white/30"
                          />
                          <span className="text-xs font-semibold text-white/70">МБ</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsRamEditing(true)}
                          className="interactive-press text-sm font-semibold text-white/90 hover:text-white"
                          title={language === "ru" ? "Нажмите, чтобы ввести в МБ" : "Click to edit in MB"}
                        >
                          {currentRamGbRounded}ГБ
                        </button>
                      )
                    }
                  />
                  <JavaSettingsTab language={language} systemMemoryGb={systemMemoryGb} showNotification={showNotification} />
                </>
              )}
            </SettingsCard>
          )}

          {settingsTab === "versions" && (
            <SettingsCard title={language === "ru" ? "Версии Minecraft" : "Minecraft versions"}>
              <SettingsToggle
                label={
                  language === "ru"
                    ? "Показывать снапшоты:"
                    : "Show snapshot versions:"
                }
                yesLabel={language === "ru" ? "Да" : "Yes"}
                noLabel={language === "ru" ? "Нет" : "No"}
                value={settings?.show_snapshots ?? false}
                onChange={(value: boolean) => updateSettings({ show_snapshots: value })}
              />
              <SettingsToggle
                label={
                  language === "ru"
                    ? "Показывать Alpha версии:"
                    : "Show Alpha versions:"
                }
                yesLabel={language === "ru" ? "Да" : "Yes"}
                noLabel={language === "ru" ? "Нет" : "No"}
                value={settings?.show_alpha_versions ?? false}
                onChange={(value: boolean) => updateSettings({ show_alpha_versions: value })}
              />
            </SettingsCard>
          )}

          {settingsTab === "launcher" && (
            <SettingsCard title={language === "ru" ? "Лаунчер" : "Launcher"}>
              <SettingsToggle
                label={
                  language === "ru"
                    ? "Новое обновление:"
                    : "Notify about new launcher updates:"
                }
                yesLabel={language === "ru" ? "Да" : "Yes"}
                noLabel={language === "ru" ? "Нет" : "No"}
                value={settings?.notify_new_update ?? true}
                onChange={(value: boolean) => updateSettings({ notify_new_update: value })}
              />
              <SettingsToggle
                label={
                  language === "ru"
                    ? "Новое сообщение:"
                    : "Notify about new messages:"
                }
                yesLabel={language === "ru" ? "Да" : "Yes"}
                noLabel={language === "ru" ? "Нет" : "No"}
                value={settings?.notify_new_message ?? true}
                onChange={(value: boolean) => updateSettings({ notify_new_message: value })}
              />
              <SettingsToggle
                label={
                  language === "ru"
                    ? "Системное сообщение:"
                    : "Notify about system messages:"
                }
                yesLabel={language === "ru" ? "Да" : "Yes"}
                noLabel={language === "ru" ? "Нет" : "No"}
                value={settings?.notify_system_message ?? true}
                onChange={(value: boolean) => updateSettings({ notify_system_message: value })}
              />
              <div className="mt-4 flex items-center justify-between gap-4">
                <span className="text-sm text-white/90">
                  {language === "ru" ? "Язык интерфейса:" : "Interface language:"}
                </span>
                <div className="relative flex rounded-full bg-white/10 p-0.5 overflow-hidden">
                  <div
                    className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-full bg-white/90 transition-all duration-200 ease-out"
                    style={{
                      left: `${languageIndicator.left}px`,
                      width: `${languageIndicator.width}px`,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setLanguage("ru")}
                    ref={(el) => {
                      languageTabRefs.current.ru = el;
                    }}
                    className={`interactive-press relative z-10 min-w-[80px] rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                      language === "ru" ? "text-black" : "text-white/70 hover:text-white"
                    }`}
                  >
                    Русский
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage("en")}
                    ref={(el) => {
                      languageTabRefs.current.en = el;
                    }}
                    className={`interactive-press relative z-10 min-w-[80px] rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                      language === "en" ? "text-black" : "text-white/70 hover:text-white"
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>
            </SettingsCard>
          )}

          {settingsTab === "updates" && (
            <SettingsCard
              title={language === "ru" ? "Обновления лаунчера" : "Launcher updates"}
            >
              <SettingsToggle
                label={
                  language === "ru"
                    ? "Проверять обновления при запуске:"
                    : "Check for updates on start:"
                }
                yesLabel={language === "ru" ? "Да" : "Yes"}
                noLabel={language === "ru" ? "Нет" : "No"}
                value={settings?.check_updates_on_start ?? true}
                onChange={(value: boolean) => updateSettings({ check_updates_on_start: value })}
              />
              <SettingsToggle
                label={
                  language === "ru"
                    ? "Автоматически устанавливать обновления:"
                    : "Automatically install updates:"
                }
                yesLabel={language === "ru" ? "Да" : "Yes"}
                noLabel={language === "ru" ? "Нет" : "No"}
                value={settings?.auto_install_updates ?? false}
                onChange={(value: boolean) =>
                  updateSettings({ auto_install_updates: value })
                }
              />
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleManualUpdateCheck}
                  className="interactive-press mt-1 inline-flex w-full items-center justify-center rounded-2xl bg-accentBlue px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-sky-500"
                >
                  {language === "ru" ? "Проверить обновления" : "Check for updates"}
                </button>
              </div>
            </SettingsCard>
          )}

          {settingsTab === "directories" && (
            <SettingsCard title={language === "ru" ? "Директории" : "Directories"}>
              <p className="text-sm text-white/70">
                {language === "ru"
                  ? "Настройки директорий будут добавлены позже."
                  : "Directory settings will be added later."}
              </p>
            </SettingsCard>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center">
        <div className="relative flex items-center gap-0 rounded-full border border-white/12 bg-black/50 p-1 shadow-soft backdrop-blur-xl overflow-hidden">
          <div
            className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-white/90 transition-all duration-200 ease-out"
            style={{
              left: `${settingsIndicator.left}px`,
              width: `${settingsIndicator.width}px`,
            }}
          />
          {(
            [
              {
                id: "directories",
                label: language === "ru" ? "Директории" : "Directories",
              },
              { id: "game", label: language === "ru" ? "Игра" : "Game" },
              {
                id: "versions",
                label: language === "ru" ? "Версии" : "Versions",
              },
              {
                id: "launcher",
                label: language === "ru" ? "Лаунчер" : "Launcher",
              },
              {
                id: "updates",
                label: language === "ru" ? "Обновления" : "Updates",
              },
            ] as { id: SettingsTabId; label: string }[]
          ).map((tab) => {
            const active = settingsTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                ref={(el) => {
                  settingsTabRefs.current[tab.id] = el;
                }}
                onClick={() => setSettingsTab(tab.id)}
                className={`interactive-press relative z-10 rounded-full px-4 py-1.5 text-xs font-semibold text-center transition-colors ${
                  active
                    ? "text-black"
                    : "text-white/70 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}