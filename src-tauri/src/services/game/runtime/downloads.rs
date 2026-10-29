use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use flate2::read::GzDecoder;
use futures_util::StreamExt;
use reqwest::Client;
use reqwest::header::{ACCEPT_ENCODING, CONTENT_TYPE, RANGE};
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use crate::infra::http::http_client;
use crate::models::events::{DownloadProgressPayload, EVENT_DOWNLOAD_PROGRESS};
use crate::services::game::core::{
    download_text_with_retries, file_len_matches, is_retryable_status, retry_delay, sha1_hex_of_file,
};
use crate::services::game::console::log_to_console;
use crate::services::game::mirrors::LOCAL_ERROR;
use crate::services::game::state::{
    CANCEL_DOWNLOAD, DEFAULT_DOWNLOAD_CONCURRENCY, DEFAULT_DOWNLOAD_RETRIES, FORGE_INSTALLER_MIN_BYTES,
    FORGE_MAVEN_MIRROR_BASE, FORGE_MAVEN_OFFICIAL_BASE,
};

use crate::services::game::version_types::{AssetIndexJson, AssetIndexRef, QuiltLoaderEntry};



pub(crate) async fn file_starts_with_pk(path: &Path) -> Result<bool, String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        use std::io::Read;
        let mut f = std::fs::File::open(&path)
            .map_err(|e| format!("Не удалось открыть файл для проверки заголовка: {e}"))?;
        let mut buf = [0u8; 4];
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("Не удалось прочитать заголовок файла: {e}"))?;
        if n < 2 {
            return Ok(false);
        }
        Ok(buf[0] == b'P' && buf[1] == b'K')
    })
    .await
    .map_err(|e| format!("Ошибка проверки файла: {e}"))?
}

