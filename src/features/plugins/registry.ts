import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  LauncherPluginInfo,
  PostLaunchEventPayload,
  PreLaunchEventPayload,
} from "./types";
import {
  getLauncherPluginConfig,
  readLauncherPluginScript,
  setLauncherPluginConfig,
  setLauncherPluginLaunchOverrides,
} from "./api";

export const PLUGIN_EVENTS = {
  preLaunch: "plugin:pre-launch",
  postLaunch: "plugin:post-launch",
  launcherReady: "plugin:launcher-ready",
} as const;

export type PluginNotificationKind = "info" | "success" | "error" | "warning";

export type PluginApiContext = {
  plugin: LauncherPluginInfo;
  showNotification?: (kind: PluginNotificationKind, message: string) => void;
};

export type PluginPanelRegistration = {
  render: (container: HTMLElement) => void | (() => void);
  destroy?: () => void;
};

type HookHandler = (payload: unknown, api: PluginRuntimeApi) => void | Promise<void>;

export type PluginRuntimeApi = {
  id: string;
  name: string;
  version: string;
  config: Record<string, unknown>;
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  getConfig: () => Promise<Record<string, unknown>>;
  setConfig: (config: Record<string, unknown>) => Promise<void>;
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  on: (event: string, handler: HookHandler) => () => void;
  setLaunchOverrides: (overrides: {
    jvmArgsAppend?: string[];
    gameArgsAppend?: string[];
  }) => Promise<void>;
  registerPanel: (registration: PluginPanelRegistration) => void;
  log: (...args: unknown[]) => void;
};

type LoadedPlugin = {
  info: LauncherPluginInfo;
  api: PluginRuntimeApi;
  panel?: PluginPanelRegistration;
  unlisteners: UnlistenFn[];
};

const loadedPlugins = new Map<string, LoadedPlugin>();

function createPluginApi(ctx: PluginApiContext): PluginRuntimeApi {
  const hookHandlers = new Map<string, Set<HookHandler>>();
  let panelRegistration: PluginPanelRegistration | undefined;

  const api: PluginRuntimeApi = {
    id: ctx.plugin.id,
    name: ctx.plugin.name,
    version: ctx.plugin.version,
    config: { ...ctx.plugin.config },
    permissions: [...ctx.plugin.permissions],

    hasPermission(permission: string) {
      return ctx.plugin.permissions.includes(permission);
    },

    async getConfig() {
      const config = await getLauncherPluginConfig(ctx.plugin.id);
      api.config = config;
      return config;
    },

    async setConfig(config: Record<string, unknown>) {
      if (!api.hasPermission("write_plugin_config")) {
        throw new Error(`Плагин «${ctx.plugin.id}» не имеет разрешения write_plugin_config`);
      }
      const updated = await setLauncherPluginConfig(ctx.plugin.id, config);
      api.config = updated.config;
      ctx.plugin.config = updated.config;
    },

    invoke<T = unknown>(command: string, args?: Record<string, unknown>) {
      return invoke<T>(command, args ?? {});
    },

    on(event: string, handler: HookHandler) {
      if (!hookHandlers.has(event)) {
        hookHandlers.set(event, new Set());
      }
      hookHandlers.get(event)!.add(handler);
      return () => {
        hookHandlers.get(event)?.delete(handler);
      };
    },

    async setLaunchOverrides(overrides) {
      if (
        overrides.jvmArgsAppend?.length &&
        !api.hasPermission("modify_jvm_args")
      ) {
        throw new Error(`Плагин «${ctx.plugin.id}» не имеет разрешения modify_jvm_args`);
      }
      if (
        overrides.gameArgsAppend?.length &&
        !api.hasPermission("modify_game_args")
      ) {
        throw new Error(`Плагин «${ctx.plugin.id}» не имеет разрешения modify_game_args`);
      }
      await setLauncherPluginLaunchOverrides(ctx.plugin.id, {
        jvm_args_append: overrides.jvmArgsAppend,
        game_args_append: overrides.gameArgsAppend,
      });
    },

    registerPanel(registration: PluginPanelRegistration) {
      panelRegistration = registration;
    },

    log(...args: unknown[]) {
      console.log(`[Plugin:${ctx.plugin.id}]`, ...args);
    },
  };

  const dispatch = (event: string, payload: unknown) => {
    const handlers = hookHandlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      void Promise.resolve(handler(payload, api)).catch((err) => {
        console.error(`[Plugin:${ctx.plugin.id}] Ошибка в обработчике ${event}:`, err);
      });
    }
  };

  (api as PluginRuntimeApi & { _dispatch: typeof dispatch })._dispatch = dispatch;
  (api as PluginRuntimeApi & { _getPanel: () => PluginPanelRegistration | undefined })._getPanel =
    () => panelRegistration;

  return api;
}

