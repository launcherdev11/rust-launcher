import { ChevronDown } from "lucide-react";
import { loaderLabels } from "../helpers";
import { type LoaderId } from "../types";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function ChangeVersionModal({ ctx }: Props) {
  const {
    isChangeVersionOpen,
    selectedProfile,
    closeChangeVersionModal,
    tt,
    ensureMigrateVersionsLoaded,
    setIsMigrateVersionDropdownOpen,
    migrateBusy,
    migrateVersionsLoading,
    migrateGameVersion,
    isMigrateVersionDropdownOpen,
    migrateVersionOptions,
    setMigrateGameVersion,
    migrateAllVersions,
    setMigrateAllVersions,
    migrateLoaderVersionOptions,
    loadMigrateLoaderVersions,
    setIsMigrateLoaderVersionDropdownOpen,
    migrateLoaderVersionsLoading,
    migrateLoaderVersion,
    isMigrateLoaderVersionDropdownOpen,
    setMigrateLoaderVersion,
    loaderChannelLabel,
    backupBeforeVersionChange,
    setBackupBeforeVersionChange,
    handleChangeProfileVersion,
  } = ctx;

  return (
    <>
      {isChangeVersionOpen && selectedProfile && (
        <div
          className="glass-overlay fixed inset-0 z-[60] flex items-center justify-center"
          onClick={closeChangeVersionModal}
        >
          <div
            className="glass-modal w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <div className="text-xs text-white/50">
                {tt("modpacks.changeVersion.title")}
              </div>
              <div className="mt-1 text-sm text-white/70">
                {tt("modpacks.changeVersion.description")}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-white/70">
                  {tt("modpacks.changeVersion.gameVersionLabel")}
                </label>
                <div className="relative inline-flex w-full items-center justify-between rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white/90">
                  <button
                    type="button"
                    onClick={() => {
                      void ensureMigrateVersionsLoaded();
                      setIsMigrateVersionDropdownOpen((v) => !v);
                    }}
                    disabled={migrateBusy}
                    className="flex flex-1 items-center justify-between gap-2 text-left disabled:opacity-60"
                  >
                    <span className="truncate">
                      {migrateVersionsLoading
                        ? tt("modpacks.common.loading")
                        : migrateGameVersion || tt("modpacks.common.select")}
                    </span>
                    <ChevronDown className="h-3 w-3 text-white/60" />
                  </button>
                  {isMigrateVersionDropdownOpen && (
                    <div className="menu-pop-in origin-top absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto glass-popover p-1 text-xs">
                      {migrateVersionsLoading && (
                        <div className="px-3 py-2 text-white/60">
                          {tt("modpacks.common.loading")}
                        </div>
                      )}
                      {!migrateVersionsLoading &&
                        migrateVersionOptions.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              setMigrateGameVersion(v.id);
                              setIsMigrateVersionDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                              migrateGameVersion === v.id
                                ? "seg-on"
                                : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            <span>{v.id}</span>
                            <span className="ml-2 text-[0.75rem] text-gray-400">
                              {v.version_type}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={migrateAllVersions}
                    onChange={(e) => setMigrateAllVersions(e.target.checked)}
                    disabled={migrateBusy}
                    className="accent-checkbox"
                  />
                  <span>{tt("modpacks.changeVersion.allVersions")}</span>
                </label>
              </div>

              {selectedProfile.loader !== "vanilla" && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-white/70">
                    {tt("modpacks.changeVersion.loaderVersionLabel")} (
                    {loaderLabels[selectedProfile.loader as LoaderId] ?? selectedProfile.loader})
                  </label>
                  <div className="relative inline-flex w-full items-center justify-between rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white/90">
                    <button
                      type="button"
                      onClick={() => {
                        if (migrateLoaderVersionOptions.length === 0) {
                          void loadMigrateLoaderVersions();
                        }
                        setIsMigrateLoaderVersionDropdownOpen((v) => !v);
                      }}
                      disabled={migrateBusy || migrateLoaderVersionsLoading}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:opacity-60"
                    >
                      <span className="truncate">
                        {migrateLoaderVersionsLoading
                          ? tt("modpacks.common.loading")
                          : migrateLoaderVersion || tt("modpacks.common.select")}
                      </span>
                      <ChevronDown className="h-3 w-3 shrink-0 text-white/60" />
                    </button>
                    {isMigrateLoaderVersionDropdownOpen && (
                      <div className="menu-pop-in origin-top absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto glass-popover p-1 text-xs">
                        {migrateLoaderVersionOptions.length === 0 &&
                          !migrateLoaderVersionsLoading && (
                            <div className="px-3 py-2 text-white/60">
                              {tt("modpacks.common.select")}
                            </div>
                          )}
                        {migrateLoaderVersionOptions.map((o) => (
                          <button
                            key={o.version}
                            type="button"
                            onClick={() => {
                              setMigrateLoaderVersion(o.version);
                              setIsMigrateLoaderVersionDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                              migrateLoaderVersion === o.version
                                ? "seg-on"
                                : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            <span>{o.version}</span>
                            {o.channel && (
                              <span className="ml-2 text-[0.75rem] text-gray-400">
                                {loaderChannelLabel(o.channel)}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <label className="mt-4 flex items-start gap-2 text-xs text-white/80">
              <input
                type="checkbox"
                checked={backupBeforeVersionChange}
                onChange={(e) => setBackupBeforeVersionChange(e.target.checked)}
                disabled={migrateBusy}
                className="mt-0.5 accent-checkbox"
              />
              <span>
                <span className="font-semibold">{tt("modpacks.editor.backupBeforeChange")}</span>
                <span className="mt-0.5 block text-white/50">
                  {tt("modpacks.editor.backupBeforeChangeHint")}
                </span>
              </span>
            </label>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeChangeVersionModal}
                disabled={migrateBusy}
                className="interactive-press rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {tt("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleChangeProfileVersion()}
                disabled={migrateBusy || !migrateGameVersion}
                className="interactive-press rounded-xl accent-bg px-4 py-2 text-sm font-semibold text-white shadow-soft hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {migrateBusy
                  ? tt("modpacks.changeVersion.migrating")
                  : tt("modpacks.changeVersion.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