pub(crate) fn ensure_launcher_profiles_json(game_dir: &Path, mc_version: &str) -> Result<(), String> {

    let launcher_profiles_path = game_dir.join("launcher_profiles.json");
    let game_dir_str = game_dir
        .to_str()
        .ok_or("Путь к gameDir не в UTF-8")?
        .to_string();

    let profile_key = format!("mc16launcher-forge-{}", mc_version);

    let mut root_obj = if launcher_profiles_path.exists() {
        let text = std::fs::read_to_string(&launcher_profiles_path)
            .map_err(|e| format!("Не удалось прочитать launcher_profiles.json: {e}"))?;
        serde_json::from_str::<serde_json::Value>(&text).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !root_obj.get("profiles").is_some() || !root_obj["profiles"].is_object() {
        root_obj["profiles"] = serde_json::json!({});
    }

    let profiles_obj = root_obj["profiles"].as_object_mut().ok_or_else(|| {
        "launcher_profiles.json: поле profiles не является объектом".to_string()
    })?;

    let mut found_key: Option<String> = None;
    for (k, v) in profiles_obj.iter() {
        if v.get("gameDir").and_then(|x| x.as_str()) == Some(game_dir_str.as_str()) {
            found_key = Some(k.clone());
            break;
        }
    }

    if found_key.is_none() {
        profiles_obj.insert(
            profile_key.clone(),
            serde_json::json!({
                "name": profile_key,
                "gameDir": game_dir_str,
                "lastVersionId": mc_version,
                "type": "custom",
                "created": "1970-01-01T00:00:00.000Z",
                "lastUsed": "1970-01-01T00:00:00.000Z"
            }),
        );
        found_key = Some(profile_key.clone());
    } else if let Some(key) = found_key.clone() {
        if let Some(profile) = profiles_obj.get_mut(&key) {
            if let Some(obj) = profile.as_object_mut() {
                obj.insert(
                    "lastVersionId".to_string(),
                    serde_json::Value::String(mc_version.to_string()),
                );
            }
        }
    }

    let selected_profile = found_key.ok_or_else(|| "Не удалось определить selectedProfile".to_string())?;
    root_obj["selectedProfile"] = serde_json::Value::String(selected_profile);

    if !root_obj.get("clientToken").is_some() {
        root_obj["clientToken"] =
            serde_json::Value::String("00000000-0000-0000-0000-000000000000".to_string());
    }
    if !root_obj.get("authenticationDatabase").is_some() || !root_obj["authenticationDatabase"].is_object() {
        root_obj["authenticationDatabase"] = serde_json::json!({});
    }
    if !root_obj.get("selectedUser").is_some() {
        root_obj["selectedUser"] = serde_json::Value::String("00000000000000000000000000000000".to_string());
    }
    if !root_obj.get("launcherVersion").is_some() {
        root_obj["launcherVersion"] = serde_json::json!({"name": "1.5.3", "format": 17});
    }

    let text = serde_json::to_string_pretty(&root_obj)
        .map_err(|e| format!("Не удалось сериализовать launcher_profiles.json: {e}"))?;
    crate::infra::fs_atomic::write_atomic(&launcher_profiles_path, text.as_bytes())
        .map_err(|e| format!("Не удалось записать launcher_profiles.json: {e}"))?;
    Ok(())
}

pub(crate) fn forge_installer_url_with_official_maven(installer_url: &str) -> String {
    installer_url.replace(FORGE_MAVEN_MIRROR_BASE, FORGE_MAVEN_OFFICIAL_BASE)
}

const CANCELLED_MSG: &str = "Загрузка отменена пользователем";
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(120);

struct TmpFileGuard {
    path: std::path::PathBuf,
    armed: bool,
}

impl TmpFileGuard {
    fn new(path: std::path::PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TmpFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

enum AttemptError {
    Fatal(String),
    FatalStatus(u16, String),
    Retry(String),
}

pub(crate) async fn download_forge_installer_once(
    client: &Client,
    url: &str,
    path: &Path,
    app: &AppHandle,
    version_id: &str,
    total_done: Arc<AtomicU64>,
) -> Result<u64, String> {
    const ATTEMPTS: usize = 6;
    let mut attempt = 0usize;
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match download_forge_installer_attempt(client, url, path, app, version_id, &total_done, &mut buf).await {
            Ok(n) => return Ok(n),
            Err(AttemptError::Fatal(e)) | Err(AttemptError::FatalStatus(_, e)) => return Err(e),
            Err(AttemptError::Retry(e)) => {
                attempt += 1;
                if attempt >= ATTEMPTS {
                    return Err(e);
                }
                log_to_console(
                    app,
                    &format!("[Forge] Загрузка installer не удалась ({e}), повтор {attempt}/{}", ATTEMPTS - 1),
                );
                tokio::time::sleep(retry_delay(attempt - 1)).await;
            }
        }
    }
}

async fn download_forge_installer_attempt(
    client: &Client,
    url: &str,
    path: &Path,
    app: &AppHandle,
    version_id: &str,
    total_done: &Arc<AtomicU64>,
    buf: &mut Vec<u8>,
) -> Result<u64, AttemptError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AttemptError::Fatal(format!("Не удалось создать папку: {e}")))?;
    }

    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        return Err(AttemptError::Fatal(CANCELLED_MSG.to_string()));
    }

    let mut req = client.get(url).header(ACCEPT_ENCODING, "identity");
    if !buf.is_empty() {
        req = req.header(RANGE, format!("bytes={}-", buf.len()));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AttemptError::Retry(format!("Ошибка запроса Forge installer: {e}")))?;

    let status = resp.status();
    if status.as_u16() == 416 {
        buf.clear();
        return Err(AttemptError::Retry("Сервер отклонил докачку installer".to_string()));
    }
    if !status.is_success() {
        if status.as_u16() == 404 {
            return Err(AttemptError::Fatal("Версия Forge не найдена".to_string()));
        }
        let msg = format!("HTTP {status} при запросе Forge installer");
        return Err(if status.is_server_error() || status.as_u16() == 429 {
            AttemptError::Retry(msg)
        } else {
            AttemptError::Fatal(msg)
        });
    }

    let ct = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<нет>")
        .to_string();
    log_to_console(app, &format!("[Forge] Content-Type installer: {ct}"));
    if ct.to_ascii_lowercase().starts_with("text/html") {
        return Err(AttemptError::Fatal("Версия Forge не найдена".to_string()));
    }

    if status.as_u16() != 206 {
        buf.clear();
    }
    let content_len = resp.content_length().unwrap_or(0);
    let expected_total = if content_len == 0 { 0 } else { buf.len() as u64 + content_len };
    if expected_total != 0 && expected_total < FORGE_INSTALLER_MIN_BYTES {
        return Err(AttemptError::Fatal("Версия Forge не найдена".to_string()));
    }

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err(AttemptError::Fatal(CANCELLED_MSG.to_string()));
        }
        let chunk = chunk.map_err(|e| AttemptError::Retry(format!("Ошибка чтения потока: {e}")))?;
        buf.extend_from_slice(&chunk);
    }

    if expected_total > 0 && buf.len() as u64 != expected_total {
        return Err(AttemptError::Retry(format!(
            "Installer получен не полностью ({} из {expected_total} байт)",
            buf.len()
        )));
    }

    let mut raw: Vec<u8> = std::mem::take(buf);

    if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut decoder = GzDecoder::new(&raw[..]);
        let mut out = Vec::new();
        decoder
            .read_to_end(&mut out)
            .map_err(|e| AttemptError::Fatal(format!("Ошибка распаковки gzip (Forge installer): {e}")))?;
        raw = out;
    }

    if (raw.len() as u64) < FORGE_INSTALLER_MIN_BYTES || !raw.starts_with(b"PK") {
        return Err(AttemptError::Fatal(
            "Сервер вернул не jar-файл Forge installer (возможно, страница-заглушка)".to_string(),
        ));
    }

    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        return Err(AttemptError::Fatal(CANCELLED_MSG.to_string()));
    }

    let tmp_path = path.with_extension("part");
    let mut guard = TmpFileGuard::new(tmp_path.clone());
    tokio::fs::write(&tmp_path, &raw)
        .await
        .map_err(|e| AttemptError::Fatal(format!("Ошибка записи: {e}")))?;

    let downloaded = raw.len() as u64;
    total_done.fetch_add(downloaded, Ordering::SeqCst);
    let _ = app.emit(
        EVENT_DOWNLOAD_PROGRESS,
        DownloadProgressPayload {
            version_id: version_id.to_string(),
            downloaded,
            total: downloaded,
            percent: 100.0,
        },
    );

    let _ = tokio::fs::remove_file(path).await;
    tokio::fs::rename(&tmp_path, path)
        .await
        .map_err(|e| AttemptError::Fatal(format!("Не удалось переместить файл: {e}")))?;
    guard.disarm();
    Ok(downloaded)
}

