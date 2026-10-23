use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
use rand::Rng;
use serde::Deserialize;
use sha1::{Digest, Sha1};
use sha2::Sha512;
use tauri::{AppHandle, Emitter};

use crate::app::paths::{game_root_dir, instance_dir};
use crate::infra::http::{http_client, http_client_for_binary_download};
use crate::models::events::{MrpackImportProgressPayload, EVENT_MRPACK_IMPORT_PROGRESS};
use crate::models::profile::InstanceProfileSummary;
use crate::services::game::cache as cache_service;
use crate::services::game::core::{is_retryable_status, retry_delay, safe_join};
use crate::services::game::profiles::{create_profile_impl, delete_profile, set_profile_icon_path};
use crate::services::game::state::{CANCEL_DOWNLOAD, DEFAULT_DOWNLOAD_CONCURRENCY};

const DOWNLOAD_CANCELLED_MSG: &str = "Загрузка отменена пользователем";
const FETCH_ATTEMPTS_PER_URL: usize = 3;

fn check_download_cancelled() -> Result<(), String> {
    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        Err(DOWNLOAD_CANCELLED_MSG.to_string())
    } else {
        Ok(())
    }
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct MrpackFileEnv {
    #[serde(default)]
    pub(crate) client: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MrpackFileEntry {
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) downloads: Vec<String>,
    #[serde(default)]
    pub(crate) hashes: HashMap<String, String>,
    #[serde(default)]
    pub(crate) env: Option<MrpackFileEnv>,
}

impl MrpackFileEntry {
    fn is_client_unsupported(&self) -> bool {
        self.env
            .as_ref()
            .and_then(|e| e.client.as_deref())
            .is_some_and(|c| c.eq_ignore_ascii_case("unsupported"))
    }

    fn should_download(&self) -> bool {
        !self.is_client_unsupported() && self.downloads.iter().any(|u| !u.trim().is_empty())
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct MrpackIndex {
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) dependencies: HashMap<String, String>,
    #[serde(default)]
    pub(crate) files: Vec<MrpackFileEntry>,
}

pub(crate) fn mrpack_game_version_and_loader(deps: &HashMap<String, String>) -> (String, String) {
    let game = deps
        .get("minecraft")
        .map(String::as_str)
        .unwrap_or("1.20.1");
    let loader = if deps.contains_key("fabric-loader") {
        "fabric"
    } else if deps.contains_key("quilt-loader") {
        "quilt"
    } else if deps.contains_key("neoforge") || deps.contains_key("neo-forge") {
        "neoforge"
    } else if deps.contains_key("forge") {
        "forge"
    } else {
        "vanilla"
    };
    (game.to_string(), loader.to_string())
}

pub(crate) fn resolve_file_path(path_or_uri: &str) -> PathBuf {
    let s = path_or_uri.trim();
    if s.starts_with("file:///") {
        let path_part = s.strip_prefix("file:///").unwrap_or(s);
        PathBuf::from(path_part.replace('/', std::path::MAIN_SEPARATOR_STR))
    } else if s.starts_with("file://") {
        let path_part = s.strip_prefix("file://").unwrap_or(s);
        PathBuf::from(path_part.replace('/', std::path::MAIN_SEPARATOR_STR))
    } else {
        PathBuf::from(s)
    }
}

enum FetchError {
    Fatal(String),
    Retry(String),
}

fn error_chain(err: &dyn std::error::Error) -> String {
    let mut msg = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !msg.ends_with(&text) {
            msg.push_str(": ");
            msg.push_str(&text);
        }
        source = cause.source();
    }
    msg
}

pub(crate) async fn fetch_verified(
    client: &reqwest::Client,
    urls: &[String],
    dest: &Path,
    sha1: Option<&str>,
    sha512: Option<&str>,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
    }

    let mut last_err = "Нет ссылок для скачивания".to_string();
    for url in urls.iter().map(|u| u.trim()).filter(|u| !u.is_empty()) {
        for attempt in 0..FETCH_ATTEMPTS_PER_URL {
            check_download_cancelled()?;
            match fetch_once(client, url, dest, sha1, sha512, attempt).await {
                Ok(()) => return Ok(()),
                Err(FetchError::Fatal(e)) => {
                    last_err = e;
                    break;
                }
                Err(FetchError::Retry(e)) => {
                    last_err = e;
                    if attempt + 1 < FETCH_ATTEMPTS_PER_URL {
                        tokio::time::sleep(retry_delay(attempt)).await;
                    }
                }
            }
        }
        check_download_cancelled()?;
    }
    Err(last_err)
}

