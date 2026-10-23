import { Modal } from "../../../components/ui";
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

  const pendingProfile = pendingDeleteProfileId
    ? profiles.find((p) => p.id === pendingDeleteProfileId)
    : undefined;

  return (
    <>
      <Modal
        open={pendingDeleteProfileId !== null}
        title={tt("modpacks.deleteConfirm.title")}
        closeLabel={tt("common.close")}
        onClose={() => setPendingDeleteProfileId(null)}
        footer={
          <>
            <button
              type="button"
              autoFocus
              onClick={() => setPendingDeleteProfileId(null)}
              className="btn btn-soft btn-sm"
            >
              {tt("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingDeleteProfileId(null);
                if (pendingProfile) void handleDeleteProfile(pendingProfile);
              }}
              className="btn btn-danger btn-sm"
            >
              {tt("common.delete")}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-white/80">
          {tt("modpacks.deleteConfirm.prompt", { name: pendingProfile?.name ?? "" })}
        </p>
      </Modal>

      <Modal
        open={pendingBulkDeleteProfileIds !== null}
        title={tt("modpacks.deleteConfirm.title")}
        closeLabel={tt("common.close")}
        onClose={() => setPendingBulkDeleteProfileIds(null)}
        footer={
          <>
            <button
              type="button"
              autoFocus
              onClick={() => setPendingBulkDeleteProfileIds(null)}
              className="btn btn-soft btn-sm"
            >
              {tt("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                const ids = pendingBulkDeleteProfileIds;
                setPendingBulkDeleteProfileIds(null);
                if (ids) void handleBulkDeleteProfiles(ids);
              }}
              className="btn btn-danger btn-sm"
            >
              {tt("common.delete")}
            </button>
          </>
        }
      >
        <p className="mb-2 text-sm leading-relaxed text-white/80">
          {tt("modpacks.deleteConfirm.bulkPrompt", {
            count: pendingBulkDeleteProfileIds?.length ?? 0,
          })}
        </p>
        <ul className="custom-scrollbar max-h-32 overflow-y-auto text-xs text-white/60">
          {(pendingBulkDeleteProfileIds ?? []).map((id) => {
            const profile = profiles.find((p) => p.id === id);
            return profile ? (
              <li key={id} className="truncate">
                {profile.name}
              </li>
            ) : null;
          })}
        </ul>
      </Modal>
    </>
  );
}