pub(crate) async fn download_file_checked(
    client: &Client,
    url: &str,
    path: &Path,
    expected_sha1: Option<String>,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    total_done: Arc<AtomicU64>,
    retries: usize,
) -> Result<u64, String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }

    if !crate::infra::network::is_online().await {
        return Err(format!("{}: {url}", crate::infra::network::OFFLINE_ERR));
    }

    let urls = crate::services::game::mirrors::candidates(url);
    let has_fallback = urls.len() > 1;
    let mut errors: Vec<String> = Vec::new();
    for (idx, candidate) in urls.iter().enumerate() {
        let is_last = idx + 1 == urls.len();
        let attempts = if has_fallback && !is_last { retries.min(2) } else { retries };
        match download_file_from(
            client,
            candidate,
            path,
            expected_sha1.clone(),
            app,
            version_id,
            total_size,
            total_done.clone(),
            attempts,
        )
        .await
        {
            Ok(n) => {
                crate::services::game::mirrors::note_success(candidate);
                return Ok(n);
            }
            Err((msg, status)) => {
                errors.push(msg);
                if CANCEL_DOWNLOAD.load(Ordering::SeqCst)
                    || !crate::services::game::mirrors::worth_trying_next(status)
                {
                    break;
                }
                crate::services::game::mirrors::note_failure(candidate);
                if !is_last {
                    eprintln!("[Download] {candidate} недоступен, пробуем другой источник");
                }
            }
        }
    }
    Err(errors.join("; "))
}

