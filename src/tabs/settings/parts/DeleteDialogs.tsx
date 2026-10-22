
import type { SettingsController } from "../useSettingsController";

type Props = { ctx: SettingsController };

export function DeleteDialogs({ ctx }: Props) {
  const {
    simpleDeleteDialog,
    setSimpleDeleteDialog,
    tt,
    deletingVersionId,
    performDelete,
    deleteDialog,
    setDeleteDialog,
  } = ctx;

  return (
    <>
      {simpleDeleteDialog && (
        <div
          className="glass-overlay fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={() => setSimpleDeleteDialog(null)}
        >
          <div
            className="glass-modal w-[min(92vw,26rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-delete-simple-title"
          >
            <p
              id="version-delete-simple-title"
              className="text-sm leading-relaxed text-white/90"
            >
              {tt("settings.versions.delete.simplePrompt", {
                version: simpleDeleteDialog.version.id,
              })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSimpleDeleteDialog(null)}
                className="btn btn-sm btn-ghost"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                disabled={deletingVersionId === simpleDeleteDialog.version.id}
                onClick={() => {
                  const { version, scope, targetLabel } = simpleDeleteDialog;
                  setSimpleDeleteDialog(null);
                  void performDelete(version, scope, targetLabel);
                }}
                className="btn btn-sm btn-danger"
              >
                {tt("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div
          className="glass-overlay fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={() => setDeleteDialog(null)}
        >
          <div
            className="glass-modal w-[min(92vw,28rem)] p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-[0.9375rem] font-semibold text-white">
              {tt("settings.versions.delete.title", { version: deleteDialog.version.id })}
            </h3>
            <p className="ui-meta mt-1">
              {tt("settings.versions.delete.choicePrompt", {
                version: deleteDialog.version.id,
              })}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={deletingVersionId === deleteDialog.version.id}
                onClick={() => {
                  const { version, details } = deleteDialog;
                  setDeleteDialog(null);
                  void performDelete(
                    version,
                    "game",
                    tt("settings.versions.delete.gameOnly", {
                      gameVersion: details.gameVersion,
                    }),
                  );
                }}
                className="btn btn-soft w-full justify-start"
              >
                {tt("settings.versions.delete.gameOnly", {
                  gameVersion: deleteDialog.details.gameVersion,
                })}
              </button>
              <button
                type="button"
                disabled={deletingVersionId === deleteDialog.version.id}
                onClick={() => {
                  const { version, details } = deleteDialog;
                  const suffix =
                    details.loaderVersions.length > 0
                      ? ` (${details.loaderVersions.join(", ")})`
                      : "";
                  setDeleteDialog(null);
                  void performDelete(
                    version,
                    "loader",
                    tt("settings.versions.delete.loaderOnly", { loaderSuffix: suffix }),
                  );
                }}
                className="btn btn-soft w-full justify-start"
              >
                <span className="truncate">
                  {tt("settings.versions.delete.loaderOnly", {
                    loaderSuffix:
                      deleteDialog.details.loaderVersions.length > 0
                        ? ` (${deleteDialog.details.loaderVersions.join(", ")})`
                        : "",
                  })}
                </span>
              </button>
              <button
                type="button"
                disabled={deletingVersionId === deleteDialog.version.id}
                onClick={() => {
                  const { version } = deleteDialog;
                  setDeleteDialog(null);
                  void performDelete(version, "all", version.id);
                }}
                className="btn btn-danger w-full justify-start"
              >
                {tt("settings.versions.delete.all")}
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="btn btn-sm btn-ghost"
              >
                {tt("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