function executePluginScript(_plugin: LauncherPluginInfo, api: PluginRuntimeApi, script: string) {
  const wrapped = `
    ${script}
    if (typeof register === 'function') {
      register(api);
    } else if (typeof onRegister === 'function') {
      onRegister(api);
    }
  `;
  // eslint-disable-next-line no-new-func
  const fn = new Function("api", wrapped);
  fn(api);
}

async function loadSinglePlugin(
  plugin: LauncherPluginInfo,
  ctx: PluginApiContext,
): Promise<LoadedPlugin | null> {
  if (!plugin.enabled || plugin.loadError) return null;

  const api = createPluginApi(ctx);
  const unlisteners: UnlistenFn[] = [];

  if (plugin.hasEntry && plugin.entry) {
    try {
      const script = await readLauncherPluginScript(plugin.id);
      executePluginScript(plugin, api, script);
    } catch (err) {
      console.error(`[Plugins] Не удалось загрузить ${plugin.id}:`, err);
      return null;
    }
  }

  const dispatch = (api as PluginRuntimeApi & { _dispatch?: (e: string, p: unknown) => void })
    ._dispatch;

  if (plugin.hooks.includes("launcher_ready") && dispatch) {
    dispatch("launcher_ready", { pluginId: plugin.id });
  }

  if (plugin.hooks.includes("pre_launch")) {
    unlisteners.push(
      await listen<PreLaunchEventPayload>(PLUGIN_EVENTS.preLaunch, (event) => {
        dispatch?.("pre_launch", event.payload);
      }),
    );
  }

  if (plugin.hooks.includes("post_launch")) {
    unlisteners.push(
      await listen<PostLaunchEventPayload>(PLUGIN_EVENTS.postLaunch, (event) => {
        dispatch?.("post_launch", event.payload);
      }),
    );
  }

  unlisteners.push(
    await listen(PLUGIN_EVENTS.launcherReady, () => {
      if (plugin.hooks.includes("launcher_ready")) {
        dispatch?.("launcher_ready", { pluginId: plugin.id });
      }
    }),
  );

  const panel = (
    api as PluginRuntimeApi & { _getPanel?: () => PluginPanelRegistration | undefined }
  )._getPanel?.();

  return { info: plugin, api, panel, unlisteners };
}

export async function initializePlugins(
  plugins: LauncherPluginInfo[],
  showNotification?: PluginApiContext["showNotification"],
): Promise<void> {
  await shutdownPlugins();

  for (const plugin of plugins) {
    const loaded = await loadSinglePlugin(plugin, { plugin, showNotification });
    if (loaded) {
      loadedPlugins.set(plugin.id, loaded);
    }
  }
}

export async function shutdownPlugins(): Promise<void> {
  for (const loaded of loadedPlugins.values()) {
    for (const unlisten of loaded.unlisteners) {
      unlisten();
    }
    loaded.panel?.destroy?.();
  }
  loadedPlugins.clear();
}

export function getLoadedPluginPanel(pluginId: string): PluginPanelRegistration | undefined {
  return loadedPlugins.get(pluginId)?.panel;
}

export function getLoadedPlugins(): LauncherPluginInfo[] {
  return Array.from(loadedPlugins.values()).map((p) => p.info);
}

export function getPluginSidebarItems(plugins: LauncherPluginInfo[]): {
  id: string;
  pluginId: string;
  label: string;
  order: number;
}[] {
  return plugins
    .filter((p) => p.enabled && !p.loadError && p.ui.sidebar)
    .map((p) => ({
      id: `plugin:${p.id}`,
      pluginId: p.id,
      label: p.ui.sidebarLabel?.trim() || p.name,
      order: p.ui.sidebarOrder ?? 100,
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