async fn download_file_from(
    client: &Client,
    url: &str,
    path: &Path,
    expected_sha1: Option<String>,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    total_done: Arc<AtomicU64>,
    retries: usize,
) -> Result<u64, (String, Option<u16>)> {
    let retries = retries.max(1);
    let mut attempt: usize = 0;
    loop {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err((CANCELLED_MSG.to_string(), Some(LOCAL_ERROR)));
        }

        if path.exists() {
            let meta_len = tokio::fs::metadata(path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            if meta_len == 0 {
                let _ = tokio::fs::remove_file(path).await;
            } else if let Some(expected) = expected_sha1.as_ref() {
                let actual = sha1_hex_of_file(path).await.map_err(|e| (e, Some(LOCAL_ERROR)))?;
                if actual.eq_ignore_ascii_case(expected) {
                    return Ok(0);
                }
                let _ = tokio::fs::remove_file(path).await;
            } else {
                return Ok(0);
            }
        }

        match download_attempt(
            client,
            url,
            path,
            expected_sha1.as_deref(),
            app,
            version_id,
            total_size,
            &total_done,
            attempt,
        )
        .await
        {
            Ok(n) => return Ok(n),
            Err(AttemptError::Fatal(e)) => return Err((e, Some(LOCAL_ERROR))),
            Err(AttemptError::FatalStatus(status, e)) => return Err((e, Some(status))),
            Err(AttemptError::Retry(e)) => {
                attempt += 1;
                if attempt >= retries {
                    return Err((e, None));
                }
                eprintln!("[Download] {e} — повтор {attempt}/{}", retries - 1);
                tokio::time::sleep(retry_delay(attempt - 1)).await;
            }
        }
    }
}

async fn download_attempt(
    client: &Client,
    url: &str,
    path: &Path,
    expected_sha1: Option<&str>,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    total_done: &Arc<AtomicU64>,
    attempt: usize,
) -> Result<u64, AttemptError> {
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut tmp_name = path.as_os_str().to_owned();
    tmp_name.push(format!(".part-{}-{}", std::process::id(), unique_id));
    let tmp_path = std::path::PathBuf::from(tmp_name);
    let mut guard = TmpFileGuard::new(tmp_path.clone());

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AttemptError::Retry(format!("Ошибка загрузки {url}: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        let body: String = body.chars().take(300).collect();
        let msg = format!("HTTP {status} для {url}: {body}");
        return Err(if is_retryable_status(status.as_u16(), attempt) {
            AttemptError::Retry(msg)
        } else {
            AttemptError::FatalStatus(status.as_u16(), msg)
        });
    }

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| AttemptError::Fatal(format!("Не удалось создать файл: {e}")))?;

    let content_len = resp.content_length().unwrap_or(0);
    let effective_total = if total_size > 0 { total_size } else { content_len };

    let mut counted: u64 = 0;
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now()
        .checked_sub(PROGRESS_EMIT_INTERVAL)
        .unwrap_or_else(Instant::now);
    let mut stream = resp.bytes_stream();

    let emit = |downloaded: u64, total_now: u64| {
        let (reported_done, percent) = if total_size > 0 {
            let p = if effective_total > 0 {
                total_now as f32 / effective_total as f32 * 100.0
            } else {
                0.0
            };
            (total_now, p)
        } else {
            let p = if effective_total > 0 {
                downloaded as f32 / effective_total as f32 * 100.0
            } else {
                0.0
            };
            (downloaded, p)
        };
        let _ = app.emit(
            EVENT_DOWNLOAD_PROGRESS,
            DownloadProgressPayload {
                version_id: version_id.to_string(),
                downloaded: reported_done,
                total: effective_total,
                percent: percent.min(100.0),
            },
        );
    };

    let rollback = |counted: u64| {
        if counted > 0 {
            let _ = total_done.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| {
                Some(v.saturating_sub(counted))
            });
        }
    };

    while let Some(chunk) = stream.next().await {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            rollback(counted);
            return Err(AttemptError::Fatal(CANCELLED_MSG.to_string()));
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                rollback(counted);
                return Err(AttemptError::Retry(format!("Обрыв загрузки {url}: {e}")));
            }
        };
        if let Err(e) = tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await {
            rollback(counted);
            return Err(AttemptError::Fatal(format!(
                "Ошибка записи на диск ({}): {e}. Проверьте свободное место.",
                tmp_path.display()
            )));
        }
        downloaded += chunk.len() as u64;
        counted += chunk.len() as u64;
        let total_now = total_done.fetch_add(chunk.len() as u64, Ordering::SeqCst) + chunk.len() as u64;
        if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
            last_emit = Instant::now();
            emit(downloaded, total_now);
        }
    }

    if let Err(e) = tokio::io::AsyncWriteExt::flush(&mut file).await {
        rollback(counted);
        return Err(AttemptError::Fatal(format!("Ошибка записи на диск: {e}")));
    }
    drop(file);

    if content_len > 0 && downloaded != content_len {
        rollback(counted);
        return Err(AttemptError::Retry(format!(
            "Файл {url} получен не полностью ({downloaded} из {content_len} байт)"
        )));
    }
    if downloaded == 0 && expected_sha1.is_none() {
        rollback(counted);
        return Err(AttemptError::Retry(format!("Пустой ответ от {url}")));
    }

    if let Some(expected) = expected_sha1 {
        let actual = sha1_hex_of_file(&tmp_path)
            .await
            .map_err(AttemptError::Fatal)?;
        if !actual.eq_ignore_ascii_case(expected) {
            rollback(counted);
            return Err(AttemptError::Retry(format!(
                "SHA1 не совпал для {} (ожидалось {expected}, получено {actual})",
                path.display()
            )));
        }
    }

    emit(downloaded, total_done.load(Ordering::SeqCst));

    if path.exists() {
        match expected_sha1 {
            Some(expected) => {
                if let Ok(existing) = sha1_hex_of_file(path).await {
                    if existing.eq_ignore_ascii_case(expected) {
                        return Ok(downloaded);
                    }
                }
                let _ = tokio::fs::remove_file(path).await;
            }
            None => return Ok(downloaded),
        }
    }

    let mut last_err = None;
    for i in 0..4u64 {
        match tokio::fs::rename(&tmp_path, path).await {
            Ok(()) => {
                guard.disarm();
                return Ok(downloaded);
            }
            Err(e) => {
                last_err = Some(e);
                tokio::time::sleep(Duration::from_millis(150 * (i + 1))).await;
            }
        }
    }
    let e = last_err.expect("loop ran at least once");
    if path.exists() {
        return Ok(downloaded);
    }
    Err(AttemptError::Fatal(format!(
        "Не удалось финализировать файл: {e} (url: {url}, target: {})",
        path.display()
    )))
}

