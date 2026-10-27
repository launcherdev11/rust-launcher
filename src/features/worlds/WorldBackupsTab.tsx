import { useCallback, useEffect, useState } from "react";
import { AssetIcon } from "../../components/asset_icon";
import { formatByteSize, localeTag, type Language } from "../../i18n";
import { confirmDialog } from "../../lib/confirmDialog";
import {
  createWorldBackup,
  deleteWorldBackup,
  listWorldBackups,
  openWorldBackupsFolder,
  restoreWorldBackup,
  type WorldBackup,
} from "./api";

type Tt = (key: string, vars?: Record<string, string | number>) => string;
type Notify = (kind: "info" | "success" | "error" | "warning", message: string) => void;

const KIND_CLASS: Record<WorldBackup["kind"], string> = {
  manual: "bg-accent-from/20 text-white",
  auto: "bg-white/10 text-white/70",
  safety: "bg-amber-500/15 text-amber-100",
};

export function WorldBackupsTab({
  profileId,
  world,
  language,
  gameRunning,
  tt,
  showNotification,
  onRestored,
}: {
  profileId: string;
  world: string;
  language: Language;
  gameRunning: boolean;
  tt: Tt;
  showNotification: Notify;
  onRestored: () => void;
}) {
  const [backups, setBackups] = useState<WorldBackup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    listWorldBackups(profileId, world)
      .then(setBackups)
      .catch(() => setBackups([]));
  }, [profileId, world]);

  useEffect(() => {
    setBackups(null);
    reload();
  }, [reload]);

  const create = async () => {
    setBusy("create");
    try {
      await createWorldBackup(profileId, world);
      showNotification("success", tt("worldTools.backups.created"));
      reload();
    } catch (e) {
      showNotification("error", String(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (b: WorldBackup) => {
    const ok = await confirmDialog({
      title: tt("worldTools.backups.restoreTitle"),
      message: tt("worldTools.backups.restoreMessage", {
        date: new Date(b.createdAtMs).toLocaleString(localeTag(language)),
      }),
      confirmLabel: tt("worldTools.backups.restore"),
      cancelLabel: tt("common.cancel"),
    });
    if (!ok) return;
    setBusy(b.id);
    try {
      await restoreWorldBackup(profileId, world, b.id);
      showNotification("success", tt("worldTools.backups.restored"));
      reload();
      onRestored();
    } catch (e) {
      showNotification("error", String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (b: WorldBackup) => {
    const ok = await confirmDialog({
      title: tt("worldTools.backups.deleteTitle"),
      message: tt("worldTools.backups.deleteMessage"),
      confirmLabel: tt("worldTools.backups.delete"),
      cancelLabel: tt("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteWorldBackup(profileId, world, b.id);
      reload();
    } catch (e) {
      showNotification("error", String(e));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void create()} disabled={busy !== null} className="btn btn-accent">
          {busy === "create" ? tt("worldTools.backups.creating") : tt("worldTools.backups.create")}
        </button>
        <button
          type="button"
          onClick={() => void openWorldBackupsFolder(profileId, world).catch((e) => showNotification("error", String(e)))}
          className="btn btn-soft"
        >
          <AssetIcon name="folder" className="h-4 w-4" />
          {tt("worldTools.backups.openFolder")}
        </button>
        {gameRunning ? <span className="text-[0.75rem] text-amber-100/80">{tt("worldTools.backups.runningHint")}</span> : null}
      </div>
      <p className="text-[0.8125rem] text-white/50">{tt("worldTools.backups.hint")}</p>

      {backups == null ? (
        <div className="py-8 text-center text-sm text-white/55">{tt("worldTools.loading")}</div>
      ) : backups.length === 0 ? (
        <div className="rounded-2xl bg-black/30 px-6 py-10 text-center text-sm text-white/55">
          {tt("worldTools.backups.empty")}
        </div>
      ) : (
        <div className="custom-scrollbar flex min-h-0 flex-col gap-1.5 overflow-y-auto">
          {backups.map((b) => (
            <div key={b.id} className="flex items-center gap-3 rounded-2xl bg-black/35 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm text-white/90">
                  <span>{new Date(b.createdAtMs).toLocaleString(localeTag(language))}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold ${KIND_CLASS[b.kind]}`}>
                    {tt(`worldTools.backups.kind.${b.kind}`)}
                  </span>
                </div>
                <div className="text-[0.75rem] text-white/45">{formatByteSize(language, b.size)}</div>
              </div>
              <button
                type="button"
                onClick={() => void restore(b)}
                disabled={busy !== null || gameRunning}
                className="btn btn-sm btn-soft"
              >
                {busy === b.id ? tt("worldTools.backups.restoring") : tt("worldTools.backups.restore")}
              </button>
              <button
                type="button"
                onClick={() => void remove(b)}
                disabled={busy !== null}
                className="icon-btn hover:!bg-red-500/15 hover:!text-red-200"
                aria-label={tt("worldTools.backups.delete")}
                title={tt("worldTools.backups.delete")}
              >
                <AssetIcon name="delete" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
