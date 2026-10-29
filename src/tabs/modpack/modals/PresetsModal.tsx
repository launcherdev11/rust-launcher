import { BUILD_PRESETS_UI_ENABLED, loaderLabels } from "../helpers";
import { type LoaderId } from "../types";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function PresetsModal({ ctx }: Props) {
  const {
    isPresetsModalOpen,
    setIsPresetsModalOpen,
    tt,
    buildPresetsLoading,
    buildPresets,
    presetIconUris,
    applyBuildPresetToCreateForm,
    setActiveView,
    ensureVersionsLoaded,
    showNotification,
    handleDeleteBuildPreset,
    activeView,
    handleSaveBuildPresetFromForm,
  } = ctx;

  return (
    <>
      {BUILD_PRESETS_UI_ENABLED && isPresetsModalOpen && (
        <div
          className="glass-overlay fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setIsPresetsModalOpen(false)}
        >
          <div
            className="glass-modal flex max-h-[80vh] w-full max-w-lg flex-col p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-white">
                {tt("modpacks.presets.title")}
              </h3>
              <button
                type="button"
                onClick={() => setIsPresetsModalOpen(false)}
                className="interactive-press rounded-xl bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
              >
                {tt("modpacks.common.backToList")}
              </button>
            </div>

            {buildPresetsLoading && (
              <p className="text-sm text-white/60">{tt("modpacks.common.loading")}</p>
            )}

            {!buildPresetsLoading && buildPresets.length === 0 && (
              <p className="text-sm text-white/70">{tt("modpacks.presets.empty")}</p>
            )}

            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
              {buildPresets.map((preset) => {
                const iconUri = presetIconUris[preset.id];
                const loaderVersionLabel =
                  preset.loader === "vanilla"
                    ? preset.game_version
                    : `${preset.game_version}${preset.loader_version ? ` · ${preset.loader_version}` : ""}`;
                return (
                  <div
                    key={preset.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                      {iconUri ? (
                        <img
                          src={iconUri}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-[0.75rem] text-white/40">
                          {preset.loader.slice(0, 2)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">
                        {preset.name}
                      </div>
                      <div className="truncate text-[0.8125rem] text-white/55">
                        {tt("modpacks.presets.loaderInfo", {
                          loader: loaderLabels[preset.loader as LoaderId] ?? preset.loader,
                          version: loaderVersionLabel,
                        })}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          applyBuildPresetToCreateForm(preset);
                          setActiveView("create");
                          void ensureVersionsLoaded();
                          setIsPresetsModalOpen(false);
                          showNotification("info", tt("modpacks.presets.applied"));
                        }}
                        className="interactive-press rounded-xl accent-bg px-3 py-1 text-[0.8125rem] font-semibold text-white hover:opacity-90"
                      >
                        {tt("modpacks.presets.apply")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteBuildPreset(preset)}
                        className="interactive-press rounded-xl bg-danger-strong/80 px-3 py-1 text-[0.8125rem] font-semibold text-white hover:bg-danger"
                      >
                        {tt("modpacks.presets.delete")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {activeView === "create" && (
              <button
                type="button"
                onClick={() => void handleSaveBuildPresetFromForm()}
                className="interactive-press mt-4 w-full rounded-2xl border border-white/15 bg-white/10 py-2 text-sm font-semibold text-white hover:bg-white/20"
              >
                {tt("modpacks.presets.saveFromForm")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