const ASSETS_BASE_URL: &str = "https://resources.download.minecraft.net";

fn asset_object_path(objects_dir: &Path, hash: &str) -> Option<std::path::PathBuf> {
    if hash.len() < 2 || !hash.is_ascii() {
        return None;
    }
    Some(objects_dir.join(&hash[..2]).join(hash))
}

async fn load_asset_index(
    client: &Client,
    asset_index: &AssetIndexRef,
    indexes_dir: &Path,
) -> Result<AssetIndexJson, String> {
    let index_path = indexes_dir.join(format!("{}.json", asset_index.id));

    if let Ok(text) = tokio::fs::read_to_string(&index_path).await {
        if let Ok(parsed) = serde_json::from_str::<AssetIndexJson>(&text) {
            return Ok(parsed);
        }
        let _ = tokio::fs::remove_file(&index_path).await;
    }

    let text = download_text_with_retries(client, &asset_index.url, DEFAULT_DOWNLOAD_RETRIES).await?;
    let parsed: AssetIndexJson =
        serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора индекса ассетов: {e}"))?;
    crate::infra::fs_atomic::write_atomic(&index_path, text.as_bytes())?;
    Ok(parsed)
}

pub(crate) async fn download_assets(
    client: &Client,
    asset_index: &AssetIndexRef,
    root: &Path,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    total_downloaded: u64,
) -> Result<(), String> {
    let assets_root = root.join("assets");
    let indexes_dir = assets_root.join("indexes");
    let objects_dir = assets_root.join("objects");
    tokio::fs::create_dir_all(&indexes_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку indexes: {e}"))?;
    tokio::fs::create_dir_all(&objects_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку objects: {e}"))?;

    let index = load_asset_index(client, asset_index, &indexes_dir).await?;

    let sem = Arc::new(Semaphore::new(DEFAULT_DOWNLOAD_CONCURRENCY));
    let total_done = Arc::new(AtomicU64::new(total_downloaded));
    let mut tasks = futures_util::stream::FuturesUnordered::new();
    let mut aborts: Vec<tokio::task::AbortHandle> = Vec::new();
    let mut queued = std::collections::HashSet::<&str>::new();

    for obj in index.objects.values() {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            for a in &aborts {
                a.abort();
            }
            return Err(CANCELLED_MSG.to_string());
        }
        let hash = obj.hash.clone();
        let size = obj.size;
        let Some(obj_path) = asset_object_path(&objects_dir, &hash) else {
            continue;
        };
        if !queued.insert(obj.hash.as_str()) {
            continue;
        }
        if file_len_matches(&obj_path, size) || (size == 0 && obj_path.is_file()) {
            total_done.fetch_add(size, Ordering::SeqCst);
            continue;
        }
        let _ = tokio::fs::remove_file(&obj_path).await;
        let url = format!("{ASSETS_BASE_URL}/{}/{hash}", &hash[..2]);
        let client = client.clone();
        let app = app.clone();
        let sem = sem.clone();
        let total_done = total_done.clone();
        let version_id = version_id.to_string();
        let handle = tokio::spawn(async move {
            let _permit = sem.acquire_owned().await.map_err(|_| "Semaphore закрыт".to_string())?;
            download_file_checked(
                &client,
                &url,
                &obj_path,
                Some(hash),
                &app,
                &version_id,
                total_size,
                total_done,
                DEFAULT_DOWNLOAD_RETRIES,
            )
            .await?;
            Ok::<(), String>(())
        });
        aborts.push(handle.abort_handle());
        tasks.push(handle);
    }

    while let Some(res) = tasks.next().await {
        let outcome = res
            .map_err(|e| format!("Ошибка задачи загрузки ассетов: {e}"))
            .and_then(|r| r);
        if let Err(e) = outcome {
            for a in &aborts {
                a.abort();
            }
            return Err(e);
        }
    }

    Ok(())
}

fn sync_legacy_assets(
    assets_root: &Path,
    index: &AssetIndexJson,
    resources_dir: Option<&Path>,
) -> Result<(), String> {
    let objects_dir = assets_root.join("objects");
    let virtual_dir = assets_root.join("virtual").join("legacy");
    for (name, obj) in &index.objects {
        let Some(src) = asset_object_path(&objects_dir, &obj.hash) else {
            continue;
        };
        if !src.is_file() {
            continue;
        }
        let mut targets = Vec::new();
        if index.is_virtual {
            if let Some(p) = crate::services::game::core::safe_join(&virtual_dir, name) {
                targets.push(p);
            }
        }
        if index.map_to_resources {
            if let Some(dir) = resources_dir {
                if let Some(p) = crate::services::game::core::safe_join(dir, name) {
                    targets.push(p);
                }
            }
        }
        for dest in targets {
            if file_len_matches(&dest, obj.size) {
                continue;
            }
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку ассетов: {e}"))?;
            }
            std::fs::copy(&src, &dest)
                .map_err(|e| format!("Не удалось скопировать ассет {name}: {e}"))?;
        }
    }
    Ok(())
}

