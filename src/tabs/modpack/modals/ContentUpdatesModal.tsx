
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function ContentUpdatesModal({ ctx }: Props) {
  const {
    isContentUpdatesModalOpen,
    selectedProfile,
    contentUpdatesApplying,
    setIsContentUpdatesModalOpen,
    tt,
    contentUpdates,
    selectedContentUpdateFilenames,
    setSelectedContentUpdateFilenames,
    handleApplyContentUpdates,
  } = ctx;

  return (
    <>
      {isContentUpdatesModalOpen && selectedProfile && (
        <div
          className="glass-overlay fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => {
            if (contentUpdatesApplying) return;
            setIsContentUpdatesModalOpen(false);
          }}
        >
          <div
            className="glass-modal w-full max-w-4xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-white/50">
                  {tt("modpacks.contentUpdates.modalTitle")}
                </div>
                <div className="truncate text-lg font-semibold text-white">
                  {selectedProfile.name}
                </div>
                <div className="text-xs text-white/65">
                  {tt("modpacks.contentUpdates.modalSubtitle")}
                </div>
              </div>
              <button
                type="button"
                className="interactive-press rounded-xl bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20 disabled:opacity-60"
                disabled={contentUpdatesApplying}
                onClick={() => setIsContentUpdatesModalOpen(false)}
              >
                {tt("common.close")}
              </button>
            </div>

            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {contentUpdates.map((update) => {
                const checked = selectedContentUpdateFilenames.has(update.filename);
                return (
                  <label
                    key={update.filename}
                    className={`flex cursor-pointer select-none items-center gap-3 rounded-2xl border px-3 py-2 text-sm ${
                      checked
                        ? "border-accent-to/40 bg-accent-from/15 text-white"
                        : "border-white/10 bg-black/35 text-white/90"
                    }`}
                    onClick={() => {
                      if (contentUpdatesApplying) return;
                      setSelectedContentUpdateFilenames((prev) => {
                        const next = new Set(prev);
                        if (next.has(update.filename)) next.delete(update.filename);
                        else next.add(update.filename);
                        return next;
                      });
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="accent-checkbox pointer-events-none"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{update.title}</div>
                      <div className="truncate text-xs text-white/70">{update.filename}</div>
                    </div>
                    <div className="text-right text-xs text-white/70">
                      <div>
                        {tt("modpacks.contentUpdates.currentVersion")}: {update.currentVersionNumber}
                      </div>
                      <div>
                        {tt("modpacks.contentUpdates.latestVersion")}: {update.latestVersionNumber}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 text-xs text-white/55">
              {tt("modpacks.contentUpdates.notOnModrinth")}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleApplyContentUpdates(false)}
                disabled={contentUpdatesApplying}
                className="interactive-press rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {contentUpdatesApplying
                  ? tt("modpacks.contentUpdates.updating")
                  : tt("modpacks.contentUpdates.updateSelected")}
              </button>
              <button
                type="button"
                onClick={() => void handleApplyContentUpdates(true)}
                disabled={contentUpdatesApplying}
                className="interactive-press rounded-xl accent-bg px-4 py-2 text-sm font-semibold text-white shadow-soft hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {contentUpdatesApplying
                  ? tt("modpacks.contentUpdates.updating")
                  : tt("modpacks.contentUpdates.updateAll")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
