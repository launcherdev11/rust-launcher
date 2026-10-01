use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::command;

use crate::app::paths::{instance_dir, instance_settings_path};
use crate::infra::fs_atomic::read_to_string_with_backup;
use crate::models::{InstanceProfileSummary, InstanceSettings};
use crate::services::game::cache as cache_service;
use crate::services::game::profiles::{
    create_profile_impl, instance_profile_summary_for_dir, read_instance_config,
    write_instance_config,
};

const SKIP_ON_DUPLICATE: &[&str] = &["logs", "crash-reports", ".cache", "cache"];

const CLEANABLE_REL_PATHS: &[&str] = &[
    "logs",
    "crash-reports",
    ".cache",
    "cache",
    ".fabric/remappedJars",
];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileWorldInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub last_played: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDiskFolderUsage {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub file_count: u32,
    pub cleanable: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDiskUsage {
    pub total_bytes: u64,
    pub folders: Vec<ProfileDiskFolderUsage>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCleanupResult {
    pub freed_bytes: u64,
    pub removed: Vec<String>,
}

fn copy_dir_filtered(src: &Path, dest: &Path, skip_top: &[&str]) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("Не удалось создать папку {}: {e}", dest.display()))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Ошибка чтения {}: {e}", src.display()))?
    {
        let entry = entry.map_err(|e| format!("Ошибка чтения {}: {e}", src.display()))?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if skip_top.iter().any(|s| name_str.eq_ignore_ascii_case(s)) {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&name);
        if from.is_dir() {
            copy_dir_filtered(&from, &to, &[])?;
        } else if from.is_file() {
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
            }
            std::fs::copy(&from, &to).map_err(|e| {
                format!(
                    "Не удалось скопировать {} → {}: {e}",
                    from.display(),
                    to.display()
                )
            })?;
        }
    }
    Ok(())
}

fn mtime_secs(path: &Path) -> Option<u64> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

fn remove_path_tree(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let (bytes, _) = cache_service::dir_size_and_count(path);
    if path.is_file() {
        std::fs::remove_file(path)
            .map_err(|e| format!("Не удалось удалить {}: {e}", path.display()))?;
    } else {
        std::fs::remove_dir_all(path)
            .map_err(|e| format!("Не удалось удалить {}: {e}", path.display()))?;
    }
    Ok(bytes)
}

#[command]
pub fn duplicate_profile(profile_id: String) -> Result<InstanceProfileSummary, String> {
    let src_dir = instance_dir(&profile_id)?;
    if !src_dir.is_dir() {
        return Err("Папка сборки не найдена".to_string());
    }
    let cfg = read_instance_config(&src_dir.join("config.json"))?;
    let settings_path = instance_settings_path(&profile_id)?;
    let initial_settings: Option<InstanceSettings> = if settings_path.exists() {
        read_to_string_with_backup(&settings_path)
            .and_then(|t| serde_json::from_str(&t).ok())
    } else {
        None
    };

    let copy_name = format!("{} (копия)", cfg.name);
    let icon_src = src_dir
        .join("icon.png")
        .to_str()
        .filter(|_| src_dir.join("icon.png").is_file())
        .map(|s| s.to_string());

    let summary = create_profile_impl(
        copy_name,
        cfg.game_version.clone(),
        cfg.loader.clone(),
        cfg.loader_version.clone(),
        icon_src,
        initial_settings,
    )?;

    let dest = instance_dir(&summary.id)?;
    copy_dir_filtered(&src_dir, &dest, SKIP_ON_DUPLICATE)?;

    let dest_cfg_path = dest.join("config.json");
    let mut dest_cfg = read_instance_config(&dest_cfg_path)?;
    dest_cfg.name = summary.name.clone();
    dest_cfg.id = summary.id.clone();
    dest_cfg.play_time_seconds = 0;
    dest_cfg.last_played_at = None;
    dest_cfg.created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if dest.join("icon.png").is_file() {
        dest_cfg.icon_path = dest.join("icon.png").to_str().map(|s| s.to_string());
    }
    write_instance_config(&dest_cfg_path, &dest_cfg)?;

    instance_profile_summary_for_dir(&dest_cfg, &dest)
}