pub(crate) async fn ensure_assets_for_launch(
    client: &Client,
    asset_index: &AssetIndexRef,
    root: &Path,
    app: &AppHandle,
    version_id: &str,
    game_dir: &Path,
) {
    let assets_root = root.join("assets");
    let indexes_dir = assets_root.join("indexes");
    let objects_dir = assets_root.join("objects");
    let _ = tokio::fs::create_dir_all(&indexes_dir).await;

    let index = match load_asset_index(client, asset_index, &indexes_dir).await {
        Ok(i) => i,
        Err(e) => {
            log_to_console(app, &format!("[Launch] Индекс ассетов недоступен ({e}), запуск без проверки"));
            return;
        }
    };

    let missing = index
        .objects
        .values()
        .filter(|o| {
            asset_object_path(&objects_dir, &o.hash)
                .map(|p| !(file_len_matches(&p, o.size) || (o.size == 0 && p.is_file())))
                .unwrap_or(false)
        })
        .count();

    if missing > 0 && !crate::infra::network::is_online().await {
        log_to_console(
            app,
            &format!("[Launch] Не хватает {missing} файлов ассетов, без интернета запускаем как есть"),
        );
    } else if missing > 0 {
        log_to_console(
            app,
            &format!("[Launch] Не хватает {missing} файлов ассетов — докачиваем"),
        );
        if let Err(e) = download_assets(client, asset_index, root, app, version_id, 0, 0).await {
            log_to_console(app, &format!("[Launch] Не удалось докачать ассеты: {e}"));
        }
    }

    if index.is_virtual || index.map_to_resources {
        let resources = game_dir.join("resources");
        let result = tokio::task::spawn_blocking(move || {
            sync_legacy_assets(&assets_root, &index, Some(&resources))
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
        if let Err(e) = result {
            log_to_console(app, &format!("[Launch] Ассеты старого формата: {e}"));
        }
    }
}

pub(crate) fn extract_natives_jar(jar_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(jar_path)
        .map_err(|e| format!("Не удалось открыть jar: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Ошибка zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Ошибка чтения entry: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        if name.starts_with("META-INF/") {
            continue;
        }
        let Some(out_path) = crate::services::game::core::safe_join(out_dir, &name) else {
            continue;
        };
        if file_len_matches(&out_path, entry.size()) {
            continue;
        }
        if let Some(p) = out_path.parent() {
            std::fs::create_dir_all(p).map_err(|e| format!("Ошибка создания папки: {e}"))?;
        }
        let tmp_path = out_path.with_extension("tmp-extract");
        let write_result = (|| -> std::io::Result<()> {
            let mut out_file = std::fs::File::create(&tmp_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
            Ok(())
        })();
        match write_result {
            Ok(()) => {
                if let Err(e) = std::fs::rename(&tmp_path, &out_path) {
                    let _ = std::fs::remove_file(&tmp_path);
                    if !out_path.is_file() {
                        return Err(format!("Ошибка записи {}: {e}", out_path.display()));
                    }
                }
            }
            Err(e) => {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(format!("Ошибка распаковки {name}: {e}"));
            }
        }
    }
    Ok(())
}

pub(crate) async fn select_latest_quilt_loader(game_version: &str) -> Result<String, String> {
    let url = format!("https://meta.quiltmc.org/v3/versions/loader/{game_version}");
    let client = http_client(false);
    let text = download_text_with_retries(&client, &url, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка запроса списка Quilt: {e}"))?;
    let list: Vec<QuiltLoaderEntry> = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора списка Quilt: {e}. Первые символы ответа: {head}")
    })?;
    if list.is_empty() {
        return Err(format!(
            "Для версии Minecraft {game_version} нет доступных версий Quilt Loader"
        ));
    }

    let mut best: Option<QuiltLoaderEntry> = None;
    for entry in list {
        match best {
            None => best = Some(entry),
            Some(ref current) => {
                if entry.loader.build > current.loader.build {
                    best = Some(entry);
                }
            }
        }
    }
    let best = best.ok_or_else(|| "Не удалось выбрать версию Quilt Loader".to_string())?;
    Ok(best.loader.version)
}












#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn extract_natives_ignores_zip_slip_entries() {
        let root = std::env::temp_dir().join(format!("mc16-natives-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let jar = root.join("n.jar");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&jar).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("lwjgl.dll", opts).unwrap();
            zip.write_all(b"dll").unwrap();
            zip.start_file("../escaped.dll", opts).unwrap();
            zip.write_all(b"evil").unwrap();
            zip.start_file("META-INF/MANIFEST.MF", opts).unwrap();
            zip.write_all(b"m").unwrap();
            zip.finish().unwrap();
        }
        let out = root.join("natives");
        extract_natives_jar(&jar, &out).unwrap();
        extract_natives_jar(&jar, &out).unwrap();
        assert!(out.join("lwjgl.dll").is_file());
        assert!(!root.join("escaped.dll").exists());
        assert!(!out.join("META-INF").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
