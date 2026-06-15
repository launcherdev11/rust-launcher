use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rand::distributions::Alphanumeric;
use rand::Rng;
use tauri::command;

use crate::app::paths::{
    build_preset_icon_path, build_preset_icons_dir, build_presets_path, instance_config_path,
    instance_settings_path,
};
use crate::models::build_preset::{BuildPreset, BuildPresetsFile};
use crate::models::profile::InstanceConfig;
use crate::models::InstanceSettings;

fn generate_preset_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(10)
        .map(char::from)
        .collect()
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs()
}

fn load_presets_file() -> Result<BuildPresetsFile, String> {
    let path = build_presets_path()?;
    if !path.is_file() {
        return Ok(BuildPresetsFile {
            presets: Vec::new(),
        });
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("Ошибка чтения build_presets.json: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора build_presets.json: {e}"))
}

fn save_presets_file(file: &BuildPresetsFile) -> Result<(), String> {
    let path = build_presets_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для build_presets.json: {e}"))?;
    }
    let text = serde_json::to_string_pretty(file)
        .map_err(|e| format!("Ошибка сериализации build_presets.json: {e}"))?;
    std::fs::write(&path, text)
        .map_err(|e| format!("Не удалось записать build_presets.json: {e}"))
}

fn copy_icon_to_preset(icon_source: &str, preset_id: &str) -> Result<Option<String>, String> {
    let src = PathBuf::from(icon_source);
    if !src.is_file() {
        return Ok(None);
    }
    let icons_dir = build_preset_icons_dir()?;
    std::fs::create_dir_all(&icons_dir)
        .map_err(|e| format!("Не удалось создать папку иконок пресетов: {e}"))?;
    let dest = build_preset_icon_path(preset_id)?;
    std::fs::copy(&src, &dest)
        .map_err(|e| format!("Не удалось скопировать иконку пресета: {e}"))?;
    Ok(dest.to_str().map(|s| s.to_string()))
}

fn remove_preset_icon(preset_id: &str) {
    if let Ok(path) = build_preset_icon_path(preset_id) {
        if path.is_file() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn image_path_to_data_uri(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Не удалось прочитать иконку пресета: {e}"))?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "png" | _ => "image/png",
    };
    let encoded = BASE64_STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

fn resolve_preset_icon(preset: &BuildPreset) -> Option<PathBuf> {
    if let Some(raw) = preset.icon_path.as_deref() {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    build_preset_icon_path(&preset.id).ok().filter(|p| p.is_file())
}

#[command]
pub fn list_build_presets() -> Result<Vec<BuildPreset>, String> {
    let file = load_presets_file()?;
    let mut presets = file.presets;
    presets.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(presets)
}

#[command]
pub fn save_build_preset(
    id: Option<String>,
    name: String,
    game_version: String,
    loader: String,
    loader_version: Option<String>,
    settings: Option<InstanceSettings>,
    icon_source_path: Option<String>,
) -> Result<BuildPreset, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Укажите название пресета.".to_string());
    }
    if game_version.trim().is_empty() {
        return Err("Укажите версию игры.".to_string());
    }
    if loader.trim().is_empty() {
        return Err("Укажите загрузчик.".to_string());
    }

    let mut file = load_presets_file()?;
    let preset_id = id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| generate_preset_id());

    let mut icon_path: Option<String> = None;
    if let Some(src) = icon_source_path {
        icon_path = copy_icon_to_preset(&src, &preset_id)?;
    }

    if let Some(existing) = file.presets.iter_mut().find(|p| p.id == preset_id) {
        if icon_path.is_none() {
            icon_path = existing.icon_path.clone();
        } else {
            remove_preset_icon(&preset_id);
        }
        existing.name = trimmed_name.to_string();
        existing.game_version = game_version.trim().to_string();
        existing.loader = loader.trim().to_string();
        existing.loader_version = loader_version;
        existing.settings = settings;
        existing.icon_path = icon_path.clone();
        let updated = existing.clone();
        save_presets_file(&file)?;
        return Ok(updated);
    }

    let preset = BuildPreset {
        id: preset_id.clone(),
        name: trimmed_name.to_string(),
        game_version: game_version.trim().to_string(),
        loader: loader.trim().to_string(),
        loader_version,
        settings,
        created_at: now_unix_secs(),
        icon_path,
    };
    file.presets.push(preset.clone());
    save_presets_file(&file)?;
    Ok(preset)
}

#[command]
pub fn delete_build_preset(preset_id: String) -> Result<(), String> {
    let mut file = load_presets_file()?;
    let before = file.presets.len();
    file.presets.retain(|p| p.id != preset_id);
    if file.presets.len() == before {
        return Err("Пресет не найден.".to_string());
    }
    save_presets_file(&file)?;
    remove_preset_icon(&preset_id);
    Ok(())
}

#[command]
pub fn create_build_preset_from_profile(profile_id: String, name: String) -> Result<BuildPreset, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Укажите название пресета.".to_string());
    }

    let cfg_path = instance_config_path(&profile_id)?;
    if !cfg_path.is_file() {
        return Err("Сборка не найдена.".to_string());
    }
    let cfg_text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Ошибка чтения config.json: {e}"))?;
    let cfg: InstanceConfig =
        serde_json::from_str(&cfg_text).map_err(|e| format!("Ошибка разбора config.json: {e}"))?;

    let settings = instance_settings_path(&profile_id)
        .ok()
        .filter(|p| p.is_file())
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<InstanceSettings>(&text).ok());

    let preset_id = generate_preset_id();
    let mut icon_path: Option<String> = None;
    if let Some(icon) = cfg.icon_path.as_deref() {
        let icon_src = PathBuf::from(icon);
        if icon_src.is_file() {
            icon_path = copy_icon_to_preset(icon, &preset_id)?;
        }
    }

    let preset = BuildPreset {
        id: preset_id,
        name: trimmed_name.to_string(),
        game_version: cfg.game_version,
        loader: cfg.loader,
        loader_version: cfg.loader_version,
        settings,
        created_at: now_unix_secs(),
        icon_path,
    };

    let mut file = load_presets_file()?;
    file.presets.push(preset.clone());
    save_presets_file(&file)?;
    Ok(preset)
}

#[command]
pub fn get_build_preset_icon_data_uri(preset_id: String) -> Result<Option<String>, String> {
    let file = load_presets_file()?;
    let preset = file
        .presets
        .into_iter()
        .find(|p| p.id == preset_id)
        .ok_or_else(|| "Пресет не найден.".to_string())?;
    match resolve_preset_icon(&preset) {
        Some(path) => image_path_to_data_uri(&path),
        None => Ok(None),
    }
}
