use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::app::paths::instance_dir;
use crate::infra::http::{http_client, http_client_for_binary_download};
use crate::models::events::{
    CurseforgeInstallProgressPayload, EVENT_CURSEFORGE_INSTALL_PROGRESS,
};
use crate::models::profile::InstanceProfileSummary;
use crate::services::curseforge::{
    curseforge_cdn_fallback_urls, curseforge_get_file, curseforge_get_files_bulk,
    curseforge_get_mod_class_ids, curseforge_resolve_download_url, CfFile,
};
use crate::services::game::cache as cache_service;
use crate::services::game::core::sha1_hex_of_file;
use crate::services::game::download::{fetch_verified, resolve_file_path};
use crate::services::game::profiles::{create_profile_impl, delete_profile, set_profile_icon_path};
use crate::services::game::state::CANCEL_DOWNLOAD;

const DOWNLOAD_CANCELLED_MSG: &str = "Загрузка отменена пользователем";
const DEFAULT_CONCURRENCY: usize = 16;

fn check_download_cancelled() -> Result<(), String> {
    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        Err(DOWNLOAD_CANCELLED_MSG.to_string())
    } else {
        Ok(())
    }
}


#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub minecraft: ManifestMinecraft,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub files: Vec<ManifestFile>,
    #[serde(default = "default_overrides")]
    pub overrides: String,
}

fn default_overrides() -> String {
    "overrides".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMinecraft {
    pub version: String,
    #[serde(default)]
    pub mod_loaders: Vec<ManifestModLoader>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestModLoader {
    pub id: String,
    #[serde(default)]
    pub primary: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifestFile {
    #[serde(rename = "projectID")]
    pub project_id: u32,
    #[serde(rename = "fileID")]
    pub file_id: u32,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedMod {
    pub project_id: u32,
    pub file_id: u32,
    pub file_name: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationResult {
    pub name: String,
    pub minecraft_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub loader_id: Option<String>,
    pub mods_downloaded: u32,
    pub mods_total: u32,
    pub failed_mods: Vec<FailedMod>,
    pub instance_dir: String,
    pub success: bool,
}

#[derive(Debug, Clone)]
pub struct InstallProgress {
    pub phase: String,
    pub current: u32,
    pub total: u32,
    pub message: String,
}


pub fn parse_mod_loader_id(id: &str) -> (String, Option<String>) {
    let lower = id.to_lowercase();
    for prefix in ["neoforge-", "fabric-", "quilt-", "forge-"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            let loader = prefix.trim_end_matches('-').to_string();
            let ver = rest.trim();
            if ver.is_empty() {
                return (loader, None);
            }
            return (loader, Some(ver.to_string()));
        }
    }
    (lower, None)
}

pub fn primary_loader(manifest: &Manifest) -> (String, Option<String>, Option<String>) {
    let chosen = manifest
        .minecraft
        .mod_loaders
        .iter()
        .find(|l| l.primary)
        .or_else(|| manifest.minecraft.mod_loaders.first());

    match chosen {
        Some(l) => {
            let (loader, version) = parse_mod_loader_id(&l.id);
            (loader, version, Some(l.id.clone()))
        }
        None => ("vanilla".to_string(), None, None),
    }
}


fn read_manifest_from_zip(zip_path: &Path) -> Result<(Manifest, PathBuf), String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Не удалось открыть архив CurseForge: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения ZIP CurseForge: {e}"))?;

    let mut manifest_json = None;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry ZIP: {e}"))?;
        let name = entry.name().replace('\\', "/");
        if name == "manifest.json" || name.ends_with("/manifest.json") {
            let mut buf = String::new();
            entry
                .read_to_string(&mut buf)
                .map_err(|e| format!("Ошибка чтения manifest.json: {e}"))?;
            manifest_json = Some(buf);
            break;
        }
    }

    let text = manifest_json.ok_or_else(|| {
        "В архиве CurseForge нет manifest.json".to_string()
    })?;
    let manifest: Manifest = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка разбора manifest.json: {e}"))?;
    Ok((manifest, zip_path.to_path_buf()))
}

fn extract_overrides(zip_path: &Path, overrides_dir_name: &str, dest_root: &Path) -> Result<u32, String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Не удалось открыть архив CurseForge: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения ZIP CurseForge: {e}"))?;

    let prefix = format!("{}/", overrides_dir_name.trim_matches('/'));
    let mut count = 0u32;

    for i in 0..archive.len() {
        check_download_cancelled()?;
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry ZIP: {e}"))?;
        let name = entry.name().replace('\\', "/");
        if !name.starts_with(&prefix) || name.ends_with('/') {
            continue;
        }
        let rel = &name[prefix.len()..];
        if rel.is_empty() {
            continue;
        }
        let dest = dest_root.join(rel);
        if !dest.starts_with(dest_root) {
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Не удалось создать папку override: {e}"))?;
        }
        let mut out = std::fs::File::create(&dest)
            .map_err(|e| format!("Не удалось создать файл override: {e}"))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("Ошибка распаковки override: {e}"))?;
        count = count.saturating_add(1);
    }
    Ok(count)
}


