import { useEffect, useRef } from "react";
import { getLoadedPluginPanel } from "./registry";

type PluginHostProps = {
  pluginId: string;
  fillPane?: boolean;
};

export function PluginHost({ pluginId, fillPane = false }: PluginHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    const panel = getLoadedPluginPanel(pluginId);
    if (!panel) {
      container.innerHTML =
        '<p class="text-sm text-white/50">Плагин не зарегистрировал панель интерфейса.</p>';
      return;
    }

    let cleanup: void | (() => void);
    try {
      cleanup = panel.render(container);
    } catch (err) {
      console.error(`[PluginHost] Ошибка render для ${pluginId}:`, err);
      container.innerHTML =
        '<p class="text-sm text-red-300/80">Ошибка отображения плагина. См. консоль.</p>';
      return;
    }

    return () => {
      if (typeof cleanup === "function") cleanup();
      panel.destroy?.();
      container.innerHTML = "";
    };
  }, [pluginId]);

  return (
    <div
      className={
        fillPane
          ? "tab-pane-fill px-4 py-3"
          : "flex min-h-0 w-full flex-1 flex-col gap-4 overflow-auto self-stretch px-4 py-4"
      }
    >
      <div ref={containerRef} className="plugin-host min-h-0 flex-1" />
    </div>
  );
}
