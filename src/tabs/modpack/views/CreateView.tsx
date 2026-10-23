import { resolveIconSrc } from "../../../lib/profile-icon";
import { BUILD_PRESETS_UI_ENABLED, loaderLabels } from "../helpers";
import { InputClearButton } from "../../../components/ui";
import { type LoaderId } from "../types";
import { ChevronDown } from "lucide-react";
import { PlusIcon } from "../icons";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

const LOADER_IDS: LoaderId[] = ["vanilla", "forge", "fabric", "quilt", "neoforge"];

const CHANNEL_BADGE = {
  stable: "bg-emerald-500/20 text-emerald-200",
  alpha: "bg-violet-500/20 text-violet-200",
  other: "bg-amber-500/20 text-amber-200",
} as const;

const CHANNEL_BADGE_SELECTED = {
  stable: "bg-emerald-600/25 text-emerald-900",
  alpha: "bg-violet-600/25 text-violet-900",
  other: "bg-amber-600/25 text-amber-900",
} as const;

function channelKey(channel: string | null | undefined): keyof typeof CHANNEL_BADGE {
  return channel === "stable" || channel === "alpha" ? channel : "other";
}

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
    lazy,
  } = ctx;

  return (
    <div className="glass-panel flex w-full max-w-2xl flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--seam)] px-6 py-4">
        <h2 className="ui-title">{tt("modpacks.create.title")}</h2>
        <button
          type="button"
          onClick={() => setActiveView("list")}
          className="btn btn-ghost btn-sm"
        >
          {tt("modpacks.common.backToList")}
        </button>
      </div>

      <div className="flex flex-col gap-5 px-6 py-5 sm:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2 sm:w-28">
          <button
            type="button"
            onClick={() => void handleChooseIcon()}
            className={`interactive-press flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl p-2 text-center text-[0.8125rem] leading-snug text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] ${
              createIconPath
                ? "glass-inset"
                : "border border-dashed border-[color:var(--seam-strong)] bg-white/[0.02] hover:bg-white/[0.04]"
            }`}
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
              <span>{tt("modpacks.create.uploadIcon")}</span>
            )}
          </button>
          {createIconPath && (
            <button
              type="button"
              onClick={() => setCreateIconPath(null)}
              className="interactive-press text-[0.8125rem] text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
            >
              {tt("modpacks.create.removeIcon")}
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {BUILD_PRESETS_UI_ENABLED && (
            <div className="flex flex-col gap-1.5">
              <label className="ui-section">{tt("modpacks.create.presetLabel")}</label>
              <div className="flex items-center gap-2">
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
                  className="glass-control launcher-select min-w-0 flex-1 px-3 text-sm focus:outline-none"
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
                  className="btn btn-soft"
                >
                  {tt("modpacks.presets.manage")}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label className="ui-section">{tt("modpacks.create.nameLabel")}</label>
              <span className="ui-caption">{createName.length}/50</span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={createName}
                onChange={(e) => {
                  createNameUserEdited.current = true;
                  setCreateName(e.target.value.slice(0, 50));
                }}
                maxLength={50}
                placeholder={tt("modpacks.create.namePlaceholder")}
                className={`glass-control h-9 w-full px-3 text-sm text-[color:var(--fg)] placeholder:text-[color:var(--fg-faint)] focus:outline-none ${
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
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="ui-section">{tt("modpacks.create.loaderLabel")}</span>
            <div className="seg-track flex w-full gap-0.5 p-0.5">
              {LOADER_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setCreateLoader(id);
                    setIsLoaderVersionDropdownOpen(false);
                  }}
                  className={`interactive-press h-8 min-w-0 flex-1 truncate rounded-lg px-2 text-xs font-semibold ${
                    createLoader === id
                      ? "seg-on"
                      : "text-[color:var(--fg-muted)] hover:bg-white/[0.05] hover:text-[color:var(--fg)]"
                  }`}
                >
                  {loaderLabels[id]}
                </button>
              ))}
            </div>
          </div>

          <div
            className={`grid gap-4 ${createLoader !== "vanilla" ? "sm:grid-cols-2" : "grid-cols-1"}`}
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="ui-section">{tt("modpacks.create.gameVersionLabel")}</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    void ensureVersionsLoaded();
                    setIsVersionDropdownOpen((v) => !v);
                  }}
                  className="glass-control flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-sm text-[color:var(--fg)]"
                >
                  <span className="truncate">
                    {createGameVersion || tt("modpacks.common.select")}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--fg-muted)]" />
                </button>
                {isVersionDropdownOpen && (
                  <div className="glass-popover absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto p-1 text-xs">
                    {versionsLoading && (
                      <div className="px-3 py-2 text-[color:var(--fg-muted)]">
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
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left transition-colors ${
                            createGameVersion === v.id
                              ? "seg-on"
                              : "text-[color:var(--fg)] hover:bg-white/[0.06]"
                          }`}
                        >
                          <span>{v.id}</span>
                          <span className="ml-2 text-[0.75rem] text-[color:var(--fg-faint)]">
                            {v.version_type}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[color:var(--fg-muted)]">
                <input
                  type="checkbox"
                  checked={createAllVersions}
                  onChange={(e) => {
                    setCreateAllVersions(e.target.checked);
                    setVersionOptions([]);
                  }}
                  className="accent-checkbox"
                />
                <span>{tt("modpacks.create.allVersions")}</span>
              </label>
            </div>

            {createLoader !== "vanilla" && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <label className="ui-section">{tt("modpacks.create.loaderVersionLabel")}</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (loaderVersionOptions.length === 0) {
                        void loadCreateLoaderVersions();
                      }
                      setIsLoaderVersionDropdownOpen((v) => !v);
                    }}
                    disabled={loaderVersionsLoading}
                    className="glass-control flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-sm text-[color:var(--fg)] disabled:opacity-60"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">
                        {loaderVersionsLoading
                          ? tt("modpacks.common.loading")
                          : createLoaderVersion || tt("modpacks.common.select")}
                      </span>
                      {selectedLoaderVersionOption?.channel && (
                        <span
                          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.75rem] font-semibold ${
                            CHANNEL_BADGE[channelKey(selectedLoaderVersionOption.channel)]
                          }`}
                        >
                          {loaderChannelLabel(selectedLoaderVersionOption.channel)}
                        </span>
                      )}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--fg-muted)]" />
                  </button>
                  {isLoaderVersionDropdownOpen && (
                    <div className="glass-popover absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto p-1 text-xs">
                      {loaderVersionOptions.length === 0 && !loaderVersionsLoading && (
                        <div className="px-3 py-2 text-[color:var(--fg-muted)]">
                          {tt("modpacks.manage.noVersionsForGame")}
                        </div>
                      )}
                      {loaderVersionOptions.map((opt, idx) => {
                        const channelLabel = loaderChannelLabel(opt.channel ?? null);
                        const selected = createLoaderVersion === opt.version;
                        const badges = selected ? CHANNEL_BADGE_SELECTED : CHANNEL_BADGE;
                        return (
                          <button
                            key={`${createLoader}-${opt.version}-${idx}`}
                            type="button"
                            onClick={() => {
                              setCreateLoaderVersion(opt.version);
                              setIsLoaderVersionDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left transition-colors ${
                              selected ? "seg-on" : "text-[color:var(--fg)] hover:bg-white/[0.06]"
                            }`}
                          >
                            <span className="truncate">{opt.version}</span>
                            {channelLabel && (
                              <span
                                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.75rem] font-semibold ${
                                  badges[channelKey(opt.channel)]
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

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="ui-section">{tt("modpacks.lazy.createSection")}</span>
              <button
                type="button"
                onClick={() => lazy.setModal({ mode: "manage" })}
                className="btn btn-ghost btn-sm"
              >
                {tt("modpacks.lazy.createManage")}
              </button>
            </div>
            {lazy.sets.length === 0 ? (
              <p className="ui-caption">{tt("modpacks.lazy.createNone")}</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {lazy.sets.map((set) => (
                  <label
                    key={set.id}
                    className="inline-flex cursor-pointer items-center gap-2 text-xs text-[color:var(--fg)]"
                  >
                    <input
                      type="checkbox"
                      checked={lazy.createSelectedIds.includes(set.id)}
                      onChange={() => lazy.toggleCreateSet(set.id)}
                      className="accent-checkbox"
                    />
                    <span>{set.name}</span>
                    <span className="tabular-nums text-[color:var(--fg-faint)]">
                      {set.items.length}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="ui-caption">{tt("modpacks.lazy.createHint")}</p>
          </div>
        </div>
      </div>

      <div
        className={`flex flex-wrap items-center gap-2 border-t border-[color:var(--seam)] px-6 py-4 ${
          BUILD_PRESETS_UI_ENABLED ? "justify-between" : "justify-end"
        }`}
      >
        {BUILD_PRESETS_UI_ENABLED && (
          <button
            type="button"
            disabled={createBusy}
            onClick={() => void handleSaveBuildPresetFromForm()}
            className="btn btn-soft"
          >
            {tt("modpacks.create.saveFormAsPreset")}
          </button>
        )}
        <button
          type="button"
          disabled={createBusy}
          onClick={() => void handleCreateProfile()}
          className="btn btn-accent btn-lg"
        >
          <PlusIcon className="h-4 w-4" />
          <span>{tt("modpacks.actions.create")}</span>
        </button>
      </div>
    </div>
  );
}
