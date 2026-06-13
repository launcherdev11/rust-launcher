use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use zip::read::ZipArchive;

use crate::app::paths::instance_dir;
use crate::services::game::profiles::{profile_content_subdir, resolve_profile_item_path};

use super::client::{modrinth_get_json, modrinth_http_client, MODRINTH_API_BASE};
use super::installed::index_content_dir_sha1;
use super::types::{ModrinthVersion, ProfileItemMetadata, MODRINTH_USER_AGENT};

const VERSION_FILES_BATCH: usize = 96;
const CF_API_BASE: &str = "https://api.curseforge.com/v1";
const MINECRAFT_GAME_ID: u32 = 432;

#[derive(Debug, Serialize, Deserialize, Default)]
struct MetadataCacheFile {
    #[serde(default)]
    entries: HashMap<String, CachedEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedEntry {
    sha1: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_data_uri: Option<String>,
}

#[derive(Debug, Serialize)]
struct VersionFilesRequest {
    hashes: Vec<String>,
    algorithm: String,
}

#[derive(Debug, Deserialize)]
struct ModrinthProjectBrief {
    id: String,
    title: String,
    #[serde(default)]
    icon_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct CurseforgeFingerprintRequest {
    fingerprints: Vec<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfFingerprintFile {
    mod_id: u32,
    file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfFingerprintExactMatch {
    file: CfFingerprintFile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfFingerprintResponseData {
    #[serde(default)]
    exact_matches: Vec<CfFingerprintExactMatch>,
}

#[derive(Debug, Deserialize)]
struct CfFingerprintResponse {
    data: CfFingerprintResponseData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfApiResponse<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfModBrief {
    id: u32,
    name: String,
    logo: Option<CfLogo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfLogo {
    thumbnail_url: Option<String>,
    url: Option<String>,
}

fn metadata_cache_path(profile_dir: &Path, category: &str) -> PathBuf {
    profile_dir
        .join(".launcher")
        .join("item-metadata")
        .join(format!("{category}.json"))
}

fn load_cache(path: &Path) -> MetadataCacheFile {
    if !path.is_file() {
        return MetadataCacheFile::default();
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_cache(path: &Path, cache: &MetadataCacheFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку кеша метаданных: {e}"))?;
    }
    let text = serde_json::to_string_pretty(cache)
        .map_err(|e| format!("Ошибка сериализации кеша метаданных: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("Не удалось записать кеш метаданных: {e}"))
}

fn cached_to_metadata(filename: &str, entry: &CachedEntry) -> ProfileItemMetadata {
    ProfileItemMetadata {
        filename: filename.to_string(),
        title: entry.title.clone(),
        icon_url: entry.icon_url.clone(),
        icon_data_uri: entry.icon_data_uri.clone(),
    }
}

fn bytes_to_data_uri(bytes: &[u8], name_hint: &str) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    let ext = Path::new(name_hint)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    Some(format!("data:{mime};base64,{}", BASE64_STANDARD.encode(bytes)))
}

async fn post_version_files_map(
    client: &reqwest::Client,
    hashes: &[String],
) -> Result<HashMap<String, ModrinthVersion>, String> {
    if hashes.is_empty() {
        return Ok(HashMap::new());
    }
    let body = VersionFilesRequest {
        hashes: hashes.to_vec(),
        algorithm: "sha1".to_string(),
    };
    let url = format!("{MODRINTH_API_BASE}/version_files");
    let resp = client
        .post(&url)
        .header(USER_AGENT, MODRINTH_USER_AGENT)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Modrinth version_files: сеть: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Modrinth version_files: HTTP {}", resp.status()));
    }
    resp.json::<HashMap<String, ModrinthVersion>>()
        .await
        .map_err(|e| format!("Modrinth version_files: JSON: {e}"))
}

async fn fetch_modrinth_projects(
    client: &reqwest::Client,
    project_ids: &[String],
) -> Result<HashMap<String, ModrinthProjectBrief>, String> {
    let mut out = HashMap::new();
    for chunk in project_ids.chunks(100) {
        let ids_json =
            serde_json::to_string(chunk).map_err(|e| format!("Modrinth projects: JSON: {e}"))?;
        let url = format!(
            "{MODRINTH_API_BASE}/projects?ids={}",
            urlencoding::encode(&ids_json)
        );
        let projects: Vec<ModrinthProjectBrief> =
            modrinth_get_json(client, &url, "Modrinth projects").await?;
        for project in projects {
            out.insert(project.id.clone(), project);
        }
    }
    Ok(out)
}

fn curseforge_api_key() -> Option<String> {
    std::env::var("CURSEFORGE_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            option_env!("CURSEFORGE_API_KEY")
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
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
            num2 = num2.wrapping_mul(multiplex) ^ num7;
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

async fn curseforge_lookup_filenames(
    filenames: &[String],
    content_dir: &Path,
) -> Result<HashMap<String, u32>, String> {
    let api_key = match curseforge_api_key() {
        Some(k) => k,
        None => return Ok(HashMap::new()),
    };

    let mut fingerprint_by_filename: HashMap<String, i32> = HashMap::new();
    for filename in filenames {
        let Some(path) = resolve_profile_item_path(content_dir, filename) else {
            continue;
        };
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Ошибка чтения {:?}: {e}", path))?;
        fingerprint_by_filename.insert(filename.clone(), curseforge_file_fingerprint(&bytes));
    }

    if fingerprint_by_filename.is_empty() {
        return Ok(HashMap::new());
    }

    let fingerprints: Vec<i32> = fingerprint_by_filename.values().copied().collect();
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
        .map_err(|e| format!("CurseForge fingerprints: сеть: {e}"))?;

    if !resp.status().is_success() {
        return Ok(HashMap::new());
    }

    let parsed: CfFingerprintResponse = resp
        .json()
        .await
        .map_err(|e| format!("CurseForge fingerprints: JSON: {e}"))?;

    let mut mod_id_by_filename = HashMap::new();
    for exact in parsed.data.exact_matches {
        let cf_name = exact.file.file_name.trim();
        if cf_name.is_empty() {
            continue;
        }
        for (filename, _) in &fingerprint_by_filename {
            if filename.eq_ignore_ascii_case(cf_name) {
                mod_id_by_filename.insert(filename.clone(), exact.file.mod_id);
                break;
            }
        }
    }
    Ok(mod_id_by_filename)
}

async fn fetch_curseforge_mods(
    mod_ids: &[u32],
) -> Result<HashMap<u32, (String, Option<String>)>, String> {
    let api_key = match curseforge_api_key() {
        Some(k) => k,
        None => return Ok(HashMap::new()),
    };
    if mod_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let ids_str = mod_ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let url = format!("{CF_API_BASE}/mods?modIds={ids_str}");
    let client = crate::infra::http::http_client(false);
    let resp = client
        .get(&url)
        .header("x-api-key", api_key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("CurseForge mods: сеть: {e}"))?;

    if !resp.status().is_success() {
        return Ok(HashMap::new());
    }

    let body: CfApiResponse<Vec<CfModBrief>> = resp
        .json()
        .await
        .map_err(|e| format!("CurseForge mods: JSON: {e}"))?;

    let mut out = HashMap::new();
    for m in body.data {
        let thumbnail = m
            .logo
            .as_ref()
            .and_then(|l| l.thumbnail_url.clone().or_else(|| l.url.clone()));
        out.insert(m.id, (m.name, thumbnail));
    }
    Ok(out)
}

fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Option<Vec<u8>> {
    let mut file = archive.by_name(name).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    if buf.is_empty() { None } else { Some(buf) }
}

fn extract_metadata_from_archive(
    bytes: &[u8],
    category: &str,
) -> (Option<String>, Option<String>) {
    let cursor = Cursor::new(bytes.to_vec());
    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return (None, None),
    };

    let entry_names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            archive
                .by_index(i)
                .ok()
                .map(|f| f.name().replace('\\', "/"))
        })
        .collect();

    if category == "resourcepacks" || category == "shaderpacks" {
        if entry_names.iter().any(|n| n == "pack.png") {
            if let Some(icon_bytes) = read_zip_entry(&mut archive, "pack.png") {
                return (None, bytes_to_data_uri(&icon_bytes, "pack.png"));
            }
        }
    }

    if let Some(json_bytes) = read_zip_entry(&mut archive, "fabric.mod.json") {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&json_bytes) {
            let title = json
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            if let Some(icon_path) = json.get("icon").and_then(|v| v.as_str()) {
                let normalized = icon_path.replace('\\', "/");
                if let Some(icon_bytes) = read_zip_entry(&mut archive, &normalized) {
                    return (title, bytes_to_data_uri(&icon_bytes, &normalized));
                }
            }
            if let Some(title) = title {
                for name in &entry_names {
                    if name.starts_with("assets/") && name.ends_with("/icon.png") {
                        if let Some(icon_bytes) = read_zip_entry(&mut archive, name) {
                            return (Some(title), bytes_to_data_uri(&icon_bytes, name));
                        }
                    }
                }
            }
        }
    }

    for candidate in ["logo.png", "icon.png"] {
        if entry_names.iter().any(|n| n == candidate) {
            if let Some(icon_bytes) = read_zip_entry(&mut archive, candidate) {
                return (None, bytes_to_data_uri(&icon_bytes, candidate));
            }
        }
    }

    for name in &entry_names {
        if name.starts_with("assets/") && name.ends_with("/icon.png") {
            if let Some(icon_bytes) = read_zip_entry(&mut archive, name) {
                return (None, bytes_to_data_uri(&icon_bytes, name));
            }
        }
    }

    (None, None)
}

fn extract_metadata_from_file(path: &Path, category: &str) -> (Option<String>, Option<String>) {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return (None, None),
    };
    extract_metadata_from_archive(&bytes, category)
}

#[tauri::command]
pub async fn resolve_profile_item_metadata(
    profile_id: String,
    category: String,
) -> Result<Vec<ProfileItemMetadata>, String> {
    let subdir = profile_content_subdir(&category)?;
    let profile_dir = instance_dir(&profile_id)?;
    let content_dir = profile_dir.join(subdir);
    if !content_dir.is_dir() {
        return Ok(Vec::new());
    }

    let sha_by_filename = index_content_dir_sha1(&content_dir).await?;
    if sha_by_filename.is_empty() {
        return Ok(Vec::new());
    }

    let cache_path = metadata_cache_path(&profile_dir, &category);
    let mut cache = load_cache(&cache_path);
    let mut resolved: HashMap<String, CachedEntry> = HashMap::new();
    let mut pending_sha: Vec<String> = Vec::new();
    let mut sha_to_filename: HashMap<String, String> = HashMap::new();

    for (filename, sha1) in &sha_by_filename {
        if let Some(cached) = cache.entries.get(filename) {
            if cached.sha1 == *sha1 {
                resolved.insert(filename.clone(), cached.clone());
                continue;
            }
        }
        pending_sha.push(sha1.clone());
        sha_to_filename.insert(sha1.clone(), filename.clone());
    }

    let client = modrinth_http_client();
    let mut still_missing: HashSet<String> = pending_sha
        .iter()
        .filter_map(|sha| sha_to_filename.get(sha).cloned())
        .collect();

    for chunk in pending_sha.chunks(VERSION_FILES_BATCH) {
        let version_map = match post_version_files_map(&client, chunk).await {
            Ok(m) => m,
            Err(e) => {
                eprintln!("resolve_profile_item_metadata: Modrinth: {e}");
                continue;
            }
        };

        let project_ids: Vec<String> = version_map
            .values()
            .map(|v| v.project_id.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();

        let projects = match fetch_modrinth_projects(&client, &project_ids).await {
            Ok(p) => p,
            Err(e) => {
                eprintln!("resolve_profile_item_metadata: Modrinth projects: {e}");
                HashMap::new()
            }
        };

        for (sha1, version) in version_map {
            let Some(filename) = sha_to_filename.get(&sha1) else {
                continue;
            };
            let project = projects.get(&version.project_id);
            let title = project.map(|p| p.title.clone());
            let icon_url = project.and_then(|p| p.icon_url.clone());
            if title.is_none() && icon_url.is_none() {
                continue;
            }
            resolved.insert(
                filename.clone(),
                CachedEntry {
                    sha1: sha1.clone(),
                    title,
                    icon_url,
                    icon_data_uri: None,
                },
            );
            still_missing.remove(filename);
        }
    }

    if !still_missing.is_empty() {
        let missing_list: Vec<String> = still_missing.iter().cloned().collect();
        if let Ok(cf_mod_by_filename) = curseforge_lookup_filenames(&missing_list, &content_dir).await
        {
            let mod_ids: Vec<u32> = cf_mod_by_filename.values().copied().collect::<HashSet<_>>().into_iter().collect();
            if let Ok(cf_mods) = fetch_curseforge_mods(&mod_ids).await {
                for filename in &missing_list {
                    let Some(mod_id) = cf_mod_by_filename.get(filename) else {
                        continue;
                    };
                    let Some((title, icon_url)) = cf_mods.get(mod_id) else {
                        continue;
                    };
                    let Some(sha1) = sha_by_filename.get(filename) else {
                        continue;
                    };
                    resolved.insert(
                        filename.clone(),
                        CachedEntry {
                            sha1: sha1.clone(),
                            title: Some(title.clone()),
                            icon_url: icon_url.clone(),
                            icon_data_uri: None,
                        },
                    );
                    still_missing.remove(filename);
                }
            }
        }
    }

    if !still_missing.is_empty() {
        let missing: Vec<String> = still_missing.into_iter().collect();
        let paths: Vec<(String, PathBuf)> = missing
            .into_iter()
            .filter_map(|filename| {
                resolve_profile_item_path(&content_dir, &filename).map(|p| (filename, p))
            })
            .collect();

        let category_owned = category.clone();
        let extracted = tokio::task::spawn_blocking(move || {
            let mut out = HashMap::new();
            for (filename, path) in paths {
                let (title, icon_data_uri) = extract_metadata_from_file(&path, &category_owned);
                if title.is_some() || icon_data_uri.is_some() {
                    out.insert(filename, (title, icon_data_uri));
                }
            }
            out
        })
        .await
        .map_err(|e| format!("Ошибка извлечения метаданных из архивов: {e}"))?;

        for (filename, (title, icon_data_uri)) in extracted {
            let Some(sha1) = sha_by_filename.get(&filename) else {
                continue;
            };
            resolved.insert(
                filename,
                CachedEntry {
                    sha1: sha1.clone(),
                    title,
                    icon_url: None,
                    icon_data_uri,
                },
            );
        }
    }

    cache.entries.retain(|filename, _| sha_by_filename.contains_key(filename));
    for (filename, entry) in &resolved {
        cache.entries.insert(filename.clone(), entry.clone());
    }
    if let Err(e) = save_cache(&cache_path, &cache) {
        eprintln!("resolve_profile_item_metadata: cache save: {e}");
    }

    let mut result: Vec<ProfileItemMetadata> = sha_by_filename
        .keys()
        .map(|filename| {
            if let Some(entry) = resolved.get(filename) {
                cached_to_metadata(filename, entry)
            } else {
                ProfileItemMetadata {
                    filename: filename.clone(),
                    title: None,
                    icon_url: None,
                    icon_data_uri: None,
                }
            }
        })
        .collect();
    result.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(result)
}
