use std::collections::HashSet;

use tauri::command;

use crate::app::paths::{instance_dir, instance_settings_path};
use crate::infra::fs_atomic::{backup_path_for, read_to_string_with_backup, write_atomic};
use crate::models::InstanceSettings;
use crate::services::game::profiles::{profile_content_subdir, resolve_profile_item_path};

fn read_settings(profile_id: &str) -> Result<InstanceSettings, String> {
    let path = instance_settings_path(profile_id)?;
    if !path.exists() && !backup_path_for(&path).exists() {
        return Ok(InstanceSettings::default());
    }
    let text = read_to_string_with_backup(&path)
        .ok_or_else(|| format!("Ошибка чтения settings.json: {}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора settings.json: {e}"))
}

pub(crate) fn pinned_items(profile_id: &str, subdir: &str) -> HashSet<String> {
    read_settings(profile_id)
        .ok()
        .and_then(|mut settings| settings.pinned_items.remove(subdir))
        .map(|names| names.into_iter().collect())
        .unwrap_or_default()
}

#[command]
pub fn set_profile_item_pinned(
    id: String,
    category: String,
    filename: String,
    pinned: bool,
) -> Result<(), String> {
    let subdir = profile_content_subdir(&category)?;
    let content_dir = instance_dir(&id)?.join(subdir);
    if pinned && resolve_profile_item_path(&content_dir, &filename).is_none() {
        return Err(format!("Файл {filename} не найден в сборке"));
    }

    let mut settings = read_settings(&id)?;
    let names = settings.pinned_items.entry(subdir.to_string()).or_default();
    if pinned {
        names.insert(filename);
    } else {
        names.remove(&filename);
    }
    names.retain(|name| resolve_profile_item_path(&content_dir, name).is_some());
    if names.is_empty() {
        settings.pinned_items.remove(subdir);
    }

    let text = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Ошибка сериализации settings.json: {e}"))?;
    write_atomic(&instance_settings_path(&id)?, text)
        .map_err(|e| format!("Не удалось записать settings.json: {e}"))
}
