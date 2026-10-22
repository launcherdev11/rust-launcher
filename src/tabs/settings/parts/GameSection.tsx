import {
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitchRow,
} from "../../../settings-ui/SettingsComponents";
import { AssetIcon } from "../../../components/asset_icon";
import { JavaSettingsTab } from "../../JavaSettings";
import type { SettingsController } from "../useSettingsController";

type Props = { ctx: SettingsController };

export function GameSection({ ctx }: Props) {
  const {
    settingsTab,
    anyVisible,
    tt,
    showSetting,
    label,
    settings,
    chooseGameDirectory,
    updateSettings,
    resolutionWidthInput,
    setResolutionWidthInput,
    commitResolution,
    resetResolutionInputs,
    numberInputClass,
    resolutionHeightInput,
    setResolutionHeightInput,
    graphicsAdapterOptions,
    ramSliderMaxGb,
    displayRamGb,
    setRamSliderLocal,
    isRamEditing,
    ramInputRef,
    ramMinMb,
    ramMaxMb,
    ramInputMb,
    setRamInputMb,
    commitRamMb,
    cancelRamEditing,
    setIsRamEditing,
    ramSliderLocal,
    currentRamGbRounded,
    language,
    systemMemoryGb,
    showNotification,
  } = ctx;

  return (
    <>
      {settingsTab === "game" && (
        <>
          {anyVisible(
            "game.gameDirectory",
            "game.showConsole",
            "game.closeLauncher",
            "game.checkProcesses",
          ) && (
            <SettingsSection
              title={tt("settings.game.subtab.general")}
              icon={<AssetIcon name="versions" />}
            >
              {showSetting("game.gameDirectory") && (
                <SettingsRow
                  label={tt("settings.game.gameDirectory.label")}
                  hint={tt("settings.game.gameDirectory.hint")}
                  stacked
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div
                      className="glass-control flex h-9 min-w-0 flex-1 items-center px-3"
                      title={settings?.game_directory ?? undefined}
                    >
                      <span
                        className={`truncate ${
                          settings?.game_directory
                            ? "font-mono text-[0.8125rem] text-white/85"
                            : "text-sm text-white/45"
                        }`}
                      >
                        {settings?.game_directory ||
                          tt("settings.game.gameDirectory.defaultPathHint")}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void chooseGameDirectory()}
                        className="btn btn-soft"
                      >
                        <AssetIcon name="folder" />
                        {tt("settings.game.gameDirectory.choose")}
                      </button>
                      <button
                        type="button"
                        disabled={!settings?.game_directory}
                        onClick={() => updateSettings({ game_directory: null })}
                        className="btn btn-ghost"
                      >
                        {tt("settings.common.reset")}
                      </button>
                    </div>
                  </div>
                </SettingsRow>
              )}
              {showSetting("game.showConsole") && (
                <SettingsSwitchRow
                  label={tt("settings.game.showConsoleOnLaunch.label")}
                  value={settings?.show_console_on_launch ?? false}
                  onChange={(v) => updateSettings({ show_console_on_launch: v })}
                />
              )}
              {showSetting("game.closeLauncher") && (
                <SettingsSwitchRow
                  label={tt("settings.game.closeLauncherOnStart.label")}
                  value={settings?.close_launcher_on_game_start ?? false}
                  onChange={(v) => updateSettings({ close_launcher_on_game_start: v })}
                />
              )}
              {showSetting("game.checkProcesses") && (
                <SettingsSwitchRow
                  label={tt("settings.game.checkGameProcesses.label")}
                  value={settings?.check_game_processes ?? true}
                  onChange={(v) => updateSettings({ check_game_processes: v })}
                />
              )}
            </SettingsSection>
          )}

          {anyVisible("game.windowSize", "game.graphicsAdapter") && (
            <SettingsSection
              title={tt("settings.section.display")}
              icon={<AssetIcon name="display" />}
            >
              {showSetting("game.windowSize") && (
                <SettingsRow label={tt("settings.game.windowSize.label")}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={320}
                    max={7680}
                    aria-label={tt("settings.game.windowSize.widthPlaceholder")}
                    placeholder={tt("settings.game.windowSize.widthPlaceholder")}
                    value={resolutionWidthInput}
                    onChange={(e) => setResolutionWidthInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitResolution();
                      if (e.key === "Escape") resetResolutionInputs();
                    }}
                    onBlur={commitResolution}
                    className={numberInputClass}
                  />
                  <span className="text-sm text-white/40">×</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={320}
                    max={7680}
                    aria-label={tt("settings.game.windowSize.heightPlaceholder")}
                    placeholder={tt("settings.game.windowSize.heightPlaceholder")}
                    value={resolutionHeightInput}
                    onChange={(e) => setResolutionHeightInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitResolution();
                      if (e.key === "Escape") resetResolutionInputs();
                    }}
                    onBlur={commitResolution}
                    className={numberInputClass}
                  />
                </SettingsRow>
              )}
              {showSetting("game.graphicsAdapter") && (
                <SettingsRow
                  label={tt("settings.game.graphicsAdapter.label")}
                  hint={tt("settings.game.graphicsAdapter.hint")}
                  htmlFor="graphics-adapter-select"
                >
                  <SettingsSelect
                    id="graphics-adapter-select"
                    value={settings?.graphics_adapter ?? ""}
                    options={graphicsAdapterOptions}
                    onChange={(value) =>
                      updateSettings({ graphics_adapter: value || null })
                    }
                  />
                </SettingsRow>
              )}
            </SettingsSection>
          )}

          {anyVisible("game.ram", "game.java") && (
            <SettingsSection
              title={tt("settings.section.java")}
              icon={<AssetIcon name="java" />}
            >
              {showSetting("game.ram") && (
                <div className="py-3.5">
                  <SettingsSlider
                    label={label("settings.game.ram.label")}
                    min={1}
                    max={ramSliderMaxGb}
                    value={displayRamGb}
                    onChange={(value: number) =>
                      setRamSliderLocal(Math.min(ramSliderMaxGb, Math.max(1, value)))
                    }
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
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRamMb(ramInputMb);
                              if (e.key === "Escape") cancelRamEditing();
                            }}
                            onBlur={() => commitRamMb(ramInputMb)}
                            className="glass-control no-number-spin h-8 w-28 px-2.5 text-right text-sm font-semibold text-white/90 outline-none"
                          />
                          <span className="ui-meta">{tt("settings.game.ram.mbUnit")}</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsRamEditing(true)}
                          className="interactive-press glass-control h-8 px-2.5 text-sm font-semibold text-white/90 hover:text-white"
                          title={tt("settings.game.ram.editInMbHint")}
                        >
                          {tt("settings.game.ram.gbValue", {
                            gb: ramSliderLocal ?? currentRamGbRounded,
                          })}
                        </button>
                      )
                    }
                  />
                </div>
              )}
              {showSetting("game.java") && (
                <div className="py-3.5">
                  <JavaSettingsTab
                    embedded
                    language={language}
                    systemMemoryGb={systemMemoryGb}
                    showNotification={showNotification}
                  />
                </div>
              )}
            </SettingsSection>
          )}
        </>
      )}
    </>
  );
}
