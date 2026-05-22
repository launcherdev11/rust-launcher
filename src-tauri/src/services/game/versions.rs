use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;

use crate::app::paths::{game_root_dir, versions_dir};
use crate::infra::http::http_client;
use crate::services::game::core::download_text_with_retries;
use crate::services::game::settings::load_settings_from_disk;
use crate::services::game::state::{
    CANCEL_DOWNLOAD, DEFAULT_DOWNLOAD_RETRIES, FABRIC_META_LOADERS, FORGE_MAVEN_BASE, FORGE_PROMOTIONS_URL,
    NEOFORGE_MAVEN_BASE, NEOFORGE_MAVEN_METADATA_URL, VERSION_MANIFEST_URL,
};
use crate::services::game::version_types::{
    FabricLoaderEntry, FabricProfile, ForgePromotionsSlim, ForgeVersionSummary,
    NeoForgeVersionSummary, VersionManifest, VersionSummary,
};

pub(crate) fn parse_neoforge_mc_version(build: &str) -> Option<String> {
    let mut parts = build.split('.');
    let major = parts.next()?;
    let minor = parts.next()?;
    if !major.chars().all(|c| c.is_ascii_digit()) || !minor.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("1.{major}.{minor}"))
}
pub(crate) async fn load_all_versions() -> Result<Vec<VersionSummary>, String> {
    let client = http_client(false);
    let text = download_text_with_retries(&client, VERSION_MANIFEST_URL, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка загрузки манифеста версий: {e}"))?;
    let manifest: VersionManifest = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора манифеста версий: {e}. Первые символы ответа: {head}")
    })?;

    let mut summaries: Vec<VersionSummary> =
        manifest.versions.into_iter().map(VersionSummary::from).collect();

    summaries.sort_by(|a, b| b.release_time.cmp(&a.release_time));

    Ok(summaries)
}

pub(crate) async fn get_mojang_version_url(version_id: &str) -> Result<String, String> {
    let client = http_client(false);
    let text = download_text_with_retries(&client, VERSION_MANIFEST_URL, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка запроса манифеста: {e}"))?;
    let manifest: VersionManifest = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка разбора манифеста: {e}"))?;
    manifest
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .map(|v| v.url)
        .ok_or_else(|| format!("Версия {version_id} не найдена в манифесте Mojang"))
}
#[tauri::command]
pub async fn fetch_all_versions() -> Result<Vec<VersionSummary>, String> {
    load_all_versions().await
}

#[tauri::command]
pub async fn fetch_vanilla_releases() -> Result<Vec<VersionSummary>, String> {
    let mut versions = load_all_versions().await?;
    versions.retain(|v| v.version_type == "release");
    Ok(versions)
}


#[tauri::command]
pub async fn fetch_forge_versions() -> Result<Vec<ForgeVersionSummary>, String> {

    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let settings = load_settings_from_disk();
    let direct_client = http_client(false);
    let text = match download_text_with_retries(&direct_client, FORGE_PROMOTIONS_URL, DEFAULT_DOWNLOAD_RETRIES).await {
        Ok(text) => text,
        Err(direct_err) => {
            if settings.forge_proxy_fallback {
                let proxy_client = http_client(true);
                download_text_with_retries(&proxy_client, FORGE_PROMOTIONS_URL, DEFAULT_DOWNLOAD_RETRIES)
                    .await
                    .map_err(|proxy_err| format!(
                        "Ошибка загрузки Forge promotions без прокси: {direct_err}; через прокси: {proxy_err}"
                    ))?
            } else {
                return Err(format!("Ошибка загрузки Forge promotions: {direct_err}"));
            }
        }
    };

    let parsed: ForgePromotionsSlim = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка разбора Forge promotions JSON: {e}"))?;


    let mut chosen_by_mc: HashMap<String, String> = HashMap::new();
    for (promo_key, forge_build) in parsed.promos {
        let Some((mc_version, suffix)) = promo_key.rsplit_once('-') else {
            continue;
        };
        if suffix != "latest" && suffix != "recommended" {
            continue;
        }

        let entry = chosen_by_mc.entry(mc_version.to_string());
        let should_replace = match entry {
            std::collections::hash_map::Entry::Vacant(_) => true,
            std::collections::hash_map::Entry::Occupied(o) => {
                let existing = o.get();
                suffix == "recommended" || existing.is_empty()
            }
        };

        if should_replace {
            chosen_by_mc.insert(mc_version.to_string(), forge_build);
        }
    }

    let mut out: Vec<ForgeVersionSummary> = chosen_by_mc
        .into_iter()
        .map(|(mc_version, forge_build)| {
            let id = format!("{mc_version}-forge-{forge_build}");
            let installer_url = format!(
                "{FORGE_MAVEN_BASE}/{mc_version}-{forge_build}/forge-{mc_version}-{forge_build}-installer.jar"
            );
            ForgeVersionSummary {
                id,
                mc_version,
                forge_build,
                installer_url,
            }
        })
        .collect();

    out.sort_by(|a, b| b.mc_version.cmp(&a.mc_version));
    Ok(out)
}


#[tauri::command]
pub async fn fetch_neoforge_versions() -> Result<Vec<NeoForgeVersionSummary>, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let client = http_client(true);
    let metadata = download_text_with_retries(
        &client,
        NEOFORGE_MAVEN_METADATA_URL,
        DEFAULT_DOWNLOAD_RETRIES,
    )
    .await
    .map_err(|e| format!("Ошибка загрузки NeoForge metadata: {e}"))?;

    let mut out: Vec<NeoForgeVersionSummary> = Vec::new();
    for entry in metadata.match_indices("<version>") {
        let start = entry.0 + "<version>".len();
        let rest = &metadata[start..];
        let Some(end_rel) = rest.find("</version>") else {
            continue;
        };
        let build = rest[..end_rel].trim();
        if build.is_empty() || !build.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }
        let Some(mc_version) = parse_neoforge_mc_version(build) else {
            continue;
        };

        let id = format!("{mc_version}-neoforge-{build}");
        let installer_url = format!("{NEOFORGE_MAVEN_BASE}/{build}/neoforge-{build}-installer.jar");
        out.push(NeoForgeVersionSummary {
            id,
            mc_version,
            neoforge_build: build.to_string(),
            installer_url,
        });
    }

    out.sort_by(|a, b| b.neoforge_build.cmp(&a.neoforge_build));
    out.dedup_by(|a, b| a.neoforge_build == b.neoforge_build);
    Ok(out)
}


