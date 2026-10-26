import { SettingsSlider, SettingsToggle } from "../../../settings-ui/SettingsComponents";
import { loaderLabels } from "../helpers";
import { type LoaderId } from "../types";
import { JavaSettingsTab } from "../../JavaSettings";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function ProfileSettingsModal({ ctx }: Props) {
  const {
    isProfileSettingsOpen,
    selectedProfile,
    closeProfileSettingsModal,
    tt,
    setProfileSettingsTab,
    profileSettingsTab,
    profileEffectiveSettings,
    patchProfileGameSettings,
    openChangeVersionModal,
    profileConflictsLoading,
    profileConflicts,
    applyConflictAction,
    systemMemoryGb,
    setProfileEffectiveSettings,
    scheduleProfileRamSave,
    commitProfileRamSaveNow,
    language,
    showNotification,
  } = ctx;

  return (
    <>
      {isProfileSettingsOpen && selectedProfile && (
        <div
          className="glass-overlay fixed inset-0 z-50 flex items-center justify-center"
          onClick={closeProfileSettingsModal}
        >
          <div
            className="glass-modal w-full max-w-3xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-white/50">
                  {tt("modpacks.profileSettingsModal.title")}
                </div>
                <div className="truncate text-lg font-semibold text-white">
                  {selectedProfile.name}
                </div>
              </div>
              <button
                type="button"
                className="interactive-press rounded-xl bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/20"
                onClick={closeProfileSettingsModal}
              >
                {tt("common.close")}
              </button>
            </div>

            <div className="mb-4 flex items-center gap-1 seg-track p-1">
              <button
                type="button"
                onClick={() => setProfileSettingsTab("general")}
                className={`interactive-press flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                  profileSettingsTab === "general"
                    ? "seg-on"
                    : "text-white/70 hover:text-white"
                }`}
              >
                {tt("modpacks.profileSettingsModal.general")}
              </button>
              <button
                type="button"
                onClick={() => setProfileSettingsTab("java")}
                className={`interactive-press flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                  profileSettingsTab === "java"
                    ? "seg-on"
                    : "text-white/70 hover:text-white"
                }`}
              >
                Java
              </button>
            </div>

            {profileSettingsTab === "general" ? (
              <div className="max-h-[420px] overflow-y-auto pr-1">
                <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
                  <div className="mb-3 text-xs text-white/60">
                    {tt("modpacks.profileSettingsModal.hint")}
                  </div>
                  <div className="flex flex-col gap-4">
                    <SettingsToggle
                      label={
                        tt("modpacks.profileSettingsModal.closeLauncherOnStart")
                      }
                      yesLabel={tt("common.yes")}
                      noLabel={tt("common.no")}
                      value={profileEffectiveSettings?.close_launcher_on_game_start ?? false}
                      onChange={(value: boolean) =>
                        void patchProfileGameSettings(selectedProfile.id, {
                          close_launcher_on_game_start: value,
                        })
                      }
                    />
                    <SettingsToggle
                      label={
                        tt("modpacks.profileSettingsModal.checkGameProcesses")
                      }
                      yesLabel={tt("common.yes")}
                      noLabel={tt("common.no")}
                      value={profileEffectiveSettings?.check_game_processes ?? true}
                      onChange={(value: boolean) =>
                        void patchProfileGameSettings(selectedProfile.id, {
                          check_game_processes: value,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
                  <div className="mb-2 text-xs font-medium text-white/70">
                    {tt("modpacks.changeVersion.currentVersion")}
                  </div>
                  <div className="mb-3 text-sm text-white/90">
                    {selectedProfile.game_version}
                    {selectedProfile.loader !== "vanilla" && (
                      <span className="text-white/60">
                        {" "}
                        · {loaderLabels[selectedProfile.loader as LoaderId] ?? selectedProfile.loader}
                        {selectedProfile.loader_version
                          ? ` ${selectedProfile.loader_version}`
                          : ""}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={openChangeVersionModal}
                    className="interactive-press w-full rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
                  >
                    {tt("modpacks.changeVersion.button")}
                  </button>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-white/70">
                      <span>{tt("modpacks.conflicts.title")}</span>
                      <span className="rounded-md border border-amber-300/40 bg-amber-500/15 px-2 py-0.5 text-[0.6875rem] font-semibold tracking-[0.14em] text-amber-100">
                        BETA
                      </span>
                    </div>
                    <div className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[0.75rem] font-semibold text-white/70">
                      {profileConflictsLoading
                        ? tt("modpacks.conflicts.loading")
                        : tt("modpacks.conflicts.count", { count: profileConflicts.length })}
                    </div>
                  </div>

                  {!profileConflictsLoading && profileConflicts.length === 0 ? (
                    <div className="text-xs text-white/60">
                      {tt("modpacks.conflicts.none")}
                    </div>
                  ) : null}

                  {profileConflicts.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {profileConflicts.map((c) => (
                        <div
                          key={c.id}
                          className={`rounded-2xl border px-3 py-2 text-xs ${
                            c.severity === "error"
                              ? "border-rose-400/30 bg-rose-500/10"
                              : "border-amber-400/25 bg-amber-500/10"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-white/90">{c.title}</div>
                              <div className="mt-0.5 text-[0.8125rem] text-white/65">{c.reason}</div>
                            </div>
                            <div
                              className={`shrink-0 rounded-md px-2 py-0.5 text-[0.75rem] font-semibold ${
                                c.severity === "error"
                                  ? "bg-rose-500/30 text-rose-100"
                                  : "bg-amber-500/30 text-amber-100"
                              }`}
                            >
                              {c.severity === "error"
                                ? tt("modpacks.conflicts.severity.error")
                                : tt("modpacks.conflicts.severity.warning")}
                            </div>
                          </div>

                          {c.affected.length > 0 ? (
                            <div className="mt-2 rounded-xl bg-black/25 px-2 py-1.5">
                              <div className="text-[0.75rem] text-white/45">
                                {tt("modpacks.conflicts.affected")}
                              </div>
                              <div className="mt-1 flex flex-col gap-0.5">
                                {c.affected.map((f) => (
                                  <div key={f} className="truncate text-[0.8125rem] text-white/75">
                                    {f}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {c.solutions.length > 0 ? (
                            <div className="mt-2">
                              <div className="text-[0.75rem] text-white/45">
                                {tt("modpacks.conflicts.solutions")}
                              </div>
                              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[0.8125rem] text-white/75">
                                {c.solutions.map((s) => (
                                  <li key={s}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {c.actions && c.actions.length > 0 && selectedProfile ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {c.actions.map((a) => (
                                <button
                                  key={a.id}
                                  type="button"
                                  className="interactive-press rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-[0.8125rem] font-semibold text-white/85 hover:bg-white/15"
                                  onClick={() => {
                                    void applyConflictAction(c, {
                                      kind: a.kind,
                                      keep: a.keep,
                                      targets: a.targets,
                                    });
                                  }}
                                >
                                  {a.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
                  <SettingsSlider
                    label={tt("modpacks.profileSettingsModal.memoryRam")}
                    min={1}
                    max={Math.max(64, systemMemoryGb)}
                    value={Math.max(
                      1,
                      Math.round((profileEffectiveSettings?.ram_mb ?? 4096) / 1024),
                    )}
                    onChange={(value: number) => {
                      const ramMb = Math.max(1, value) * 1024;
                      setProfileEffectiveSettings((prev) =>
                        prev ? { ...prev, ram_mb: ramMb } : prev,
                      );
                      scheduleProfileRamSave(selectedProfile.id, ramMb);
                    }}
                    onChangeCommitted={(value: number) =>
                      commitProfileRamSaveNow(selectedProfile.id, Math.max(1, value) * 1024)
                    }
                    right={
                      <span className="text-sm font-semibold text-white/90">
                        {tt("settings.game.ram.gbValue", {
                          gb: Math.max(
                            1,
                            Math.round((profileEffectiveSettings?.ram_mb ?? 4096) / 1024),
                          ),
                        })}
                      </span>
                    }
                  />
                </div>
              </div>
            ) : (
              <JavaSettingsTab
                language={language}
                systemMemoryGb={systemMemoryGb}
                showNotification={showNotification}
                profileId={selectedProfile.id}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