async fn fetch_once(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    sha1: Option<&str>,
    sha512: Option<&str>,
    attempt: usize,
) -> Result<(), FetchError> {
    use tokio::io::AsyncWriteExt;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| FetchError::Retry(format!("Ошибка скачивания {url}: {}", error_chain(&e))))?;
    let status = resp.status();
    if !status.is_success() {
        let msg = format!("Сервер вернул ошибку {status} при скачивании {url}");
        return Err(if is_retryable_status(status.as_u16(), attempt) {
            FetchError::Retry(msg)
        } else {
            FetchError::Fatal(msg)
        });
    }
    let content_len = resp.content_length().unwrap_or(0);

    let mut tmp_name = dest.as_os_str().to_owned();
    tmp_name.push(format!(".part-{}", rand::thread_rng().gen::<u32>()));
    let tmp_path = PathBuf::from(tmp_name);

    let result = async {
        let mut file = tokio::fs::File::create(&tmp_path)
            .await
            .map_err(|e| FetchError::Fatal(format!("Не удалось создать {}: {e}", tmp_path.display())))?;
        let mut h1 = sha1.map(|_| Sha1::new());
        let mut h512 = sha512.map(|_| Sha512::new());
        let mut received: u64 = 0;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            check_download_cancelled().map_err(FetchError::Fatal)?;
            let chunk = chunk
                .map_err(|e| FetchError::Retry(format!("Обрыв загрузки {url}: {}", error_chain(&e))))?;
            if let Some(h) = h1.as_mut() {
                h.update(&chunk);
            }
            if let Some(h) = h512.as_mut() {
                h.update(&chunk);
            }
            received += chunk.len() as u64;
            file.write_all(&chunk).await.map_err(|e| {
                FetchError::Fatal(format!("Ошибка записи на диск: {e}. Проверьте свободное место."))
            })?;
        }
        file.flush()
            .await
            .map_err(|e| FetchError::Fatal(format!("Ошибка записи на диск: {e}")))?;
        drop(file);

        if content_len > 0 && received != content_len {
            return Err(FetchError::Retry(format!(
                "Файл {url} получен не полностью ({received} из {content_len} байт)"
            )));
        }
        if let (Some(h), Some(expected)) = (h1, sha1) {
            let actual = format!("{:x}", h.finalize());
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(FetchError::Retry(format!(
                    "SHA1 не совпал для {url} (ожидалось {expected}, получено {actual})"
                )));
            }
        }
        if let (Some(h), Some(expected)) = (h512, sha512) {
            let actual = format!("{:x}", h.finalize());
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(FetchError::Retry(format!(
                    "SHA512 не совпал для {url} (ожидалось {expected}, получено {actual})"
                )));
            }
        }

        let mut last = None;
        for i in 0..4u64 {
            match tokio::fs::rename(&tmp_path, dest).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last = Some(e);
                    tokio::time::sleep(Duration::from_millis(150 * (i + 1))).await;
                }
            }
        }
        Err(FetchError::Fatal(format!(
            "Не удалось сохранить {}: {}",
            dest.display(),
            last.map(|e| e.to_string()).unwrap_or_default()
        )))
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }
    result
}

fn read_mrpack_index(pack_path: &Path) -> Result<MrpackIndex, String> {
    use std::io::Read;
    let file = std::fs::File::open(pack_path)
        .map_err(|e| format!("Не удалось открыть .mrpack: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения .mrpack: {e}"))?;
    let mut entry = archive
        .by_name("modrinth.index.json")
        .map_err(|_| "В .mrpack нет modrinth.index.json".to_string())?;
    let mut buf = String::new();
    entry
        .read_to_string(&mut buf)
        .map_err(|e| format!("Ошибка чтения modrinth.index.json: {e}"))?;
    serde_json::from_str(&buf).map_err(|e| format!("Ошибка разбора modrinth.index.json: {e}"))
}

