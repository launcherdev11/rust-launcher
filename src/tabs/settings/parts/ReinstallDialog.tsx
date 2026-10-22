import { SettingsSelect } from "../../../settings-ui/SettingsComponents";
import type { SettingsController } from "../useSettingsController";

type Props = { ctx: SettingsController };

export function ReinstallDialog({ ctx }: Props) {
  const {
    reinstallDialog,
    setReinstallDialog,
    tt,
    label,
    reinstallLoaderLoading,
    reinstallLoaderOptions,
    installingVersionId,
    confirmReinstall,
  } = ctx;

  return (
    <>
      {reinstallDialog && (
        <div
          className="glass-overlay fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={() => setReinstallDialog(null)}
        >
          <div
            className="glass-modal w-[min(92vw,28rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-[0.9375rem] font-semibold text-white">
              {tt("settings.versions.manage.reinstallTitle", {
                version: reinstallDialog.version.id,
              })}
            </h3>
            <p className="ui-meta mt-1">
              {tt("settings.versions.manage.reinstallHint", {
                gameVersion: reinstallDialog.gameVersion,
              })}
            </p>
            <label className="ui-meta mb-1.5 mt-4 block" htmlFor="reinstall-loader-select">
              {label("settings.versions.manage.loaderVersionLabel")}
            </label>
            <SettingsSelect
              id="reinstall-loader-select"
              className="w-full"
              disabled={reinstallLoaderLoading}
              value={reinstallDialog.selectedLoaderVersion}
              placeholder={
                reinstallLoaderLoading ? tt("common.loading") : tt("modpacks.common.select")
              }
              options={reinstallLoaderOptions.map((opt) => ({
                value: opt.version,
                label: opt.version,
              }))}
              onChange={(version) =>
                setReinstallDialog((prev) =>
                  prev ? { ...prev, selectedLoaderVersion: version } : null,
                )
              }
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReinstallDialog(null)}
                className="btn btn-sm btn-ghost"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                disabled={installingVersionId === reinstallDialog.version.id}
                onClick={() => void confirmReinstall()}
                className="btn btn-sm btn-accent"
              >
                {tt("settings.versions.manage.reinstallConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
