import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { SplittableTabId, TabSplitLayout } from "../../splitView";
import { CloseIcon } from "../icons";
import type { Tt } from "../types";

type Props = {
  layout: TabSplitLayout;
  tt: Tt;
  dividerDragging: boolean;
  onDividerPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onLayoutChange: (layout: TabSplitLayout) => void;
  onFocusTab: (tab: SplittableTabId) => void;
  onDismissPane: (role: "primary" | "secondary") => void;
  renderPane: (tab: SplittableTabId) => ReactNode;
};

export function TabSplitPanes({
  layout,
  tt,
  dividerDragging,
  onDividerPointerDown,
  onLayoutChange,
  onFocusTab,
  onDismissPane,
  renderPane,
}: Props) {
  return (
    <div
      className={`tab-split-main tab-animate min-h-0 w-full flex-1 ${
        layout.direction === "horizontal"
          ? "tab-split-main-horizontal"
          : "tab-split-main-vertical"
      }`}
    >
      <div
        className={`tab-split-pane ${
          layout.focused !== "primary" ? "tab-split-pane-inactive" : ""
        }`}
        style={{ flexGrow: layout.ratio, flexBasis: 0 }}
        onPointerDown={() => {
          if (layout.focused !== "primary") {
            onLayoutChange({ ...layout, focused: "primary" });
            onFocusTab(layout.primary);
          }
        }}
      >
        <button
          type="button"
          className="tab-split-pane-close interactive-press no-shift"
          title={tt("app.splitView.closePane")}
          aria-label={tt("app.splitView.closePane")}
          onClick={(e) => {
            e.stopPropagation();
            onDismissPane("primary");
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CloseIcon />
        </button>
        <div className="tab-split-pane-inner">
          {renderPane(layout.primary)}
        </div>
      </div>
      <div
        role="separator"
        aria-orientation={
          layout.direction === "horizontal" ? "vertical" : "horizontal"
        }
        aria-valuenow={Math.round(layout.ratio * 100)}
        className={[
          "tab-split-divider",
          layout.direction === "horizontal"
            ? "tab-split-divider-horizontal"
            : "tab-split-divider-vertical",
          dividerDragging ? "tab-split-divider-dragging" : "",
        ].join(" ")}
        onPointerDown={onDividerPointerDown}
      />
      <div
        className={`tab-split-pane ${
          layout.focused !== "secondary" ? "tab-split-pane-inactive" : ""
        }`}
        style={{ flexGrow: 1 - layout.ratio, flexBasis: 0 }}
        onPointerDown={() => {
          if (layout.focused !== "secondary") {
            onLayoutChange({ ...layout, focused: "secondary" });
            onFocusTab(layout.secondary);
          }
        }}
      >
        <button
          type="button"
          className="tab-split-pane-close interactive-press no-shift"
          title={tt("app.splitView.closePane")}
          aria-label={tt("app.splitView.closePane")}
          onClick={(e) => {
            e.stopPropagation();
            onDismissPane("secondary");
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CloseIcon />
        </button>
        <div className="tab-split-pane-inner">
          {renderPane(layout.secondary)}
        </div>
      </div>
    </div>
  );
}
