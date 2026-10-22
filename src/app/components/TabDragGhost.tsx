import type { SplittableTabId } from "../../splitView";
import { SIDEBAR_ICON_PATHS } from "../sidebar";
import { PlayIcon, SettingsIcon } from "../icons";

type Props = {
  drag: { tab: SplittableTabId; x: number; y: number };
};

export function TabDragGhost({ drag: tabDrag }: Props) {
  return (
    <div
      className="tab-drag-ghost"
      style={{ left: tabDrag.x, top: tabDrag.y }}
      aria-hidden
    >
      {SIDEBAR_ICON_PATHS[tabDrag.tab] ? (
        <img
          src={SIDEBAR_ICON_PATHS[tabDrag.tab]}
          alt=""
          className="h-7 w-7 object-contain"
        />
      ) : (
        <>
          {tabDrag.tab === "play" && <PlayIcon />}
          {tabDrag.tab === "settings" && <SettingsIcon />}
        </>
      )}
    </div>
  );
}
