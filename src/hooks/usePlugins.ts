import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getPluginSidebarItems,
  initializePlugins,
  listLauncherPlugins,
  shutdownPlugins,
  type LauncherPluginInfo,
  type PluginNotificationKind,
} from "../features/plugins";

type UsePluginsOptions = {
  showNotification?: (kind: PluginNotificationKind, message: string) => void;
};

export function usePlugins({ showNotification }: UsePluginsOptions = {}) {
  const [plugins, setPlugins] = useState<LauncherPluginInfo[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    await shutdownPlugins();
    const list = await listLauncherPlugins();
    setPlugins(list);
    await initializePlugins(list, showNotification);
    setReady(true);
    return list;
  }, [showNotification]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listLauncherPlugins();
        if (cancelled) return;
        setPlugins(list);
        await initializePlugins(list, showNotification);
        if (!cancelled) setReady(true);
      } catch (err) {
        console.error("[usePlugins]", err);
      }
    })();
    return () => {
      cancelled = true;
      void shutdownPlugins();
    };
  }, [showNotification]);

  const sidebarItems = useMemo(() => getPluginSidebarItems(plugins), [plugins]);

  return {
    plugins,
    ready,
    sidebarItems,
    reloadPlugins: reload,
    setPlugins,
  };
}
