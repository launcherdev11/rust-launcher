import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n";
import {
  getLauncherPluginIcon,
  getPluginsDirectory,
  listLauncherPlugins,
  openPluginsFolder,
  reloadLauncherPlugins,
  setLauncherPluginEnabled,
} from "./api";
import type { LauncherPluginInfo } from "./types";

type PluginsManagerProps = {
  language: import("../../i18n").Language;
  showNotification: (
    kind: "info" | "success" | "error" | "warning",
    message: string,
  ) => void;
  onPluginsChanged?: (plugins: LauncherPluginInfo[]) => void;
  compact?: boolean;
};

export function PluginsManager({
  language,
  showNotification,
  onPluginsChanged,
  compact = false,
}: PluginsManagerProps) {
  const tt = useT(language);
  const [plugins, setPlugins] = useState<LauncherPluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pluginsDir, setPluginsDir] = useState("");
  const [icons, setIcons] = useState<Record<string, string | null>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await reloadLauncherPlugins();
      setPlugins(list);
      onPluginsChanged?.(list);

      const iconEntries = await Promise.all(
        list
          .filter((p) => p.hasIcon)
          .map(async (p) => [p.id, await getLauncherPluginIcon(p.id)] as const),
      );
      setIcons(Object.fromEntries(iconEntries));
    } catch (err) {
      showNotification("error", String(err));
    } finally {
      setLoading(false);
    }
  }, [onPluginsChanged, showNotification]);

  useEffect(() => {
    void (async () => {
      try {
        const dir = await getPluginsDirectory();
        setPluginsDir(dir);
        const list = await listLauncherPlugins();
        setPlugins(list);
        onPluginsChanged?.(list);
      } catch (err) {
        showNotification("error", String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [onPluginsChanged, showNotification]);

  const toggleEnabled = async (plugin: LauncherPluginInfo) => {
    try {
      const updated = await setLauncherPluginEnabled(plugin.id, !plugin.enabled);
      setPlugins((prev) => prev.map((p) => (p.id === plugin.id ? updated : p)));
      onPluginsChanged?.(
        plugins.map((p) => (p.id === plugin.id ? updated : p)),
      );
      showNotification(
        "success",
        updated.enabled
          ? tt("plugins.enabled", { name: plugin.name })
          : tt("plugins.disabled", { name: plugin.name }),
      );
      await refresh();
    } catch (err) {
      showNotification("error", String(err));
    }
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-white/55">
            {tt("plugins.folderHint")}
          </p>
          {pluginsDir ? (
            <p className="mt-1 break-all font-mono text-[11px] text-white/40">{pluginsDir}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void openPluginsFolder()}
            className="interactive-press rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-white/40 hover:text-white"
          >
            {tt("plugins.openFolder")}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="interactive-press rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-white/40 hover:text-white"
          >
            {tt("plugins.reload")}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-white/50">{tt("common.loading")}</p>
      ) : plugins.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-black/15 p-4 text-sm text-white/55">
          <p>{tt("plugins.empty")}</p>
          <p className="mt-2 text-xs text-white/40">{tt("plugins.emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="rounded-2xl border border-white/10 bg-black/20 p-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10">
                  {icons[plugin.id] ? (
                    <img src={icons[plugin.id]!} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-white/50">
                      {plugin.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-semibold text-white">{plugin.name}</h4>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
                      v{plugin.version}
                    </span>
                    {plugin.loadError ? (
                      <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-200">
                        {tt("plugins.error")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-white/45">
                    {plugin.description || tt("plugins.noDescription")}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    {plugin.author ? `${plugin.author} · ` : ""}
                    <span className="font-mono">{plugin.id}</span>
                  </p>
                  {plugin.loadError ? (
                    <p className="mt-2 text-xs text-red-300/80">{plugin.loadError}</p>
                  ) : null}
                  {plugin.hooks.length > 0 ? (
                    <p className="mt-2 text-[11px] text-white/35">
                      {tt("plugins.hooks")}: {plugin.hooks.join(", ")}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={!!plugin.loadError}
                  onClick={() => void toggleEnabled(plugin)}
                  className={[
                    "interactive-press shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                    plugin.enabled && !plugin.loadError
                      ? "bg-emerald-500/90 text-white hover:bg-emerald-500"
                      : "border border-white/25 text-white/75 hover:border-white/40 hover:text-white",
                    plugin.loadError ? "opacity-40" : "",
                  ].join(" ")}
                >
                  {plugin.enabled ? tt("plugins.disable") : tt("plugins.enable")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
