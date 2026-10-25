import {
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsSelect,
  SettingsSwitchRow,
} from "../../../settings-ui/SettingsComponents";
import { AssetIcon } from "../../../components/asset_icon";
import { SUPPORTED_LANGUAGES } from "../../../i18n";
import { parseSidebarPosition, SIDEBAR_POSITIONS } from "../../../app/sidebar";
import {
  ACCENT_HUE_RING_STYLE,
  ACCENT_PRESETS,
  hexToRgb,
  hsvToRgb,
  rgbToHex,
  rgbToHsv,
} from "../accentColor";
import { InputClearButton } from "../../../components/ui";
import { ThemeCard } from "../../../features/theme-editor/ThemeCard";
import { ThemeEditorPanel } from "../../../features/theme-editor/ThemeEditorPanel";
import type { SettingsController } from "../useSettingsController";

type Props = { ctx: SettingsController };

export function LauncherSection({ ctx }: Props) {
  const {
    settingsTab,
    onCheckUpdate,
    showSetting,
    tt,
    label,
    updateStatusText,
    updateStatus,
    updateDownloadPercent,
    onInstallUpdate,
    onPreviewUpdatePopup,
    settings,
    updateSettings,
    anyVisible,
    language,
    setLanguage,
    sidebarOrder,
    sidebarItemLabel,
    moveSidebarItem,
    seasonalThemeActive,
    accentPickerRef,
    isAccentPickerOpen,
    setIsAccentPickerOpen,
    accentColor,
    applyAccentColor,
    accentHueWheelRef,
    accentColorHsv,
    handleAccentWheelPointerDown,
    handleAccentWheelPointerMove,
    handleAccentWheelPointerEnd,
    accentInput,
    setAccentInput,
    accentSvPadRef,
    handleAccentSvPointerDown,
    handleAccentSvPointerMove,
    handleAccentSvPointerEnd,
    chooseBackgroundImage,
    resetBackgroundImage,
    themesLoading,
    refreshThemes,
    activeThemeId,
    editingThemeId,
    installedThemes,
    createTheme,
    importThemeZip,
    openThemesFolder,
    activeTheme,
    setEditingThemeId,
    openActiveThemeCss,
    duplicateActiveTheme,
    exportActiveTheme,
    deleteActiveTheme,
    showNotification,
    isCacheLoading,
    formatCacheSize,
    cacheSizeBytes,
    handleClearCache,
    handleExportSettings,
    isExportingSettings,
    handleImportSettings,
    isImportingSettings,
    handleResetSettings,
    isResettingSettings,
  } = ctx;

  return (
    <>
      {settingsTab === "launcher" && (
        <>
          {onCheckUpdate && showSetting("launcher.updates") && (
            <SettingsSection
              title={tt("settings.card.updates")}
              icon={<AssetIcon name="updates" />}
            >
              <SettingsRow
                label={
                  <>
                    <span>{updateStatusText}</span>
                    {updateStatus === "downloading" && updateDownloadPercent != null && (
                      <span className="mt-2 block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                        <span
                          className="progress-fill block h-full rounded-full transition-[width]"
                          style={{
                            width: `${Math.min(100, Math.max(0, updateDownloadPercent))}%`,
                          }}
                        />
                      </span>
                    )}
                  </>
                }
              >
                {updateStatus === "available" && onInstallUpdate && (
                  <button
                    type="button"
                    onClick={() => void onInstallUpdate()}
                    className="btn btn-sm btn-accent"
                  >
                    <AssetIcon name="download" className="h-3.5 w-3.5" />
                    {tt("settings.updates.installNow")}
                  </button>
                )}
                {updateStatus !== "downloading" && updateStatus !== "installing" && (
                  <button
                    type="button"
                    disabled={updateStatus === "checking"}
                    title={
                      onPreviewUpdatePopup ? tt("settings.updates.checkNowHint") : undefined
                    }
                    onClick={(e) => {
                      if (e.shiftKey && onPreviewUpdatePopup) {
                        void onPreviewUpdatePopup();
                        return;
                      }
                      void onCheckUpdate?.();
                    }}
                    className="btn btn-sm btn-soft"
                  >
                    <AssetIcon
                      name="updates"
                      className={`h-3.5 w-3.5 ${updateStatus === "checking" ? "animate-spin" : ""}`}
                      />
                    {tt("settings.updates.checkNow")}
                  </button>
                )}
              </SettingsRow>
              <SettingsSwitchRow
                label={tt("settings.updates.checkOnStart.label")}
                value={settings?.check_updates_on_start ?? true}
                onChange={(v) => updateSettings({ check_updates_on_start: v })}
              />
              <SettingsSwitchRow
                label={tt("settings.updates.autoInstall.label")}
                value={settings?.auto_install_updates ?? false}
                onChange={(v) => updateSettings({ auto_install_updates: v })}
              />
            </SettingsSection>
          )}

          {anyVisible(
            "launcher.openOnProfiles",
            "launcher.uiSounds",
            "launcher.discordRpc",
            "launcher.minimizeToTray",
            "launcher.autostart",
            "launcher.splitView",
          ) && (
            <SettingsSection
              title={tt("settings.section.behavior")}
              icon={<AssetIcon name="options" />}
            >
              {showSetting("launcher.openOnProfiles") && (
                <SettingsRow label={tt("settings.launcher.openOnProfilesTab.label")}>
                  <SettingsSegmented
                    ariaLabel={label("settings.launcher.openOnProfilesTab.label")}
                    value={settings?.open_launcher_on_profiles_tab ? "profiles" : "home"}
                    options={[
                      { value: "home", label: tt("settings.launcher.openOnProfilesTab.no") },
                      {
                        value: "profiles",
                        label: tt("settings.launcher.openOnProfilesTab.yes"),
                      },
                    ]}
                    onChange={(value) =>
                      updateSettings({
                        open_launcher_on_profiles_tab: value === "profiles",
                      })
                    }
                  />
                </SettingsRow>
              )}
              {showSetting("launcher.uiSounds") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.uiSounds.label")}
                  value={settings?.ui_sounds_enabled ?? true}
                  onChange={(v) => updateSettings({ ui_sounds_enabled: v })}
                />
              )}
              {showSetting("launcher.discordRpc") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.discordRpc.label")}
                  hint={tt("settings.launcher.discordRpc.hint")}
                  value={settings?.discord_rpc_enabled ?? true}
                  onChange={(v) => updateSettings({ discord_rpc_enabled: v })}
                />
              )}
              {showSetting("launcher.minimizeToTray") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.minimizeToTray.label")}
                  value={settings?.minimize_to_tray_on_close ?? false}
                  onChange={(v) => updateSettings({ minimize_to_tray_on_close: v })}
                />
              )}
              {showSetting("launcher.autostart") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.autostart.label")}
                  value={settings?.autostart_enabled ?? false}
                  onChange={(v) => updateSettings({ autostart_enabled: v })}
                />
              )}
              {showSetting("launcher.splitView") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.splitView.label")}
                  hint={tt("settings.launcher.splitView.hint")}
                  value={settings?.split_view_enabled ?? false}
                  onChange={(v) => updateSettings({ split_view_enabled: v })}
                />
              )}
            </SettingsSection>
          )}

          {anyVisible(
            "launcher.language",
            "launcher.sidebarPosition",
            "launcher.sidebarOrder",
          ) && (
            <SettingsSection
              title={tt("settings.section.interface")}
              icon={<AssetIcon name="grid" />}
            >
              {showSetting("launcher.language") && (
                <SettingsRow label={tt("settings.launcher.interfaceLanguage.label")}>
                  <SettingsSegmented
                    ariaLabel={label("settings.launcher.interfaceLanguage.label")}
                    value={language}
                    options={SUPPORTED_LANGUAGES.map((code) => ({
                      value: code,
                      label: tt(`settings.launcher.interfaceLanguage.${code}`),
                    }))}
                    onChange={(code) => setLanguage(code)}
                  />
                </SettingsRow>
              )}
              {showSetting("launcher.sidebarPosition") && (
                <SettingsRow
                  label={tt("settings.launcher.sidebarPosition.label")}
                  htmlFor="sidebar-position-select"
                >
                  <SettingsSelect
                    id="sidebar-position-select"
                    className="w-full sm:w-48"
                    value={parseSidebarPosition(settings?.sidebar_position)}
                    options={SIDEBAR_POSITIONS.map((pos) => ({
                      value: pos,
                      label: tt(`settings.launcher.sidebarPosition.${pos}`),
                    }))}
                    onChange={(pos) => updateSettings({ sidebar_position: pos })}
                  />
                </SettingsRow>
              )}
              {showSetting("launcher.sidebarOrder") && (
                <SettingsRow label={tt("settings.launcher.sidebarOrder.label")} stacked>
                  <div className="glass-inset flex flex-col gap-0.5 p-1 sm:max-w-sm">
                    {sidebarOrder.map((id, index) => (
                      <div
                        key={id}
                        className="flex items-center justify-between gap-3 rounded-xl py-1 pl-3 pr-1 text-sm text-white/85 hover:bg-white/[0.035]"
                      >
                        <span className="flex items-center gap-2.5">
                          <span className="ui-caption w-3 text-right">{index + 1}</span>
                          {sidebarItemLabel(id)}
                        </span>
                        <span className="flex items-center">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveSidebarItem(id, "up")}
                            className="icon-btn disabled:opacity-30"
                            aria-label={tt("settings.launcher.sidebarOrder.moveUp")}
                            title={tt("settings.launcher.sidebarOrder.moveUp")}
                          >
                            <AssetIcon name="arrow_down" className="h-4 w-4 rotate-180" />
                          </button>
                          <button
                            type="button"
                            disabled={index === sidebarOrder.length - 1}
                            onClick={() => moveSidebarItem(id, "down")}
                            className="icon-btn disabled:opacity-30"
                            aria-label={tt("settings.launcher.sidebarOrder.moveDown")}
                            title={tt("settings.launcher.sidebarOrder.moveDown")}
                          >
                            <AssetIcon name="arrow_down" />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </SettingsRow>
              )}
            </SettingsSection>
          )}

          {(anyVisible(
            "launcher.accentColor",
            "launcher.backgroundImage",
            "launcher.adaptiveAccent",
            "launcher.backgroundBlur",
            "launcher.backgroundAnimation",
            "launcher.disableAnimations",
          ) ||
            (seasonalThemeActive &&
              showSetting("launcher.disableThematicDecorations"))) && (
            <SettingsSection
              title={tt("settings.section.appearance")}
              icon={<AssetIcon name="palette" />}
            >
              {showSetting("launcher.accentColor") && (
                <SettingsRow label={tt("settings.launcher.accentColor.label")}>
                  <div ref={accentPickerRef} className="relative">
                    <button
                      type="button"
                      aria-expanded={isAccentPickerOpen}
                      onClick={() => setIsAccentPickerOpen((v) => !v)}
                      className="interactive-press glass-control flex h-9 items-center gap-2.5 pl-1.5 pr-3"
                    >
                      <span
                        className="h-6 w-6 rounded-md ring-1 ring-inset ring-white/15"
                        style={{ background: accentColor }}
                      />
                      <span className="font-mono text-[0.8125rem] text-white/80">
                        {accentColor}
                      </span>
                    </button>
                    {isAccentPickerOpen && (
                      <div className="glass-popover absolute right-0 top-full z-40 mt-2 w-80 p-3 text-xs text-white">
                        <div className="mb-3 text-[0.8125rem] font-semibold text-white/80">
                          {tt("settings.launcher.accentColor.popupTitle")}
                          </div>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {ACCENT_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => applyAccentColor(preset)}
                              aria-label={preset}
                              title={preset}
                              className={`interactive-press h-7 w-7 rounded-md ring-inset ${
                                accentColor.toLowerCase() === preset
                                  ? "ring-2 ring-white"
                                  : "ring-1 ring-white/15 hover:ring-white/40"
                              }`}
                              style={{ background: preset }}
                            />
                          ))}
                        </div>
                        <div className="mb-3 flex items-center gap-3">
                          <div
                            ref={accentHueWheelRef}
                            role="slider"
                            tabIndex={0}
                            aria-label={tt("settings.launcher.accentColor.pickColorAria")}
                            aria-valuemin={0}
                            aria-valuemax={360}
                            aria-valuenow={Math.round(accentColorHsv.h)}
                            className="relative h-14 w-14 shrink-0 cursor-crosshair touch-none select-none rounded-full"
                            style={{
                              boxShadow:
                                "0 0 0 1px rgba(255,255,255,0.12), 0 0 0 1px rgba(0,0,0,0.45) inset, 0 8px 28px rgba(0,0,0,0.55)",
                            }}
                            onPointerDown={handleAccentWheelPointerDown}
                            onPointerMove={handleAccentWheelPointerMove}
                            onPointerUp={handleAccentWheelPointerEnd}
                            onPointerCancel={handleAccentWheelPointerEnd}
                            onKeyDown={(e) => {
                              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                              e.preventDefault();
                              const rgb = hexToRgb(accentColor);
                              if (!rgb) return;
                              const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                              const delta = e.key === "ArrowRight" ? 3 : -3;
                              const next = hsvToRgb((hsv.h + delta + 360) % 360, hsv.s, hsv.v);
                              applyAccentColor(rgbToHex(next.r, next.g, next.b));
                            }}
                          >
                            <div
                              className="pointer-events-none absolute inset-0 overflow-hidden rounded-full [backface-visibility:hidden] [transform:translateZ(0)]"
                              style={ACCENT_HUE_RING_STYLE}
                            />
                            <div className="pointer-events-none absolute inset-[10px] rounded-full ring-1 ring-black/50">
                              <div
                                className="h-full w-full rounded-full"
                                style={{ backgroundColor: accentColor }}
                              />
                            </div>
                            <div
                              className="pointer-events-none absolute left-1/2 top-1/2 z-10"
                              style={{ width: 0, height: 0 }}
                            >
                              <div
                                style={{
                                  transform: `rotate(${accentColorHsv.h}deg) translateY(-23px)`,
                                }}
                              >
                                <div
                                  className="h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow-[0_2px_8px_rgba(0,0,0,0.55)] ring-1 ring-black/40"
                                  aria-hidden
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="ui-caption">
                              {tt("settings.launcher.accentColor.currentLabel")}
                            </span>
                            <div className="relative">
                              <input
                                type="text"
                                maxLength={7}
                                value={accentInput}
                                onChange={(e) => setAccentInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                }}
                                onBlur={(e) => {
                                  const raw = e.target.value.trim();
                                  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
                                  if (!raw || !/^#[0-9a-fA-F]{6}$/.test(withHash)) {
                                    setAccentInput(accentColor);
                                    return;
                                  }
                                  applyAccentColor(withHash.toLowerCase());
                                }}
                                className={`glass-control h-8 w-full px-2.5 font-mono text-[0.8125rem] text-white/85 outline-none ${
                                  accentInput ? "pr-8" : ""
                                }`}
                              />
                              <InputClearButton
                                value={accentInput}
                                onClear={() => setAccentInput("")}
                                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                                aria-label={tt("common.clear")}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="ui-caption mb-1.5">
                          {tt("settings.launcher.accentColor.svPadLabel")}
                        </div>
                        <div
                          ref={accentSvPadRef}
                          className="relative h-24 w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl ring-1 ring-white/10"
                          style={{
                            backgroundImage: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, hsl(${accentColorHsv.h} 100% 50%))`,
                          }}
                          aria-label={tt("settings.launcher.accentColor.svPadAria")}
                          onPointerDown={handleAccentSvPointerDown}
                          onPointerMove={handleAccentSvPointerMove}
                          onPointerUp={handleAccentSvPointerEnd}
                          onPointerCancel={handleAccentSvPointerEnd}
                        >
                          <div
                            className="pointer-events-none absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white/95 shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-black/35"
                            style={{
                              left: `${accentColorHsv.s}%`,
                              top: `${100 - accentColorHsv.v}%`,
                            }}
                            aria-hidden
                          />
                        </div>
                        <p className="ui-caption mt-2">
                          {tt("settings.launcher.accentColor.helpText")}
                        </p>
                      </div>
                    )}
                  </div>
                </SettingsRow>
              )}
              {showSetting("launcher.backgroundImage") && (
                <SettingsRow
                  label={tt("settings.launcher.backgroundImage.label")}
                  hint={tt("settings.launcher.backgroundImage.hint")}
                >
                  <button
                    type="button"
                    onClick={() => void chooseBackgroundImage()}
                    className="btn btn-sm btn-soft"
                  >
                    {tt("settings.launcher.backgroundImage.choose")}
                  </button>
                  {settings?.background_image_url && (
                    <button
                      type="button"
                      onClick={() => void resetBackgroundImage()}
                      className="btn btn-sm btn-ghost"
                    >
                      {tt("settings.common.reset")}
                    </button>
                  )}
                </SettingsRow>
              )}
              {showSetting("launcher.adaptiveAccent") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.adaptiveAccent.label")}
                  hint={tt("settings.launcher.adaptiveAccent.hint")}
                  value={settings?.adaptive_accent_enabled ?? false}
                  onChange={(v) => updateSettings({ adaptive_accent_enabled: v })}
                />
              )}
              {showSetting("launcher.backgroundBlur") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.backgroundBlur.label")}
                  value={settings?.background_blur_enabled ?? true}
                  onChange={(v) => updateSettings({ background_blur_enabled: v })}
                />
              )}
              {showSetting("launcher.backgroundAnimation") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.backgroundAnimation.label")}
                  hint={tt("settings.launcher.backgroundAnimation.hint")}
                  value={!(settings?.background_animation_disabled ?? false)}
                  onChange={(v) => updateSettings({ background_animation_disabled: !v })}
                />
              )}
              {showSetting("launcher.disableAnimations") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.disableAnimations.label")}
                  value={settings?.animations_disabled ?? false}
                  onChange={(v) => updateSettings({ animations_disabled: v })}
                />
              )}
              {seasonalThemeActive && showSetting("launcher.disableThematicDecorations") && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.disableThematicDecorations.label")}
                  hint={tt("settings.launcher.disableThematicDecorations.hint") || undefined}
                  value={settings?.thematic_decorations_disabled ?? false}
                  onChange={(v) => updateSettings({ thematic_decorations_disabled: v })}
                />
              )}
            </SettingsSection>
          )}

          {showSetting("launcher.customThemes") && (
            <SettingsSection
              title={tt("settings.section.themes")}
              icon={<AssetIcon name="brush" />}
              actions={
                <button
                  type="button"
                  disabled={themesLoading}
                  onClick={() => void refreshThemes()}
                  className="btn btn-sm btn-ghost"
                >
                  <AssetIcon
                    name="updates"
                    className={`h-3.5 w-3.5 ${themesLoading ? "animate-spin" : ""}`}
                    />
                  {tt("settings.launcher.customThemes.refresh")}
                </button>
              }
            >
              <div className="flex flex-col gap-3 py-3.5">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
                  <ThemeCard
                    name={tt("settings.launcher.customThemes.default")}
                    subtitle="16Launcher"
                    selected={!activeThemeId}
                    disabled={editingThemeId != null}
                    onClick={() => updateSettings({ custom_theme_id: null })}
                  />
                  {installedThemes.map((theme) => (
                    <ThemeCard
                      key={theme.id}
                      name={theme.name}
                      subtitle={[
                        theme.author
                          ? tt("settings.launcher.customThemes.byAuthor", {
                              author: theme.author,
                            })
                          : "",
                        theme.version ? `v${theme.version}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      title={theme.description || undefined}
                      selected={activeThemeId === theme.id}
                      disabled={editingThemeId != null}
                      preview={theme.preview}
                      variables={theme.variables}
                      onClick={() => updateSettings({ custom_theme_id: theme.id })}
                    />
                  ))}
                </div>
                {themesLoading && installedThemes.length === 0 && (
                  <p className="ui-meta">{tt("settings.launcher.customThemes.loading")}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void createTheme()}
                    className="btn btn-sm btn-soft"
                  >
                    {tt("settings.launcher.customThemes.create")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void importThemeZip()}
                    className="btn btn-sm btn-soft"
                  >
                    {tt("settings.launcher.customThemes.importZip")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openThemesFolder()}
                    className="btn btn-sm btn-ghost"
                  >
                    <AssetIcon name="folder" className="h-3.5 w-3.5" />
                    {tt("settings.launcher.customThemes.openFolder")}
                  </button>
                </div>
              </div>
              {activeThemeId && (
                <div className="flex flex-col gap-3 py-3.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white/90">
                      {activeTheme?.name ?? activeThemeId}
                    </div>
                    {activeTheme?.description ? (
                      <p className="ui-meta mt-0.5">{activeTheme.description}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingThemeId(activeThemeId)}
                      disabled={editingThemeId != null}
                      className="btn btn-sm btn-tint"
                    >
                      {tt("settings.launcher.customThemes.openEditor")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openActiveThemeCss()}
                      className="btn btn-sm btn-soft"
                    >
                      {tt("settings.launcher.customThemes.editCss")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void duplicateActiveTheme()}
                      disabled={editingThemeId != null}
                      className="btn btn-sm btn-soft"
                    >
                      {tt("settings.launcher.customThemes.duplicate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void exportActiveTheme()}
                      className="btn btn-sm btn-soft"
                    >
                      {tt("settings.launcher.customThemes.exportZip")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteActiveTheme()}
                      className="btn btn-sm btn-danger"
                    >
                      {tt("settings.launcher.customThemes.delete")}
                    </button>
                  </div>
                </div>
              )}
              {activeThemeId && (
                <SettingsSwitchRow
                  label={tt("settings.launcher.customThemes.hotReload.label")}
                  hint={tt("settings.launcher.customThemes.hotReload.hint")}
                  value={settings?.custom_theme_hot_reload ?? false}
                  onChange={(v) => updateSettings({ custom_theme_hot_reload: v })}
                />
              )}
              {editingThemeId && (
                <ThemeEditorPanel
                  themeId={editingThemeId}
                  tt={tt}
                  onClose={() => setEditingThemeId(null)}
                  onSaved={() => void refreshThemes()}
                  showNotification={showNotification}
                />
              )}
            </SettingsSection>
          )}

          {anyVisible("launcher.cache", "launcher.backup", "launcher.resetSettings") && (
            <SettingsSection
              title={tt("settings.section.data")}
              icon={<AssetIcon name="storage" />}
            >
              {showSetting("launcher.cache") && (
                <SettingsRow
                  label={tt("settings.launcher.cache.label")}
                  hint={
                    <>
                      {tt("settings.launcher.cache.description")}{" "}
                      <span className="text-white/70">
                        {isCacheLoading
                          ? tt("settings.launcher.cache.loading")
                          : tt("settings.launcher.cache.sizeLabel", {
                              size: formatCacheSize(cacheSizeBytes),
                            })}
                      </span>
                    </>
                  }
                >
                  <button
                    type="button"
                    onClick={() => void handleClearCache()}
                    disabled={isCacheLoading}
                    className="btn btn-sm btn-soft"
                  >
                    <AssetIcon name="delete" className="h-3.5 w-3.5" />
                    {tt("settings.launcher.cache.clearButton")}
                  </button>
                </SettingsRow>
              )}
              {showSetting("launcher.backup") && (
                <SettingsRow
                  label={tt("settings.launcher.backup.title")}
                  hint={tt("settings.launcher.backup.hint")}
                >
                  <button
                    type="button"
                    onClick={() => void handleExportSettings()}
                    disabled={isExportingSettings}
                    className="btn btn-sm btn-soft"
                  >
                    {isExportingSettings
                      ? tt("settings.launcher.backup.exporting").trim()
                      : tt("settings.launcher.backup.exportButton")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleImportSettings()}
                    disabled={isImportingSettings}
                    className="btn btn-sm btn-soft"
                  >
                    {isImportingSettings
                      ? tt("settings.launcher.backup.importing")
                      : tt("settings.launcher.backup.importButton")}
                  </button>
                </SettingsRow>
              )}
              {showSetting("launcher.resetSettings") && (
                <SettingsRow
                  label={tt("settings.launcher.resetSettings.button")}
                  hint={tt("settings.launcher.resetSettings.hint")}
                >
                  <button
                    type="button"
                    onClick={() => void handleResetSettings()}
                    disabled={isResettingSettings}
                    className="btn btn-sm btn-danger"
                  >
                    {tt("settings.common.reset")}
                  </button>
                </SettingsRow>
              )}
            </SettingsSection>
          )}
        </>
      )}
    </>
  );
}
