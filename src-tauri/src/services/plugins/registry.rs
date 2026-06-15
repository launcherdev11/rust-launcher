use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde_json::Value;

use crate::app::paths;
use crate::models::plugin::{
    PluginInfo, PluginLaunchOverrides, PluginManifest, PluginStateEntry, PluginsStateFile,
};
use crate::services::plugins::manifest;

static LAUNCH_OVERRIDES: Lazy<Mutex<HashMap<String, PluginLaunchOverrides>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn set_launch_overrides(plugin_id: &str, overrides: PluginLaunchOverrides) -> Result<(), String> {
    let mut guard = LAUNCH_OVERRIDES
        .lock()
        .map_err(|_| "Не удалось заблокировать launch overrides".to_string())?;
    guard.insert(plugin_id.to_string(), overrides);
    Ok(())
}

pub fn take_all_launch_overrides() -> HashMap<String, PluginLaunchOverrides> {
    let mut guard = LAUNCH_OVERRIDES.lock().ok();
    guard
        .as_mut()
        .map(|g| std::mem::take(&mut **g))
        .unwrap_or_default()
}

pub fn clear_launch_overrides() {
    if let Ok(mut guard) = LAUNCH_OVERRIDES.lock() {
        guard.clear();
    }
}

pub fn plugins_state_path() -> Result<PathBuf, String> {
    Ok(paths::launcher_data_dir()?.join("plugins-state.json"))
}

pub fn load_plugins_state() -> PluginsStateFile {
    let path = match plugins_state_path() {
        Ok(p) => p,
        Err(_) => return PluginsStateFile::default(),
    };
    if !path.is_file() {
        return PluginsStateFile::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_plugins_state(state: &PluginsStateFile) -> Result<(), String> {
    let path = plugins_state_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку состояния плагинов: {e}"))?;
    }
    let text = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Не удалось сериализовать plugins-state.json: {e}"))?;
    std::fs::write(&path, text)
        .map_err(|e| format!("Не удалось записать plugins-state.json: {e}"))
}

pub fn discover_plugin_dirs() -> Result<Vec<PathBuf>, String> {
    let root = paths::plugins_dir()?;
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Не удалось создать папку plugins: {e}"))?;

    let mut dirs = Vec::new();
    let entries = std::fs::read_dir(&root)
        .map_err(|e| format!("Не удалось прочитать папку plugins: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Ошибка чтения entry plugins: {e}"))?;
        let path = entry.path();
        if path.is_dir() && path.join("plugin.json").is_file() {
            dirs.push(path);
        }
    }

    dirs.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    Ok(dirs)
}

fn resolve_enabled(manifest: &PluginManifest, state: &PluginsStateFile) -> bool {
    state
        .plugins
        .get(&manifest.id)
        .map(|e| e.enabled)
        .unwrap_or(manifest.defaults.enabled)
}

fn resolve_config(manifest: &PluginManifest, state: &PluginsStateFile) -> Value {
    state
        .plugins
        .get(&manifest.id)
        .map(|e| e.config.clone())
        .unwrap_or_else(|| manifest.defaults.config.clone())
}

pub fn load_plugin_info(plugin_dir: &Path, state: &PluginsStateFile) -> PluginInfo {
    let path_str = plugin_dir.to_string_lossy().to_string();
    let icon_path = plugin_dir.join("icon.png");

    match manifest::read_manifest(plugin_dir) {
        Ok(manifest) => {
            let entry_rel = manifest.entry.as_deref();
            let has_entry = entry_rel
                .map(|e| plugin_dir.join(e).is_file())
                .unwrap_or(false);

            PluginInfo {
                id: manifest.id.clone(),
                name: manifest.name.clone(),
                version: manifest.version.clone(),
                description: manifest.description.clone(),
                author: manifest.author.clone(),
                homepage: manifest.homepage.clone(),
                enabled: resolve_enabled(&manifest, state),
                has_entry,
                entry: manifest.entry.clone(),
                hooks: manifest.hooks.clone(),
                permissions: manifest.permissions.clone(),
                ui: manifest.ui.clone(),
                config: resolve_config(&manifest, state),
                path: path_str,
                has_icon: icon_path.is_file(),
                load_error: None,
            }
        }
        Err(e) => {
            let folder_name = plugin_dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            PluginInfo {
                id: folder_name.clone(),
                name: folder_name,
                version: "?".to_string(),
                description: String::new(),
                author: String::new(),
                homepage: None,
                enabled: false,
                has_entry: false,
                entry: None,
                hooks: Vec::new(),
                permissions: Vec::new(),
                ui: Default::default(),
                config: Value::Object(Default::default()),
                path: path_str,
                has_icon: icon_path.is_file(),
                load_error: Some(e),
            }
        }
    }
}

