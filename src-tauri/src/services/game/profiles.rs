use std::path::Path;
use std::path::PathBuf;

use rand::distributions::Alphanumeric;
use rand::Rng;

use crate::models::profile::{SelectedProfileFile};
use crate::models::{InstanceConfig, InstanceProfileSummary, InstanceSettings};
use crate::services::game::cache as cache_service;

// пока используем существующий источник путей данных, чтобы не менять поведение.
use crate::game_provider::launcher_data_dir;

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

fn selected_profile_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("selected_profile.json"))
}

fn generate_instance_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(12)
        .map(char::from)
        .collect()
}

fn find_icon_png_in_profile(root: &Path) -> Option<String> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            let is_icon_png = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.eq_ignore_ascii_case("icon.png"))
                .unwrap_or(false);
            if is_icon_png {
                return path.to_str().map(|s| s.to_string());
            }
        }
    }
    None
}

pub fn read_selected_profile_id() -> Option<String> {
    let path = selected_profile_path().ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    let obj: SelectedProfileFile = serde_json::from_str(&text).ok()?;
    if obj.id.trim().is_empty() { None } else { Some(obj.id) }
}

pub fn set_selected_profile(id: Option<String>) -> Result<(), String> {
    let path = selected_profile_path()?;
    if let Some(id) = id {
        if id.trim().is_empty() {
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Не удалось удалить selected_profile.json: {e}"))?;
            }
            return Ok(());
        }
        let obj = SelectedProfileFile { id };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Не удалось создать папку для selected_profile.json: {e}"))?;
        }
        let text = serde_json::to_string_pretty(&obj)
            .map_err(|e| format!("Ошибка сериализации selected_profile.json: {e}"))?;
        std::fs::write(&path, text)
            .map_err(|e| format!("Не удалось записать selected_profile.json: {e}"))?;
    } else if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Не удалось удалить selected_profile.json: {e}"))?;
    }
    Ok(())
}

pub fn load_all_instance_profiles() -> Result<Vec<InstanceProfileSummary>, String> {
    let root = instances_root_dir()?;
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| format!("Ошибка чтения папки instances: {e}"))? {
        let entry = entry.map_err(|e| format!("Ошибка чтения entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let _id = match path.file_name().and_then(|n| n.to_str()) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => continue,
        }; // unused
        let config_path = path.join("config.json");
        if !config_path.exists() {
            continue;
        }
        let cfg_text = match std::fs::read_to_string(&config_path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let cfg: InstanceConfig = match serde_json::from_str(&cfg_text) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mods_dir = path.join("mods");
        let res_dir = path.join("resourcepacks");
        let shader_dir = path.join("shaderpacks");

        let (mods_size, mods_count) = cache_service::dir_size_and_count(&mods_dir);
        let (res_size, res_count) = cache_service::dir_size_and_count(&res_dir);
        let (shader_size, shader_count) = cache_service::dir_size_and_count(&shader_dir);

        let total_size_bytes = mods_size.saturating_add(res_size).saturating_add(shader_size);

        let directory = match path.to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };

        let icon_path = find_icon_png_in_profile(&path).or(cfg.icon_path);

        out.push(InstanceProfileSummary {
            id: cfg.id,
            name: cfg.name,
            icon_path,
            game_version: cfg.game_version,
            loader: cfg.loader,
            created_at: cfg.created_at,
            play_time_seconds: cfg.play_time_seconds,
            mods_count,
            resourcepacks_count: res_count,
            shaderpacks_count: shader_count,
            total_size_bytes,
            directory,
        });
    }

    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(out)
}

pub fn get_selected_profile() -> Result<Option<InstanceProfileSummary>, String> {
    let selected_id = match read_selected_profile_id() {
        Some(id) => id,
        None => return Ok(None),
    };
    let all = load_all_instance_profiles()?;
    Ok(all.into_iter().find(|p| p.id == selected_id))
}

pub fn delete_profile(id: String) -> Result<(), String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }

    if let Some(selected_id) = read_selected_profile_id() {
        if selected_id == id {
            set_selected_profile(None)?;
        }
    }

    std::fs::remove_dir_all(&dir).map_err(|e| format!("Не удалось удалить папку сборки {:?}: {e}", dir))?;
    Ok(())
}

pub fn update_profile_settings(id: String, patch: InstanceSettings) -> Result<(), String> {
    let path = instance_settings_path(&id)?;
    let mut current = if path.exists() {
        let text = std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения settings.json: {e}"))?;
        serde_json::from_str::<InstanceSettings>(&text).map_err(|e| format!("Ошибка разбора settings.json: {e}"))?
    } else {
        InstanceSettings::default()
    };

    if let Some(v) = patch.ram_mb {
        current.ram_mb = Some(v);
    }
    if let Some(v) = patch.jvm_args {
        current.jvm_args = Some(v);
    }
    if let Some(v) = patch.java_settings {
        current.java_settings = Some(v);
    }
    if let Some(v) = patch.resolution_width {
        current.resolution_width = Some(v);
    }
    if let Some(v) = patch.resolution_height {
        current.resolution_height = Some(v);
    }
    if let Some(v) = patch.show_console_on_launch {
        current.show_console_on_launch = Some(v);
    }
    if let Some(v) = patch.close_launcher_on_game_start {
        current.close_launcher_on_game_start = Some(v);
    }
    if let Some(v) = patch.check_game_processes {
        current.check_game_processes = Some(v);
    }

    let text = serde_json::to_string_pretty(&current).map_err(|e| format!("Ошибка сериализации settings.json сборки: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку для settings.json: {e}"))?;
    }
    std::fs::write(&path, text).map_err(|e| format!("Не удалось записать settings.json: {e}"))?;
    Ok(())
}

pub fn rename_profile(id: String, name: String) -> Result<(), String> {
    let cfg_path = instance_config_path(&id)?;
    if !cfg_path.exists() {
        return Err("config.json сборки не найден".to_string());
    }
    let text = std::fs::read_to_string(&cfg_path).map_err(|e| format!("Ошибка чтения config.json сборки: {e}"))?;
    let mut cfg: InstanceConfig = serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора config.json: {e}"))?;
    cfg.name = name;
    let new_text = serde_json::to_string_pretty(&cfg).map_err(|e| format!("Ошибка сериализации config.json: {e}"))?;
    std::fs::write(&cfg_path, new_text).map_err(|e| format!("Не удалось записать config.json сборки: {e}"))?;
    Ok(())
}

pub fn delete_item(id: String, category: String, filename: String) -> Result<(), String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестная категория контента: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };
    let target = dir.join(subdir).join(&filename);
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| format!("Не удалось удалить файл {:?}: {e}", target))?;
    }
    Ok(())
}

pub fn list_profile_items(id: String, category: String) -> Result<Vec<String>, String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестная категория контента: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };
    let target_dir = dir.join(subdir);
    if !target_dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&target_dir).map_err(|e| format!("Ошибка чтения папки сборки: {e}"))? {
        let entry = entry.map_err(|e| format!("Ошибка чтения файла сборки: {e}"))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                files.push(name.to_string());
            }
        }
    }
    files.sort();
    Ok(files)
}

