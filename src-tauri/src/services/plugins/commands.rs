use serde_json::Value;
use tauri::command;

use crate::app::paths;
use crate::models::plugin::{PluginInfo, PluginLaunchOverrides};
use crate::services::plugins::registry::{
    get_plugin_config, list_plugins, read_plugin_icon_data_uri, read_plugin_script,
    set_launch_overrides, set_plugin_config, set_plugin_enabled,
};

#[command]
pub fn list_launcher_plugins() -> Result<Vec<PluginInfo>, String> {
    list_plugins()
}

#[command]
pub fn get_plugins_directory() -> Result<String, String> {
    paths::plugins_dir().map(|p| p.to_string_lossy().to_string())
}

#[command]
pub async fn open_plugins_folder() -> Result<(), String> {
    let dir = paths::plugins_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось создать папку plugins: {e}"))?;
    let path_str = dir
        .to_str()
        .ok_or_else(|| "Путь к папке plugins не в UTF-8".to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть проводник: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
    }

    Ok(())
}

#[command]
pub fn set_launcher_plugin_enabled(plugin_id: String, enabled: bool) -> Result<PluginInfo, String> {
    set_plugin_enabled(&plugin_id, enabled)
}

#[command]
pub fn get_launcher_plugin_config(plugin_id: String) -> Result<Value, String> {
    get_plugin_config(&plugin_id)
}

#[command]
pub fn set_launcher_plugin_config(plugin_id: String, config: Value) -> Result<PluginInfo, String> {
    set_plugin_config(&plugin_id, config)
}

#[command]
pub fn read_launcher_plugin_script(plugin_id: String) -> Result<String, String> {
    read_plugin_script(&plugin_id)
}

#[command]
pub fn get_launcher_plugin_icon(plugin_id: String) -> Result<Option<String>, String> {
    read_plugin_icon_data_uri(&plugin_id)
}

#[command]
pub fn set_launcher_plugin_launch_overrides(
    plugin_id: String,
    overrides: PluginLaunchOverrides,
) -> Result<(), String> {
    set_launch_overrides(&plugin_id, overrides)
}

#[command]
pub fn reload_launcher_plugins() -> Result<Vec<PluginInfo>, String> {
    list_plugins()
}