fn subdir_for_class_id(class_id: Option<u32>) -> &'static str {
    match class_id {
        Some(12) => "resourcepacks",
        Some(6552) => "shaderpacks",
        Some(6945) => "datapacks",
        _ => "mods",
    }
}

async fn resolve_mod_urls(
    project_id: u32,
    file_id: u32,
    meta: &CfFile,
) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(url) = meta
        .download_url
        .as_ref()
        .map(|u| u.trim())
        .filter(|u| !u.is_empty())
    {
        urls.push(url.to_string());
    } else if let Ok(url) = curseforge_resolve_download_url(project_id, file_id).await {
        urls.push(url);
    }
    urls.extend(curseforge_cdn_fallback_urls(file_id, &meta.file_name));
    urls
}

async fn download_manifest_file(
    file: ManifestFile,
    meta: Option<CfFile>,
    class_id: Option<u32>,
    instance_dir: PathBuf,
) -> Result<String, FailedMod> {
    let failed = |file_name: Option<String>, reason: String| FailedMod {
        project_id: file.project_id,
        file_id: file.file_id,
        file_name,
        reason,
    };

    let meta = match meta {
        Some(m) => m,
        None => curseforge_get_file(file.project_id, file.file_id)
            .await
            .map_err(|e| failed(None, format!("Метаданные файла: {e}")))?,
    };

    let safe_name = Path::new(&meta.file_name)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("mod.jar")
        .to_string();
    let dest = instance_dir
        .join(subdir_for_class_id(class_id))
        .join(&safe_name);
    let sha1 = meta.sha1();

    if let (Some(expected), true) = (sha1.as_deref(), dest.is_file()) {
        if let Ok(actual) = sha1_hex_of_file(&dest).await {
            if actual.eq_ignore_ascii_case(expected) {
                return Ok(safe_name);
            }
        }
    }

    let urls = resolve_mod_urls(file.project_id, file.file_id, &meta).await;
    let client = http_client_for_binary_download(false);
    fetch_verified(&client, &urls, &dest, sha1.as_deref(), None)
        .await
        .map_err(|e| failed(Some(safe_name.clone()), e))?;
    Ok(safe_name)
}

