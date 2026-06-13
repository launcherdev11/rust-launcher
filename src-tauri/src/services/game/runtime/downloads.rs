use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use flate2::read::GzDecoder;
use futures_util::StreamExt;
use reqwest::Client;
use reqwest::header::{ACCEPT_ENCODING, CONTENT_TYPE};
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use crate::infra::http::http_client;
use crate::models::events::{DownloadProgressPayload, EVENT_DOWNLOAD_PROGRESS};
use crate::services::game::core::{download_text_with_retries, sha1_hex_of_file};
use crate::services::game::console::log_to_console;
use crate::services::game::state::{
    CANCEL_DOWNLOAD, DEFAULT_DOWNLOAD_CONCURRENCY, DEFAULT_DOWNLOAD_RETRIES, FORGE_INSTALLER_MIN_BYTES,
    FORGE_MAVEN_MIRROR_BASE, FORGE_MAVEN_OFFICIAL_BASE,
};

use crate::services::game::version_types::{AssetIndexJson, AssetIndexRef, QuiltLoaderEntry};
pub(crate) async fn download_file(
    client: &Client,
    url: &str,
    path: &Path,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    offset_downloaded: u64,
) -> Result<u64, String> {

    let total_done = Arc::new(AtomicU64::new(offset_downloaded));
    download_file_checked(
        client,
        url,
        path,
        None,
        app,
        version_id,
        total_size,
        total_done,
        DEFAULT_DOWNLOAD_RETRIES,
    )
    .await
}


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
    std::fs::write(&launcher_profiles_path, text)
        .map_err(|e| format!("Не удалось записать launcher_profiles.json: {e}"))?;
    Ok(())
}

pub(crate) fn forge_installer_url_with_official_maven(installer_url: &str) -> String {
    installer_url.replace(FORGE_MAVEN_MIRROR_BASE, FORGE_MAVEN_OFFICIAL_BASE)
}

pub(crate) async fn download_forge_installer_once(
    client: &Client,
    url: &str,
    path: &Path,
    app: &AppHandle,
    version_id: &str,
    total_done: Arc<AtomicU64>,
) -> Result<u64, String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }

    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        return Err("Загрузка отменена пользователем".to_string());
    }

    let tmp_path = path.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Не удалось создать файл: {e}"))?;


    let resp = client
        .get(url)
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Forge installer: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        if status.as_u16() == 404 || status.is_server_error() {
            return Err("Версия Forge не найдена".to_string());
        }
        return Err(format!("HTTP {status} при запросе Forge installer"));
    }

    let ct = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<нет>");
    log_to_console(app, &format!("[Forge] Content-Type installer: {ct}"));
    if ct.to_ascii_lowercase().starts_with("text/html") {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err("Версия Forge не найдена".to_string());
    }

    let content_len = resp.content_length().unwrap_or(0);
    if content_len < FORGE_INSTALLER_MIN_BYTES {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err("Версия Forge не найдена".to_string());
    }

    let effective_total = content_len;

    let mut raw = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения потока: {e}"))?;

    if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut decoder = GzDecoder::new(raw.as_ref());
        let mut out = Vec::new();
        decoder
            .read_to_end(&mut out)
            .map_err(|e| format!("Ошибка распаковки gzip (Forge installer): {e}"))?;
        raw = out.into();
    }

    let bytes = raw;

    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err("Загрузка отменена пользователем".to_string());
    }

    tokio::io::AsyncWriteExt::write_all(&mut file, &bytes)
        .await
        .map_err(|e| format!("Ошибка записи: {e}"))?;

    let downloaded = bytes.len() as u64;
    total_done.fetch_add(downloaded, Ordering::SeqCst);

    let percent = if effective_total > 0 {
        downloaded as f32 / effective_total as f32 * 100.0
    } else {
        100.0
    };
    let _ = app.emit(
        EVENT_DOWNLOAD_PROGRESS,
        DownloadProgressPayload {
            version_id: version_id.to_string(),
            downloaded,
            total: effective_total,
            percent,
        },
    );

    drop(file);
    let _ = tokio::fs::remove_file(path).await;
    tokio::fs::rename(&tmp_path, path)
        .await
        .map_err(|e| format!("Не удалось переместить файл: {e}"))?;
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

    let mut attempt: usize = 0;
    loop {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("Загрузка отменена пользователем".to_string());
        }

        if path.exists() {
            if let Some(expected) = expected_sha1.as_ref() {
                let actual = sha1_hex_of_file(path).await?;
                if actual.eq_ignore_ascii_case(expected) {
                    return Ok(0);
                }
                let _ = tokio::fs::remove_file(path).await;
            } else {
                return Ok(0);
            }
        }

        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp_path = path.with_extension(format!("part-{}-{}", std::process::id(), unique_id));
        let mut file = tokio::fs::File::create(&tmp_path)
            .await
            .map_err(|e| format!("Не удалось создать файл: {e}"))?;

        let resp = client.get(url).send().await;
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                if attempt + 1 >= retries {
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return Err(format!("Ошибка загрузки {url}: {e}"));
                }
                let _ = tokio::fs::remove_file(&tmp_path).await;
                let delay_ms = (1000u64).saturating_mul(2u64.saturating_pow(attempt.min(6) as u32));
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                attempt += 1;
                continue;
            }
        };

        let status = resp.status();
        if !status.is_success() {
            let should_retry = status.as_u16() == 404
                || status.as_u16() == 408
                || status.as_u16() == 429
                || status.is_server_error();
            let body = resp.text().await.unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
            if !should_retry || attempt + 1 >= retries {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(format!("HTTP {} для {}: {}", status, url, body));
            }
            let _ = tokio::fs::remove_file(&tmp_path).await;
            let delay_ms = (1000u64).saturating_mul(2u64.saturating_pow(attempt.min(6) as u32));
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            attempt += 1;
            continue;
        }

        let content_len = resp.content_length().unwrap_or(0);
        let effective_total = if total_size > 0 { total_size } else { content_len };

        let mut downloaded: u64 = 0;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err("Загрузка отменена пользователем".to_string());
            }
            let chunk = chunk.map_err(|e| format!("Ошибка чтения потока: {e}"))?;
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                .await
                .map_err(|e| format!("Ошибка записи: {e}"))?;
            downloaded += chunk.len() as u64;
            let total_now = total_done.fetch_add(chunk.len() as u64, Ordering::SeqCst) + (chunk.len() as u64);
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
                    percent,
                },
            );
        }

        drop(file);

        if let Some(expected) = expected_sha1.clone() {
            let actual = sha1_hex_of_file(&tmp_path).await?;
            if actual.to_ascii_lowercase() != expected.to_ascii_lowercase() {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                if attempt + 1 >= retries {
                    return Err(format!(
                        "SHA1 не совпал для {} (ожидалось {}, получено {})",
                        path.display(),
                        expected,
                        actual
                    ));
                }
                let delay_ms = (800u64).saturating_mul(2u64.saturating_pow(attempt.min(6) as u32));
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                attempt += 1;
                continue;
            }
        }

        if path.exists() {
            if let Some(expected) = expected_sha1.as_ref() {
                let actual_existing = sha1_hex_of_file(path).await?;
                if actual_existing.eq_ignore_ascii_case(expected) {
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return Ok(downloaded);
                }
                let _ = tokio::fs::remove_file(path).await;
            } else {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Ok(downloaded);
            }
        }

        match tokio::fs::rename(&tmp_path, path).await {
            Ok(()) => return Ok(downloaded),
            Err(e) => {
                if path.exists() {
                    if let Some(expected) = expected_sha1.as_ref() {
                        let actual_existing = sha1_hex_of_file(path).await?;
                        if actual_existing.eq_ignore_ascii_case(expected) {
                            let _ = tokio::fs::remove_file(&tmp_path).await;
                            return Ok(downloaded);
                        }
                    } else {
                        let _ = tokio::fs::remove_file(&tmp_path).await;
                        return Ok(downloaded);
                    }
                }
                return Err(format!(
                    "Не удалось финализировать файл: {e} (url: {url}, target: {})",
                    path.display()
                ));
            }
        }
    }
}

