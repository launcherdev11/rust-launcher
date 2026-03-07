import { check } from "@tauri-apps/plugin-updater";
import { useEffect, useRef, useState } from "react";

type SettingsTabId = "directories" | "game" | "versions" | "notifications" | "updates";

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
}: SettingsTabProps) {
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

  const currentRamMb = settings?.ram_mb ?? 4096;
  const currentRamGbRounded = Math.max(1, Math.round(currentRamMb / 1024));
  const ramMinMb = 1024;
  const ramMaxMb = 64 * 1024;
  const ramSliderMaxGb = Math.max(64, systemMemoryGb);

  useEffect(() => {
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

  useEffect(() => {
    if (!isRamEditing) {
      setRamInputMb(String(currentRamMb));
    }
  }, [currentRamMb, isRamEditing]);

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
        showNotification("info", "Новых обновлений не найдено.");
        return;
      }
      if (settings?.auto_install_updates) {
        await update.downloadAndInstall();
        showNotification("success", "Обновление установлено. Перезапустите лаунчер.");
      } else {
        showNotification(
          "info",
          `Доступна новая версия лаунчера: ${update.version}. Установка будет предложена при следующем запуске.`,
        );
      }
    } catch (e) {
      console.error("Ошибка проверки обновлений:", e);
      showNotification("error", "Не удалось проверить обновления.");
    }
  };

  return (
    <div className="flex w-full max-w-3xl h-[420px] flex-col">
      <div className="flex flex-1 items-center justify-center">
        <div className="glass-panel w-full px-6 py-5">
          {settingsTab === "game" && (
            <SettingsCard title="Игра">
              <SettingsSlider
                label="Оперативная память:"
                min={1}
                max={ramSliderMaxGb}
                value={currentRamGbRounded}
                onChange={(value: number) =>
                  updateSettings({ ram_mb: Math.max(1, value) * 1024 })
                }
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
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRamMb(ramInputMb);
                          if (e.key === "Escape") cancelRamEditing();
                        }}
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
                      title="Нажмите, чтобы ввести в МБ"
                    >
                      {currentRamGbRounded}ГБ
                    </button>
                  )
                }
              />
              <SettingsToggle
                label="Консоль при запуске:"
                value={settings?.show_console_on_launch ?? false}
                onChange={(value: boolean) => updateSettings({ show_console_on_launch: value })}
              />
              <SettingsToggle
                label="Закрывать лаунчер при запуске игры:"
                value={settings?.close_launcher_on_game_start ?? false}
                onChange={(value: boolean) =>
                  updateSettings({ close_launcher_on_game_start: value })
                }
              />
              <SettingsToggle
                label="Проверять запущенные процессы игры:"
                value={settings?.check_game_processes ?? true}
                onChange={(value: boolean) =>
                  updateSettings({ check_game_processes: value })
                }
              />
            </SettingsCard>
          )}

          {settingsTab === "versions" && (
            <SettingsCard title="Версии Minecraft">
              <SettingsToggle
                label="Показывать снапшоты:"
                value={settings?.show_snapshots ?? false}
                onChange={(value: boolean) => updateSettings({ show_snapshots: value })}
              />
              <SettingsToggle
                label="Показывать Alpha версии:"
                value={settings?.show_alpha_versions ?? false}
                onChange={(value: boolean) => updateSettings({ show_alpha_versions: value })}
              />
            </SettingsCard>
          )}

          {settingsTab === "notifications" && (
            <SettingsCard title="Уведомления">
              <SettingsToggle
                label="Новое обновление:"
                value={settings?.notify_new_update ?? true}
                onChange={(value: boolean) => updateSettings({ notify_new_update: value })}
              />
              <SettingsToggle
                label="Новое сообщение:"
                value={settings?.notify_new_message ?? true}
                onChange={(value: boolean) => updateSettings({ notify_new_message: value })}
              />
              <SettingsToggle
                label="Системное сообщение:"
                value={settings?.notify_system_message ?? true}
                onChange={(value: boolean) => updateSettings({ notify_system_message: value })}
              />
            </SettingsCard>
          )}

          {settingsTab === "updates" && (
            <SettingsCard title="Обновления лаунчера">
              <SettingsToggle
                label="Проверять обновления при запуске:"
                value={settings?.check_updates_on_start ?? true}
                onChange={(value: boolean) => updateSettings({ check_updates_on_start: value })}
              />
              <SettingsToggle
                label="Автоматически устанавливать обновления:"
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
                  Проверить обновления
                </button>
              </div>
            </SettingsCard>
          )}

          {settingsTab === "directories" && (
            <SettingsCard title="Директории">
              <p className="text-sm text-white/70">
                Настройки директорий будут добавлены позже.
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
              { id: "directories", label: "Директории" },
              { id: "game", label: "Игра" },
              { id: "versions", label: "Версии" },
              { id: "notifications", label: "Уведомления" },
              { id: "updates", label: "Обновления" },
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

