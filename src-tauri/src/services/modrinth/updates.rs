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

use super::client::{modrinth_http_client, should_filter_by_loader, MODRINTH_API_BASE};
use super::installed::index_content_dir_sha1;
use super::types::{
    ApplyProfileContentUpdate, ModrinthVersion, ProfileContentUpdate, MODRINTH_USER_AGENT,
};

const VERSION_FILES_BATCH: usize = 96;
const CF_API_BASE: &str = "https://api.curseforge.com/v1";
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

fn curseforge_api_key() -> Result<String, String> {
    std::env::var("CURSEFORGE_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            option_env!("CURSEFORGE_API_KEY")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .ok_or_else(|| {
            "CURSEFORGE_API_KEY не задан. Добавьте ключ API CurseForge в файл .env (значения с символом $ укажите в одинарных кавычках).".to_string()
        })
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
    file: CfFingerprintFile,
    #[serde(default)]
    latest_files: Vec<CfFingerprintFile>,
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

async fn check_curseforge_content_updates(
    content_dir: &Path,
    enabled_by_filename: &HashMap<String, bool>,
    game_version: &str,
) -> Result<Vec<ProfileContentUpdate>, String> {
    let mut fingerprints: Vec<i32> = Vec::new();

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

        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Ошибка чтения файла {:?}: {e}", path))?;

        fingerprints.push(curseforge_file_fingerprint(&bytes));
    }

    fingerprints.sort_unstable();
    fingerprints.dedup();
    if fingerprints.is_empty() {
        return Ok(Vec::new());
    }

    let api_key = curseforge_api_key()?;
    let client = crate::infra::http::http_client(false);
    let url = format!("{CF_API_BASE}/fingerprints/{MINECRAFT_GAME_ID}");

    let body = CurseforgeFingerprintRequest { fingerprints };
    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
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

    let mut out = Vec::new();
    let mut seen: HashMap<String, bool> = HashMap::new();
    let game_version_trimmed = game_version.trim();

    for exact in parsed.data.exact_matches {
        let current = exact.file;
        let Some(latest) = exact.latest_files.first().cloned() else {
            continue;
        };

        if current.id == latest.id {
            continue;
        }

        let filename = current.file_name.clone();
        if filename.trim().is_empty() {
            continue;
        }

        if seen.contains_key(&filename) {
            continue;
        }

        if let Some(download_url) = latest.download_url.clone() {
            if latest.game_versions.is_empty()
                || game_version_trimmed.is_empty()
                || latest
                    .game_versions
                    .iter()
                    .any(|gv| gv.eq_ignore_ascii_case(game_version_trimmed))
            {
                let latest_sha1 = cf_sha1_hex_from_hashes(&latest.hashes);

                let enabled = enabled_by_filename.get(&filename).copied().unwrap_or(true);
                let title = if !latest.display_name.trim().is_empty() {
                    latest.display_name.trim().to_string()
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

                out.push(ProfileContentUpdate {
                    filename: filename.clone(),
                    enabled,
                    project_id: latest.mod_id.to_string(),
                    title,
                    current_version_id: current.id.to_string(),
                    current_version_number: current_version_number,
                    latest_version_id: latest.id.to_string(),
                    latest_version_number: latest_version_number,
                    latest_url: download_url,
                    latest_filename: latest.file_name.clone(),
                    latest_sha1,
                });

                seen.insert(filename, true);
            }
        }
    }

    Ok(out)
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

    let sha_by_filename = index_content_dir_sha1(&content_dir).await?;
    if sha_by_filename.is_empty() {
        return Ok(Vec::new());
    }

    let mut enabled_by_filename = HashMap::new();
    let mut read_dir = tokio::fs::read_dir(&content_dir)
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
    let loaders = if category == "mods" && should_filter_by_loader(&loader) {
        vec![loader.clone()]
    } else {
        Vec::new()
    };
    let game_versions = vec![game_version.clone()];

    let client = modrinth_http_client();
    let mut all_updates = Vec::new();

    for chunk in hashes.chunks(VERSION_FILES_BATCH) {
        let body = VersionFilesRequest {
            hashes: chunk.to_vec(),
            algorithm: "sha1".to_string(),
            loaders: loaders.clone(),
            game_versions: game_versions.clone(),
        };

        let current_map = post_version_files_map(
            &client,
            &body,
            "version_files",
            "идентификация файлов Modrinth",
        )
        .await?;

        let latest_map = post_version_files_map(
            &client,
            &body,
            "version_files/update",
            "проверка обновлений Modrinth",
        )
        .await?;

        all_updates.extend(build_updates_for_batch(
            &sha_by_filename,
            &enabled_by_filename,
            &current_map,
            &latest_map,
        ));
    }

    let modrinth_update_filenames: std::collections::HashSet<String> = all_updates
        .iter()
        .map(|u| u.filename.clone())
        .collect();

    if let Ok(mut cf_updates) =
        check_curseforge_content_updates(&content_dir, &enabled_by_filename, &game_version).await
    {
        cf_updates.retain(|u| !modrinth_update_filenames.contains(&u.filename));
        all_updates.extend(cf_updates);
    } else {
        eprintln!("CurseForge content updates check failed (ignored).");
    }

    all_updates.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(all_updates)
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
        let stored_name = profile_item_stored_name(&item.filename, item.enabled);
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

        if item.latest_filename != stored_name {
            let alt = content_dir.join(&item.latest_filename);
            if alt.is_file() && alt != dest_path {
                let _ = tokio::fs::remove_file(&alt).await;
            }
        }

        applied += 1;
    }

    Ok(applied)
}
