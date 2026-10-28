import { Search } from "lucide-react";
import { ReinstallDialog } from "./settings/parts/ReinstallDialog";
import { DeleteDialogs } from "./settings/parts/DeleteDialogs";
import { RepairPromptDialog } from "./settings/parts/RepairPromptDialog";
import { SettingsHeader } from "./settings/parts/SettingsHeader";
import { GameSection } from "./settings/parts/GameSection";
import { VersionsSection } from "./settings/parts/VersionsSection";
import { LauncherSection } from "./settings/parts/LauncherSection";
import { useSettingsController } from "./settings/useSettingsController";
import type { SettingsTabProps } from "./settings/types";

export function SettingsTab(props: SettingsTabProps) {
  const ctx = useSettingsController(props);
  const {
    fillPane,
    settingsSearchActive,
    searchHasAnyMatches,
    searchHasMatchesOnTab,
    tt,
  } = ctx;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <ReinstallDialog ctx={ctx} />
      <DeleteDialogs ctx={ctx} />
      <RepairPromptDialog ctx={ctx} />
      <div
        className={`settings-shell flex min-h-0 w-full flex-1 flex-col ${fillPane ? "px-1 py-1" : "px-4 py-4"}`}
      >
        <div
          className={`settings-frame flex min-h-0 flex-1 flex-col gap-3 ${
            fillPane ? "settings-frame-fill" : ""
          }`}
        >
          <SettingsHeader ctx={ctx} />

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
            {settingsSearchActive && (!searchHasAnyMatches || !searchHasMatchesOnTab) ? (
              <div className="glass-panel px-6 py-10 text-center">
                <Search className="mx-auto mb-3 h-5 w-5 text-white/30" aria-hidden />
                <p className="ui-meta">{tt("settings.search.noResults")}</p>
              </div>
            ) : (
              <div className="settings-flow pb-1" data-tab={ctx.settingsTab}>
                <GameSection ctx={ctx} />

                <VersionsSection ctx={ctx} />

                <LauncherSection ctx={ctx} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
