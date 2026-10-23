use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::stream::{self, StreamExt};
use rand::distributions::Alphanumeric;
use rand::Rng;
use tauri::command;

use crate::app::paths::{instance_config_path, instance_dir, lazy_mods_path};
use crate::infra::fs_atomic::{backup_path_for, write_atomic};
use crate::models::lazy_mods::{
    LazyApplyReport, LazyModFailure, LazyModItem, LazyModSet, LazyModsFile,
};
use crate::services::curseforge::{curseforge_get_mod_files, download_curseforge_file};
use crate::services::game::download::modrinth_content_subdir;
use crate::services::game::profiles::read_instance_config;
use crate::services::modrinth::client::modrinth_http_client;
use crate::services::modrinth::{
    install_modrinth_targets, resolve_latest_project_targets, ModrinthDownloadTarget,
};

const RESOLVE_CONCURRENCY: usize = 6;

fn generate_set_id() -> String {
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

fn load_sets_file() -> Result<LazyModsFile, String> {
    let path = lazy_mods_path()?;
    if !path.is_file() {
        return Ok(LazyModsFile { sets: Vec::new() });
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("Ошибка чтения lazy_mods.json: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора lazy_mods.json: {e}"))
}

fn save_sets_file(file: &LazyModsFile) -> Result<(), String> {
    let path = lazy_mods_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для lazy_mods.json: {e}"))?;
    }
    let text = serde_json::to_string_pretty(file)
        .map_err(|e| format!("Ошибка сериализации lazy_mods.json: {e}"))?;
    write_atomic(&path, text)
}

fn validate_item(item: &LazyModItem) -> Result<(), String> {
    if !matches!(item.provider.as_str(), "modrinth" | "curseforge") {
        return Err(format!("Неизвестный источник контента: {}", item.provider));
    }
    if !matches!(item.content_type.as_str(), "mod" | "resourcepack" | "shader") {
        return Err(format!("Неизвестный тип контента: {}", item.content_type));
    }
    if item.project_id.trim().is_empty() {
        return Err("У элемента набора не указан проект.".to_string());
    }
    if item.provider == "curseforge" && item.project_id.trim().parse::<u32>().is_err() {
        return Err(format!("Некорректный id проекта CurseForge: {}", item.project_id));
    }
    Ok(())
}

fn same_project(a: &LazyModItem, b: &LazyModItem) -> bool {
    a.provider == b.provider && a.project_id == b.project_id
}

fn merge_items(target: &mut Vec<LazyModItem>, incoming: Vec<LazyModItem>) -> Result<(), String> {
    for mut item in incoming {
        validate_item(&item)?;
        item.project_id = item.project_id.trim().to_string();
        match target.iter_mut().find(|existing| same_project(existing, &item)) {
            Some(existing) => *existing = item,
            None => target.push(item),
        }
    }
    Ok(())
}

fn find_set_mut<'a>(file: &'a mut LazyModsFile, set_id: &str) -> Result<&'a mut LazyModSet, String> {
    file.sets
        .iter_mut()
        .find(|s| s.id == set_id)
        .ok_or_else(|| "Набор не найден.".to_string())
}

#[command]
pub fn list_lazy_mod_sets() -> Result<Vec<LazyModSet>, String> {
    let mut sets = load_sets_file()?.sets;
    sets.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(sets)
}

#[command]
pub fn save_lazy_mod_set(
    id: Option<String>,
    name: String,
    auto_apply: bool,
    items: Option<Vec<LazyModItem>>,
) -> Result<LazyModSet, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Укажите название набора.".to_string());
    }
    let mut file = load_sets_file()?;

    if let Some(set_id) = id.filter(|s| !s.trim().is_empty()) {
        let set = find_set_mut(&mut file, &set_id)?;
        set.name = trimmed_name.to_string();
        set.auto_apply = auto_apply;
        if let Some(items) = items {
            let mut next = Vec::new();
            merge_items(&mut next, items)?;
            set.items = next;
        }
        let updated = set.clone();
        save_sets_file(&file)?;
        return Ok(updated);
    }

    let mut new_items = Vec::new();
    merge_items(&mut new_items, items.unwrap_or_default())?;
    let set = LazyModSet {
        id: generate_set_id(),
        name: trimmed_name.to_string(),
        items: new_items,
        auto_apply,
        created_at: now_unix_secs(),
    };
    file.sets.push(set.clone());
    save_sets_file(&file)?;
    Ok(set)
}

