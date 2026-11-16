use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use futures_util::stream::{self, StreamExt};
use reqwest::header::USER_AGENT;
use crate::app::paths::{instance_config_path, instance_dir};
use crate::models::profile::InstanceConfig;
use crate::services::game::content_pins::pinned_items;
use crate::services::game::content_snapshots::UpdateSnapshot;
use crate::services::game::download::save_modrinth_file;
use crate::services::game::profiles::{
    profile_item_display_name, profile_item_is_disabled, profile_item_stored_name,
    read_instance_config, resolve_profile_item_path,
};
use crate::services::game::state::{CANCEL_DOWNLOAD, DEFAULT_DOWNLOAD_CONCURRENCY};

use crate::infra::api_base::curseforge_api_base;
use super::client::{modrinth_http_client, should_filter_by_loader, MODRINTH_API_BASE};
use super::content_metadata::curseforge_file_fingerprint;
use super::installed::index_content_dir_sha1;
use super::jar_compat::{compatible_loaders, jar_supports_game_version};
use super::types::{
    ApplyProfileContentUpdate, ApplyProfileContentUpdatesResult, FailedProfileContentUpdate,
    ModrinthVersion, ProfileContentUpdate, ProfileIncompatibleContent, ProfileVersionChangePreview,
    VersionChangeItemStatus, VersionChangePreviewItem, MODRINTH_USER_AGENT,
};

const VERSION_FILES_BATCH: usize = 96;
const MINECRAFT_GAME_ID: u32 = 432;

#[derive(Debug, serde::Serialize)]
struct VersionFilesRequest {
    hashes: Vec<String>,
    algorithm: String,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default, rename = "game_versions")]
    game_versions: Vec<String>,
}

pub(super) fn load_profile_config(profile_id: &str) -> Result<InstanceConfig, String> {
    let cfg_path = instance_config_path(profile_id)?;
    if !cfg_path.is_file() && !crate::infra::fs_atomic::backup_path_for(&cfg_path).is_file() {
        return Err("config.json сборки не найден".to_string());
    }
    read_instance_config(&cfg_path)
}

fn modrinth_category_from_profile_category(category: &str) -> Result<&'static str, String> {
    match category {
        "mods" => Ok("mods"),
        "resourcepacks" => Ok("resourcepacks"),
        "shaderpacks" => Ok("shaderpacks"),
        other => Err(format!(
            "Неизвестная категория: {other}. Ожидается mods, resourcepacks или shaderpacks."
        )),
    }
}

fn modrinth_download_category(category: &str) -> Result<&'static str, String> {
    match category {
        "mods" => Ok("mod"),
        "resourcepacks" => Ok("resourcepack"),
        "shaderpacks" => Ok("shader"),
        other => Err(format!(
            "Неизвестная категория: {other}. Ожидается mods, resourcepacks или shaderpacks."
        )),
    }
}

async fn post_version_files_map(
    client: &reqwest::Client,
    body: &VersionFilesRequest,
    endpoint: &str,
    context: &str,
) -> Result<HashMap<String, ModrinthVersion>, String> {
    let url = format!("{MODRINTH_API_BASE}/{endpoint}");
    let resp = client
        .post(&url)
        .header(USER_AGENT, MODRINTH_USER_AGENT)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("{context}: сеть: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "{context}: Modrinth HTTP {}",
            resp.status()
        ));
    }

    resp.json::<HashMap<String, ModrinthVersion>>()
        .await
        .map_err(|e| format!("{context}: ошибка разбора JSON: {e}"))
}


#[derive(Debug, serde::Serialize)]
struct CurseforgeFingerprintRequest {
    fingerprints: Vec<u32>,
}

#[derive(Debug, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CfFileHash {
    value: String,
    algo: u32,
}

#[derive(Debug, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CfFingerprintFile {
    id: u32,
    mod_id: u32,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    file_name: String,
    download_url: Option<String>,
    #[serde(default)]
    hashes: Vec<CfFileHash>,
    #[serde(default)]
    file_fingerprint: Option<u64>,
    #[serde(default)]
    #[serde(rename = "gameVersions")]
    game_versions: Vec<String>,
}

#[derive(Debug, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CfFingerprintExactMatch {
    file: CfFingerprintFile,
    #[serde(default)]
    latest_files: Vec<CfFingerprintFile>,
}

#[derive(Default)]
struct CfScanResult {
    updates: Vec<ProfileContentUpdate>,
    incompatible: Vec<ProfileIncompatibleContent>,
    identified: HashSet<String>,
}

fn cf_game_versions_include(versions: &[String], needle: &str) -> bool {
    let needle = needle.trim();
    if needle.is_empty() {
        return true;
    }
    versions
        .iter()
        .any(|gv| gv.trim().eq_ignore_ascii_case(needle))
}

