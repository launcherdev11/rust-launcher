import { check } from "@tauri-apps/plugin-updater";

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
                max={systemMemoryGb}
                value={Math.round((settings?.ram_mb ?? 4096) / 1024)}
                onChange={(value: number) =>
                  updateSettings({ ram_mb: Math.max(1, value) * 1024 })
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

      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setSettingsTab("directories")}
          className={`interactive-press rounded-full px-4 py-1.5 text-xs font-semibold ${
            settingsTab === "directories"
              ? "bg-white/80 text-black"
              : "bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          Директории
        </button>
        <button
          type="button"
          onClick={() => setSettingsTab("game")}
          className={`interactive-press rounded-full px-4 py-1.5 text-xs font-semibold ${
            settingsTab === "game"
              ? "bg-white/80 text-black"
              : "bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          Игра
        </button>
        <button
          type="button"
          onClick={() => setSettingsTab("versions")}
          className={`interactive-press rounded-full px-4 py-1.5 text-xs font-semibold ${
            settingsTab === "versions"
              ? "bg-white/80 text-black"
              : "bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          Версии
        </button>
        <button
          type="button"
          onClick={() => setSettingsTab("notifications")}
          className={`interactive-press rounded-full px-4 py-1.5 text-xs font-semibold ${
            settingsTab === "notifications"
              ? "bg-white/80 text-black"
              : "bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          Уведомления
        </button>
        <button
          type="button"
          onClick={() => setSettingsTab("updates")}
          className={`interactive-press rounded-full px-4 py-1.5 text-xs font-semibold ${
            settingsTab === "updates"
              ? "bg-white/80 text-black"
              : "bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          Обновления
        </button>
      </div>
    </div>
  );
}

