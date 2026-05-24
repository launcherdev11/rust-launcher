use std::path::Path;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rand::distributions::Alphanumeric;
use rand::Rng;
use tauri::command;

use crate::models::profile::{InstanceConfig, ProfileItemEntry, SelectedProfileFile};
use crate::models::{InstanceProfileSummary, InstanceSettings};
use crate::app::paths::{
    instance_config_path, instance_dir, instance_settings_path, instances_root_dir,
    selected_profile_path,
};
use crate::services::game::cache as cache_service;


const PROFILE_ITEM_DISABLED_SUFFIX: &str = ".disabled";

fn profile_content_subdir(category: &str) -> Result<&'static str, String> {
    match category {
        "mod" | "mods" => Ok("mods"),
        "resourcepack" | "resourcepacks" => Ok("resourcepacks"),
        "shader" | "shaderpack" | "shaderpacks" => Ok("shaderpacks"),
        other => Err(format!(
            "Неизвестная категория контента: {other}. Ожидается mod, resourcepack или shader."
        )),
    }
}

fn profile_item_is_disabled(stored_name: &str) -> bool {
    stored_name.ends_with(PROFILE_ITEM_DISABLED_SUFFIX)
}

fn profile_item_display_name(stored_name: &str) -> String {
    if profile_item_is_disabled(stored_name) {
        stored_name
            .strip_suffix(PROFILE_ITEM_DISABLED_SUFFIX)
            .unwrap_or(stored_name)
            .to_string()
    } else {
        stored_name.to_string()
    }
}

fn profile_item_stored_name(display_name: &str, enabled: bool) -> String {
    let base = profile_item_display_name(display_name);
    if enabled {
        base
    } else {
        format!("{base}{PROFILE_ITEM_DISABLED_SUFFIX}")
    }
}

fn resolve_profile_item_path(content_dir: &Path, filename: &str) -> Option<PathBuf> {
    let direct = content_dir.join(filename);
    if direct.is_file() {
        return Some(direct);
    }
    let display = profile_item_display_name(filename);
    let enabled_path = content_dir.join(&display);
    if enabled_path.is_file() {
        return Some(enabled_path);
    }
    let disabled_path = content_dir.join(profile_item_stored_name(&display, false));
    if disabled_path.is_file() {
        return Some(disabled_path);
    }
    None
}

fn generate_instance_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(12)
        .map(char::from)
        .collect()
}

fn image_path_to_data_uri(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Не удалось прочитать иконку сборки: {e}"))?;
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

pub fn set_profile_icon_path(profile_id: &str, icon_path: Option<String>) -> Result<(), String> {
    let cfg_path = instance_config_path(profile_id)?;
    if !cfg_path.exists() {
        return Err("config.json сборки не найден".to_string());
    }
    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Ошибка чтения config.json: {e}"))?;
    let mut cfg: InstanceConfig =
        serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора config.json: {e}"))?;
    cfg.icon_path = icon_path;
    let new_text = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Ошибка сериализации config.json: {e}"))?;
    std::fs::write(&cfg_path, new_text)
        .map_err(|e| format!("Не удалось записать config.json: {e}"))?;
    Ok(())
}

fn resolve_profile_icon_file(profile_dir: &Path, cfg_icon: Option<&str>) -> Option<PathBuf> {
    if let Some(raw) = cfg_icon {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if path.is_absolute() && path.is_file() {
                return Some(path);
            }
            let in_profile = profile_dir.join(&path);
            if in_profile.is_file() {
                return Some(in_profile);
            }
            if path.is_file() {
                return Some(path);
            }
        }
    }

    let root_icon = profile_dir.join("icon.png");
    if root_icon.is_file() {
        return Some(root_icon);
    }

    find_icon_png_in_profile(profile_dir).map(PathBuf::from)
}

pub fn profile_icon_file_path(profile_id: &str) -> Option<PathBuf> {
    let profile_dir = instance_dir(profile_id).ok()?;
    if !profile_dir.is_dir() {
        return None;
    }
    let cfg_icon = instance_config_path(profile_id)
        .ok()
        .filter(|p| p.is_file())
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<InstanceConfig>(&text).ok())
        .and_then(|cfg| cfg.icon_path);
    resolve_profile_icon_file(&profile_dir, cfg_icon.as_deref())
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

pub fn load_selected_instance_settings() -> Result<Option<(String, InstanceSettings)>, String> {
    let id = match read_selected_profile_id() {
        Some(id) => id,
        None => return Ok(None),
    };
    let path = instance_settings_path(&id)?;
    let settings = if path.exists() {
        let text =
            std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения настроек сборки: {e}"))?;
        serde_json::from_str::<InstanceSettings>(&text)
            .map_err(|e| format!("Ошибка разбора настроек сборки: {e}"))?
    } else {
        InstanceSettings::default()
    };
    Ok(Some((id, settings)))
}

