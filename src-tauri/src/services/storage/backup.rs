use std::path::PathBuf;

use tauri::{command, AppHandle};

use crate::models::LauncherSettingsBackupV1;
use crate::models::{JavaSettings, Settings};
use crate::services::game::settings as settings_service;

fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[command]
pub fn export_launcher_settings_backup(
    app: AppHandle,
    path: String,
    sidebar_order: Option<Vec<String>>,
) -> Result<String, String> {
    let p = PathBuf::from(path.clone());
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку для экспорта: {e}"))?;
    }

    let settings: Settings = settings_service::load_settings_from_disk();
    let java_settings: JavaSettings = settings_service::load_java_settings(&app);

    let backup = LauncherSettingsBackupV1 {
        format_version: 1,
        exported_at_ms: now_unix_ms(),
        settings,
        java_settings,
        sidebar_order,
    };

    let text = serde_json::to_string_pretty(&backup).map_err(|e| format!("Ошибка сериализации файла экспорта: {e}"))?;
    std::fs::write(&p, text).map_err(|e| format!("Не удалось записать файл экспорта: {e}"))?;
    Ok(path)
}

#[command]
pub fn import_launcher_settings_backup(app: AppHandle, path: String) -> Result<LauncherSettingsBackupV1, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать файл импорта: {e}"))?;

    let parsed_backup = serde_json::from_str::<LauncherSettingsBackupV1>(&text).ok();
    let (mut settings, mut java_settings, sidebar_order) = if let Some(b) = parsed_backup {
        (b.settings, b.java_settings, b.sidebar_order)
    } else {
        let s = serde_json::from_str::<Settings>(&text)
            .map_err(|e| format!("Файл импорта не распознан (ожидался JSON настроек): {e}"))?;
        let js = settings_service::load_java_settings(&app);
        (s, js, None)
    };

    settings_service::sanitize_imported_settings(&mut settings, &mut java_settings);

    settings_service::save_settings_to_disk(&settings)?;
    settings_service::save_java_settings(&app, &java_settings)?;

    Ok(LauncherSettingsBackupV1 {
        format_version: 1,
        exported_at_ms: now_unix_ms(),
        settings,
        java_settings,
        sidebar_order,
    })
}

