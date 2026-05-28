use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use crate::app::paths::{game_root_dir, versions_dir};
use crate::infra::http::http_client;
use crate::services::game::core::download_text_with_retries;
use crate::services::game::settings::load_settings_from_disk;
use crate::services::game::state::{
    CANCEL_DOWNLOAD, DEFAULT_DOWNLOAD_RETRIES, FABRIC_META_GAME, FABRIC_META_LOADERS, FORGE_MAVEN_BASE,
    FORGE_MAVEN_METADATA_URL, FORGE_MAVEN_OFFICIAL_METADATA_URL, FORGE_PROMOTIONS_URL,
    NEOFORGE_MAVEN_BASE, NEOFORGE_MAVEN_METADATA_URL,
    QUILT_META_GAME, VERSION_MANIFEST_URL,
};
use crate::services::game::version_types::{
    FabricLoaderEntry, FabricProfile, ForgePromotionsSlim, ForgeVersionSummary, LoaderMetaGameVersion,
    LoaderVersionChannel, LoaderVersionOption, NeoForgeVersionSummary, QuiltLoaderEntry, VersionDetail,
    VersionManifest, VersionSummary,
};

const CUSTOM_VERSION_MARKER: &str = ".custom";

pub(crate) fn parse_neoforge_mc_version(build: &str) -> Option<String> {
    let mut parts = build.split('.');
    let major = parts.next()?;
    let minor = parts.next()?;
    if !major.chars().all(|c| c.is_ascii_digit()) || !minor.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("1.{major}.{minor}"))
}

fn neoforge_build_matches_mc(build: &str, mc_version: &str) -> bool {
    let Some(suffix) = mc_version.strip_prefix("1.") else {
        return false;
    };
    build.starts_with(&format!("{suffix}.")) || build == suffix
}

fn cmp_dot_version_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let pa: Vec<u32> = a
        .split(|c| c == '.' || c == '-' || c == '+')
        .filter_map(|s| s.parse().ok())
        .collect();
    let pb: Vec<u32> = b
        .split(|c| c == '.' || c == '-' || c == '+')
        .filter_map(|s| s.parse().ok())
        .collect();
    let len = pa.len().max(pb.len());
    for i in 0..len {
        let va = pa.get(i).copied().unwrap_or(0);
        let vb = pb.get(i).copied().unwrap_or(0);
        match vb.cmp(&va) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    b.cmp(a)
}

fn parse_maven_metadata_versions(metadata: &str) -> Vec<String> {
    let mut out = Vec::new();
    for entry in metadata.match_indices("<version>") {
        let start = entry.0 + "<version>".len();
        let rest = &metadata[start..];
        let Some(end_rel) = rest.find("</version>") else {
            continue;
        };
        let version = rest[..end_rel].trim();
        if !version.is_empty() {
            out.push(version.to_string());
        }
    }
    out
}

fn dedupe_sort_versions(mut versions: Vec<String>) -> Vec<String> {
    versions.sort_by(|a, b| cmp_dot_version_desc(a, b));
    versions.dedup();
    versions
}

fn channel_from_version_string(version: &str) -> Option<LoaderVersionChannel> {
    let lower = version.to_lowercase();
    if lower.contains("alpha") {
        Some(LoaderVersionChannel::Alpha)
    } else if lower.contains("beta")
        || lower.contains("snapshot")
        || lower.contains("-rc")
        || lower.contains("pre")
    {
        Some(LoaderVersionChannel::Beta)
    } else {
        None
    }
}

fn fabric_loader_channel(stable: bool) -> Option<LoaderVersionChannel> {
    Some(if stable {
        LoaderVersionChannel::Stable
    } else {
        LoaderVersionChannel::Beta
    })
}

fn quilt_loader_channel(version: &str) -> Option<LoaderVersionChannel> {
    channel_from_version_string(version).or(Some(LoaderVersionChannel::Stable))
}