pub fn add_play_time_seconds_to_profile(profile_id: &str, delta_secs: u64) -> Result<(), String> {
    let cfg_path = instance_config_path(profile_id)?;
    if !cfg_path.exists() {
        return Ok(());
    }

    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Ошибка чтения config.json для playtime: {e}"))?;

    let mut cfg: InstanceConfig = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };

    cfg.play_time_seconds = cfg.play_time_seconds.saturating_add(delta_secs);

    let new_text = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Ошибка сериализации config.json для playtime: {e}"))?;

    std::fs::write(&cfg_path, new_text)
        .map_err(|e| format!("Ошибка записи config.json для playtime: {e}"))?;

    Ok(())
}

pub fn selected_instance_dir() -> Option<PathBuf> {
    let id = read_selected_profile_id()?;
    let dir = instance_dir(&id).ok()?;
    if dir.exists() {
        Some(dir)
    } else {
        None
    }
}

pub fn read_selected_profile_id() -> Option<String> {
    let path = selected_profile_path().ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    let obj: SelectedProfileFile = serde_json::from_str(&text).ok()?;
    if obj.id.trim().is_empty() { None } else { Some(obj.id) }
}

#[command]
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
        }; //unused
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
            loader_version: cfg.loader_version,
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

#[command]
pub fn get_selected_profile() -> Result<Option<InstanceProfileSummary>, String> {
    let selected_id = match read_selected_profile_id() {
        Some(id) => id,
        None => return Ok(None),
    };
    let all = load_all_instance_profiles()?;
    Ok(all.into_iter().find(|p| p.id == selected_id))
}

#[command]
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

#[command]
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

#[command]
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

#[command]
pub fn delete_item(id: String, category: String, filename: String) -> Result<(), String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    let subdir = profile_content_subdir(&category)?;
    let content_dir = dir.join(subdir);
    let Some(target) = resolve_profile_item_path(&content_dir, &filename) else {
        return Ok(());
    };
    std::fs::remove_file(&target).map_err(|e| format!("Не удалось удалить файл {:?}: {e}", target))
}

#[command]
pub fn list_profile_items(id: String, category: String) -> Result<Vec<ProfileItemEntry>, String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    let subdir = profile_content_subdir(&category)?;
    let target_dir = dir.join(subdir);
    if !target_dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&target_dir).map_err(|e| format!("Ошибка чтения папки сборки: {e}"))? {
        let entry = entry.map_err(|e| format!("Ошибка чтения файла сборки: {e}"))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(stored_name) = path.file_name().and_then(|n| n.to_str()) {
                files.push(ProfileItemEntry {
                    name: profile_item_display_name(stored_name),
                    enabled: !profile_item_is_disabled(stored_name),
                });
            }
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[command]
pub fn set_profile_item_enabled(
    id: String,
    category: String,
    filename: String,
    enabled: bool,
) -> Result<(), String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    let subdir = profile_content_subdir(&category)?;
    let content_dir = dir.join(subdir);
    let Some(from) = resolve_profile_item_path(&content_dir, &filename) else {
        return Err("Файл не найден в сборке".to_string());
    };
    let display_name = profile_item_display_name(
        from.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&filename),
    );
    let to = content_dir.join(profile_item_stored_name(&display_name, enabled));
    if from == to {
        return Ok(());
    }
    if to.exists() {
        return Err("Файл с таким именем уже существует".to_string());
    }
    std::fs::rename(&from, &to).map_err(|e| {
        format!(
            "Не удалось {} файл {:?}: {e}",
            if enabled { "включить" } else { "отключить" },
            from
        )
    })
}

