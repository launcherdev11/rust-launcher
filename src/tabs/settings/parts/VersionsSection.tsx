import {
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitchRow,
} from "../../../settings-ui/SettingsComponents";
import { AssetIcon } from "../../../components/asset_icon";
import { type DownloadSource, type LoaderId } from "../../../app/types";
import { AnimatePresence, motion } from "framer-motion";
import { InputClearButton } from "../../../components/ui";
import { localeTag } from "../../../i18n";
import type { SettingsController } from "../useSettingsController";

type Props = { ctx: SettingsController };

export function VersionsSection({ ctx }: Props) {
  const {
    settingsTab,
    anyVisible,
    tt,
    showSetting,
    label,
    settings,
    updateSettings,
    versionsLoader,
    handleImportCustomVersion,
    isLoadingVersions,
    refreshVersionsList,
    setVersionsLoader,
    setIsVersionFilterDropdownOpen,
    versionsFilterDropdownRef,
    isVersionFilterDropdownOpen,
    selectedVersionFilterLabel,
    versionFilterInputRef,
    versionFilterQuery,
    setVersionFilterQuery,
    versionFilterOptions,
    setSelectedVersionFilterId,
    versionFilterListRef,
    selectedVersionFilterId,
    selectedVersionFilterButtonRef,
    availableVersions,
    filteredAvailableVersions,
    isVersionInstalled,
    downloadProgress,
    installingVersionId,
    checkingVersionId,
    deletingVersionId,
    language,
    handleCheckVersionFiles,
    openDeleteFlow,
    openReinstallDialog,
    handleInstallVersion,
    installLogLines,
    installLogEndRef,
  } = ctx;

  return (
    <>
      {settingsTab === "versions" && (
        <>
          <div className="settings-col">
            {anyVisible(
              "versions.showSnapshots",
              "versions.showAlpha",
              "versions.forgeProxy",
              "versions.downloadSource",
            ) && (
              <SettingsSection
                title={tt("settings.section.versionList")}
                icon={<AssetIcon name="filter" />}
              >
                {showSetting("versions.showSnapshots") && (
                  <SettingsSwitchRow
                    label={tt("settings.versions.showSnapshots.label")}
                    value={settings?.show_snapshots ?? false}
                    onChange={(v) => updateSettings({ show_snapshots: v })}
                  />
                )}
                {showSetting("versions.showAlpha") && (
                  <SettingsSwitchRow
                    label={tt("settings.versions.showAlpha.label")}
                    value={settings?.show_alpha_versions ?? false}
                    onChange={(v) => updateSettings({ show_alpha_versions: v })}
                  />
                )}
                {showSetting("versions.forgeProxy") && (
                  <SettingsSwitchRow
                    label={tt("settings.versions.forgeProxyFallback.label")}
                    value={settings?.forge_proxy_fallback ?? false}
                    onChange={(v) => updateSettings({ forge_proxy_fallback: v })}
                  />
                )}
                {showSetting("versions.downloadSource") && (
                  <SettingsRow
                    label={tt("downloads.source.label")}
                    hint={tt("downloads.source.hint")}
                  >
                    <SettingsSelect<DownloadSource>
                      value={settings?.download_source ?? "auto"}
                      options={(["auto", "official", "mirror"] as DownloadSource[]).map((id) => ({
                        value: id,
                        label: tt(`downloads.source.option.${id}`),
                      }))}
                      onChange={(v) => updateSettings({ download_source: v })}
                    />
                  </SettingsRow>
                )}
              </SettingsSection>
            )}
          </div>

          <div className="settings-col">
            {anyVisible(
              "versions.loaderFilter",
              "versions.versionFilter",
              "versions.available",
            ) && (
              <SettingsSection
                title={tt("settings.card.versions")}
                icon={<AssetIcon name="versions" />}
                actions={
                  showSetting("versions.available") ? (
                    <>
                      {versionsLoader === "vanilla" && (
                        <button
                          type="button"
                          onClick={() => void handleImportCustomVersion()}
                          className="btn btn-sm btn-soft"
                        >
                          <AssetIcon name="import" className="h-3.5 w-3.5" />
                          {tt("settings.versions.custom.importButton")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isLoadingVersions}
                        onClick={() => void refreshVersionsList()}
                        className="btn btn-sm btn-ghost"
                      >
                        <AssetIcon
                          name="updates"
                          className={`h-3.5 w-3.5 ${isLoadingVersions ? "animate-spin" : ""}`}
                          />
                        {tt("settings.versions.refresh")}
                      </button>
                    </>
                  ) : undefined
                }
              >
                {anyVisible("versions.loaderFilter", "versions.versionFilter") && (
                  <div className="grid grid-cols-1 gap-3 py-3.5 sm:grid-cols-2">
                    {showSetting("versions.loaderFilter") && (
                      <div>
                        <label
                          htmlFor="versions-loader-select"
                          className="ui-meta mb-1.5 block"
                        >
                          {label("settings.versions.loaderFilter.label")}
                        </label>
                        <SettingsSelect
                          id="versions-loader-select"
                          className="w-full"
                          value={versionsLoader}
                          options={(
                            ["vanilla", "fabric", "quilt", "forge", "neoforge"] as LoaderId[]
                          ).map((id) => ({
                            value: id,
                            label: tt(`settings.versions.loader.${id}`),
                          }))}
                          onChange={(id) => {
                            setVersionsLoader(id);
                            setIsVersionFilterDropdownOpen(false);
                          }}
                        />
                      </div>
                    )}
                    {showSetting("versions.versionFilter") && (
                      <div ref={versionsFilterDropdownRef} className="relative">
                        <span className="ui-meta mb-1.5 block">
                          {label("settings.versions.versionFilter.label")}
                        </span>
                        <button
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={isVersionFilterDropdownOpen}
                          onClick={() => setIsVersionFilterDropdownOpen((prev) => !prev)}
                          className="interactive-press launcher-select glass-control flex h-9 w-full items-center px-3 text-left text-sm outline-none"
                        >
                          <span className="truncate">{selectedVersionFilterLabel}</span>
                        </button>
                        <AnimatePresence>
                          {isVersionFilterDropdownOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: 6, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 4, scale: 0.98 }}
                              transition={{ duration: 0.14, ease: "easeOut" }}
                              className="glass-popover absolute left-0 z-30 mt-1 w-full p-1"
                            >
                              <div className="relative px-1 pb-1 pt-0.5">
                                <input
                                  ref={versionFilterInputRef}
                                  type="text"
                                  value={versionFilterQuery}
                                  onChange={(e) => setVersionFilterQuery(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      setIsVersionFilterDropdownOpen(false);
                                      return;
                                    }
                                    if (e.key === "Enter") {
                                      const q = versionFilterQuery.trim().toLowerCase();
                                      const exact = q
                                        ? versionFilterOptions.find(
                                            (v) => v.id.toLowerCase() === q,
                                          )
                                        : null;
                                      const chosen = exact ?? versionFilterOptions[0] ?? null;
                                      if (chosen) {
                                        setSelectedVersionFilterId(chosen.id);
                                        setIsVersionFilterDropdownOpen(false);
                                      }
                                    }
                                  }}
                                  placeholder={tt("play.version.searchPlaceholder")}
                                  className={`glass-control h-8 w-full px-3 text-xs text-white/90 outline-none placeholder:text-white/35 ${
                                    versionFilterQuery ? "pr-8" : ""
                                  }`}
                                />
                                <InputClearButton
                                  value={versionFilterQuery}
                                  onClear={() => setVersionFilterQuery("")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2"
                                  aria-label={tt("common.clear")}
                                />
                              </div>
                              <div
                                ref={versionFilterListRef}
                                className="custom-scrollbar max-h-[240px] overflow-y-auto px-1 pb-1"
                              >
                                <button
                                  type="button"
                                  ref={(el) => {
                                    if (selectedVersionFilterId === null) {
                                      selectedVersionFilterButtonRef.current = el;
                                    }
                                  }}
                                  onClick={() => {
                                    setSelectedVersionFilterId(null);
                                    setIsVersionFilterDropdownOpen(false);
                                  }}
                                  className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                                    selectedVersionFilterId === null
                                      ? "seg-on"
                                      : "text-white/80 hover:bg-white/10"
                                  }`}
                                >
                                  {tt("settings.versions.versionFilter.all")}
                                </button>
                                {versionFilterOptions.length === 0 ? (
                                  <div className="ui-meta px-3 py-2">
                                    {tt("settings.versions.versionFilter.noneFound")}
                                  </div>
                                ) : (
                                  versionFilterOptions.map((v) => {
                                    const selected = selectedVersionFilterId === v.id;
                                    return (
                                      <button
                                        key={v.id}
                                        ref={(el) => {
                                          if (selected) {
                                            selectedVersionFilterButtonRef.current = el;
                                          }
                                        }}
                                        type="button"
                                        onClick={() => {
                                          setSelectedVersionFilterId(v.id);
                                          setIsVersionFilterDropdownOpen(false);
                                        }}
                                        className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                                          selected
                                            ? "seg-on"
                                            : "text-white/80 hover:bg-white/10"
                                        }`}
                                      >
                                        <span className="truncate">{v.id}</span>
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                )}

                {showSetting("versions.available") && (
                  <div className="py-3.5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="ui-meta">
                        {label("settings.versions.available.label")}
                      </span>
                      {!isLoadingVersions && availableVersions && (
                        <span className="ui-caption">{filteredAvailableVersions.length}</span>
                      )}
                    </div>
                    <div className="custom-scrollbar glass-inset max-h-[26rem] min-h-[8rem] overflow-y-auto p-1">
                      {isLoadingVersions ? (
                        <div className="ui-meta flex h-32 items-center justify-center">
                          {tt("settings.versions.loading")}
                        </div>
                      ) : !availableVersions || availableVersions.length === 0 ? (
                        <div className="ui-meta flex h-32 items-center justify-center px-4 text-center">
                          {tt("settings.versions.noneFound")}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {filteredAvailableVersions.map((v) => {
                            const installed = isVersionInstalled(v);
                            const progress = downloadProgress[v.id];
                            const percent =
                              progress && progress.total > 0
                                ? Math.round(progress.percent)
                                : null;
                            const installing = installingVersionId === v.id;
                            const checking = checkingVersionId === v.id;
                            const deleting = deletingVersionId === v.id;
                            return (
                              <div
                                key={v.id}
                                className="flex flex-col gap-2 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.035] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate text-sm font-semibold text-white/90">
                                      {v.id}
                                    </span>
                                    <span className="tag">
                                      {tt(`settings.versions.loader.${v.loader}`)}
                                    </span>
                                    {v.version_type && v.version_type !== v.loader && (
                                      <span className="tag">{v.version_type}</span>
                                    )}
                                    {installed && (
                                      <span className="tag bg-emerald-500/15 text-emerald-300">
                                        {tt("settings.versions.installedBadge")}
                                      </span>
                                    )}
                                  </div>
                                  {v.release_time && (
                                    <div className="ui-caption mt-0.5">
                                      {new Date(v.release_time).toLocaleDateString(
                                        localeTag(language),
                                      )}
                                    </div>
                                  )}
                                  {percent !== null && installing && (
                                    <div className="mt-1.5 flex items-center gap-2">
                                      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                                        <div
                                          className="progress-fill h-full rounded-full transition-[width]"
                                          style={{
                                            width: `${Math.min(100, Math.max(0, percent))}%`,
                                          }}
                                        />
                                      </div>
                                      <span className="ui-caption">{percent}%</span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {installed && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={checking || installing || deleting}
                                        onClick={() => void handleCheckVersionFiles(v)}
                                        className="btn btn-sm btn-ghost"
                                      >
                                        {checking
                                          ? tt("settings.versions.verify.checking")
                                          : tt("settings.versions.verify.button")}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={installing || deleting}
                                        onClick={() => void openDeleteFlow(v)}
                                        className="icon-btn hover:!bg-red-500/15 hover:!text-red-200"
                                        title={
                                          deleting
                                            ? tt("settings.versions.action.deleting")
                                            : tt("settings.versions.action.delete")
                                        }
                                        aria-label={tt("settings.versions.action.delete")}
                                      >
                                        <AssetIcon name="delete" />
                                      </button>
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    disabled={installing || deleting}
                                    onClick={() =>
                                      void (installed
                                        ? openReinstallDialog(v)
                                        : handleInstallVersion(v))
                                    }
                                    className={`btn btn-sm min-w-[7.5rem] ${
                                      installed ? "btn-soft" : "btn-accent"
                                    }`}
                                  >
                                    {!installed && !installing && (
                                      <AssetIcon name="download" className="h-3.5 w-3.5" />
                                    )}
                                    {installing
                                      ? tt("settings.versions.action.installing")
                                      : installed
                                        ? tt("settings.versions.action.reinstall")
                                        : tt("settings.versions.action.install")}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {installingVersionId && (
                      <div className="mt-3">
                        <div className="ui-caption mb-1.5">
                          {tt("settings.versions.installLog", {
                            version: installingVersionId,
                          })}
                        </div>
                        <div className="custom-scrollbar max-h-36 min-h-[5rem] overflow-y-auto rounded-xl border border-[color:var(--seam)] bg-black/50 px-3 py-2 font-mono text-[0.75rem] text-white/75">
                          {installLogLines.length > 0 ? (
                            installLogLines.map((entry, idx) => (
                              <div
                                key={`${idx}-${entry.line.slice(0, 24)}`}
                                className={`whitespace-pre break-all ${
                                  entry.source === "stderr" ? "text-red-300" : ""
                                }`}
                              >
                                {entry.line}
                              </div>
                            ))
                          ) : (
                            <div className="text-white/40">{tt("play.install.logWaiting")}</div>
                          )}
                          <div ref={installLogEndRef} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </SettingsSection>
            )}
          </div>
        </>
      )}
    </>
  );
}