async fn forge_promo_builds_for_mc(mc_version: &str) -> Result<(Option<String>, Option<String>), String> {
    let direct_client = http_client(false);
    let text = download_text_with_retries(&direct_client, FORGE_PROMOTIONS_URL, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка загрузки Forge promotions: {e}"))?;

    let parsed: ForgePromotionsSlim = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка разбора Forge promotions JSON: {e}"))?;

    let mut recommended: Option<String> = None;
    let mut latest: Option<String> = None;
    for (promo_key, forge_build) in parsed.promos {
        let Some((mc, suffix)) = promo_key.rsplit_once('-') else {
            continue;
        };
        if mc != mc_version {
            continue;
        }
        match suffix {
            "recommended" => recommended = Some(forge_build),
            "latest" => latest = Some(forge_build),
            _ => {}
        }
    }
    Ok((recommended, latest))
}

fn forge_build_channel(
    build: &str,
    recommended: &Option<String>,
    latest: &Option<String>,
) -> Option<LoaderVersionChannel> {
    if recommended.as_deref() == Some(build) {
        return Some(LoaderVersionChannel::Stable);
    }
    if latest.as_deref() == Some(build) && latest != recommended {
        return Some(LoaderVersionChannel::Beta);
    }
    channel_from_version_string(build)
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

pub(crate) fn apply_version_visibility_filter(
    mut versions: Vec<VersionSummary>,
    show_snapshots: bool,
    show_alpha: bool,
) -> Vec<VersionSummary> {
    versions.retain(|v| {
        if v.version_type == "release" || v.version_type == "custom" {
            return true;
        }
        if v.version_type == "snapshot" {
            return show_snapshots;
        }
        if v.version_type == "old_beta"
            || v.version_type == "old_alpha"
            || v.version_type == "alpha"
        {
            return show_alpha;
        }
        false
    });
    versions
}

async fn load_loader_supported_game_ids(loader: &str) -> Result<HashSet<String>, String> {
    let url = match loader {
        "fabric" => FABRIC_META_GAME,
        "quilt" => QUILT_META_GAME,
        _ => return Ok(HashSet::new()),
    };
    let client = http_client(false);
    let text = download_text_with_retries(&client, url, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка загрузки списка версий для {loader}: {e}"))?;
    let list: Vec<LoaderMetaGameVersion> = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора списка версий для {loader}: {e}. Первые символы: {head}")
    })?;
    Ok(list.into_iter().map(|e| e.version).collect())
}

fn is_mod_loader_profile_id(id: &str) -> bool {
    id.contains("-forge-")
        || id.contains("-neoforge-")
        || id.starts_with("fabric-loader-")
        || id.starts_with("quilt-loader-")
}

fn read_custom_version_summaries(manifest_ids: &HashSet<String>) -> Result<Vec<VersionSummary>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
        let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() || is_mod_loader_profile_id(&id) {
            continue;
        }
        let version_json = path.join(format!("{id}.json"));
        if !version_json.exists() || path.join("profile.json").exists() {
            continue;
        }
        let is_custom = path.join(CUSTOM_VERSION_MARKER).exists() || !manifest_ids.contains(&id);
        if !is_custom {
            continue;
        }
        let release_time = std::fs::metadata(&version_json)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| {
                let dur = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                Some(format!("{}", dur.as_secs()))
            })
            .unwrap_or_default();
        out.push(VersionSummary {
            id,
            version_type: "custom".to_string(),
            url: String::new(),
            release_time,
        });
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

#[tauri::command]
pub async fn fetch_versions_for_loader(
    loader: String,
    show_snapshots: bool,
    show_alpha: bool,
) -> Result<Vec<VersionSummary>, String> {
    let loader_norm = loader.to_lowercase();
    if loader_norm == "forge" || loader_norm == "neoforge" {
        return Err(format!(
            "Для загрузчика {loader} используйте fetch_forge_versions или fetch_neoforge_versions"
        ));
    }

    let all = load_all_versions().await?;
    let manifest_ids: HashSet<String> = all.iter().map(|v| v.id.clone()).collect();
    let mut versions = apply_version_visibility_filter(all, show_snapshots, show_alpha);

    if loader_norm == "fabric" || loader_norm == "quilt" {
        let supported = load_loader_supported_game_ids(&loader_norm).await?;
        versions.retain(|v| supported.contains(&v.id));
    } else if loader_norm == "vanilla" {
        let mut custom = read_custom_version_summaries(&manifest_ids)?;
        let existing: HashSet<String> = versions.iter().map(|v| v.id.clone()).collect();
        custom.retain(|v| !existing.contains(&v.id));
        versions.extend(custom);
        versions.sort_by(|a, b| b.release_time.cmp(&a.release_time));
    } else {
        return Err(format!("Неизвестный загрузчик: {loader}"));
    }

    Ok(versions)
}