pub fn create_profile_impl(
    name: String,
    game_version: String,
    loader: String,
    loader_version: Option<String>,
    icon_source_path: Option<String>,
    initial_settings: Option<InstanceSettings>,
) -> Result<InstanceProfileSummary, String> {
    let root = instances_root_dir()?;
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Не удалось создать папку instances: {e}"))?;

    let mut id = generate_instance_id();
    while instance_dir(&id)?.exists() {
        id = generate_instance_id();
    }
    let dir = instance_dir(&id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось создать папку сборки: {e}"))?;

    for sub in ["mods", "resourcepacks", "shaderpacks"] {
        let subdir = dir.join(sub);
        std::fs::create_dir_all(&subdir)
            .map_err(|e| format!("Не удалось создать папку '{sub}': {e}"))?;
    }

    let mut icon_path: Option<String> = None;
    if let Some(src) = icon_source_path {
        let src_path = PathBuf::from(&src);
        if src_path.exists() {
            let dest = dir.join("icon.png");
            std::fs::copy(&src_path, &dest)
                .map_err(|e| format!("Не удалось скопировать иконку сборки: {e}"))?;
            icon_path = dest.to_str().map(|s| s.to_string());
        }
    }

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs();

    let cfg = InstanceConfig {
        id: id.clone(),
        name: name.clone(),
        icon_path: icon_path.clone(),
        game_version: game_version.clone(),
        loader: loader.clone(),
        loader_version: loader_version.clone(),
        created_at,
        play_time_seconds: 0,
    };

    let cfg_path = instance_config_path(&id)?;
    let cfg_text = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Ошибка сериализации config.json сборки: {e}"))?;
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для config.json: {e}"))?;
    }
    std::fs::write(&cfg_path, cfg_text)
        .map_err(|e| format!("Не удалось записать config.json сборки: {e}"))?;

    let settings_path = instance_settings_path(&id)?;
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для settings.json: {e}"))?;
    }
    let settings = initial_settings.unwrap_or_default();
    let settings_text = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Ошибка сериализации settings.json сборки: {e}"))?;
    std::fs::write(&settings_path, settings_text)
        .map_err(|e| format!("Не удалось записать settings.json сборки: {e}"))?;

    let (mods_size, mods_count) = cache_service::dir_size_and_count(&dir.join("mods"));
    let (res_size, res_count) = cache_service::dir_size_and_count(&dir.join("resourcepacks"));
    let (shader_size, shader_count) = cache_service::dir_size_and_count(&dir.join("shaderpacks"));
    let total_size_bytes = mods_size
        .saturating_add(res_size)
        .saturating_add(shader_size);

    let directory = dir
        .to_str()
        .ok_or("Путь к папке сборки не в UTF-8")?
        .to_string();

    Ok(InstanceProfileSummary {
        id,
        name,
        icon_path,
        game_version,
        loader,
        loader_version,
        created_at,
        play_time_seconds: 0,
        mods_count,
        resourcepacks_count: res_count,
        shaderpacks_count: shader_count,
        total_size_bytes,
        directory,
    })
}

#[command]
pub fn get_profile_icon_data_uri(profile_id: String) -> Result<Option<String>, String> {
    let profile_dir = instance_dir(&profile_id)?;
    if !profile_dir.is_dir() {
        return Ok(None);
    }

    let cfg_icon = instance_config_path(&profile_id)
        .ok()
        .filter(|path| path.is_file())
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<InstanceConfig>(&text).ok())
        .and_then(|cfg| cfg.icon_path);

    match resolve_profile_icon_file(&profile_dir, cfg_icon.as_deref()) {
        Some(path) => image_path_to_data_uri(&path),
        None => Ok(None),
    }
}

#[command]
pub fn get_profiles() -> Result<Vec<InstanceProfileSummary>, String> {
    load_all_instance_profiles()
}

#[command]
pub fn get_profile_play_time_seconds(profile_id: String) -> Result<u64, String> {
    let cfg_path = instance_config_path(&profile_id)?;
    if !cfg_path.exists() {
        return Ok(0);
    }
    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Ошибка чтения config.json для playtime: {e}"))?;
    let cfg: InstanceConfig = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка разбора config.json для playtime: {e}"))?;
    Ok(cfg.play_time_seconds)
}

#[command]
pub fn create_profile(
    name: String,
    game_version: String,
    loader: String,
    loader_version: Option<String>,
    icon_source_path: Option<String>,
    initial_settings: Option<InstanceSettings>,
) -> Result<InstanceProfileSummary, String> {
    create_profile_impl(
        name,
        game_version,
        loader,
        loader_version,
        icon_source_path,
        initial_settings,
    )
}

#[command]
pub async fn add_profile_files(
    id: String,
    category: String,
    files: Vec<String>,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let root = instance_dir(&id)?;
    if !root.exists() {
        return Err("Папка сборки не найдена".to_string());
    }

    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестная категория контента сборки: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };

    let target_dir = root.join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку '{subdir}' для сборки: {e}"))?;

    for src in files {
        let src_path = PathBuf::from(&src);
        if !src_path.exists() {
            continue;
        }
        let file_name = match src_path.file_name().and_then(|n| n.to_str()) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => continue,
        };
        let dest_path = target_dir.join(&file_name);
        if let Some(parent) = dest_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку для файла сборки: {e}"))?;
        }
        tokio::fs::copy(&src_path, &dest_path)
            .await
            .map_err(|e| format!("Не удалось скопировать файл сборки {:?}: {e}", src_path))?;
    }

    Ok(())
}

