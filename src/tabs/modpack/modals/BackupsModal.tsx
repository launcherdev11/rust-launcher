import { BackupIcon, FolderIcon } from "../icons";
import { invoke } from "@tauri-apps/api/core";
import { formatByteSize, localeTag } from "../../../i18n";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function BackupsModal({ ctx }: Props) {
  const {
    backupsModalProfileId,
    backupCreating,
    backupRestoringId,
    setBackupsModalProfileId,
    tt,
    profiles,
    handleCreateBackup,
    showNotification,
    backupsLoading,
    backupsList,
    language,
    handleRestoreBackup,
    handleDeleteBackup,
  } = ctx;

  return (
    <>
      {backupsModalProfileId && (
        <div
          className="glass-overlay fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => {
            if (backupCreating || backupRestoringId) return;
            setBackupsModalProfileId(null);
          }}
        >
          <div
            className="glass-modal flex w-full max-w-lg flex-col p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-white">
                  {tt("modpacks.backups.title")}
                </h3>
                <p className="mt-1 text-xs text-white/55">
                  {tt("modpacks.backups.hint", {
                    name:
                      profiles.find((p) => p.id === backupsModalProfileId)?.name ??
                      backupsModalProfileId,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBackupsModalProfileId(null)}
                disabled={Boolean(backupCreating || backupRestoringId)}
                className="interactive-press rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/20 disabled:opacity-50"
              >
                {tt("common.close")}
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCreateBackup(backupsModalProfileId)}
                disabled={backupCreating || Boolean(backupRestoringId)}
                className="interactive-press inline-flex items-center gap-2 rounded-xl accent-bg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <BackupIcon className="h-3.5 w-3.5" />
                {backupCreating
                  ? tt("modpacks.backups.creating")
                  : tt("modpacks.backups.create")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void invoke("open_profile_backups_folder", {
                    profileId: backupsModalProfileId,
                  }).catch((e) => {
                    console.error(e);
                    showNotification("error", tt("modpacks.backups.openFolderFailed"));
                  })
                }
                className="interactive-press inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
              >
                <FolderIcon className="h-3.5 w-3.5" />
                {tt("modpacks.backups.openFolder")}
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/25 p-2">
              {backupsLoading ? (
                <div className="px-2 py-6 text-center text-xs text-white/55">
                  {tt("modpacks.common.loading")}
                </div>
              ) : backupsList.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-white/55">
                  {tt("modpacks.backups.empty")}
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {backupsList.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-white">
                          {b.id}
                        </div>
                        <div className="mt-0.5 text-[0.8125rem] text-white/55">
                          {formatByteSize(language, b.size_bytes)}
                          {" · "}
                          {new Date(b.created_at * 1000).toLocaleString(localeTag(language))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void handleRestoreBackup(backupsModalProfileId, b.id)
                          }
                          disabled={backupCreating || Boolean(backupRestoringId)}
                          className="interactive-press rounded-lg bg-accent-from/20 px-2 py-1 text-[0.8125rem] font-semibold text-accent-hi hover:bg-accent-from/30 disabled:opacity-50"
                        >
                          {backupRestoringId === b.id
                            ? tt("modpacks.backups.restoring")
                            : tt("modpacks.backups.restore")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteBackup(backupsModalProfileId, b.id)
                          }
                          disabled={backupCreating || Boolean(backupRestoringId)}
                          className="interactive-press rounded-lg bg-danger-strong/20 px-2 py-1 text-[0.8125rem] font-semibold text-danger-fg hover:bg-danger-strong/30 disabled:opacity-50"
                        >
                          {tt("modpacks.backups.delete")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
