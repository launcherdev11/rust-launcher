use crate::app::paths::{instance_config_path, instance_dir};
use crate::services::game::profiles::{
    profile_item_display_name, profile_item_is_disabled, read_instance_config,
    resolve_profile_item_path,
};

use super::jar_compat::{read_jar_mod_info, JarModInfo};

#[tauri::command]
pub async fn scan_profile_mod_jars(profile_id: String) -> Result<Vec<JarModInfo>, String> {
    let profile_dir = instance_dir(&profile_id)?;
    // Multi-loader jars carry several metadata files; read the one this profile's loader uses.
    let loader = instance_config_path(&profile_id)
        .and_then(|p| read_instance_config(&p))
        .map(|cfg| cfg.loader.trim().to_ascii_lowercase())
        .ok()
        .filter(|l| !l.is_empty());
    let content_dir = profile_dir.join("mods");
    if !content_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files: Vec<(String, bool, std::path::PathBuf)> = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&content_dir)
        .await
        .map_err(|e| format!("Не удалось прочитать папку mods: {e}"))?;
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(stored_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let lower = stored_name.to_ascii_lowercase();
        if !(lower.ends_with(".jar")
            || lower.ends_with(".jar.disabled")
            || lower.ends_with(".zip")
            || lower.ends_with(".zip.disabled"))
        {
            continue;
        }
        let display = profile_item_display_name(stored_name);
        let enabled = !profile_item_is_disabled(stored_name);
        let resolved = resolve_profile_item_path(&content_dir, &display)
            .unwrap_or_else(|| path.clone());
        files.push((display, enabled, resolved));
    }

    files.sort_by(|a, b| a.0.to_ascii_lowercase().cmp(&b.0.to_ascii_lowercase()));

    let infos = tokio::task::spawn_blocking(move || {
        files
            .into_iter()
            .map(|(filename, enabled, path)| {
                read_jar_mod_info(&path, &filename, enabled, loader.as_deref())
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| format!("Сканирование модов прервано: {e}"))?;

    Ok(infos)
}