#[command]
pub fn delete_lazy_mod_set(set_id: String) -> Result<(), String> {
    let mut file = load_sets_file()?;
    let before = file.sets.len();
    file.sets.retain(|s| s.id != set_id);
    if file.sets.len() == before {
        return Err("Набор не найден.".to_string());
    }
    save_sets_file(&file)
}

#[command]
pub fn add_lazy_mod_items(set_id: String, items: Vec<LazyModItem>) -> Result<LazyModSet, String> {
    let mut file = load_sets_file()?;
    let set = find_set_mut(&mut file, &set_id)?;
    merge_items(&mut set.items, items)?;
    let updated = set.clone();
    save_sets_file(&file)?;
    Ok(updated)
}

#[command]
pub fn remove_lazy_mod_item(
    set_id: String,
    provider: String,
    project_id: String,
) -> Result<LazyModSet, String> {
    let mut file = load_sets_file()?;
    let set = find_set_mut(&mut file, &set_id)?;
    set.items
        .retain(|i| !(i.provider == provider && i.project_id == project_id));
    let updated = set.clone();
    save_sets_file(&file)?;
    Ok(updated)
}

enum ResolvedItem {
    Modrinth(Vec<ModrinthDownloadTarget>),
    Curseforge {
        mod_id: u32,
        file_id: u32,
        file_name: String,
    },
    Unavailable,
}

fn item_label(item: &LazyModItem) -> String {
    let title = item.title.trim();
    if title.is_empty() {
        item.project_id.clone()
    } else {
        title.to_string()
    }
}

async fn resolve_item(
    item: &LazyModItem,
    game_version: &str,
    loader: &str,
) -> Result<ResolvedItem, String> {
    let effective_loader = if item.content_type == "mod" { loader } else { "" };

    if item.provider == "modrinth" {
        let client = modrinth_http_client();
        let targets =
            resolve_latest_project_targets(&client, &item.project_id, game_version, effective_loader)
                .await?;
        return Ok(match targets {
            Some(targets) if !targets.is_empty() => ResolvedItem::Modrinth(targets),
            _ => ResolvedItem::Unavailable,
        });
    }

    let mod_id: u32 = item
        .project_id
        .parse()
        .map_err(|_| format!("Некорректный id проекта CurseForge: {}", item.project_id))?;
    let files = curseforge_get_mod_files(
        mod_id,
        game_version.to_string(),
        effective_loader.to_string(),
    )
    .await?;
    let candidate = files.into_iter().find(|f| {
        f.game_versions.is_empty() || f.game_versions.iter().any(|v| v == game_version)
    });
    Ok(match candidate {
        Some(f) => ResolvedItem::Curseforge {
            mod_id,
            file_id: f.id,
            file_name: f.file_name,
        },
        None => ResolvedItem::Unavailable,
    })
}

enum InstallOutcome {
    Installed,
    AlreadyPresent,
}