pub fn list_plugins() -> Result<Vec<PluginInfo>, String> {
    let state = load_plugins_state();
    let dirs = discover_plugin_dirs()?;
    Ok(dirs
        .iter()
        .map(|d| load_plugin_info(d, &state))
        .collect())
}

pub fn get_plugin_manifest(plugin_id: &str) -> Result<(PluginManifest, PathBuf), String> {
    let dirs = discover_plugin_dirs()?;
    for dir in dirs {
        if let Ok(manifest) = manifest::read_manifest(&dir) {
            if manifest.id == plugin_id {
                return Ok((manifest, dir));
            }
        }
    }
    Err(format!("Плагин «{plugin_id}» не найден"))
}

pub fn set_plugin_enabled(plugin_id: &str, enabled: bool) -> Result<PluginInfo, String> {
    let (manifest, dir) = get_plugin_manifest(plugin_id)?;
    let mut state = load_plugins_state();
    let entry = state
        .plugins
        .entry(plugin_id.to_string())
        .or_insert_with(|| PluginStateEntry {
            enabled: manifest.defaults.enabled,
            config: manifest.defaults.config.clone(),
        });
    entry.enabled = enabled;
    save_plugins_state(&state)?;
    Ok(load_plugin_info(&dir, &state))
}

pub fn get_plugin_config(plugin_id: &str) -> Result<Value, String> {
    let (manifest, _) = get_plugin_manifest(plugin_id)?;
    let state = load_plugins_state();
    Ok(resolve_config(&manifest, &state))
}

pub fn set_plugin_config(plugin_id: &str, config: Value) -> Result<PluginInfo, String> {
    let (manifest, dir) = get_plugin_manifest(plugin_id)?;
    let mut state = load_plugins_state();
    let entry = state
        .plugins
        .entry(plugin_id.to_string())
        .or_insert_with(|| PluginStateEntry {
            enabled: manifest.defaults.enabled,
            config: manifest.defaults.config.clone(),
        });
    entry.config = config;
    save_plugins_state(&state)?;
    Ok(load_plugin_info(&dir, &state))
}

pub fn read_plugin_script(plugin_id: &str) -> Result<String, String> {
    let (manifest, dir) = get_plugin_manifest(plugin_id)?;
    let entry = manifest
        .entry
        .ok_or_else(|| format!("Плагин «{plugin_id}» не объявляет entry"))?;
    let script_path = dir.join(&entry);
    if !script_path.is_file() {
        return Err(format!(
            "Скрипт плагина не найден: {}",
            script_path.display()
        ));
    }
    std::fs::read_to_string(&script_path)
        .map_err(|e| format!("Не удалось прочитать {}: {e}", script_path.display()))
}

pub fn read_plugin_icon_data_uri(plugin_id: &str) -> Result<Option<String>, String> {
    let (_, dir) = get_plugin_manifest(plugin_id)?;
    let icon_path = dir.join("icon.png");
    if !icon_path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&icon_path)
        .map_err(|e| format!("Не удалось прочитать icon.png: {e}"))?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:image/png;base64,{encoded}")))
}

pub fn enabled_plugins_with_manifest() -> Result<Vec<(PluginManifest, PathBuf)>, String> {
    let state = load_plugins_state();
    let mut out = Vec::new();
    for dir in discover_plugin_dirs()? {
        if let Ok(manifest) = manifest::read_manifest(&dir) {
            if resolve_enabled(&manifest, &state) {
                out.push((manifest, dir));
            }
        }
    }
    Ok(out)
}
