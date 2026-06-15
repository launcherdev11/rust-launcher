use std::path::PathBuf;

use crate::app::game_data_migrate::{
    game_root_from_directory_setting, migrate_between_game_roots, migrate_game_data_if_needed,
};
use crate::models::profile::InstanceConfig;
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

pub fn default_game_root_dir() -> Result<PathBuf, String> {
    game_root_from_directory_setting(None)
}

pub fn game_root_dir() -> Result<PathBuf, String> {
    let settings = settings_service::load_settings_from_disk();
    game_root_from_directory_setting(settings.game_directory.as_deref())
}

pub fn legacy_instances_root_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("instances"))
}

pub fn legacy_runtimes_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("runtimes"))
}

pub fn legacy_forge_installers_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("forge_installers"))
}

pub fn ensure_game_data_layout() -> Result<(), String> {
    let target = game_root_dir()?;
    let default_game = default_game_root_dir()?;

    migrate_game_data_if_needed(
        &target,
        &legacy_instances_root_dir()?,
        &legacy_runtimes_dir()?,
        &legacy_forge_installers_dir()?,
    )?;

    if default_game != target && default_game.is_dir() {
        migrate_between_game_roots(&default_game, &target)?;
    }

    Ok(())
}

pub fn migrate_game_directory_change(
    old_game_directory: Option<&str>,
    new_game_directory: Option<&str>,
) -> Result<(), String> {
    let from = game_root_from_directory_setting(old_game_directory)?;
    let to = game_root_from_directory_setting(new_game_directory)?;
    if from != to {
        migrate_between_game_roots(&from, &to)?;
    }
    ensure_game_data_layout()
}

pub fn libraries_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("libraries"))
}

pub fn versions_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("versions"))
}

pub fn instances_root_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("instances"))
}

pub fn instance_dir(id: &str) -> Result<PathBuf, String> {
    let root = instances_root_dir()?;
    let legacy = root.join(id);
    if legacy.is_dir() {
        return Ok(legacy);
    }

    if !root.is_dir() {
        return Ok(legacy);
    }

    let entries = std::fs::read_dir(&root)
        .map_err(|e| format!("Ошибка чтения папки instances: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Ошибка чтения entry instances: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let cfg_path = path.join("config.json");
        if !cfg_path.is_file() {
            continue;
        }
        let text = match std::fs::read_to_string(&cfg_path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let cfg = match serde_json::from_str::<InstanceConfig>(&text) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if cfg.id == id {
            return Ok(path);
        }
    }

    Ok(legacy)
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

pub fn screenshots_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("screenshots"))
}

pub fn plugins_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("plugins"))
}

pub fn plugin_dir(plugin_id: &str) -> Result<PathBuf, String> {
    Ok(plugins_dir()?.join(plugin_id))
}