const KNOWN_LOADER_TAGS: [&str; 4] = ["forge", "neoforge", "fabric", "quilt"];

fn modrinth_version_fits(version: &ModrinthVersion, game_version: &str, loader: &str) -> bool {
    let game_version = game_version.trim();
    let game_ok = version.game_versions.is_empty()
        || version.game_versions.iter().any(|g| g.trim() == game_version);
    let wanted = compatible_loaders(loader, game_version);
    let declares_known_loader = version
        .loaders
        .iter()
        .any(|l| KNOWN_LOADER_TAGS.iter().any(|k| l.eq_ignore_ascii_case(k)));
    let loader_ok = wanted.is_empty()
        || !declares_known_loader
        || version
            .loaders
            .iter()
            .any(|l| wanted.iter().any(|w| l.eq_ignore_ascii_case(w)));
    game_ok && loader_ok
}

fn cf_file_supports_loader(
    versions: &[String],
    file_name: &str,
    loader: &str,
    game_version: &str,
) -> bool {
    let l = loader.trim().to_ascii_lowercase();
    if l.is_empty() || l == "any" || l == "vanilla" {
        return true;
    }

    let loader_aliases = compatible_loaders(&l, game_version);
    if loader_aliases.is_empty() {
        return true;
    }

    let tags: Vec<String> = versions
        .iter()
        .map(|gv| gv.trim().to_ascii_lowercase())
        .filter(|g| KNOWN_LOADER_TAGS.contains(&g.as_str()))
        .collect();
    if !tags.is_empty() {
        return tags.iter().any(|t| loader_aliases.contains(&t.as_str()));
    }
    if loader_aliases.contains(&"forge") && l == "neoforge" {
        return true;
    }

    let name = file_name.to_ascii_lowercase();
    let named_neoforge = name.contains("neoforge");
    let named_forge = name.contains("forge") && !named_neoforge;
    let named_fabric = name.contains("fabric");
    let named_quilt = name.contains("quilt");

    match l.as_str() {
        "forge" => {
            if named_neoforge || named_fabric || named_quilt {
                return false;
            }
            true
        }
        "neoforge" => {
            if named_fabric || named_quilt {
                return false;
            }
            if named_forge && !named_neoforge {
                return false;
            }
            true
        }
        "fabric" => {
            if named_forge || named_neoforge {
                return false;
            }
            true
        }
        "quilt" => {
            if named_forge || named_neoforge {
                return false;
            }
            true
        }
        _ => true,
    }
}

fn pick_cf_latest_for_target<'a>(
    exact: &'a CfFingerprintExactMatch,
    game_version: &str,
    loader: &str,
) -> Option<&'a CfFingerprintFile> {
    exact
        .latest_files
        .iter()
        .filter(|f| {
            f.id > exact.file.id
                && f.download_url.as_ref().map(|u| !u.trim().is_empty()).unwrap_or(false)
                && cf_game_versions_include(&f.game_versions, game_version)
                && cf_file_supports_loader(&f.game_versions, &f.file_name, loader, game_version)
        })
        .max_by_key(|f| f.id)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfFingerprintResponseData {
    #[serde(default)]
    exact_matches: Vec<CfFingerprintExactMatch>,
}

#[derive(Debug, serde::Deserialize)]
struct CfFingerprintResponse {
    data: CfFingerprintResponseData,
}

fn cf_sha1_hex_from_hashes(hashes: &[CfFileHash]) -> Option<String> {
    let sha1 = hashes.iter().find(|h| h.algo == 1)?.value.clone();
    let trimmed = sha1.trim().to_ascii_lowercase();
    if trimmed.is_empty() { None } else { Some(trimmed) }
}