fn extract_mrpack_overrides(pack_path: &Path, dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(pack_path)
        .map_err(|e| format!("Не удалось открыть .mrpack: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения .mrpack: {e}"))?;

    for prefix in ["overrides/", "client-overrides/"] {
        for i in 0..archive.len() {
            check_download_cancelled()?;
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Ошибка чтения entry .mrpack: {e}"))?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().to_string();
            let Some(rel) = name.strip_prefix(prefix) else {
                continue;
            };
            if rel.is_empty() {
                continue;
            }
            let Some(dest) = safe_join(dir, rel) else {
                eprintln!("[Mrpack] Пропущен небезопасный путь в архиве: {name}");
                continue;
            };
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку override: {e}"))?;
            }
            let mut out = std::fs::File::create(&dest)
                .map_err(|e| format!("Не удалось создать файл override {rel}: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Ошибка распаковки override {rel}: {e}"))?;
        }
    }
    Ok(())
}

fn emit_mrpack_progress(
    app: &AppHandle,
    phase: &str,
    current: Option<u32>,
    total: Option<u32>,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: phase.to_string(),
            current,
            total,
            message,
        },
    );
}

async fn install_mrpack_contents(
    app: &AppHandle,
    pack_path: &Path,
    dir: &Path,
    index: &MrpackIndex,
) -> Result<(), String> {
    emit_mrpack_progress(app, "overrides", None, None, None);
    {
        let pack_path = pack_path.to_path_buf();
        let dir = dir.to_path_buf();
        tokio::task::spawn_blocking(move || extract_mrpack_overrides(&pack_path, &dir))
            .await
            .map_err(|e| format!("Ошибка распаковки .mrpack: {e}"))??;
    }

    struct Job {
        dest: PathBuf,
        filename: String,
        urls: Vec<String>,
        sha1: Option<String>,
        sha512: Option<String>,
    }
    let mut jobs: Vec<Job> = Vec::new();
    for f in index.files.iter().filter(|f| f.should_download()) {
        let dest = safe_join(dir, &f.path)
            .ok_or_else(|| format!("Небезопасный путь файла в сборке: {}", f.path))?;
        jobs.push(Job {
            dest,
            filename: f.path.rsplit('/').next().unwrap_or(&f.path).to_string(),
            urls: f.downloads.clone(),
            sha1: f.hashes.get("sha1").cloned(),
            sha512: f.hashes.get("sha512").cloned(),
        });
    }
    let total = jobs.len() as u32;
    emit_mrpack_progress(app, "files", Some(0), Some(total), None);

    let client = http_client(false);
    let completed = Arc::new(AtomicU32::new(0));

    let mut downloads = stream::iter(jobs.into_iter())
        .map(|job| {
            let client = client.clone();
            let completed = Arc::clone(&completed);
            async move {
                check_download_cancelled()?;
                fetch_verified(
                    &client,
                    &job.urls,
                    &job.dest,
                    job.sha1.as_deref(),
                    job.sha512.as_deref(),
                )
                .await
                .map_err(|e| format!("{}: {e}", job.filename))?;
                let current = completed.fetch_add(1, Ordering::SeqCst) + 1;
                Ok::<(u32, String), String>((current, job.filename))
            }
        })
        .buffer_unordered(DEFAULT_DOWNLOAD_CONCURRENCY);

    while let Some(res) = downloads.next().await {
        let (current, filename) = res?;
        emit_mrpack_progress(app, "files", Some(current), Some(total), Some(filename));
    }

    Ok(())
}

async fn save_profile_icon_from_url(profile_id: &str, icon_url: &str) -> Result<Option<String>, String> {
    let trimmed = icon_url.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let dir = instance_dir(profile_id)?;
    let dest = dir.join("icon.png");

    let client = http_client(false);
    if fetch_verified(&client, &[trimmed.to_string()], &dest, None, None)
        .await
        .is_err()
    {
        return Ok(None);
    }

    let icon_path = dest.to_str().map(|s| s.to_string());
    set_profile_icon_path(profile_id, icon_path.clone())?;
    Ok(icon_path)
}