#[command]
pub fn list_profile_worlds(profile_id: String) -> Result<Vec<ProfileWorldInfo>, String> {
    let dir = instance_dir(&profile_id)?;
    let saves = dir.join("saves");
    if !saves.is_dir() {
        return Ok(Vec::new());
    }
    let mut worlds = Vec::new();
    for entry in std::fs::read_dir(&saves)
        .map_err(|e| format!("Не удалось прочитать saves: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Не удалось прочитать элемент saves: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let (size_bytes, _) = cache_service::dir_size_and_count(&path);
        let last_played = mtime_secs(&path.join("level.dat"))
            .or_else(|| mtime_secs(&path.join("session.lock")))
            .or_else(|| mtime_secs(&path));
        let path_str = path
            .to_str()
            .ok_or_else(|| format!("Путь мира «{name}» не в UTF-8"))?
            .to_string();
        worlds.push(ProfileWorldInfo {
            name,
            path: path_str,
            size_bytes,
            last_played,
        });
    }
    worlds.sort_by(|a, b| {
        b.last_played
            .unwrap_or(0)
            .cmp(&a.last_played.unwrap_or(0))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(worlds)
}

#[command]
pub fn get_profile_disk_usage(profile_id: String) -> Result<ProfileDiskUsage, String> {
    let dir = instance_dir(&profile_id)?;
    if !dir.is_dir() {
        return Err("Папка сборки не найдена".to_string());
    }

    let known: &[(&str, &str, bool)] = &[
        ("mods", "mods", false),
        ("resourcepacks", "resourcepacks", false),
        ("shaderpacks", "shaderpacks", false),
        ("saves", "saves", false),
        ("config", "config", false),
        ("datapacks", "datapacks", false),
        ("logs", "logs", true),
        ("crash-reports", "crash-reports", true),
        ("cache", "cache", true),
        (".cache", ".cache", true),
        (".fabric", ".fabric", true),
    ];

    let mut folders = Vec::new();
    let mut accounted: Vec<PathBuf> = Vec::new();
    let mut total = 0u64;

    for (id, name, cleanable) in known {
        let path = dir.join(id);
        if !path.exists() {
            continue;
        }
        let (size_bytes, file_count) = cache_service::dir_size_and_count(&path);
        if size_bytes == 0 && file_count == 0 {
            continue;
        }
        total = total.saturating_add(size_bytes);
        accounted.push(path);
        folders.push(ProfileDiskFolderUsage {
            id: (*id).to_string(),
            name: (*name).to_string(),
            size_bytes,
            file_count,
            cleanable: *cleanable,
        });
    }

    let (root_bytes, root_files) = cache_service::dir_size_and_count(&dir);
    let accounted_bytes: u64 = folders.iter().map(|f| f.size_bytes).sum();
    let other_bytes = root_bytes.saturating_sub(accounted_bytes);
    if other_bytes > 0 {
        folders.push(ProfileDiskFolderUsage {
            id: "other".to_string(),
            name: "other".to_string(),
            size_bytes: other_bytes,
            file_count: root_files,
            cleanable: false,
        });
        total = root_bytes;
    }

    folders.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(ProfileDiskUsage {
        total_bytes: total.max(root_bytes),
        folders,
    })
}

#[command]
pub fn cleanup_profile(
    profile_id: String,
    targets: Option<Vec<String>>,
) -> Result<ProfileCleanupResult, String> {
    let dir = instance_dir(&profile_id)?;
    if !dir.is_dir() {
        return Err("Папка сборки не найдена".to_string());
    }

    let wanted: Vec<String> = targets.unwrap_or_else(|| {
        CLEANABLE_REL_PATHS
            .iter()
            .map(|s| (*s).to_string())
            .collect()
    });

    let mut freed = 0u64;
    let mut removed = Vec::new();

    for rel in wanted {
        let rel = rel.replace('\\', "/");
        if rel.is_empty() || rel.contains("..") {
            continue;
        }
        let allowed = CLEANABLE_REL_PATHS
            .iter()
            .any(|p| rel.eq_ignore_ascii_case(p))
            || rel.eq_ignore_ascii_case(".fabric")
            || rel.eq_ignore_ascii_case("cache")
            || rel.eq_ignore_ascii_case(".cache")
            || rel.eq_ignore_ascii_case("logs")
            || rel.eq_ignore_ascii_case("crash-reports");
        if !allowed {
            continue;
        }
        let path = dir.join(&rel);
        match remove_path_tree(&path) {
            Ok(bytes) if bytes > 0 || path.exists() == false => {
                if bytes > 0 {
                    freed = freed.saturating_add(bytes);
                    removed.push(rel);
                } else if !path.exists() {
                    //already gone
                }
            }
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }

    Ok(ProfileCleanupResult { freed_bytes: freed, removed })
}

#[command]
pub fn get_profile_instance_settings(profile_id: String) -> Result<InstanceSettings, String> {
    let path = instance_settings_path(&profile_id)?;
    if !path.exists() {
        return Ok(InstanceSettings::default());
    }
    let text = read_to_string_with_backup(&path)
        .ok_or_else(|| format!("Ошибка чтения settings.json: {}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора settings.json: {e}"))
}