async fn check_curseforge_content(
    content_dir: &Path,
    enabled_by_filename: &HashMap<String, bool>,
    game_version: &str,
    loader: &str,
    pinned: &HashSet<String>,
) -> Result<CfScanResult, String> {
    let mut fingerprint_by_filename: HashMap<String, u32> = HashMap::new();
    let mut filename_by_fingerprint: HashMap<u32, String> = HashMap::new();

    let mut read_dir = tokio::fs::read_dir(content_dir)
        .await
        .map_err(|e| format!("Ошибка чтения папки {:?}: {e}", content_dir))?;
    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Ошибка чтения записи в {:?}: {e}", content_dir))?
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(stored_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let display = profile_item_display_name(stored_name);
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Ошибка чтения файла {:?}: {e}", path))?;
        let fp = curseforge_file_fingerprint(&bytes);
        fingerprint_by_filename.insert(display.clone(), fp);
        filename_by_fingerprint.insert(fp, display);
    }

    if fingerprint_by_filename.is_empty() {
        return Ok(CfScanResult::default());
    }

    let fingerprints: Vec<u32> = fingerprint_by_filename.values().copied().collect();
    let client = crate::infra::http::http_client(false);
    let url = format!("{}/fingerprints/{MINECRAFT_GAME_ID}", curseforge_api_base());

    let body = CurseforgeFingerprintRequest { fingerprints };
    let resp = client
        .post(&url)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("проверка обновлений CurseForge: сеть: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("проверка обновлений CurseForge: HTTP {status}: {body}"));
    }

    let parsed: CfFingerprintResponse = resp
        .json::<CfFingerprintResponse>()
        .await
        .map_err(|e| format!("проверка обновлений CurseForge: ошибка разбора JSON: {e}"))?;

    let mut updates = Vec::new();
    let mut incompatible = Vec::new();
    let mut identified: HashSet<String> = HashSet::new();
    let game_version_trimmed = game_version.trim();

    for exact in parsed.data.exact_matches {
        let local_filename = exact
            .file
            .file_fingerprint
            .and_then(|fp| u32::try_from(fp).ok())
            .and_then(|fp| filename_by_fingerprint.get(&fp))
            .cloned()
            .or_else(|| {
                let cf_name = exact.file.file_name.trim();
                if cf_name.is_empty() {
                    return None;
                }
                fingerprint_by_filename
                    .keys()
                    .find(|k| k.eq_ignore_ascii_case(cf_name))
                    .cloned()
            });

        let Some(filename) = local_filename else {
            continue;
        };
        if !identified.insert(filename.clone()) {
            continue;
        }

        let enabled = enabled_by_filename.get(&filename).copied().unwrap_or(true);
        let current = &exact.file;
        let current_supports = cf_game_versions_include(&current.game_versions, game_version_trimmed)
            && cf_file_supports_loader(
                &current.game_versions,
                &current.file_name,
                loader,
                game_version_trimmed,
            );

        let latest = if pinned.contains(&filename) {
            None
        } else {
            pick_cf_latest_for_target(&exact, game_version_trimmed, loader)
        };
        if let Some(latest) = latest {
            if let Some(download_url) = latest.download_url.clone() {
                let latest_sha1 = cf_sha1_hex_from_hashes(&latest.hashes);
                let title = if !latest.display_name.trim().is_empty() {
                    latest.display_name.trim().to_string()
                } else if !current.display_name.trim().is_empty() {
                    current.display_name.trim().to_string()
                } else {
                    latest.id.to_string()
                };
                let current_version_number = if !current.display_name.trim().is_empty() {
                    current.display_name.trim().to_string()
                } else {
                    current.id.to_string()
                };
                let latest_version_number = if !latest.display_name.trim().is_empty() {
                    latest.display_name.trim().to_string()
                } else {
                    latest.id.to_string()
                };

                updates.push(ProfileContentUpdate {
                    filename: filename.clone(),
                    enabled,
                    project_id: latest.mod_id.to_string(),
                    title,
                    current_version_id: current.id.to_string(),
                    current_version_number,
                    latest_version_id: latest.id.to_string(),
                    latest_version_number,
                    latest_url: download_url,
                    latest_filename: latest.file_name.clone(),
                    latest_sha1,
                });
                continue;
            }
        }

        if !current_supports {
            let title = if !current.display_name.trim().is_empty() {
                current.display_name.trim().to_string()
            } else {
                filename.clone()
            };
            incompatible.push(ProfileIncompatibleContent {
                filename,
                enabled,
                title,
                project_id: Some(current.mod_id.to_string()),
            });
        }
    }

    Ok(CfScanResult {
        updates,
        incompatible,
        identified,
    })
}

fn version_display_title(version: &ModrinthVersion) -> String {
    if !version.name.trim().is_empty() {
        return version.name.trim().to_string();
    }
    if !version.version_number.trim().is_empty() {
        return version.version_number.trim().to_string();
    }
    version.project_id.clone()
}

fn build_updates_for_batch(
    sha_by_filename: &HashMap<String, String>,
    enabled_by_filename: &HashMap<String, bool>,
    current_map: &HashMap<String, ModrinthVersion>,
    latest_map: &HashMap<String, ModrinthVersion>,
    pinned: &HashSet<String>,
) -> Vec<ProfileContentUpdate> {
    let mut updates = Vec::new();

    for (filename, sha1) in sha_by_filename {
        if pinned.contains(filename) {
            continue;
        }
        let Some(current) = current_map.get(sha1) else {
            continue;
        };
        let Some(latest) = latest_map.get(sha1) else {
            continue;
        };
        if current.id == latest.id {
            continue;
        }
        let Some(file) = latest.primary_file() else {
            continue;
        };

        updates.push(ProfileContentUpdate {
            filename: filename.clone(),
            enabled: *enabled_by_filename.get(filename).unwrap_or(&true),
            project_id: latest.project_id.clone(),
            title: version_display_title(latest),
            current_version_id: current.id.clone(),
            current_version_number: if current.version_number.is_empty() {
                current.id.clone()
            } else {
                current.version_number.clone()
            },
            latest_version_id: latest.id.clone(),
            latest_version_number: if latest.version_number.is_empty() {
                latest.id.clone()
            } else {
                latest.version_number.clone()
            },
            latest_url: file.url.clone(),
            latest_filename: file.filename.clone(),
            latest_sha1: file.sha1_hex(),
        });
    }

    updates
}

