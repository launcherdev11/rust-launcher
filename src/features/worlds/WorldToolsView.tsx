import { useState } from "react";
import type { Language } from "../../i18n";
import { ChunkMapTab } from "./ChunkMapTab";
import { WorldBackupsTab } from "./WorldBackupsTab";

type Tt = (key: string, vars?: Record<string, string | number>) => string;
type Notify = (kind: "info" | "success" | "error" | "warning", message: string) => void;

type Tab = "backups" | "map";

export function WorldToolsView({
  profileId,
  world,
  language,
  gameRunning,
  tt,
  showNotification,
  onBack,
  onWorldChanged,
}: {
  profileId: string;
  world: string;
  language: Language;
  gameRunning: boolean;
  tt: Tt;
  showNotification: Notify;
  onBack: () => void;
  onWorldChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("backups");

  return (
    <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="btn btn-sm btn-ghost">
          <img src="/launcher-assets/back.svg" alt="" className="h-3.5 w-3.5 opacity-80" />
          {tt("worldTools.back")}
        </button>
        <div className="min-w-0 flex-1 truncate text-base font-semibold text-white" title={world}>
          {world}
        </div>
        <div className="seg-track flex rounded-xl p-0.5 text-[0.8125rem]">
          {(["backups", "map"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1 font-semibold ${tab === t ? "seg-on" : "text-white/60"}`}
            >
              {tt(`worldTools.tab.${t}`)}
            </button>
          ))}
        </div>
      </div>
      {tab === "backups" ? (
        <WorldBackupsTab
          profileId={profileId}
          world={world}
          language={language}
          gameRunning={gameRunning}
          tt={tt}
          showNotification={showNotification}
          onRestored={onWorldChanged}
        />
      ) : (
        <ChunkMapTab
          profileId={profileId}
          world={world}
          language={language}
          gameRunning={gameRunning}
          tt={tt}
          showNotification={showNotification}
        />
      )}
    </div>
  );
}