#[tauri::command]
pub async fn import_mrpack_as_new_profile(
    app: AppHandle,
    mrpack_path: String,
    icon_url: Option<String>,
) -> Result<InstanceProfileSummary, String> {
    emit_mrpack_progress(&app, "start", None, None, None);

    let pack_path = resolve_file_path(&mrpack_path);
    if !pack_path.exists() {
        return Err("Файл .mrpack не найден".to_string());
    }

    let index = {
        let p = pack_path.clone();
        tokio::task::spawn_blocking(move || read_mrpack_index(&p))
            .await
            .map_err(|e| format!("Ошибка чтения .mrpack: {e}"))??
    };

    let (game_version, loader) = mrpack_game_version_and_loader(&index.dependencies);
    let name = index
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            pack_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Modpack")
                .to_string()
        });

    let profile = create_profile_impl(name, game_version, loader, None, None, None)?;
    let profile_id = profile.id.clone();
    let dir = instance_dir(&profile.id)?;

    if let Err(e) = install_mrpack_contents(&app, &pack_path, &dir, &index).await {
        let _ = delete_profile(profile_id);
        return Err(e);
    }

    if !dir.join("icon.png").exists() {
        if let Some(ref url) = icon_url {
            let _ = save_profile_icon_from_url(&profile.id, url).await;
        }
    }

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

    Ok(InstanceProfileSummary {
        id: profile.id,
        name: profile.name,
        icon_path: {
            let icon_png_path = dir.join("icon.png");
            if icon_png_path.exists() {
                icon_png_path.to_str().map(|s| s.to_string())
            } else {
                profile.icon_path
            }
        },
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
    })
}

#[tauri::command]
pub async fn download_modrinth_modpack_and_import(
    app: AppHandle,
    url: String,
    filename: String,
    icon_url: Option<String>,
) -> Result<InstanceProfileSummary, String> {
    let root = cache_service::tmp_cache_dir()?.join("modrinth_modpacks");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Не удалось создать temp-папку: {e}"))?;

    let base_name = Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("pack.mrpack");

    let suffix: u64 = rand::thread_rng().gen();
    let dest = root.join(format!("{}-{}", suffix, base_name));

    check_download_cancelled()?;

    let client = http_client_for_binary_download(false);
    let downloaded = fetch_verified(&client, &[url], &dest, None, None).await;

    let result = match downloaded {
        Ok(()) => match dest.to_str() {
            Some(dest_str) => {
                import_mrpack_as_new_profile(app.clone(), dest_str.to_string(), icon_url).await
            }
            None => Err("Путь к временной .mrpack не в UTF-8".to_string()),
        },
        Err(e) => Err(format!("Ошибка загрузки Modrinth .mrpack: {e}")),
    };

    let _ = tokio::fs::remove_file(&dest).await;

    result
}

pub(crate) fn modrinth_content_subdir(category: &str) -> Result<&'static str, String> {
    match category {
        "mod" | "mods" => Ok("mods"),
        "resourcepack" | "resourcepacks" => Ok("resourcepacks"),
        "shader" | "shaderpack" | "shaderpacks" => Ok("shaderpacks"),
        other => Err(format!(
            "Неизвестный тип контента Modrinth: {other}. Ожидается mod, resourcepack или shader."
        )),
    }
}

pub async fn save_modrinth_file(
    category: &str,
    url: &str,
    filename: &str,
    profile_id: Option<&str>,
    expected_sha1: Option<&str>,
) -> Result<(), String> {
    let root = if let Some(id) = profile_id {
        instance_dir(id)?
    } else {
        game_root_dir()?
    };
    let subdir = modrinth_content_subdir(category)?;

    let target_dir = root.join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку '{subdir}': {e}"))?;

    let safe_name = Path::new(filename)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| format!("Некорректное имя файла: {filename}"))?;
    let dest_path = target_dir.join(safe_name);

    let client = http_client(false);
    fetch_verified(&client, &[url.to_string()], &dest_path, expected_sha1, None)
        .await
        .map_err(|e| format!("Ошибка загрузки файла Modrinth ({safe_name}): {e}"))
}

#[tauri::command]
pub async fn download_modrinth_file(
    category: String,
    url: String,
    filename: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    save_modrinth_file(
        &category,
        &url,
        &filename,
        profile_id.as_deref(),
        None,
    )
    .await
}