#[tauri::command]
pub fn import_custom_version(json_path: String, jar_path: Option<String>) -> Result<String, String> {
    let json_src = PathBuf::from(&json_path);
    if !json_src.is_file() {
        return Err(format!("Файл version.json не найден: {json_path}"));
    }

    let version_id = json_src
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Не удалось определить id версии из имени JSON-файла".to_string())?;

    if is_mod_loader_profile_id(version_id) {
        return Err("Имя версии не должно совпадать с профилем mod loader".to_string());
    }

    let json_text = std::fs::read_to_string(&json_src)
        .map_err(|e| format!("Не удалось прочитать JSON: {e}"))?;
    let _: VersionDetail = serde_json::from_str(&json_text)
        .map_err(|e| format!("Некорректный JSON версии Minecraft: {e}"))?;

    let vers_root = versions_dir()?;
    let root = game_root_dir()?;
    let version_dir = vers_root.join(version_id);
    std::fs::create_dir_all(&version_dir)
        .map_err(|e| format!("Не удалось создать папку версии: {e}"))?;

    let dest_json = version_dir.join(format!("{version_id}.json"));
    std::fs::copy(&json_src, &dest_json).map_err(|e| format!("Не удалось скопировать JSON: {e}"))?;
    std::fs::write(version_dir.join(CUSTOM_VERSION_MARKER), version_id.as_bytes())
        .map_err(|e| format!("Не удалось записать маркер кастомной версии: {e}"))?;

    if let Some(jar) = jar_path {
        let jar_src = Path::new(&jar);
        if !jar_src.is_file() {
            return Err(format!("JAR не найден: {jar}"));
        }
        std::fs::create_dir_all(&root).map_err(|e| format!("Не удалось создать папку игры: {e}"))?;
        let dest_jar = root.join(format!("{version_id}.jar"));
        std::fs::copy(jar_src, &dest_jar).map_err(|e| format!("Не удалось скопировать JAR: {e}"))?;
    }

    Ok(version_id.to_string())
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

    let direct_client = http_client(false);
    let text = download_text_with_retries(&direct_client, FORGE_PROMOTIONS_URL, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка загрузки Forge promotions: {e}"))?;

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
pub async fn fetch_fabric_loaders(game_version: String) -> Result<Vec<LoaderVersionOption>, String> {
    let url = format!("{FABRIC_META_LOADERS}/{game_version}");
    let client = http_client(false);
    let text = download_text_with_retries(&client, &url, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка запроса списка Fabric: {e}"))?;
    let list: Vec<FabricLoaderEntry> = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора списка Fabric: {e}. Первые символы ответа: {head}")
    })?;
    let mut entries: Vec<(u32, LoaderVersionOption)> = list
        .into_iter()
        .map(|e| {
            (
                e.loader.build,
                LoaderVersionOption {
                    version: e.loader.version.clone(),
                    channel: fabric_loader_channel(e.loader.stable),
                },
            )
        })
        .collect();
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out: Vec<LoaderVersionOption> = Vec::new();
    let mut seen = HashSet::new();
    for (_, opt) in entries {
        if seen.insert(opt.version.clone()) {
            out.push(opt);
        }
    }
    Ok(out)
}


#[tauri::command]
pub async fn fetch_quilt_loaders(game_version: String) -> Result<Vec<LoaderVersionOption>, String> {
    let url = format!("https://meta.quiltmc.org/v3/versions/loader/{game_version}");
    let client = http_client(false);
    let text = download_text_with_retries(&client, &url, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка запроса списка Quilt: {e}"))?;
    let list: Vec<QuiltLoaderEntry> = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора списка Quilt: {e}. Первые символы ответа: {head}")
    })?;
    let mut entries: Vec<(i32, LoaderVersionOption)> = list
        .into_iter()
        .map(|e| {
            let version = e.loader.version.clone();
            (
                e.loader.build,
                LoaderVersionOption {
                    channel: quilt_loader_channel(&version),
                    version,
                },
            )
        })
        .collect();
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out: Vec<LoaderVersionOption> = Vec::new();
    let mut seen = HashSet::new();
    for (_, opt) in entries {
        if seen.insert(opt.version.clone()) {
            out.push(opt);
        }
    }
    Ok(out)
}


