use std::path::Path;
use std::path::PathBuf;

use sysinfo::System;
use tauri::{command, AppHandle, Manager};

use crate::models::settings::default_interface_language;
use crate::models::{
    JavaArgsValidationResult, JavaIntegrityCheckResult, JavaRuntimeInfo, JavaSettings, Settings,
};
use crate::models::profile::InstanceSettings;
use crate::services::java as java_service;

use crate::app::paths::{instance_settings_path, launcher_data_dir, migrate_game_directory_change};
use crate::infra::fs_atomic::{read_to_string_with_backup, write_atomic};
use crate::services::game::profiles::read_selected_profile_id;

fn settings_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("settings.json"))
}

fn game_directory_sidecar_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("game_directory.json"))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
struct GameDirectorySidecar {
    game_directory: Option<String>,
}

fn load_game_directory_sidecar() -> Option<String> {
    let path = game_directory_sidecar_path().ok()?;
    let text = read_to_string_with_backup(&path)?;
    let parsed: GameDirectorySidecar = serde_json::from_str(&text).ok()?;
    parsed
        .game_directory
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn save_game_directory_sidecar(game_directory: Option<&str>) -> Result<(), String> {
    let path = game_directory_sidecar_path()?;
    let value = GameDirectorySidecar {
        game_directory: game_directory
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
    };
    let text = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Ошибка сериализации game_directory.json: {e}"))?;
    write_atomic(&path, text)
}

fn instances_appear_present(game_directory: Option<&str>) -> bool {
    let Ok(root) = crate::app::game_data_migrate::game_root_from_directory_setting(game_directory)
    else {
        return false;
    };
    let instances = root.join("instances");
    let Ok(entries) = std::fs::read_dir(&instances) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        path.is_dir() && path.join("config.json").is_file()
    })
}

fn heal_game_directory(settings: &mut Settings) {
    let current = settings
        .game_directory
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if instances_appear_present(current) {
        return;
    }
    let Some(sidecar) = load_game_directory_sidecar() else {
        return;
    };
    if current == Some(sidecar.as_str()) {
        return;
    }
    if instances_appear_present(Some(&sidecar)) {
        settings.game_directory = Some(sidecar);
    }
}

pub fn launcher_cache_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("cache"))
}

fn java_settings_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("java-settings.json"))
}

fn legacy_java_settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|base| base.join("16Launcher").join("java-settings.json"))
}

fn load_java_settings_from_path(path: &Path) -> Option<JavaSettings> {
    let text = read_to_string_with_backup(path)?;
    serde_json::from_str::<JavaSettings>(&text).ok()
}

fn save_java_settings_to_path(path: &Path, settings: &JavaSettings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Ошибка сериализации настроек Java: {e}"))?;
    write_atomic(path, text)
}

pub fn load_java_settings(app: &AppHandle) -> JavaSettings {
    let Ok(path) = java_settings_path() else {
        return JavaSettings::default();
    };
    if let Some(settings) = load_java_settings_from_path(&path) {
        return settings;
    }
    if let Some(legacy) = legacy_java_settings_path(app) {
        if let Some(settings) = load_java_settings_from_path(&legacy) {
            let _ = save_java_settings_to_path(&path, &settings);
            return settings;
        }
    }
    JavaSettings::default()
}

pub fn save_java_settings(app: &AppHandle, settings: &JavaSettings) -> Result<(), String> {
    let _ = app;
    let path = java_settings_path()?;
    save_java_settings_to_path(&path, settings)
}

pub fn load_settings_from_disk() -> Settings {
    let mut settings = settings_path()
        .ok()
        .and_then(|p| read_to_string_with_backup(&p))
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default();
    heal_game_directory(&mut settings);
    if load_game_directory_sidecar().is_none() {
        if let Some(dir) = settings
            .game_directory
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let _ = save_game_directory_sidecar(Some(dir));
        }
    }
    settings
}

pub fn save_settings_to_disk(settings: &Settings) -> Result<(), String> {
    let path = settings_path()?;
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Ошибка сериализации настроек: {e}"))?;
    write_atomic(&path, text)?;
    let _ = save_game_directory_sidecar(settings.game_directory.as_deref());
    Ok(())
}

#[command]
pub fn reset_settings_to_default(app: AppHandle) -> Result<Settings, String> {
    let previous = load_settings_from_disk();
    let defaults = Settings::default();
    save_settings_to_disk(&defaults)?;
    migrate_game_directory_change(
        previous.game_directory.as_deref(),
        defaults.game_directory.as_deref(),
    )?;
    crate::infra::tray::sync_tray_from_settings(
        &app,
        defaults.minimize_to_tray_on_close,
        &defaults.interface_language,
    );
    crate::infra::autostart::sync_autostart_from_settings(&app, defaults.autostart_enabled);
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
pub fn set_profile_java_settings(id: String, settings: JavaSettings) -> Result<(), String> {
    let path = instance_settings_path(&id)?;
    let mut current = if path.exists() {
        let text = std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения settings.json: {e}"))?;
        serde_json::from_str::<InstanceSettings>(&text).map_err(|e| format!("Ошибка разбора settings.json: {e}"))?
    } else {
        InstanceSettings::default()
    };
    current.java_settings = Some(settings);
    let text =
        serde_json::to_string_pretty(&current).map_err(|e| format!("Ошибка сериализации settings.json сборки: {e}"))?;
    write_atomic(&path, text)?;
    Ok(())
}

pub fn sanitize_imported_settings(settings: &mut Settings, java_settings: &mut JavaSettings) {
    if settings.interface_language.trim().is_empty() {
        settings.interface_language = default_interface_language();
    }
    if settings.background_accent_color.trim().is_empty() {
        settings.background_accent_color = "#0b1530".to_string();
    }
    if let Some(ref theme_id) = settings.custom_theme_id {
        let trimmed = theme_id.trim();
        if trimmed.is_empty() || !crate::services::themes::theme_exists(trimmed) {
            settings.custom_theme_id = None;
        } else if trimmed != theme_id {
            settings.custom_theme_id = Some(trimmed.to_string());
        }
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
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let previous = load_settings_from_disk();
    let old_dir = previous.game_directory.clone();
    let new_dir = settings.game_directory.clone();
    save_settings_to_disk(&settings)?;
    if old_dir != new_dir {
        migrate_game_directory_change(old_dir.as_deref(), new_dir.as_deref())?;
    } else {
        crate::app::paths::ensure_game_data_layout()?;
    }
    crate::infra::tray::sync_tray_from_settings(
        &app,
        settings.minimize_to_tray_on_close,
        &settings.interface_language,
    );
    crate::infra::autostart::sync_autostart_from_settings(&app, settings.autostart_enabled);
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

#[command]
pub fn list_installed_java_runtimes() -> Result<Vec<JavaRuntimeInfo>, String> {
    crate::java_runtime::list_installed_runtimes()
}

#[command]
pub async fn verify_java_runtimes(
    majors: Option<Vec<u8>>,
) -> Result<JavaIntegrityCheckResult, String> {
    crate::java_runtime::verify_installed_java_runtimes(majors).await
}

#[command]
pub async fn reinstall_java_runtimes(
    majors: Option<Vec<u8>>,
) -> Result<Vec<JavaRuntimeInfo>, String> {
    crate::java_runtime::reinstall_java_runtimes(majors).await
}

