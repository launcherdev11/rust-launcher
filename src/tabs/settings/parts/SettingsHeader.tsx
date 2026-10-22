import { playTabSwitchSound } from "../../../uiSounds";
import { AssetIcon } from "../../../components/asset_icon";
import { Search } from "lucide-react";
import { InputClearButton } from "../../../components/ui";
import type { SettingsController } from "../useSettingsController";

type Props = { ctx: SettingsController };

export function SettingsHeader({ ctx }: Props) {
  const {
    settingsIndicator,
    settingsTabs,
    settingsTab,
    tabMatchCounts,
    settingsTabRefs,
    settings,
    setSettingsTab,
    settingsSearch,
    setSettingsSearch,
    tt,
  } = ctx;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div
          role="tablist"
          className="seg-track relative flex items-center overflow-hidden p-1"
        >
          <div
            className="seg-indicator pointer-events-none absolute bottom-1 top-1 rounded-lg transition-all duration-200 ease-out"
            style={{
              left: `${settingsIndicator.left}px`,
              width: `${settingsIndicator.width}px`,
            }}
          />
          {settingsTabs.map((tab) => {
            const active = settingsTab === tab.id;
            const count = tabMatchCounts?.[tab.id] ?? null;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                ref={(el) => {
                  settingsTabRefs.current[tab.id] = el;
                }}
                onClick={() => {
                  if ((settings?.ui_sounds_enabled ?? true) && settingsTab !== tab.id) {
                    playTabSwitchSound();
                  }
                  setSettingsTab(tab.id);
                }}
                className={`interactive-press relative z-10 flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[0.8125rem] font-semibold transition-colors ${
                  active
                    ? "text-white"
                    : count === 0
                      ? "text-white/35 hover:text-white/60"
                      : "text-white/65 hover:text-white"
                }`}
              >
                <AssetIcon name={tab.icon} />
                <span>{tab.label}</span>
                {count != null && count > 0 && (
                  <span className="rounded-md bg-white/10 px-1.5 text-[0.6875rem] leading-5 text-white/80">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <label className="glass-toolbar flex min-w-[14rem] flex-1 items-center gap-3 px-3.5 py-2 sm:ml-auto sm:max-w-sm">
          <Search className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
          <input
            type="search"
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSettingsSearch("");
            }}
            placeholder={tt("settings.search.placeholder")}
            className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
            aria-label={tt("settings.search.placeholder")}
          />
          <InputClearButton
            value={settingsSearch}
            onClear={() => setSettingsSearch("")}
            aria-label={tt("common.clear")}
          />
        </label>
      </div>
    </>
  );
}
