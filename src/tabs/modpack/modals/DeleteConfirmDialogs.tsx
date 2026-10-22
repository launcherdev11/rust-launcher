
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function DeleteConfirmDialogs({ ctx }: Props) {
  const {
    pendingDeleteProfileId,
    setPendingDeleteProfileId,
    tt,
    profiles,
    handleDeleteProfile,
    pendingBulkDeleteProfileIds,
    setPendingBulkDeleteProfileIds,
    handleBulkDeleteProfiles,
  } = ctx;

  return (
    <>
      {pendingDeleteProfileId && (
        <div
          className="glass-overlay fixed inset-0 z-40 flex items-center justify-center"
          onClick={() => setPendingDeleteProfileId(null)}
        >
          <div
            className="glass-modal relative w-full max-w-sm border-yellow-400/60 p-5 text-sm text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-300">
                !
              </div>
              <h2 className="text-sm font-semibold text-yellow-200">
                {tt("modpacks.deleteConfirm.title")}
              </h2>
            </div>
            <p className="mb-4 text-xs text-yellow-50">
              {(() => {
                const profile = profiles.find((p) => p.id === pendingDeleteProfileId);
                const name = profile?.name ?? "";
                return tt("modpacks.deleteConfirm.prompt", { name });
              })()}
            </p>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPendingDeleteProfileId(null)}
                className="interactive-press rounded-xl bg-white/10 px-4 py-1.5 font-semibold text-white hover:bg-white/20"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const profile = profiles.find(
                    (p) => p.id === pendingDeleteProfileId,
                  );
                  if (!profile) {
                    setPendingDeleteProfileId(null);
                    return;
                  }
                  setPendingDeleteProfileId(null);
                  void handleDeleteProfile(profile);
                }}
                className="interactive-press rounded-xl bg-red-600 px-4 py-1.5 font-semibold text-white hover:bg-red-500"
              >
                {tt("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingBulkDeleteProfileIds && (
        <div
          className="glass-overlay fixed inset-0 z-40 flex items-center justify-center"
          onClick={() => setPendingBulkDeleteProfileIds(null)}
        >
          <div
            className="glass-modal relative w-full max-w-sm border-yellow-400/60 p-5 text-sm text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-300">
                !
              </div>
              <h2 className="text-sm font-semibold text-yellow-200">
                {tt("modpacks.deleteConfirm.title")}
              </h2>
            </div>
            <p className="mb-2 text-xs text-yellow-50">
              {tt("modpacks.deleteConfirm.bulkPrompt", {
                count: pendingBulkDeleteProfileIds.length,
              })}
            </p>
            <ul className="custom-scrollbar mb-4 max-h-32 overflow-y-auto text-xs text-white/60">
              {pendingBulkDeleteProfileIds.map((id) => {
                const profile = profiles.find((p) => p.id === id);
                return profile ? (
                  <li key={id} className="truncate">
                    {profile.name}
                  </li>
                ) : null;
              })}
            </ul>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPendingBulkDeleteProfileIds(null)}
                className="interactive-press rounded-xl bg-white/10 px-4 py-1.5 font-semibold text-white hover:bg-white/20"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = pendingBulkDeleteProfileIds;
                  setPendingBulkDeleteProfileIds(null);
                  void handleBulkDeleteProfiles(ids);
                }}
                className="interactive-press rounded-xl bg-red-600 px-4 py-1.5 font-semibold text-white hover:bg-red-500"
              >
                {tt("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
