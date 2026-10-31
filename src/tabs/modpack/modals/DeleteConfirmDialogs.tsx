import { Modal } from "../../../components/ui";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function DeleteConfirmDialogs({ ctx }: Props) {
  const {
    tt,
    profiles,
    pendingBulkDeleteProfileIds,
    setPendingBulkDeleteProfileIds,
    handleBulkDeleteProfiles,
  } = ctx;

  return (
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
  );
}
