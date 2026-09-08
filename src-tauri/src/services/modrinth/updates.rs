use std::collections::HashMap;
use std::path::Path;

use reqwest::header::USER_AGENT;
use crate::app::paths::{instance_config_path, instance_dir};
use crate::models::profile::InstanceConfig;
use crate::services::game::download::save_modrinth_file;
use crate::services::game::profiles::{
    profile_item_display_name, profile_item_is_disabled, profile_item_stored_name,
    resolve_profile_item_path,
};

use crate::infra::api_base::curseforge_api_base;
use super::client::{modrinth_http_client, should_filter_by_loader, MODRINTH_API_BASE};
use super::installed::index_content_dir_sha1;
use super::types::{
    ApplyProfileContentUpdate, ModrinthVersion, ProfileContentUpdate, ProfileIncompatibleContent,
    MODRINTH_USER_AGENT,
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

fn load_profile_config(profile_id: &str) -> Result<InstanceConfig, String> {
    let cfg_path = instance_config_path(profile_id)?;
    if !cfg_path.is_file() {
        return Err("config.json сборки не найден".to_string());
    }
    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Ошибка чтения config.json: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора config.json: {e}"))
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

fn is_ignored_in_curseforge_fingerprint(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

fn curseforge_file_fingerprint(buf: &[u8]) -> i32 {
    const multiplex: u32 = 1540483477;

    let mut normalized_len: u32 = 0;
    for &b in buf {
        if !is_ignored_in_curseforge_fingerprint(b) {
            normalized_len = normalized_len.wrapping_add(1);
        }
    }

    let mut num2: u32 = 1u32 ^ normalized_len;
    let mut num3: u32 = 0;
    let mut num4: u32 = 0;

    for &b in buf {
        if is_ignored_in_curseforge_fingerprint(b) {
            continue;
        }

        num3 |= (b as u32) << num4;
        num4 = num4.wrapping_add(8);

        if num4 == 32 {
            let num6: u32 = num3.wrapping_mul(multiplex);
            let num7: u32 = (num6 ^ (num6 >> 24)).wrapping_mul(multiplex);
            num2 = num2
                .wrapping_mul(multiplex)
                ^ num7;
            num3 = 0;
            num4 = 0;
        }
    }

    if num4 > 0 {
        num2 = (num2 ^ num3).wrapping_mul(multiplex);
    }

    let num6: u32 = (num2 ^ (num2 >> 13)).wrapping_mul(multiplex);
    let out: u32 = num6 ^ (num6 >> 15);
    out as i32
}

#[derive(Debug, serde::Serialize)]
struct CurseforgeFingerprintRequest {
    fingerprints: Vec<i32>,
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
    #[serde(rename = "gameVersions")]
    game_versions: Vec<String>,
}

#[derive(Debug, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CfFingerprintExactMatch {
    #[serde(default)]
    id: i32,
    file: CfFingerprintFile,
    #[serde(default)]
    latest_files: Vec<CfFingerprintFile>,
}

struct CfScanResult {
    updates: Vec<ProfileContentUpdate>,
    incompatible: Vec<ProfileIncompatibleContent>,
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

fn cf_file_supports_loader(versions: &[String], file_name: &str, loader: &str) -> bool {
    let l = loader.trim().to_ascii_lowercase();
    if l.is_empty() || l == "any" || l == "vanilla" {
        return true;
    }

    let loader_aliases: &[&str] = match l.as_str() {
        "forge" => &["forge"],
        "neoforge" => &["neoforge"],
        "fabric" => &["fabric"],
        "quilt" => &["quilt", "fabric"],
        _ => return true,
    };

    let has_loader_tag = versions.iter().any(|gv| {
        let g = gv.trim().to_ascii_lowercase();
        loader_aliases.iter().any(|a| g == *a)
    });
    if has_loader_tag {
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
    exact.latest_files.iter().find(|f| {
        f.id != exact.file.id
            && f.download_url.as_ref().map(|u| !u.trim().is_empty()).unwrap_or(false)
            && cf_game_versions_include(&f.game_versions, game_version)
            && cf_file_supports_loader(&f.game_versions, &f.file_name, loader)
    })
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
) -> Result<CfScanResult, String> {
    let mut fingerprint_by_filename: HashMap<String, i32> = HashMap::new();
    let mut filename_by_fingerprint: HashMap<i32, String> = HashMap::new();

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
        return Ok(CfScanResult {
            updates: Vec::new(),
            incompatible: Vec::new(),
        });
    }

    let fingerprints: Vec<i32> = fingerprint_by_filename.values().copied().collect();
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
    let mut seen: HashMap<String, bool> = HashMap::new();
    let game_version_trimmed = game_version.trim();

    for exact in parsed.data.exact_matches {
        let local_filename = filename_by_fingerprint
            .get(&exact.id)
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
        if seen.contains_key(&filename) {
            continue;
        }
        seen.insert(filename.clone(), true);

        let enabled = enabled_by_filename.get(&filename).copied().unwrap_or(true);
        let current = &exact.file;
        let current_supports = cf_game_versions_include(&current.game_versions, game_version_trimmed)
            && cf_file_supports_loader(&current.game_versions, &current.file_name, loader);

        if let Some(latest) = pick_cf_latest_for_target(&exact, game_version_trimmed, loader) {
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
) -> Vec<ProfileContentUpdate> {
    let mut updates = Vec::new();

    for (filename, sha1) in sha_by_filename {
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
) -> Vec<ProfileIncompatibleContent> {
    let mut out = Vec::new();

    for (filename, sha1) in sha_by_filename {
        let Some(current) = current_map.get(sha1) else {
            continue;
        };
        if latest_map.contains_key(sha1) {
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

async fn collect_modrinth_version_maps(
    content_dir: &Path,
    category: &str,
    loader: &str,
    game_version: &str,
) -> Result<
    (
        HashMap<String, String>,
        HashMap<String, bool>,
        HashMap<String, ModrinthVersion>,
        HashMap<String, ModrinthVersion>,
    ),
    String,
> {
    let sha_by_filename = index_content_dir_sha1(content_dir).await?;
    if sha_by_filename.is_empty() {
        return Ok((
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
        ));
    }

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

    let hashes: Vec<String> = sha_by_filename.values().cloned().collect();
    let loaders = if category == "mods" && should_filter_by_loader(loader) {
        vec![loader.to_string()]
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

    Ok((sha_by_filename, enabled_by_filename, current_map, latest_map))
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

    let (sha_by_filename, enabled_by_filename, current_map, latest_map) =
        match collect_modrinth_version_maps(&content_dir, &category, &loader, &game_version).await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Modrinth content updates check failed (ignored): {e}");
                (
                    index_content_dir_sha1(&content_dir).await.unwrap_or_default(),
                    HashMap::new(),
                    HashMap::new(),
                    HashMap::new(),
                )
            }
        };

    let enabled_by_filename = if enabled_by_filename.is_empty() && !sha_by_filename.is_empty() {
        let mut enabled = HashMap::new();
        if let Ok(mut read_dir) = tokio::fs::read_dir(&content_dir).await {
            while let Ok(Some(entry)) = read_dir.next_entry().await {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Some(stored_name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let display = profile_item_display_name(stored_name);
                enabled.insert(display, !profile_item_is_disabled(stored_name));
            }
        }
        enabled
    } else {
        enabled_by_filename
    };

    if sha_by_filename.is_empty() {
        return Ok(Vec::new());
    }

    let mut all_updates = build_updates_for_batch(
        &sha_by_filename,
        &enabled_by_filename,
        &current_map,
        &latest_map,
    );

    let modrinth_update_filenames: std::collections::HashSet<String> = all_updates
        .iter()
        .map(|u| u.filename.clone())
        .collect();

    if let Ok(cf) =
        check_curseforge_content(&content_dir, &enabled_by_filename, &game_version, &loader).await
    {
        let mut cf_updates = cf.updates;
        cf_updates.retain(|u| !modrinth_update_filenames.contains(&u.filename));
        all_updates.extend(cf_updates);
    } else {
        eprintln!("CurseForge content updates check failed (ignored).");
    }

    all_updates.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(all_updates)
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

    let (sha_by_filename, enabled_by_filename, current_map, latest_map) =
        match collect_modrinth_version_maps(&content_dir, &category, &loader, &game_version).await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Modrinth incompatible check failed (ignored): {e}");
                (
                    index_content_dir_sha1(&content_dir).await.unwrap_or_default(),
                    HashMap::new(),
                    HashMap::new(),
                    HashMap::new(),
                )
            }
        };

    let enabled_by_filename = if enabled_by_filename.is_empty() && !sha_by_filename.is_empty() {
        let mut enabled = HashMap::new();
        if let Ok(mut read_dir) = tokio::fs::read_dir(&content_dir).await {
            while let Ok(Some(entry)) = read_dir.next_entry().await {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Some(stored_name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let display = profile_item_display_name(stored_name);
                enabled.insert(display, !profile_item_is_disabled(stored_name));
            }
        }
        enabled
    } else {
        enabled_by_filename
    };

    if sha_by_filename.is_empty() {
        return Ok(Vec::new());
    }

    let mut updatable: std::collections::HashSet<String> = build_updates_for_batch(
        &sha_by_filename,
        &enabled_by_filename,
        &current_map,
        &latest_map,
    )
    .into_iter()
    .map(|u| u.filename)
    .collect();

    let mut incompatible = build_incompatible_for_batch(
        &sha_by_filename,
        &enabled_by_filename,
        &current_map,
        &latest_map,
    );

    if let Ok(cf) =
        check_curseforge_content(&content_dir, &enabled_by_filename, &game_version, &loader).await
    {
        for u in cf.updates {
            updatable.insert(u.filename);
        }
        let known: std::collections::HashSet<String> =
            incompatible.iter().map(|i| i.filename.clone()).collect();
        for item in cf.incompatible {
            if updatable.contains(&item.filename) || known.contains(&item.filename) {
                continue;
            }
            incompatible.push(item);
        }
    } else {
        eprintln!("CurseForge incompatible check failed (ignored).");
    }

    if category == "mods" {
        let known: std::collections::HashSet<String> =
            incompatible.iter().map(|i| i.filename.clone()).collect();
        for filename in sha_by_filename.keys() {
            if updatable.contains(filename) || known.contains(filename) {
                continue;
            }
            let Some(path) = resolve_profile_item_path(&content_dir, filename) else {
                continue;
            };
            let (supports, title) = super::jar_compat::jar_supports_game_version(&path, &game_version);
            if supports == Some(false) {
                incompatible.push(ProfileIncompatibleContent {
                    filename: filename.clone(),
                    enabled: *enabled_by_filename.get(filename).unwrap_or(&true),
                    title: title.unwrap_or_else(|| filename.clone()),
                    project_id: None,
                });
            }
        }
    }

    incompatible.retain(|i| !updatable.contains(&i.filename));
    incompatible.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(incompatible)
}

#[tauri::command]
pub async fn apply_profile_content_updates(
    profile_id: String,
    category: String,
    updates: Vec<ApplyProfileContentUpdate>,
) -> Result<u32, String> {
    if updates.is_empty() {
        return Ok(0);
    }

    let download_category = modrinth_download_category(&category)?;
    let subdir = modrinth_category_from_profile_category(&category)?;
    let profile_dir = instance_dir(&profile_id)?;
    let content_dir = profile_dir.join(subdir);
    tokio::fs::create_dir_all(&content_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку '{subdir}': {e}"))?;

    let mut applied = 0u32;

    for item in &updates {
        let target_display = if item.latest_filename.trim().is_empty() {
            item.filename.as_str()
        } else {
            item.latest_filename.as_str()
        };
        let stored_name = profile_item_stored_name(target_display, item.enabled);
        let dest_path = content_dir.join(&stored_name);

        save_modrinth_file(
            download_category,
            &item.latest_url,
            &stored_name,
            Some(&profile_id),
            item.latest_sha1.as_deref(),
        )
        .await?;

        if let Some(old_path) = resolve_profile_item_path(&content_dir, &item.filename) {
            if old_path != dest_path && old_path.is_file() {
                let _ = tokio::fs::remove_file(&old_path).await;
            }
        }

        let sibling_name = profile_item_stored_name(target_display, !item.enabled);
        if sibling_name != stored_name {
            let sibling_path = content_dir.join(&sibling_name);
            if sibling_path.is_file() {
                let _ = tokio::fs::remove_file(&sibling_path).await;
            }
        }

        applied += 1;
    }

    Ok(applied)
}
