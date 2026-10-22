
import type { SettingsController } from "../useSettingsController";

type Props = { ctx: SettingsController };

export function RepairPromptDialog({ ctx }: Props) {
  const {
    repairPrompt,
    setRepairPrompt,
    tt,
    skipRepairPrompt,
    handleSkipRepairPromptToggle,
    handleInstallVersion,
    showNotification,
  } = ctx;

  return (
    <>
      {repairPrompt && (
        <div
          className="glass-overlay fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={() => setRepairPrompt(null)}
        >
          <div
            className="glass-modal w-[min(92vw,28rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <p className="text-sm leading-relaxed text-white/90">
              {tt("settings.versions.verify.promptText", {
                version: repairPrompt.version.id,
                checked: repairPrompt.result.checked_files,
                missing: repairPrompt.result.missing_files,
                corrupted: repairPrompt.result.corrupted_files,
              })}
            </p>
            <label className="ui-meta mt-4 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="accent-checkbox"
                checked={skipRepairPrompt}
                onChange={(e) => handleSkipRepairPromptToggle(e.target.checked)}
              />
              <span>{tt("settings.versions.verify.skipPrompt")}</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRepairPrompt(null)}
                className="btn btn-sm btn-ghost"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = repairPrompt.version;
                  setRepairPrompt(null);
                  void (async () => {
                    await handleInstallVersion(target, { silentSuccess: true });
                    showNotification(
                      "warning",
                      tt("settings.versions.verify.rewritten", { version: target.id }),
                      { sound: true },
                    );
                  })();
                }}
                className="btn btn-sm btn-accent"
              >
                {tt("settings.versions.verify.rewriteButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