const ASSETS_BASE_URL: &str = "https://resources.download.minecraft.net";

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

    let index_path = indexes_dir.join(format!("{}.json", asset_index.id));
    let index_json = if index_path.exists() {
        tokio::fs::read_to_string(&index_path)
            .await
            .map_err(|e| format!("Ошибка чтения индекса: {e}"))?
    } else {
        let text = download_text_with_retries(client, &asset_index.url, DEFAULT_DOWNLOAD_RETRIES).await?;
        tokio::fs::write(&index_path, &text)
            .await
            .map_err(|e| format!("Не удалось сохранить индекс: {e}"))?;
        text
    };

    let index: AssetIndexJson = serde_json::from_str(&index_json)
        .map_err(|e| format!("Ошибка разбора индекса ассетов: {e}"))?;

    let sem = Arc::new(Semaphore::new(DEFAULT_DOWNLOAD_CONCURRENCY));
    let total_done = Arc::new(AtomicU64::new(total_downloaded));
    let mut tasks = futures_util::stream::FuturesUnordered::new();

    for (_path, obj) in &index.objects {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("Загрузка отменена пользователем".to_string());
        }
        let hash = obj.hash.clone();
        let size = obj.size;
        if hash.len() < 2 {
            continue;
        }
        let prefix = hash[..2].to_string();
        let obj_path = objects_dir.join(&prefix).join(&hash);
        if obj_path.exists() {
            total_done.fetch_add(size, Ordering::SeqCst);
            continue;
        }
        let url = format!("{ASSETS_BASE_URL}/{prefix}/{hash}");
        let client = client.clone();
        let app = app.clone();
        let sem = sem.clone();
        let total_done = total_done.clone();
        let version_id = version_id.to_string();
        let obj_path2 = obj_path.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = sem.acquire_owned().await.map_err(|_| "Semaphore закрыт".to_string())?;
            if let Some(parent) = obj_path2.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("Не удалось создать папку: {e}"))?;
            }
            download_file_checked(
                &client,
                &url,
                &obj_path2,
                Some(hash),
                &app,
                &version_id,
                total_size,
                total_done,
                DEFAULT_DOWNLOAD_RETRIES,
            )
            .await?;
            Ok::<(), String>(())
        }));
    }

    while let Some(res) = tasks.next().await {
        res.map_err(|e| format!("Ошибка задачи загрузки ассетов: {e}"))??;
    }

    Ok(())
}

pub(crate) fn extract_natives_jar(jar_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(jar_path)
        .map_err(|e| format!("Не удалось открыть jar: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Ошибка zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Ошибка чтения entry: {e}"))?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        if name.starts_with("META-INF/") {
            continue;
        }
        let out_path = out_dir.join(&name);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("Ошибка создания папки: {e}"))?;
        } else {
            if let Some(p) = out_path.parent() {
                std::fs::create_dir_all(p).map_err(|e| format!("Ошибка создания папки: {e}"))?;
            }
            let mut out_file =
                std::fs::File::create(&out_path).map_err(|e| format!("Ошибка создания файла: {e}"))?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| format!("Ошибка копирования: {e}"))?;
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











