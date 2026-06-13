use std::path::Path;
use std::path::PathBuf;

use sysinfo::System;
use tauri::{command, AppHandle, Manager};

use crate::models::settings::default_interface_language;
use crate::models::{JavaArgsValidationResult, JavaRuntimeInfo, JavaSettings, Settings};
use crate::models::profile::InstanceSettings;
use crate::services::java as java_service;

use crate::app::paths::{instance_settings_path, launcher_data_dir, migrate_game_directory_change};
use crate::services::game::profiles::read_selected_profile_id;

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

#[command]
pub fn reset_settings_to_default() -> Result<Settings, String> {
    let previous = load_settings_from_disk();
    let defaults = Settings::default();
    save_settings_to_disk(&defaults)?;
    migrate_game_directory_change(
        previous.game_directory.as_deref(),
        defaults.game_directory.as_deref(),
    )?;
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

#[command]
pub fn set_profile_java_settings(profile_id: String, settings: JavaSettings) -> Result<(), String> {
    let path = instance_settings_path(&profile_id)?;
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

pub fn effective_settings_for_profile(profile_id: Option<String>) -> Settings {
    let base = load_settings_from_disk();
    let id = match profile_id {
        Some(id) if !id.trim().is_empty() => id,
        _ => return base,
    };
    let path = match instance_settings_path(&id) {
        Ok(p) => p,
        Err(_) => return base,
    };
    let inst: InstanceSettings = if path.exists() {
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => return base,
        };
        match serde_json::from_str(&text) {
            Ok(s) => s,
            Err(_) => return base,
        }
    } else {
        return base;
    };
    let mut s = base;
    if let Some(ram) = inst.ram_mb {
        s.ram_mb = ram.max(512);
    }
    if let Some(v) = inst.show_console_on_launch {
        s.show_console_on_launch = v;
    }
    if let Some(v) = inst.close_launcher_on_game_start {
        s.close_launcher_on_game_start = v;
    }
    if let Some(v) = inst.check_game_processes {
        s.check_game_processes = v;
    }
    s
}

pub fn effective_settings_for_launch() -> Settings {
    effective_settings_for_profile(read_selected_profile_id())
}

#[command]
pub fn get_system_memory_gb() -> Result<u64, String> {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_bytes = sys.total_memory();
    if total_bytes == 0 {
        return Err("Не удалось определить объём памяти системы".to_string());
    }
    let gb = total_bytes / (1024 * 1024 * 1024);
    Ok(gb.max(1))
}

#[command]
pub fn get_settings() -> Result<Settings, String> {
    Ok(load_settings_from_disk())
}

#[command]
pub fn set_settings(settings: Settings) -> Result<(), String> {
    let previous = load_settings_from_disk();
    let old_dir = previous.game_directory.clone();
    let new_dir = settings.game_directory.clone();
    save_settings_to_disk(&settings)?;
    if old_dir != new_dir {
        migrate_game_directory_change(old_dir.as_deref(), new_dir.as_deref())?;
    } else {
        crate::app::paths::ensure_game_data_layout()?;
    }
    Ok(())
}

#[command]
pub fn get_effective_settings(profile_id: Option<String>) -> Result<Settings, String> {
    Ok(effective_settings_for_profile(profile_id))
}

#[command]
pub fn get_java_settings(app: AppHandle) -> Result<JavaSettings, String> {
    Ok(load_java_settings(&app))
}

#[command]
pub fn set_java_settings(app: AppHandle, settings: JavaSettings) -> Result<(), String> {
    save_java_settings(&app, &settings)
}

#[command]
pub fn get_profile_java_settings(app: AppHandle, id: String) -> Result<JavaSettings, String> {
    Ok(effective_java_settings_for_profile(&app, Some(id)))
}

#[command]
pub async fn validate_java_args(
    java_path: Option<String>,
    args: String,
) -> Result<JavaArgsValidationResult, String> {
    java_service::validate::validate_java_args(java_path, args).await
}

#[command]
pub async fn detect_java_runtimes() -> Result<Vec<JavaRuntimeInfo>, String> {
    java_service::detect::detect_java_runtimes().await
}