fn build_incompatible_for_batch(
    sha_by_filename: &HashMap<String, String>,
    enabled_by_filename: &HashMap<String, bool>,
    current_map: &HashMap<String, ModrinthVersion>,
    latest_map: &HashMap<String, ModrinthVersion>,
    game_version: &str,
    loader: &str,
    pinned: &HashSet<String>,
) -> Vec<ProfileIncompatibleContent> {
    let mut out = Vec::new();

    for (filename, sha1) in sha_by_filename {
        let Some(current) = current_map.get(sha1) else {
            continue;
        };
        if latest_map.contains_key(sha1) && !pinned.contains(filename) {
            continue;
        }
        if modrinth_version_fits(current, game_version, loader) {
            continue;
        }
        out.push(ProfileIncompatibleContent {
            filename: filename.clone(),
            enabled: *enabled_by_filename.get(filename).unwrap_or(&true),
            title: version_display_title(current),
            project_id: Some(current.project_id.clone()),
        });
    }

    out
}

async fn read_enabled_by_filename(content_dir: &Path) -> Result<HashMap<String, bool>, String> {
    let mut enabled_by_filename = HashMap::new();
    let mut read_dir = tokio::fs::read_dir(content_dir)
        .await
        .map_err(|e| format!("Ошибка чтения папки {:?}: {e}", content_dir))?;
    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Ошибка чтения записи в {:?}: {e}", content_dir))?
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(stored_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let display = profile_item_display_name(stored_name);
        enabled_by_filename.insert(display, !profile_item_is_disabled(stored_name));
    }
    Ok(enabled_by_filename)
}

async fn fetch_modrinth_version_maps(
    hashes: &[String],
    category: &str,
    loader: &str,
    game_version: &str,
) -> Result<(HashMap<String, ModrinthVersion>, HashMap<String, ModrinthVersion>), String> {
    let loaders = if category == "mods" && should_filter_by_loader(loader) {
        let compatible = compatible_loaders(loader, game_version);
        if compatible.is_empty() {
            vec![loader.to_string()]
        } else {
            compatible.into_iter().map(str::to_string).collect()
        }
    } else {
        Vec::new()
    };
    let game_versions = vec![game_version.to_string()];

    let client = modrinth_http_client();
    let mut current_map = HashMap::new();
    let mut latest_map = HashMap::new();

    for chunk in hashes.chunks(VERSION_FILES_BATCH) {
        let identify_body = VersionFilesRequest {
            hashes: chunk.to_vec(),
            algorithm: "sha1".to_string(),
            loaders: Vec::new(),
            game_versions: Vec::new(),
        };
        let update_body = VersionFilesRequest {
            hashes: chunk.to_vec(),
            algorithm: "sha1".to_string(),
            loaders: loaders.clone(),
            game_versions: game_versions.clone(),
        };

        let identified = post_version_files_map(
            &client,
            &identify_body,
            "version_files",
            "идентификация файлов Modrinth",
        )
        .await?;
        current_map.extend(identified);

        let latest = post_version_files_map(
            &client,
            &update_body,
            "version_files/update",
            "проверка обновлений Modrinth",
        )
        .await?;
        latest_map.extend(latest);
    }

    Ok((current_map, latest_map))
}

#[derive(Default)]
struct ContentScan {
    sha_by_filename: HashMap<String, String>,
    enabled_by_filename: HashMap<String, bool>,
    current_map: HashMap<String, ModrinthVersion>,
    latest_map: HashMap<String, ModrinthVersion>,
    updates: Vec<ProfileContentUpdate>,
    cf_incompatible: Vec<ProfileIncompatibleContent>,
    cf_identified: HashSet<String>,
    lookup_failed: bool,
}

