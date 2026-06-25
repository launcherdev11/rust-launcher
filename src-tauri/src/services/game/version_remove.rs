use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::app::paths::{game_root_dir, versions_dir};
use crate::services::game::version_types::{parse_forge_id, parse_neoforge_id, FabricProfile};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionDeleteScope {
    Game,
    Loader,
    All,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInstallDetails {
    pub game_version: String,
    pub has_game_files: bool,
    pub has_loader: bool,
    pub loader_versions: Vec<String>,
    pub profile_ids: Vec<String>,
    pub loader_version_id: Option<String>,
}

fn remove_dir_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|e| format!("Не удалось удалить {:?}: {e}", path))?;
    }
    Ok(())
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.is_file() {
        std::fs::remove_file(path).map_err(|e| format!("Не удалось удалить {:?}: {e}", path))?;
    }
    Ok(())
}

fn game_version_has_files(mc: &str) -> Result<bool, String> {
    let root = game_root_dir()?;
    let vers_root = versions_dir()?;
    let json = vers_root.join(mc).join(format!("{mc}.json"));
    let jar_root = root.join(format!("{mc}.jar"));
    let jar_vers = vers_root.join(mc).join(format!("{mc}.jar"));
    Ok(json.is_file() || jar_root.is_file() || jar_vers.is_file())
}

fn remove_game_version_files(mc: &str) -> Result<(), String> {
    let root = game_root_dir()?;
    let vers_root = versions_dir()?;
    remove_dir_if_exists(&vers_root.join(mc))?;
    remove_file_if_exists(&root.join(format!("{mc}.jar")))?;
    Ok(())
}

fn extract_loader_version_from_profile_id(profile_id: &str, game_version: &str) -> Option<String> {
    let prefix = if profile_id.starts_with("quilt-loader-") {
        "quilt-loader-"
    } else if profile_id.starts_with("fabric-loader-") {
        "fabric-loader-"
    } else {
        return None;
    };
    let rest = profile_id.strip_prefix(prefix)?;
    let suffix = format!("-{game_version}");
    rest.strip_suffix(&suffix).map(|s| s.to_string())
}

fn try_read_fabric_profile(path: &Path) -> Option<FabricProfile> {
    let s = std::fs::read_to_string(path).ok()?;
    if s.trim().is_empty() {
        return None;
    }
    serde_json::from_str(&s).ok()
}

fn find_mod_loader_profiles(
    game_version: &str,
    quilt: bool,
) -> Result<Vec<(String, String)>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(vec![]);
    }
    let prefix = if quilt { "quilt-loader-" } else { "fabric-loader-" };
    let mut out = Vec::new();
    for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
        let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let profile_path = path.join("profile.json");
        if !profile_path.exists() {
            continue;
        }
        let Some(profile) = try_read_fabric_profile(&profile_path) else {
            eprintln!(
                "[Versions] Пропущен повреждённый profile.json: {}",
                profile_path.display()
            );
            continue;
        };
        if !profile.id.starts_with(prefix) || profile.inherits_from != game_version {
            continue;
        }
        let folder_id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if folder_id.is_empty() {
            continue;
        }
        let loader_version = extract_loader_version_from_profile_id(&profile.id, game_version)
            .unwrap_or_else(|| profile.id.clone());
        out.push((folder_id, loader_version));
    }
    out.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(out)
}

pub(crate) fn remove_fabric_profiles_for_game_version(game_version: &str) -> Result<(), String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(());
    }
    let suffix = format!("-{game_version}");
    for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
        let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let folder_id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let matches_name = folder_id.starts_with("fabric-loader-") && folder_id.ends_with(&suffix);
        let matches_profile = if !matches_name {
            let profile_path = path.join("profile.json");
            try_read_fabric_profile(&profile_path).is_some_and(|profile| {
                profile.id.starts_with("fabric-loader-") && profile.inherits_from == game_version
            })
        } else {
            false
        };
        if matches_name || matches_profile {
            remove_dir_if_exists(&path)?;
        }
    }
    Ok(())
}

fn remove_mod_loader_profiles(game_version: &str, quilt: bool) -> Result<(), String> {
    let profiles = find_mod_loader_profiles(game_version, quilt)?;
    let vers_root = versions_dir()?;
    for (folder_id, _) in profiles {
        remove_dir_if_exists(&vers_root.join(&folder_id))?;
    }
    Ok(())
}

fn forge_loader_dir_exists(version_id: &str) -> Result<bool, String> {
    let vers_root = versions_dir()?;
    let json = vers_root
        .join(version_id)
        .join(format!("{version_id}.json"));
    Ok(json.is_file())
}

