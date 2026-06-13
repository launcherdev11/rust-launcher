import type { TabDropZone } from "../splitView";

type TabSplitDropOverlayProps = {
  zone: TabDropZone | null;
  labels: Record<TabDropZone, string>;
};

const ZONE_CLASS: Record<TabDropZone, string> = {
  left: "tab-split-zone-left",
  right: "tab-split-zone-right",
  top: "tab-split-zone-top",
  bottom: "tab-split-zone-bottom",
  center: "tab-split-zone-center",
};

export function TabSplitDropOverlay({ zone, labels }: TabSplitDropOverlayProps) {
  const zones: TabDropZone[] = ["left", "right", "top", "bottom", "center"];
  return (
    <div className="tab-split-drop-overlay pointer-events-none absolute inset-0 z-40">
      {zones.map((z) => (
        <div
          key={z}
          className={[
            "tab-split-zone",
            ZONE_CLASS[z],
            zone === z ? "tab-split-zone-active" : "",
          ].join(" ")}
        >
          <span className="tab-split-zone-label">{labels[z]}</span>
        </div>
      ))}
    </div>
  );
}
