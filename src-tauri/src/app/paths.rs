use std::path::PathBuf;

use crate::services::game::settings as settings_service;

//корневая папка данных лаунчера (…/16Launcher)
pub fn launcher_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .ok_or_else(|| "Не удалось получить папку данных".to_string())
        .map(|p| p.join("16Launcher"))
}

pub fn profile_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("profile.json"))
}

pub fn launcher_accounts_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("accounts.json"))
}

pub fn game_root_dir() -> Result<PathBuf, String> {
    let settings = settings_service::load_settings_from_disk();
    if let Some(raw) = settings.game_directory {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let base = dirs::data_dir().ok_or("Не удалось получить системную папку данных")?;
    Ok(base.join("16Launcher").join("game"))
}

pub fn libraries_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("libraries"))
}

pub fn versions_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("versions"))
}

pub fn instances_root_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("instances"))
}

pub fn instance_dir(id: &str) -> Result<PathBuf, String> {
    Ok(instances_root_dir()?.join(id))
}

pub fn instance_dir_for_id(id: &str) -> Result<PathBuf, String> {
    instance_dir(id)
}

pub fn instance_config_path(id: &str) -> Result<PathBuf, String> {
    Ok(instance_dir(id)?.join("config.json"))
}

pub fn instance_settings_path(id: &str) -> Result<PathBuf, String> {
    Ok(instance_dir(id)?.join("settings.json"))
}

pub fn selected_profile_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("selected_profile.json"))
}

pub fn build_presets_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("build_presets.json"))
}

pub fn build_preset_icons_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("build_preset_icons"))
}

pub fn build_preset_icon_path(preset_id: &str) -> Result<PathBuf, String> {
    Ok(build_preset_icons_dir()?.join(format!("{preset_id}.png")))
}