async fn download_manifest_mods<F>(
    files: &[ManifestFile],
    instance_dir: &Path,
    concurrency: usize,
    mut on_progress: F,
) -> Result<(u32, Vec<FailedMod>), String>
where
    F: FnMut(InstallProgress) + Send,
{
    let total = files.len() as u32;
    if total == 0 {
        on_progress(InstallProgress {
            phase: "files".into(),
            current: 0,
            total: 0,
            message: "Нет модов для загрузки".into(),
        });
        return Ok((0, Vec::new()));
    }

    on_progress(InstallProgress {
        phase: "files".into(),
        current: 0,
        total,
        message: "Получение информации о файлах".into(),
    });

    let file_ids: Vec<u32> = files.iter().map(|f| f.file_id).collect();
    let mut project_ids: Vec<u32> = files.iter().map(|f| f.project_id).collect();
    project_ids.sort_unstable();
    project_ids.dedup();

    let (metas, class_ids) = tokio::join!(
        curseforge_get_files_bulk(&file_ids),
        curseforge_get_mod_class_ids(&project_ids),
    );
    let metas = metas.unwrap_or_else(|e| {
        eprintln!("[curseforge_installer] пакетные метаданные файлов недоступны: {e}");
        Default::default()
    });
    let class_ids = class_ids.unwrap_or_else(|e| {
        eprintln!("[curseforge_installer] пакетные метаданные проектов недоступны: {e}");
        Default::default()
    });
    check_download_cancelled()?;

    on_progress(InstallProgress {
        phase: "files".into(),
        current: 0,
        total,
        message: format!("Загрузка модов (0/{total})"),
    });

    let completed = Arc::new(AtomicU32::new(0));
    let instance_dir = instance_dir.to_path_buf();
    let concurrency = concurrency.clamp(1, 32);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<InstallProgress>();

    let download_fut = async {
        let results: Vec<Result<(), FailedMod>> = stream::iter(files.to_vec())
            .map(|file| {
                let instance_dir = instance_dir.clone();
                let completed = completed.clone();
                let tx = tx.clone();
                let meta = metas.get(&file.file_id).cloned();
                let class_id = class_ids.get(&file.project_id).copied();
                async move {
                    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
                        return Err(FailedMod {
                            project_id: file.project_id,
                            file_id: file.file_id,
                            file_name: None,
                            reason: DOWNLOAD_CANCELLED_MSG.to_string(),
                        });
                    }

                    let name = download_manifest_file(file, meta, class_id, instance_dir).await?;

                    let cur = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    let _ = tx.send(InstallProgress {
                        phase: "files".into(),
                        current: cur,
                        total,
                        message: name,
                    });
                    Ok(())
                }
            })
            .buffer_unordered(concurrency)
            .collect()
            .await;
        drop(tx);
        results
    };

    let progress_fut = async {
        while let Some(p) = rx.recv().await {
            on_progress(p);
        }
    };

    let (results, _) = tokio::join!(download_fut, progress_fut);

    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        return Err(DOWNLOAD_CANCELLED_MSG.to_string());
    }

    let mut failed = Vec::new();
    let mut ok = 0u32;
    for r in results {
        match r {
            Ok(()) => ok = ok.saturating_add(1),
            Err(f) => {
                eprintln!(
                    "[curseforge_installer] не скачан projectID={} fileID={}: {}",
                    f.project_id, f.file_id, f.reason
                );
                failed.push(f);
            }
        }
    }
    Ok((ok, failed))
}

pub async fn install_curseforge_zip<F>(
    zip_path: &Path,
    instance_dir: &Path,
    concurrency: usize,
    mut on_progress: F,
) -> Result<InstallationResult, String>
where
    F: FnMut(InstallProgress) + Send,
{
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    on_progress(InstallProgress {
        phase: "start".into(),
        current: 0,
        total: 0,
        message: "Чтение manifest.json".into(),
    });

    let (manifest, zip_path) = read_manifest_from_zip(zip_path)?;
    let (loader, loader_version, loader_id) = primary_loader(&manifest);
    let pack_name = manifest
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            zip_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("CurseForge Pack")
                .to_string()
        });

    std::fs::create_dir_all(instance_dir)
        .map_err(|e| format!("Не удалось создать папку экземпляра: {e}"))?;
    let mods_dir = instance_dir.join("mods");
    std::fs::create_dir_all(&mods_dir)
        .map_err(|e| format!("Не удалось создать папку mods: {e}"))?;

    on_progress(InstallProgress {
        phase: "overrides".into(),
        current: 0,
        total: 0,
        message: format!("Распаковка {}/", manifest.overrides),
    });

    let overrides_count = extract_overrides(&zip_path, &manifest.overrides, instance_dir)?;
    on_progress(InstallProgress {
        phase: "overrides".into(),
        current: overrides_count,
        total: overrides_count,
        message: format!("Распаковано файлов overrides: {overrides_count}"),
    });

    let mods_total = manifest.files.len() as u32;
    let (mods_downloaded, failed_mods) = download_manifest_mods(
        &manifest.files,
        instance_dir,
        concurrency,
        &mut on_progress,
    )
    .await?;

    let instance_dir_str = instance_dir
        .to_str()
        .ok_or("Путь к экземпляру не в UTF-8")?
        .to_string();

    let success = failed_mods.is_empty();
    if !success {
        on_progress(InstallProgress {
            phase: "done".into(),
            current: mods_downloaded,
            total: mods_total,
            message: format!(
                "Установка завершена с предупреждениями: не скачано {} мод(ов)",
                failed_mods.len()
            ),
        });
    } else {
        on_progress(InstallProgress {
            phase: "done".into(),
            current: mods_downloaded,
            total: mods_total,
            message: "Установка CurseForge-сборки завершена".into(),
        });
    }

    Ok(InstallationResult {
        name: pack_name,
        minecraft_version: manifest.minecraft.version,
        loader,
        loader_version,
        loader_id,
        mods_downloaded,
        mods_total,
        failed_mods,
        instance_dir: instance_dir_str,
        success,
    })
}

