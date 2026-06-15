export type PluginUiConfig = {
  sidebar: boolean;
  sidebarLabel?: string | null;
  sidebarOrder?: number | null;
  settingsSection: boolean;
};

export type LauncherPluginInfo = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string | null;
  enabled: boolean;
  hasEntry: boolean;
  entry?: string | null;
  hooks: string[];
  permissions: string[];
  ui: PluginUiConfig;
  config: Record<string, unknown>;
  path: string;
  hasIcon: boolean;
  loadError?: string | null;
};

export type PluginLaunchOverrides = {
  jvm_args_append?: string[];
  game_args_append?: string[];
};

export type PreLaunchEventPayload = {
  profileId?: string | null;
  versionId: string;
  jvmArgs: string[];
  gameArgs: string[];
};

export type PostLaunchEventPayload = {
  profileId?: string | null;
  versionId: string;
  pid: number;
};

export type PluginSidebarItem = {
  id: string;
  pluginId: string;
  label: string;
  iconDataUri?: string | null;
  order: number;
};

export const PLUGIN_SIDEBAR_PREFIX = "plugin:";

export function pluginSidebarId(pluginId: string): string {
  return `${PLUGIN_SIDEBAR_PREFIX}${pluginId}`;
}

export function parsePluginSidebarId(id: string): string | null {
  if (!id.startsWith(PLUGIN_SIDEBAR_PREFIX)) return null;
  return id.slice(PLUGIN_SIDEBAR_PREFIX.length);
}

export function isPluginSidebarId(id: string): boolean {
  return id.startsWith(PLUGIN_SIDEBAR_PREFIX);
}