async fn scan_content_for_target(
    content_dir: &Path,
    category: &str,
    game_version: &str,
    loader: &str,
    pinned: &HashSet<String>,
) -> ContentScan {
    let mut scan = ContentScan::default();

    match index_content_dir_sha1(content_dir).await {
        Ok(index) => scan.sha_by_filename = index,
        Err(e) => {
            eprintln!("Content index failed (ignored): {e}");
            scan.lookup_failed = true;
            return scan;
        }
    }
    if scan.sha_by_filename.is_empty() {
        return scan;
    }
    scan.enabled_by_filename = read_enabled_by_filename(content_dir).await.unwrap_or_default();

    let hashes: Vec<String> = scan.sha_by_filename.values().cloned().collect();
    match fetch_modrinth_version_maps(&hashes, category, loader, game_version).await {
        Ok((current_map, latest_map)) => {
            scan.current_map = current_map;
            scan.latest_map = latest_map;
        }
        Err(e) => {
            eprintln!("Modrinth content check failed (ignored): {e}");
            scan.lookup_failed = true;
        }
    }

    scan.updates = build_updates_for_batch(
        &scan.sha_by_filename,
        &scan.enabled_by_filename,
        &scan.current_map,
        &scan.latest_map,
        pinned,
    );

    match check_curseforge_content(
        content_dir,
        &scan.enabled_by_filename,
        game_version,
        loader,
        pinned,
    )
    .await
    {
        Ok(mut cf) => {
            let sha_by_filename = &scan.sha_by_filename;
            let current_map = &scan.current_map;
            cf.updates.retain(|u| {
                !sha_by_filename
                    .get(&u.filename)
                    .is_some_and(|sha1| current_map.contains_key(sha1))
            });
            scan.updates.extend(cf.updates);
            scan.cf_incompatible = cf.incompatible;
            scan.cf_identified = cf.identified;
        }
        Err(e) => {
            eprintln!("CurseForge content check failed (ignored): {e}");
            scan.lookup_failed = true;
        }
    }

    scan.updates.sort_by(|a, b| a.title.cmp(&b.title));
    scan
}

#[derive(Default)]
struct IncompatibleScan {
    incompatible: Vec<ProfileIncompatibleContent>,
    jar_supported: HashSet<String>,
    jar_titles: HashMap<String, String>,
}

async fn collect_incompatible_content(
    scan: &ContentScan,
    content_dir: &Path,
    category: &str,
    game_version: &str,
    loader: &str,
    pinned: &HashSet<String>,
) -> IncompatibleScan {
    let updatable: HashSet<String> = scan.updates.iter().map(|u| u.filename.clone()).collect();

    let mut incompatible = build_incompatible_for_batch(
        &scan.sha_by_filename,
        &scan.enabled_by_filename,
        &scan.current_map,
        &scan.latest_map,
        game_version,
        loader,
        pinned,
    );

    let known: HashSet<String> = incompatible.iter().map(|i| i.filename.clone()).collect();
    for item in &scan.cf_incompatible {
        if !updatable.contains(&item.filename) && !known.contains(&item.filename) {
            incompatible.push(item.clone());
        }
    }

    let mut result = IncompatibleScan::default();
    if category == "mods" {
        let candidates: Vec<(String, std::path::PathBuf)> = scan
            .sha_by_filename
            .keys()
            .filter(|filename| !updatable.contains(*filename))
            .filter_map(|filename| {
                let path = resolve_profile_item_path(content_dir, filename)?;
                Some((filename.clone(), path))
            })
            .collect();
        let game_version_owned = game_version.to_string();
        let loader_owned = loader.to_string();
        let jar_verdicts = tokio::task::spawn_blocking(move || {
            candidates
                .into_iter()
                .map(|(filename, path)| {
                    let verdict = jar_supports_game_version(&path, &game_version_owned, &loader_owned);
                    (filename, verdict)
                })
                .collect::<HashMap<String, (Option<bool>, Option<String>)>>()
        })
        .await
        .unwrap_or_default();

        incompatible.retain(|i| !matches!(jar_verdicts.get(&i.filename), Some((Some(true), _))));

        let known: HashSet<String> = incompatible.iter().map(|i| i.filename.clone()).collect();
        for (filename, (supports, title)) in jar_verdicts {
            if let Some(title) = title.clone() {
                result.jar_titles.insert(filename.clone(), title);
            }
            if supports == Some(true) {
                result.jar_supported.insert(filename.clone());
            }
            if supports != Some(false) || known.contains(&filename) {
                continue;
            }
            incompatible.push(ProfileIncompatibleContent {
                enabled: *scan.enabled_by_filename.get(&filename).unwrap_or(&true),
                title: title.unwrap_or_else(|| filename.clone()),
                filename,
                project_id: None,
            });
        }
    }

    incompatible.retain(|i| !updatable.contains(&i.filename));
    incompatible.sort_by(|a, b| a.title.cmp(&b.title));
    result.incompatible = incompatible;
    result
}