fn emit_progress(app: &AppHandle, p: &InstallProgress) {
    let _ = app.emit(
        EVENT_CURSEFORGE_INSTALL_PROGRESS,
        CurseforgeInstallProgressPayload {
            phase: p.phase.clone(),
            current: Some(p.current),
            total: Some(p.total),
            message: Some(p.message.clone()),
        },
    );
}


pub async fn install_curseforge_zip_as_new_profile(
    app: AppHandle,
    zip_path: String,
) -> Result<(InstanceProfileSummary, InstallationResult), String> {
    let _ = app.emit(
        EVENT_CURSEFORGE_INSTALL_PROGRESS,
        CurseforgeInstallProgressPayload {
            phase: "start".to_string(),
            current: None,
            total: None,
            message: Some("Чтение manifest.json".into()),
        },
    );

    let pack_path = resolve_file_path(&zip_path);
    if !pack_path.exists() {
        return Err("Файл .zip CurseForge не найден".to_string());
    }

    let (manifest, _) = read_manifest_from_zip(&pack_path)?;
    let (loader, loader_version, _) = primary_loader(&manifest);
    let name = manifest
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            pack_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("CurseForge Pack")
                .to_string()
        });

    let profile = create_profile_impl(
        name,
        manifest.minecraft.version.clone(),
        loader.clone(),
        loader_version.clone(),
        None,
        None,
    )?;
    let profile_id = profile.id.clone();
    let dir = instance_dir(&profile.id)?;

    let app2 = app.clone();
    let result = match install_curseforge_zip(
        &pack_path,
        &dir,
        DEFAULT_CONCURRENCY,
        move |p| emit_progress(&app2, &p),
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = delete_profile(profile_id);
            return Err(e);
        }
    };

    let (mods_size, mods_count) = cache_service::dir_size_and_count(&dir.join("mods"));
    let (res_size, res_count) = cache_service::dir_size_and_count(&dir.join("resourcepacks"));
    let (shader_size, shader_count) = cache_service::dir_size_and_count(&dir.join("shaderpacks"));
    let total_size_bytes = mods_size
        .saturating_add(res_size)
        .saturating_add(shader_size);
    let directory = dir
        .to_str()
        .ok_or("Путь к папке сборки не в UTF-8")?
        .to_string();

    let summary = InstanceProfileSummary {
        id: profile.id,
        name: profile.name,
        icon_path: profile.icon_path,
        game_version: profile.game_version,
        loader: profile.loader,
        loader_version: profile.loader_version,
        created_at: profile.created_at,
        play_time_seconds: profile.play_time_seconds,
        last_played_at: profile.last_played_at,
        mods_count,
        resourcepacks_count: res_count,
        shaderpacks_count: shader_count,
        total_size_bytes,
        directory,
    };

    Ok((summary, result))
}

