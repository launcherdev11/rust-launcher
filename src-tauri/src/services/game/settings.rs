use std::path::Path;
use std::path::PathBuf;

use tauri::AppHandle;
use tauri::Manager;

use crate::models::settings::default_interface_language;
use crate::models::{JavaSettings, Settings};

// ВАЖНО: на первом этапе эти функции напрямую используют существующие helper'ы из
// `game_provider.rs`, чтобы не ломать пути/поведение. По мере распила вынесем paths
// в `app/paths.rs` и уберём обратные зависимости.
use crate::game_provider::{instance_settings_path, launcher_data_dir, InstanceSettings};

fn settings_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("settings.json"))
}

pub fn launcher_cache_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("cache"))
}

fn java_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    match app.path().app_config_dir() {
        Ok(base) => Ok(base.join("16Launcher").join("java-settings.json")),
        Err(_) => Ok(launcher_data_dir()?.join("java-settings.json")),
    }
}

fn load_java_settings_from_path(path: &Path) -> JavaSettings {
    match std::fs::read_to_string(path).ok() {
        Some(text) => serde_json::from_str::<JavaSettings>(&text).unwrap_or_default(),
        None => JavaSettings::default(),
    }
}

fn save_java_settings_to_path(path: &Path, settings: &JavaSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку настроек Java: {e}"))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Ошибка сериализации настроек Java: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("Не удалось записать файл настроек Java: {e}"))?;
    Ok(())
}

pub fn load_java_settings(app: &AppHandle) -> JavaSettings {
    match java_settings_path(app) {
        Ok(path) => load_java_settings_from_path(&path),
        Err(_) => JavaSettings::default(),
    }
}

pub fn save_java_settings(app: &AppHandle, settings: &JavaSettings) -> Result<(), String> {
    let path = java_settings_path(app)?;
    save_java_settings_to_path(&path, settings)
}

pub fn load_settings_from_disk() -> Settings {
    match settings_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
    {
        Some(text) => serde_json::from_str::<Settings>(&text).unwrap_or_default(),
        None => Settings::default(),
    }
}

pub fn save_settings_to_disk(settings: &Settings) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку настроек: {e}"))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Ошибка сериализации настроек: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("Не удалось записать файл настроек: {e}"))?;
    Ok(())
}

pub fn reset_settings_to_default() -> Result<Settings, String> {
    let defaults = Settings::default();
    save_settings_to_disk(&defaults)?;
    Ok(defaults)
}

pub fn effective_java_settings_for_profile(app: &AppHandle, profile_id: Option<String>) -> JavaSettings {
    let id = match profile_id {
        Some(id) if !id.trim().is_empty() => id,
        _ => return load_java_settings(app),
    };
    let path = match instance_settings_path(&id) {
        Ok(p) => p,
        Err(_) => return load_java_settings(app),
    };
    if !path.exists() {
        return load_java_settings(app);
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return load_java_settings(app),
    };
    let inst: InstanceSettings = match serde_json::from_str(&text) {
        Ok(s) => s,
        Err(_) => return load_java_settings(app),
    };
    inst.java_settings.unwrap_or_else(|| load_java_settings(app))
}

pub fn set_profile_java_settings(profile_id: &str, settings: JavaSettings) -> Result<(), String> {
    let path = instance_settings_path(profile_id)?;
    let mut current = if path.exists() {
        let text = std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения settings.json: {e}"))?;
        serde_json::from_str::<InstanceSettings>(&text).map_err(|e| format!("Ошибка разбора settings.json: {e}"))?
    } else {
        InstanceSettings::default()
    };
    current.java_settings = Some(settings);
    let text =
        serde_json::to_string_pretty(&current).map_err(|e| format!("Ошибка сериализации settings.json сборки: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку для settings.json: {e}"))?;
    }
    std::fs::write(&path, text).map_err(|e| format!("Не удалось записать settings.json: {e}"))?;
    Ok(())
}

pub fn sanitize_imported_settings(settings: &mut Settings, java_settings: &mut JavaSettings) {
    if settings.interface_language.trim().is_empty() {
        settings.interface_language = default_interface_language();
    }
    if settings.background_accent_color.trim().is_empty() {
        settings.background_accent_color = "#0b1530".to_string();
    }
    if java_settings.java_path.as_deref().unwrap_or("").trim().is_empty() {
        java_settings.java_path = None;
    }
}