#[tauri::command]
pub async fn fetch_forge_builds_for_game(game_version: String) -> Result<Vec<LoaderVersionOption>, String> {
    let prefix = format!("{game_version}-");
    let settings = load_settings_from_disk();
    let direct_client = http_client(false);
    let metadata = match download_text_with_retries(
        &direct_client,
        FORGE_MAVEN_METADATA_URL,
        DEFAULT_DOWNLOAD_RETRIES,
    )
    .await
    {
        Ok(text) => text,
        Err(direct_err) => {
            if settings.forge_proxy_fallback {
                download_text_with_retries(
                    &direct_client,
                    FORGE_MAVEN_OFFICIAL_METADATA_URL,
                    DEFAULT_DOWNLOAD_RETRIES,
                )
                .await
                .map_err(|fallback_err| {
                    format!(
                        "Ошибка загрузки Forge metadata с зеркала: {direct_err}; официальный Maven: {fallback_err}"
                    )
                })?
            } else {
                return Err(format!("Ошибка загрузки Forge metadata: {direct_err}"));
            }
        }
    };

    let builds: Vec<String> = parse_maven_metadata_versions(&metadata)
        .into_iter()
        .filter_map(|full| {
            let build = full.strip_prefix(&prefix)?;
            if build.is_empty() || build.contains('-') {
                return None;
            }
            Some(build.to_string())
        })
        .collect();

    let (recommended, latest) = forge_promo_builds_for_mc(&game_version).await.unwrap_or((None, None));
    let sorted = dedupe_sort_versions(builds);
    Ok(sorted
        .into_iter()
        .map(|version| LoaderVersionOption {
            channel: forge_build_channel(&version, &recommended, &latest),
            version,
        })
        .collect())
}


#[tauri::command]
pub async fn fetch_neoforge_builds_for_game(game_version: String) -> Result<Vec<LoaderVersionOption>, String> {
    let client = http_client(true);
    let metadata = download_text_with_retries(
        &client,
        NEOFORGE_MAVEN_METADATA_URL,
        DEFAULT_DOWNLOAD_RETRIES,
    )
    .await
    .map_err(|e| format!("Ошибка загрузки NeoForge metadata: {e}"))?;

    let builds: Vec<String> = parse_maven_metadata_versions(&metadata)
        .into_iter()
        .filter(|b| neoforge_build_matches_mc(b, &game_version))
        .collect();

    Ok(dedupe_sort_versions(builds)
        .into_iter()
        .map(|version| LoaderVersionOption {
            channel: channel_from_version_string(&version),
            version,
        })
        .collect())
}


fn fabric_profile_matches_loader_version(profile: &FabricProfile, loader_version: &str) -> bool {
    profile.id.contains(loader_version)
        || profile
            .id
            .strip_prefix("fabric-loader-")
            .is_some_and(|rest| rest.starts_with(loader_version))
}

fn quilt_profile_matches_loader_version(profile: &FabricProfile, loader_version: &str) -> bool {
    profile.id.contains(loader_version)
        || profile
            .id
            .strip_prefix("quilt-loader-")
            .is_some_and(|rest| rest.starts_with(loader_version))
}

#[tauri::command]
pub fn get_installed_fabric_profile_id(
    game_version: String,
    loader_version: Option<String>,
) -> Result<Option<String>, String> {
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
            if let Some(ref lv) = loader_version {
                if !fabric_profile_matches_loader_version(&profile, lv) {
                    continue;
                }
            }
            let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if !id.is_empty() {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}


#[tauri::command]
pub fn get_installed_quilt_profile_id(
    game_version: String,
    loader_version: Option<String>,
) -> Result<Option<String>, String> {
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
            if let Some(ref lv) = loader_version {
                if !quilt_profile_matches_loader_version(&profile, lv) {
                    continue;
                }
            }
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

