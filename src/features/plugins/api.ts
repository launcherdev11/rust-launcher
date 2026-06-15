import { invoke } from "@tauri-apps/api/core";
import type { LauncherPluginInfo, PluginLaunchOverrides } from "./types";

export function listLauncherPlugins(): Promise<LauncherPluginInfo[]> {
  return invoke<LauncherPluginInfo[]>("list_launcher_plugins");
}

export function getPluginsDirectory(): Promise<string> {
  return invoke<string>("get_plugins_directory");
}

export function openPluginsFolder(): Promise<void> {
  return invoke("open_plugins_folder");
}

export function setLauncherPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<LauncherPluginInfo> {
  return invoke<LauncherPluginInfo>("set_launcher_plugin_enabled", { pluginId, enabled });
}

export function getLauncherPluginConfig(
  pluginId: string,
): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("get_launcher_plugin_config", { pluginId });
}

export function setLauncherPluginConfig(
  pluginId: string,
  config: Record<string, unknown>,
): Promise<LauncherPluginInfo> {
  return invoke<LauncherPluginInfo>("set_launcher_plugin_config", { pluginId, config });
}

export function readLauncherPluginScript(pluginId: string): Promise<string> {
  return invoke<string>("read_launcher_plugin_script", { pluginId });
}

export function getLauncherPluginIcon(pluginId: string): Promise<string | null> {
  return invoke<string | null>("get_launcher_plugin_icon", { pluginId });
}

export function setLauncherPluginLaunchOverrides(
  pluginId: string,
  overrides: PluginLaunchOverrides,
): Promise<void> {
  return invoke("set_launcher_plugin_launch_overrides", { pluginId, overrides });
}

export function reloadLauncherPlugins(): Promise<LauncherPluginInfo[]> {
  return invoke<LauncherPluginInfo[]>("reload_launcher_plugins");
}