async fn save_profile_icon_from_url(profile_id: &str, icon_url: &str) -> Result<(), String> {
    let trimmed = icon_url.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let dir = instance_dir(profile_id)?;
    let dest = dir.join("icon.png");
    let client = http_client(false);
    let resp = client
        .get(trimmed)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки иконки сборки: {e}"))?;
    if !resp.status().is_success() {
        return Ok(());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения иконки сборки: {e}"))?;
    if bytes.is_empty() {
        return Ok(());
    }
    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить иконку сборки: {e}"))?;
    let icon_path = dest.to_str().map(|s| s.to_string());
    set_profile_icon_path(profile_id, icon_path)?;
    Ok(())
}

#[tauri::command]
pub async fn download_curseforge_modpack_and_import(
    app: AppHandle,
    mod_id: u32,
    file_id: u32,
    filename: String,
    icon_url: Option<String>,
) -> Result<InstanceProfileSummary, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let _ = app.emit(
        EVENT_CURSEFORGE_INSTALL_PROGRESS,
        CurseforgeInstallProgressPayload {
            phase: "start".to_string(),
            current: None,
            total: None,
            message: Some("Скачивание архива CurseForge…".into()),
        },
    );

    let root = cache_service::tmp_cache_dir()?.join("curseforge_modpacks");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Не удалось создать temp-папку: {e}"))?;

    let base_name = Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("pack.zip");
    let dest = root.join(format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        base_name
    ));

    check_download_cancelled()?;

    let mut urls = Vec::new();
    match curseforge_resolve_download_url(mod_id, file_id).await {
        Ok(u) => urls.push(u),
        Err(_) => {
            if let Some(u) = curseforge_get_file(mod_id, file_id)
                .await
                .ok()
                .and_then(|m| m.download_url)
                .filter(|u| !u.trim().is_empty())
            {
                urls.push(u);
            }
        }
    }
    urls.extend(curseforge_cdn_fallback_urls(file_id, base_name));

    let client = http_client_for_binary_download(false);
    fetch_verified(&client, &urls, &dest, None, None)
        .await
        .map_err(|e| format!("Ошибка загрузки архива CurseForge: {e}"))?;

    let dest_str = dest
        .to_str()
        .ok_or_else(|| "Путь к временному архиву не в UTF-8".to_string())?
        .to_string();

    let (mut summary, _result) =
        install_curseforge_zip_as_new_profile(app.clone(), dest_str).await?;

    let _ = tokio::fs::remove_file(&dest).await;

    if let Some(ref url) = icon_url {
        if summary.icon_path.is_none() {
            if save_profile_icon_from_url(&summary.id, url).await.is_ok() {
                let icon = instance_dir(&summary.id)
                    .ok()
                    .map(|d| d.join("icon.png"))
                    .filter(|p| p.exists())
                    .and_then(|p| p.to_str().map(|s| s.to_string()));
                summary.icon_path = icon;
            }
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_forge_loader_id() {
        let (l, v) = parse_mod_loader_id("forge-47.2.0");
        assert_eq!(l, "forge");
        assert_eq!(v.as_deref(), Some("47.2.0"));
    }

    #[test]
    fn parses_fabric_loader_id() {
        let (l, v) = parse_mod_loader_id("fabric-0.15.7");
        assert_eq!(l, "fabric");
        assert_eq!(v.as_deref(), Some("0.15.7"));
    }

    #[test]
    fn parses_neoforge_before_forge() {
        let (l, v) = parse_mod_loader_id("neoforge-20.4.80");
        assert_eq!(l, "neoforge");
        assert_eq!(v.as_deref(), Some("20.4.80"));
    }

    #[test]
    fn deserializes_manifest_project_id_casing() {
        let json = r#"{
            "minecraft": {
                "version": "1.20.1",
                "modLoaders": [{ "id": "forge-47.2.0", "primary": true }]
            },
            "name": "Test Pack",
            "files": [
                { "projectID": 238222, "fileID": 456, "required": true }
            ],
            "overrides": "overrides"
        }"#;
        let m: Manifest = serde_json::from_str(json).expect("manifest");
        assert_eq!(m.minecraft.version, "1.20.1");
        assert_eq!(m.files[0].project_id, 238222);
        assert_eq!(m.files[0].file_id, 456);
        let (loader, ver, id) = primary_loader(&m);
        assert_eq!(loader, "forge");
        assert_eq!(ver.as_deref(), Some("47.2.0"));
        assert_eq!(id.as_deref(), Some("forge-47.2.0"));
    }
}
