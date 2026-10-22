import { resolveIconSrc } from "../../../lib/profile-icon";
import { BUILD_PRESETS_UI_ENABLED, loaderLabels } from "../helpers";
import { InputClearButton } from "../../../components/ui";
import { type LoaderId } from "../types";
import { ChevronDown } from "lucide-react";
import { PlusIcon } from "../icons";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function CreateView({ ctx }: Props) {
  const {
    tt,
    setActiveView,
    handleChooseIcon,
    createIconPath,
    setCreateIconPath,
    createSelectedPresetId,
    clearCreatePresetSelection,
    buildPresets,
    applyBuildPresetToCreateForm,
    showNotification,
    refreshBuildPresets,
    setIsPresetsModalOpen,
    createName,
    createNameUserEdited,
    setCreateName,
    setCreateLoader,
    setIsLoaderVersionDropdownOpen,
    createLoader,
    ensureVersionsLoaded,
    setIsVersionDropdownOpen,
    createGameVersion,
    isVersionDropdownOpen,
    versionsLoading,
    versionOptions,
    setCreateGameVersion,
    createAllVersions,
    setCreateAllVersions,
    setVersionOptions,
    loaderVersionOptions,
    loadCreateLoaderVersions,
    loaderVersionsLoading,
    createLoaderVersion,
    selectedLoaderVersionOption,
    loaderChannelLabel,
    isLoaderVersionDropdownOpen,
    setCreateLoaderVersion,
    createBusy,
    handleSaveBuildPresetFromForm,
    handleCreateProfile,
  } = ctx;

  return (
    <div className="glass-panel flex w-full max-w-2xl flex-col gap-4 px-6 py-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          {tt("modpacks.create.title")}
        </h2>
        <button
          type="button"
          onClick={() => setActiveView("list")}
          className="interactive-press rounded-xl bg-white/10 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/20"
        >
          {tt("modpacks.common.backToList")}
        </button>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void handleChooseIcon()}
            className="interactive-press flex h-28 w-24 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black/40 text-xs text-white/70 hover:bg-black/60"
          >
            {createIconPath ? (
              <img
                src={resolveIconSrc(createIconPath)}
                alt="icon"
                className="h-full w-full object-contain"
                onError={(e) => {
                  const img = e.currentTarget;
                  img.style.display = "none";
                }}
              />
            ) : (
              <span>
                {tt("modpacks.create.uploadIcon")}
              </span>
            )}
          </button>
          {createIconPath && (
            <button
              type="button"
              onClick={() => setCreateIconPath(null)}
              className="interactive-press text-[0.8125rem] text-white/60 hover:text-white/90"
            >
              {tt("modpacks.create.removeIcon")}
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3 min-w-0">
          {BUILD_PRESETS_UI_ENABLED && (
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">
                {tt("modpacks.create.presetLabel")}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={createSelectedPresetId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      clearCreatePresetSelection();
                      return;
                    }
                    const preset = buildPresets.find((p) => p.id === id);
                    if (preset) {
                      applyBuildPresetToCreateForm(preset);
                      showNotification("info", tt("modpacks.presets.applied"));
                    }
                  }}
                  className="min-w-[12rem] flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                >
                  <option value="">{tt("modpacks.create.noPreset")}</option>
                  {buildPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    void refreshBuildPresets();
                    setIsPresetsModalOpen(true);
                  }}
                  className="interactive-press rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white/85 hover:bg-white/20"
                >
                  {tt("modpacks.presets.manage")}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-white/70">
              {tt("modpacks.create.nameLabel")}
            </label>
            <div className="relative">
              <input
                type="text"
                value={createName}
                onChange={(e) => {
                  createNameUserEdited.current = true;
                  setCreateName(e.target.value.slice(0, 50));
                }}
                maxLength={50}
                placeholder={
                  tt("modpacks.create.namePlaceholder")
                }
                className={`glass-control w-full rounded-xl border px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none ${
                  createName ? "pr-9" : ""
                }`}
              />
              <InputClearButton
                value={createName}
                onClear={() => {
                  createNameUserEdited.current = true;
                  setCreateName("");
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
                aria-label={tt("common.clear")}
              />
            </div>
            <span className="mt-0.5 block text-[0.75rem] text-white/50">
              {createName.length}/50
            </span>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-white/70">
              {tt("modpacks.create.loaderLabel")}
            </span>
            <div className="flex flex-wrap gap-2">
              {(["vanilla", "forge", "fabric", "quilt", "neoforge"] as LoaderId[]).map(
                (id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setCreateLoader(id);
                      setIsLoaderVersionDropdownOpen(false);
                    }}
                    className={`interactive-press rounded-xl px-3 py-1.5 text-xs font-semibold ${
                      createLoader === id
                        ? "seg-on"
                        : "bg-white/10 text-white/80 hover:bg-white/20"
                    }`}
                  >
                    {loaderLabels[id]}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-white/70">
              {tt("modpacks.create.gameVersionLabel")}
            </label>
            <div className="relative inline-flex w-60 items-center justify-between rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white/90">
              <button
                type="button"
                onClick={() => {
                  void ensureVersionsLoaded();
                  setIsVersionDropdownOpen((v) => !v);
                }}
                className="flex flex-1 items-center justify-between gap-2 text-left"
              >
                <span className="truncate">
                  {createGameVersion || tt("modpacks.common.select")}
                </span>
                <ChevronDown className="h-3 w-3 text-white/60" />
              </button>
              {isVersionDropdownOpen && (
                <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto glass-popover overflow-y-auto p-1 text-xs">
                  {versionsLoading && (
                    <div className="px-3 py-2 text-white/60">
                      {tt("modpacks.common.loading")}
                    </div>
                  )}
                  {!versionsLoading &&
                    versionOptions.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setCreateGameVersion(v.id);
                          setIsVersionDropdownOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                          createGameVersion === v.id
                            ? "seg-on"
                            : "text-white/80 hover:bg-white/10"
                        }`}
                      >
                        <span>{v.id}</span>
                        <span className="ml-2 text-[0.75rem] text-gray-400">
                          {v.version_type}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={createAllVersions}
                onChange={(e) => {
                  setCreateAllVersions(e.target.checked);
                  setVersionOptions([]);
                }}
                className="accent-checkbox"
              />
              <span>
                {tt("modpacks.create.allVersions")}
              </span>
            </label>
          </div>

          {createLoader !== "vanilla" && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-white/70">
                {tt("modpacks.create.loaderVersionLabel")}
              </label>
              <div className="relative inline-flex w-72 items-center justify-between rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white/90">
                <button
                  type="button"
                  onClick={() => {
                    if (loaderVersionOptions.length === 0) {
                      void loadCreateLoaderVersions();
                    }
                    setIsLoaderVersionDropdownOpen((v) => !v);
                  }}
                  disabled={loaderVersionsLoading}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:opacity-60"
                >
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    <span className="truncate">
                      {loaderVersionsLoading
                        ? tt("modpacks.common.loading")
                        : createLoaderVersion || tt("modpacks.common.select")}
                    </span>
                    {selectedLoaderVersionOption?.channel && (
                      <span
                        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.75rem] font-semibold ${
                          selectedLoaderVersionOption.channel === "stable"
                            ? "bg-emerald-500/20 text-emerald-200"
                            : selectedLoaderVersionOption.channel === "alpha"
                              ? "bg-violet-500/20 text-violet-200"
                              : "bg-amber-500/20 text-amber-200"
                        }`}
                      >
                        {loaderChannelLabel(selectedLoaderVersionOption.channel)}
                      </span>
                    )}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-white/60" />
                </button>
                {isLoaderVersionDropdownOpen && (
                  <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto glass-popover overflow-y-auto p-1 text-xs">
                    {loaderVersionOptions.length === 0 && !loaderVersionsLoading && (
                      <div className="px-3 py-2 text-white/60">
                        {tt("modpacks.manage.noVersionsForGame")}
                      </div>
                    )}
                    {loaderVersionOptions.map((opt, idx) => {
                      const channelLabel = loaderChannelLabel(opt.channel ?? null);
                      const selected = createLoaderVersion === opt.version;
                      return (
                        <button
                          key={`${createLoader}-${opt.version}-${idx}`}
                          type="button"
                          onClick={() => {
                            setCreateLoaderVersion(opt.version);
                            setIsLoaderVersionDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left transition-colors ${
                            selected
                              ? "seg-on"
                              : "text-white/80 hover:bg-white/10"
                          }`}
                        >
                          <span className="truncate">{opt.version}</span>
                          {channelLabel && (
                            <span
                              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.75rem] font-semibold ${
                                selected
                                  ? opt.channel === "stable"
                                    ? "bg-emerald-600/25 text-emerald-900"
                                    : opt.channel === "alpha"
                                      ? "bg-violet-600/25 text-violet-900"
                                      : "bg-amber-600/25 text-amber-900"
                                  : opt.channel === "stable"
                                    ? "bg-emerald-500/20 text-emerald-200"
                                    : opt.channel === "alpha"
                                      ? "bg-violet-500/20 text-violet-200"
                                      : "bg-amber-500/20 text-amber-200"
                              }`}
                            >
                              {channelLabel}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={`mt-2 flex flex-wrap items-center gap-2 ${
          BUILD_PRESETS_UI_ENABLED ? "justify-between" : "justify-end"
        }`}
      >
        {BUILD_PRESETS_UI_ENABLED && (
          <button
            type="button"
            disabled={createBusy}
            onClick={() => void handleSaveBuildPresetFromForm()}
            className="interactive-press rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white/85 hover:bg-white/20 disabled:opacity-60"
          >
            {tt("modpacks.create.saveFormAsPreset")}
          </button>
        )}
        <button
          type="button"
          disabled={createBusy}
          onClick={() => void handleCreateProfile()}
          className="interactive-press inline-flex items-center gap-2 rounded-xl accent-bg px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:opacity-90 disabled:opacity-60"
        >
          <PlusIcon className="h-4 w-4" />
          <span>{tt("modpacks.actions.create")}</span>
        </button>
      </div>
    </div>
  );
}