#[tauri::command]
pub async fn fetch_fabric_loaders(game_version: String) -> Result<Vec<String>, String> {
    let url = format!("{FABRIC_META_LOADERS}/{game_version}");
    let client = http_client(false);
    let text = download_text_with_retries(&client, &url, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка запроса списка Fabric: {e}"))?;
    let list: Vec<FabricLoaderEntry> = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора списка Fabric: {e}. Первые символы ответа: {head}")
    })?;
    let versions: Vec<String> = list
        .into_iter()
        .map(|e| e.loader.version)
        .collect();
    Ok(versions)
}


#[tauri::command]
pub fn get_installed_fabric_profile_id(game_version: String) -> Result<Option<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(None);
    }
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
        let s = std::fs::read_to_string(&profile_path)
            .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
        let profile: FabricProfile = serde_json::from_str(&s)
            .map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.id.starts_with("fabric-loader-") && profile.inherits_from == game_version {
            let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if !id.is_empty() {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}


#[tauri::command]
pub fn get_installed_quilt_profile_id(game_version: String) -> Result<Option<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(None);
    }
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
        let s = std::fs::read_to_string(&profile_path)
            .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
        let profile: FabricProfile = serde_json::from_str(&s)
            .map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.id.starts_with("quilt-loader-") && profile.inherits_from == game_version {
            let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if !id.is_empty() {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}


#[tauri::command]
pub fn list_installed_fabric_game_versions() -> Result<Vec<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(vec![]);
    }
    let mut out: HashSet<String> = HashSet::new();
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
        let s = std::fs::read_to_string(&profile_path)
            .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
        let profile: FabricProfile =
            serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.id.starts_with("fabric-loader-") && !profile.inherits_from.is_empty() {
            out.insert(profile.inherits_from);
        }
    }
    let mut result: Vec<String> = out.into_iter().collect();
    result.sort();
    Ok(result)
}


#[tauri::command]
pub fn list_installed_quilt_game_versions() -> Result<Vec<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(vec![]);
    }
    let mut out: HashSet<String> = HashSet::new();
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
        let s = std::fs::read_to_string(&profile_path)
            .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
        let profile: FabricProfile =
            serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.id.starts_with("quilt-loader-") && !profile.inherits_from.is_empty() {
            out.insert(profile.inherits_from);
        }
    }
    let mut result: Vec<String> = out.into_iter().collect();
    result.sort();
    Ok(result)
}


#[tauri::command]
pub fn list_installed_versions() -> Result<Vec<String>, String> {
    let root = game_root_dir()?;
    let vers_root = versions_dir()?;
    let mut ids = std::collections::HashSet::new();
    if root.exists() {
        for e in std::fs::read_dir(&root).map_err(|e| format!("Ошибка чтения папки игры: {e}"))? {
            let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
            let name = e.file_name();
            let name = name.to_str().ok_or("Неверная кодировка имени файла")?;
            if name.ends_with(".jar") {
                let id = name.strip_suffix(".jar").unwrap_or(name);
                ids.insert(id.to_string());
            }
        }
    }
    if vers_root.exists() {
        for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
            let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
            let path = e.path();
            if path.is_dir() {
                let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !id.is_empty()
                    && (path.join("profile.json").exists() || path.join(format!("{id}.json")).exists())
                {
                    ids.insert(id.to_string());
                }
            }
        }
    }
    let mut result: Vec<String> = ids.into_iter().collect();
    result.sort();
    Ok(result)
}