fn remove_forge_loader(version_id: &str) -> Result<(), String> {
    let vers_root = versions_dir()?;
    let root = game_root_dir()?;
    remove_dir_if_exists(&vers_root.join(version_id))?;
    remove_dir_if_exists(&root.join("forge_installers").join(version_id))?;
    Ok(())
}

fn resolve_game_and_loader_ids(loader: &str, item_id: &str) -> Result<(String, Option<String>), String> {
    match loader {
        "forge" => {
            let (mc, build) = parse_forge_id(item_id)
                .ok_or_else(|| format!("Некорректный id Forge: {item_id}"))?;
            let loader_id = format!("{mc}-forge-{build}");
            Ok((mc, Some(loader_id)))
        }
        "neoforge" => {
            let (mc, build) = parse_neoforge_id(item_id)
                .ok_or_else(|| format!("Некорректный id NeoForge: {item_id}"))?;
            let loader_id = format!("{mc}-neoforge-{build}");
            Ok((mc, Some(loader_id)))
        }
        "fabric" | "quilt" => Ok((item_id.to_string(), None)),
        _ => Ok((item_id.to_string(), None)),
    }
}

#[tauri::command]
pub fn get_version_install_details(loader: String, item_id: String) -> Result<VersionInstallDetails, String> {
    let (game_version, loader_version_id) = resolve_game_and_loader_ids(&loader, &item_id)?;
    let has_game_files = game_version_has_files(&game_version)?;

    let (has_loader, loader_versions, profile_ids) = match loader.as_str() {
        "fabric" => {
            let profiles = find_mod_loader_profiles(&game_version, false)?;
            let versions: Vec<String> = profiles.iter().map(|(_, lv)| lv.clone()).collect();
            let ids: Vec<String> = profiles.iter().map(|(id, _)| id.clone()).collect();
            (!profiles.is_empty(), versions, ids)
        }
        "quilt" => {
            let profiles = find_mod_loader_profiles(&game_version, true)?;
            let versions: Vec<String> = profiles.iter().map(|(_, lv)| lv.clone()).collect();
            let ids: Vec<String> = profiles.iter().map(|(id, _)| id.clone()).collect();
            (!profiles.is_empty(), versions, ids)
        }
        "forge" | "neoforge" => {
            let vid = loader_version_id.clone().unwrap_or_default();
            let has = if vid.is_empty() {
                false
            } else {
                forge_loader_dir_exists(&vid)?
            };
            let build = match loader.as_str() {
                "forge" => parse_forge_id(&item_id).map(|(_, b)| b),
                _ => parse_neoforge_id(&item_id).map(|(_, b)| b),
            };
            (
                has,
                build.map(|b| vec![b]).unwrap_or_default(),
                vec![],
            )
        }
        _ => (false, vec![], vec![]),
    };

    Ok(VersionInstallDetails {
        game_version,
        has_game_files,
        has_loader,
        loader_versions,
        profile_ids,
        loader_version_id,
    })
}

#[tauri::command]
pub fn delete_minecraft_installation(
    loader: String,
    item_id: String,
    scope: VersionDeleteScope,
) -> Result<(), String> {
    let (game_version, loader_version_id) = resolve_game_and_loader_ids(&loader, &item_id)?;

    match loader.as_str() {
        "vanilla" => {
            remove_game_version_files(&game_version)?;
        }
        "fabric" => match scope {
            VersionDeleteScope::Game => remove_game_version_files(&game_version)?,
            VersionDeleteScope::Loader => remove_mod_loader_profiles(&game_version, false)?,
            VersionDeleteScope::All => {
                remove_mod_loader_profiles(&game_version, false)?;
                remove_game_version_files(&game_version)?;
            }
        },
        "quilt" => match scope {
            VersionDeleteScope::Game => remove_game_version_files(&game_version)?,
            VersionDeleteScope::Loader => remove_mod_loader_profiles(&game_version, true)?,
            VersionDeleteScope::All => {
                remove_mod_loader_profiles(&game_version, true)?;
                remove_game_version_files(&game_version)?;
            }
        },
        "forge" | "neoforge" => {
            let vid = loader_version_id
                .ok_or_else(|| format!("Некорректный id версии: {item_id}"))?;
            match scope {
                VersionDeleteScope::Game => remove_game_version_files(&game_version)?,
                VersionDeleteScope::Loader => remove_forge_loader(&vid)?,
                VersionDeleteScope::All => {
                    remove_forge_loader(&vid)?;
                    remove_game_version_files(&game_version)?;
                }
            }
        }
        _ => return Err(format!("Неизвестный загрузчик: {loader}")),
    }

    Ok(())
}