fn classify_version_change_items(
    scan: &ContentScan,
    incompatible: &IncompatibleScan,
    pinned: &HashSet<String>,
) -> Vec<VersionChangePreviewItem> {
    let updates: HashMap<&str, &ProfileContentUpdate> =
        scan.updates.iter().map(|u| (u.filename.as_str(), u)).collect();
    let incompatible_by_name: HashMap<&str, &ProfileIncompatibleContent> = incompatible
        .incompatible
        .iter()
        .map(|i| (i.filename.as_str(), i))
        .collect();

    let mut items: Vec<VersionChangePreviewItem> = scan
        .sha_by_filename
        .iter()
        .map(|(filename, sha1)| {
            let current = scan.current_map.get(sha1);
            let update = updates.get(filename.as_str());
            let blocked = incompatible_by_name.get(filename.as_str());
            let status = if update.is_some() {
                VersionChangeItemStatus::Update
            } else if blocked.is_some() {
                VersionChangeItemStatus::Incompatible
            } else if current.is_some()
                || scan.cf_identified.contains(filename)
                || incompatible.jar_supported.contains(filename)
            {
                VersionChangeItemStatus::Compatible
            } else {
                VersionChangeItemStatus::Unknown
            };
            let title = update
                .map(|u| u.title.clone())
                .or_else(|| blocked.map(|i| i.title.clone()))
                .or_else(|| incompatible.jar_titles.get(filename).cloned())
                .or_else(|| current.map(version_display_title))
                .unwrap_or_else(|| filename.clone());
            VersionChangePreviewItem {
                filename: filename.clone(),
                title,
                enabled: *scan.enabled_by_filename.get(filename).unwrap_or(&true),
                pinned: pinned.contains(filename),
                status,
                current_version: update
                    .map(|u| u.current_version_number.clone())
                    .or_else(|| current.map(|c| c.version_number.clone()))
                    .filter(|v| !v.is_empty()),
                latest_version: update.map(|u| u.latest_version_number.clone()),
            }
        })
        .collect();
    items.sort_by(|a, b| {
        a.status
            .cmp(&b.status)
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    items
}

#[tauri::command]
pub async fn check_profile_content_updates(
    profile_id: String,
    category: String,
) -> Result<Vec<ProfileContentUpdate>, String> {
    let cfg = load_profile_config(&profile_id)?;
    let game_version = cfg.game_version.trim().to_string();
    if game_version.is_empty() {
        return Err("В сборке не указана версия Minecraft.".to_string());
    }

    let loader = cfg.loader.trim().to_lowercase();
    let subdir = modrinth_category_from_profile_category(&category)?;
    let profile_dir = instance_dir(&profile_id)?;
    let content_dir = profile_dir.join(subdir);
    if !content_dir.is_dir() {
        return Ok(Vec::new());
    }

    let pinned = pinned_items(&profile_id, subdir);
    let scan = scan_content_for_target(&content_dir, &category, &game_version, &loader, &pinned).await;
    Ok(scan.updates)
}

#[tauri::command]
pub async fn check_profile_incompatible_content(
    profile_id: String,
    category: String,
) -> Result<Vec<ProfileIncompatibleContent>, String> {
    let cfg = load_profile_config(&profile_id)?;
    let game_version = cfg.game_version.trim().to_string();
    if game_version.is_empty() {
        return Err("В сборке не указана версия Minecraft.".to_string());
    }

    let loader = cfg.loader.trim().to_lowercase();
    let subdir = modrinth_category_from_profile_category(&category)?;
    let profile_dir = instance_dir(&profile_id)?;
    let content_dir = profile_dir.join(subdir);
    if !content_dir.is_dir() {
        return Ok(Vec::new());
    }

    let pinned = pinned_items(&profile_id, subdir);
    let scan = scan_content_for_target(&content_dir, &category, &game_version, &loader, &pinned).await;
    let result =
        collect_incompatible_content(&scan, &content_dir, &category, &game_version, &loader, &pinned)
            .await;
    Ok(result.incompatible)
}

#[tauri::command]
pub async fn preview_profile_version_change(
    profile_id: String,
    game_version: String,
    loader: String,
) -> Result<ProfileVersionChangePreview, String> {
    let game_version = game_version.trim().to_string();
    if game_version.is_empty() {
        return Err("Версия Minecraft не указана".to_string());
    }
    let loader = loader.trim().to_lowercase();
    let content_dir = instance_dir(&profile_id)?.join("mods");
    if !content_dir.is_dir() {
        return Ok(ProfileVersionChangePreview::default());
    }

    if loader == "vanilla" {
        return Ok(ProfileVersionChangePreview {
            mods_ignored_by_vanilla: read_enabled_by_filename(&content_dir).await?.len(),
            ..Default::default()
        });
    }

    let pinned = pinned_items(&profile_id, "mods");
    let scan = scan_content_for_target(&content_dir, "mods", &game_version, &loader, &pinned).await;
    let incompatible =
        collect_incompatible_content(&scan, &content_dir, "mods", &game_version, &loader, &pinned)
            .await;
    Ok(ProfileVersionChangePreview {
        items: classify_version_change_items(&scan, &incompatible, &pinned),
        lookup_failed: scan.lookup_failed,
        mods_ignored_by_vanilla: 0,
    })
}

#[tauri::command]
pub async fn apply_profile_content_updates(
    profile_id: String,
    category: String,
    updates: Vec<ApplyProfileContentUpdate>,
) -> Result<ApplyProfileContentUpdatesResult, String> {
    if updates.is_empty() {
        return Ok(ApplyProfileContentUpdatesResult {
            applied: 0,
            failed: Vec::new(),
        });
    }

    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let download_category = modrinth_download_category(&category)?;
    let subdir = modrinth_category_from_profile_category(&category)?;
    let profile_dir = instance_dir(&profile_id)?;
    let content_dir = profile_dir.join(subdir);
    tokio::fs::create_dir_all(&content_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку '{subdir}': {e}"))?;

    let snapshot = Arc::new(UpdateSnapshot::begin(&profile_id, subdir, &content_dir)?);
    let applied = Arc::new(AtomicU32::new(0));
    let results: Vec<Result<(), FailedProfileContentUpdate>> = stream::iter(updates.into_iter())
        .map(|item| {
            let content_dir = content_dir.clone();
            let profile_id = profile_id.clone();
            let applied = Arc::clone(&applied);
            let snapshot = Arc::clone(&snapshot);
            async move {
                let target_display = if item.latest_filename.trim().is_empty() {
                    item.filename.as_str()
                } else {
                    item.latest_filename.as_str()
                };
                let fail = |error: String| FailedProfileContentUpdate {
                    filename: item.filename.clone(),
                    error,
                };
                let stored_name = profile_item_stored_name(target_display, item.enabled);
                let dest_path = content_dir.join(&stored_name);

                let old_path = resolve_profile_item_path(&content_dir, &item.filename);
                if let Some(old) = old_path.as_deref() {
                    if old == dest_path {
                        snapshot.stash_copy(old, &stored_name);
                    }
                }

                save_modrinth_file(
                    download_category,
                    &item.latest_url,
                    &stored_name,
                    Some(&profile_id),
                    item.latest_sha1.as_deref(),
                )
                .await
                .map_err(&fail)?;

                if let Some(old_path) = old_path {
                    if old_path != dest_path && old_path.is_file() {
                        snapshot.stash_move(&old_path, Some(&stored_name));
                        if old_path.is_file() {
                            let _ = tokio::fs::remove_file(&dest_path).await;
                            return Err(fail(format!(
                                "Файл {} занят другой программой. Закройте игру и повторите обновление.",
                                item.filename
                            )));
                        }
                    }
                }

                let sibling_name = profile_item_stored_name(target_display, !item.enabled);
                if sibling_name != stored_name {
                    let sibling_path = content_dir.join(&sibling_name);
                    if sibling_path.is_file() {
                        snapshot.stash_move(&sibling_path, None);
                    }
                }

                applied.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        })
        .buffer_unordered(DEFAULT_DOWNLOAD_CONCURRENCY)
        .collect()
        .await;

    let snapshot = Arc::try_unwrap(snapshot)
        .map_err(|_| "Не удалось завершить снимок обновления".to_string())?;
    let failed: Vec<FailedProfileContentUpdate> =
        results.into_iter().filter_map(Result::err).collect();
    let applied = applied.load(Ordering::SeqCst);

    if applied == 0 {
        if let Some(first) = failed.into_iter().next() {
            snapshot.rollback();
            return Err(first.error);
        }
        snapshot.finish();
        return Ok(ApplyProfileContentUpdatesResult {
            applied,
            failed: Vec::new(),
        });
    }
    snapshot.finish();

    Ok(ApplyProfileContentUpdatesResult { applied, failed })
}

#[cfg(test)]
mod curseforge_update_tests {
    use super::*;

    fn file(id: u32, game_version: &str) -> CfFingerprintFile {
        CfFingerprintFile {
            id,
            mod_id: 1,
            display_name: format!("build {id}"),
            file_name: format!("mod-{id}.jar"),
            download_url: Some(format!("https://edge.forgecdn.net/{id}.jar")),
            hashes: Vec::new(),
            file_fingerprint: None,
            game_versions: vec![game_version.to_string()],
        }
    }

    fn exact(current: u32, latest: &[u32]) -> CfFingerprintExactMatch {
        CfFingerprintExactMatch {
            file: file(current, "1.20.1"),
            latest_files: latest.iter().map(|id| file(*id, "1.20.1")).collect(),
        }
    }

    #[test]
    fn older_files_are_not_offered_as_updates() {
        assert!(pick_cf_latest_for_target(&exact(200, &[100, 150]), "1.20.1", "any").is_none());
    }

    #[test]
    fn newest_matching_file_wins() {
        let m = exact(100, &[120, 300, 200]);
        assert_eq!(pick_cf_latest_for_target(&m, "1.20.1", "any").map(|f| f.id), Some(300));
    }

    #[test]
    fn other_game_versions_are_skipped() {
        let m = CfFingerprintExactMatch {
            file: file(100, "1.20.1"),
            latest_files: vec![file(500, "1.21.1"), file(150, "1.20.1")],
        };
        assert_eq!(pick_cf_latest_for_target(&m, "1.20.1", "any").map(|f| f.id), Some(150));
    }
}

#[cfg(test)]
mod pinned_content_tests {
    use super::*;
    use crate::services::modrinth::types::{ModrinthFileHashes, ModrinthVersionFile};

    fn version(id: &str, game_version: &str) -> ModrinthVersion {
        ModrinthVersion {
            id: id.to_string(),
            project_id: "project".to_string(),
            name: format!("Mod {id}"),
            version_number: id.to_string(),
            dependencies: Vec::new(),
            files: vec![ModrinthVersionFile {
                id: format!("file-{id}"),
                url: format!("https://cdn.modrinth.com/{id}.jar"),
                filename: format!("mod-{id}.jar"),
                primary: true,
                hashes: ModrinthFileHashes::default(),
            }],
            game_versions: vec![game_version.to_string()],
            loaders: vec!["fabric".to_string()],
        }
    }

    fn scan_with_update() -> ContentScan {
        ContentScan {
            sha_by_filename: HashMap::from([("mod.jar".to_string(), "sha".to_string())]),
            enabled_by_filename: HashMap::from([("mod.jar".to_string(), true)]),
            current_map: HashMap::from([("sha".to_string(), version("old", "1.20.1"))]),
            latest_map: HashMap::from([("sha".to_string(), version("new", "1.21.1"))]),
            ..Default::default()
        }
    }

    #[test]
    fn pinned_file_is_not_offered_as_update() {
        let scan = scan_with_update();
        let updates = |pinned: &HashSet<String>| {
            build_updates_for_batch(
                &scan.sha_by_filename,
                &scan.enabled_by_filename,
                &scan.current_map,
                &scan.latest_map,
                pinned,
            )
        };
        assert_eq!(updates(&HashSet::new()).len(), 1);
        assert!(updates(&HashSet::from(["mod.jar".to_string()])).is_empty());
    }

    #[test]
    fn pinned_file_that_does_not_fit_target_is_incompatible() {
        let scan = scan_with_update();
        let blocked = |pinned: &HashSet<String>| {
            build_incompatible_for_batch(
                &scan.sha_by_filename,
                &scan.enabled_by_filename,
                &scan.current_map,
                &scan.latest_map,
                "1.21.1",
                "fabric",
                pinned,
            )
        };
        assert!(blocked(&HashSet::new()).is_empty());
        assert_eq!(blocked(&HashSet::from(["mod.jar".to_string()])).len(), 1);
    }

    #[test]
    fn preview_marks_unidentified_jar_as_unknown_and_sorts_problems_first() {
        let mut scan = scan_with_update();
        scan.sha_by_filename.insert("custom.jar".to_string(), "local".to_string());
        scan.updates = build_updates_for_batch(
            &scan.sha_by_filename,
            &scan.enabled_by_filename,
            &scan.current_map,
            &scan.latest_map,
            &HashSet::new(),
        );
        let items = classify_version_change_items(&scan, &IncompatibleScan::default(), &HashSet::new());
        assert_eq!(items[0].filename, "custom.jar");
        assert_eq!(items[0].status, VersionChangeItemStatus::Unknown);
        assert_eq!(items[1].status, VersionChangeItemStatus::Update);
        assert_eq!(items[1].latest_version.as_deref(), Some("new"));
    }

    #[test]
    fn preview_trusts_jar_metadata_for_local_mods() {
        let mut scan = ContentScan::default();
        scan.sha_by_filename.insert("custom.jar".to_string(), "local".to_string());
        let incompatible = IncompatibleScan {
            jar_supported: HashSet::from(["custom.jar".to_string()]),
            jar_titles: HashMap::from([("custom.jar".to_string(), "My Fork".to_string())]),
            ..Default::default()
        };
        let items = classify_version_change_items(&scan, &incompatible, &HashSet::new());
        assert_eq!(items[0].status, VersionChangeItemStatus::Compatible);
        assert_eq!(items[0].title, "My Fork");
    }
}