async fn install_resolved(
    resolved: ResolvedItem,
    item: &LazyModItem,
    profile_id: &str,
) -> Result<Option<InstallOutcome>, String> {
    match resolved {
        ResolvedItem::Unavailable => Ok(None),
        ResolvedItem::Modrinth(mut targets) => {
            install_modrinth_targets(&item.content_type, &mut targets, Some(profile_id)).await?;
            Ok(Some(if targets.iter().any(|t| !t.skipped) {
                InstallOutcome::Installed
            } else {
                InstallOutcome::AlreadyPresent
            }))
        }
        ResolvedItem::Curseforge {
            mod_id,
            file_id,
            file_name,
        } => {
            let subdir = modrinth_content_subdir(&item.content_type)?;
            let dest = instance_dir(profile_id)?.join(subdir).join(&file_name);
            if dest.is_file() {
                return Ok(Some(InstallOutcome::AlreadyPresent));
            }
            download_curseforge_file(
                mod_id,
                file_id,
                item.content_type.clone(),
                file_name,
                Some(profile_id.to_string()),
            )
            .await?;
            Ok(Some(InstallOutcome::Installed))
        }
    }
}

#[command]
pub async fn apply_lazy_mod_sets(
    profile_id: String,
    set_ids: Vec<String>,
) -> Result<LazyApplyReport, String> {
    let mut report = LazyApplyReport::default();
    if set_ids.is_empty() {
        return Ok(report);
    }

    let cfg_path = instance_config_path(&profile_id)?;
    if !cfg_path.is_file() && !backup_path_for(&cfg_path).is_file() {
        return Err("Сборка не найдена.".to_string());
    }
    let cfg = read_instance_config(&cfg_path)?;
    let loader = cfg.loader.trim().to_ascii_lowercase();
    let game_version = cfg.game_version.trim().to_string();

    let file = load_sets_file()?;
    let mut items: Vec<LazyModItem> = Vec::new();
    for set in file.sets.iter().filter(|s| set_ids.contains(&s.id)) {
        for item in &set.items {
            if !items.iter().any(|existing| same_project(existing, item)) {
                items.push(item.clone());
            }
        }
    }

    let mut candidates: Vec<LazyModItem> = Vec::new();
    for item in items {
        if loader == "vanilla" && item.content_type == "mod" {
            report.unavailable.push(item_label(&item));
        } else {
            candidates.push(item);
        }
    }

    let resolved: Vec<(LazyModItem, Result<ResolvedItem, String>)> = stream::iter(candidates)
        .map(|item| {
            let game_version = game_version.clone();
            let loader = loader.clone();
            async move {
                let result = resolve_item(&item, &game_version, &loader).await;
                (item, result)
            }
        })
        .buffer_unordered(RESOLVE_CONCURRENCY)
        .collect()
        .await;

    for (item, result) in resolved {
        let label = item_label(&item);
        let outcome = match result {
            Ok(resolved) => install_resolved(resolved, &item, &profile_id).await,
            Err(e) => Err(e),
        };
        match outcome {
            Ok(Some(InstallOutcome::Installed)) => report.installed += 1,
            Ok(Some(InstallOutcome::AlreadyPresent)) => report.already_present += 1,
            Ok(None) => report.unavailable.push(label),
            Err(reason) => report.failed.push(LazyModFailure { title: label, reason }),
        }
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(provider: &str, project_id: &str, content_type: &str) -> LazyModItem {
        LazyModItem {
            provider: provider.to_string(),
            project_id: project_id.to_string(),
            content_type: content_type.to_string(),
            title: String::new(),
            icon_url: None,
        }
    }

    #[test]
    fn merge_replaces_same_project_and_keeps_others() {
        let mut items = vec![item("modrinth", "AANobbMI", "mod")];
        let mut updated = item("modrinth", "AANobbMI", "mod");
        updated.title = "Sodium".to_string();
        merge_items(&mut items, vec![updated, item("curseforge", "306612", "mod")]).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Sodium");
    }

    #[test]
    fn rejects_unknown_provider_type_and_bad_curseforge_id() {
        assert!(validate_item(&item("github", "x", "mod")).is_err());
        assert!(validate_item(&item("modrinth", "x", "world")).is_err());
        assert!(validate_item(&item("curseforge", "abc", "mod")).is_err());
        assert!(validate_item(&item("modrinth", " ", "mod")).is_err());
        assert!(validate_item(&item("curseforge", "306612", "shader")).is_ok());
    }
}
