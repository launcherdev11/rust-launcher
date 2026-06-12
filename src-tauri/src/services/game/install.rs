use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use crate::app::paths::{game_root_dir, libraries_dir, versions_dir};
use crate::infra::process::hide_console;
use crate::infra::http::{http_client, http_client_for_binary_download};
use crate::models::events::{DownloadProgressPayload, EVENT_DOWNLOAD_PROGRESS};
use crate::services::game::core::{
    current_os_name, download_text_with_retries, fabric_library_path,
    library_applies, resolve_native_artifact, try_fetch_remote_sha1,
};
use crate::services::game::console::log_to_console;
use crate::services::game::runtime::{
    download_assets, download_file, download_file_checked, download_forge_installer_once,
    ensure_launcher_profiles_json, extract_natives_jar, file_starts_with_pk,
    forge_installer_url_with_official_maven, parse_forge_id, parse_neoforge_id,
    select_latest_quilt_loader,
};
use crate::services::game::settings::load_settings_from_disk;
use crate::services::game::state::{
    CANCEL_DOWNLOAD, DEFAULT_DOWNLOAD_CONCURRENCY, DEFAULT_DOWNLOAD_RETRIES, FABRIC_META_PROFILE,
    FORGE_INSTALLER_MIRROR_URL, FORGE_MAVEN_MIRROR_BASE, NEOFORGE_MAVEN_BASE,
};
use crate::services::game::version_types::*;
use crate::services::game::versions::{
    get_mojang_version_url, neoforge_minecraft_version_for_install, resolve_mojang_version,
};

#[tauri::command]
pub async fn install_fabric(
    app: AppHandle,
    game_version: String,
    loader_version: String,
) -> Result<String, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let client = http_client(false);
    log_to_console(
        &app,
        &format!(
            "[Fabric] Начало установки Fabric для Minecraft {game_version}, loader {loader_version}"
        ),
    );
    let profile_url =
        format!("{FABRIC_META_PROFILE}/{game_version}/{loader_version}/profile/json");
    log_to_console(&app, &format!("[Fabric] Загрузка профиля с {profile_url}"));
    let resp = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки профиля Fabric: {e}"))?;
    let status = resp.status();
    log_to_console(&app, &format!("[Fabric] Ответ профиля: HTTP {status}"));
    let profile: FabricProfile = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора профиля Fabric: {e}"))?;

    let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
    log_to_console(
        &app,
        &format!(
            "[Fabric] Манифест Mojang для базовой версии {}: {mojang_url}",
            profile.inherits_from
        ),
    );
    let mojang_detail: VersionDetail = client
        .get(&mojang_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки версии Mojang: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора версии Mojang: {e}"))?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    tokio::fs::create_dir_all(&root).await.map_err(|e| format!("Папка игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root).await.map_err(|e| format!("Папка библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root).await.map_err(|e| format!("Папка версий: {e}"))?;

    let profile_id = profile.id.clone();
    let os_name = current_os_name();
    let mojang_dl = mojang_detail
        .downloads
        .as_ref()
        .ok_or("Версия Mojang без downloads")?;
    let mut total_size = mojang_dl.client.size
        + profile
            .libraries
            .iter()
            .map(|l| l.size)
            .fold(0u64, |a, b| a.saturating_add(b));
    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            total_size = total_size.saturating_add(a.size);
        }
        if let Some(nat) = resolve_native_artifact(lib, os_name) {
            total_size = total_size.saturating_add(nat.size);
        }
    }
    if let Some(ref ai) = mojang_detail.asset_index {
        log_to_console(
            &app,
            &format!(
                "[Fabric] Загрузка ассетов из {}",
                ai.url.as_str()
            ),
        );
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }
    let mut total_downloaded: u64 = 0;

    log_to_console(
        &app,
        &format!(
            "[Fabric] Итоговый размер загрузки (jar+lib+natives+assets): {} байт",
            total_size
        ),
    );

    let client_jar = root.join(format!("{}.jar", profile.inherits_from));
    if client_jar.is_file() {
        log_to_console(
            &app,
            &format!(
                "[Fabric] client.jar уже есть: {}",
                client_jar.display()
            ),
        );
        total_downloaded = total_downloaded.saturating_add(mojang_dl.client.size);
    } else {
        log_to_console(
            &app,
            &format!(
                "[Fabric] Загрузка клиентского JAR в {}",
                client_jar.display()
            ),
        );
        let _ = download_file(
            &client,
            &mojang_dl.client.url,
            &client_jar,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(mojang_dl.client.size);
    }

    let natives_dir = vers_root.join(&profile_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;
    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    log_to_console(&app, "[Fabric] Загрузка библиотек и natives Mojang");
    log_to_console(&app, "[Quilt] Загрузка библиотек и natives Mojang");
    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            if path.exists() {
                total_downloaded = total_downloaded.saturating_add(artifact.size);
                if total_size > 0 {
                    let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                    let _ = app.emit(
                        EVENT_DOWNLOAD_PROGRESS,
                        DownloadProgressPayload {
                            version_id: profile_id.clone(),
                            downloaded: total_downloaded,
                            total: total_size,
                            percent,
                        },
                    );
                }
                continue;
            }
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
            }
            let _ = download_file(
                &client,
                &artifact.url,
                &path,
                &app,
                &profile_id,
                total_size,
                total_downloaded,
            )
            .await?;
            total_downloaded = total_downloaded.saturating_add(artifact.size);
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    total_downloaded = total_downloaded.saturating_add(nat.size);
                    if total_size > 0 {
                        let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                        let _ = app.emit(
                            EVENT_DOWNLOAD_PROGRESS,
                            DownloadProgressPayload {
                                version_id: profile_id.clone(),
                                downloaded: total_downloaded,
                                total: total_size,
                                percent,
                            },
                        );
                    }
                    let _ = extract_natives_jar(&path, &natives_dir);
                    continue;
                }
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
                }
                let _ = download_file(
                    &client,
                    &nat.url,
                    &path,
                    &app,
                    &profile_id,
                    total_size,
                    total_downloaded,
                )
                .await?;
                total_downloaded = total_downloaded.saturating_add(nat.size);
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }

    let base_url = "https://maven.fabricmc.net/";
    for lib in &profile.libraries {
        let path = fabric_library_path(&lib.name);
        let url = lib
            .url
            .as_deref()
            .unwrap_or(base_url)
            .trim_end_matches('/');
        let lib_url = format!("{url}/{path}");
        let dest = libs_root.join(&path);
        if dest.exists() {
            total_downloaded = total_downloaded.saturating_add(lib.size);
            if total_size > 0 {
                let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                let _ = app.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgressPayload {
                        version_id: profile_id.clone(),
                        downloaded: total_downloaded,
                        total: total_size,
                        percent,
                    },
                );
            }
            continue;
        }
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
        }
        let _ = download_file(
            &client,
            &lib_url,
            &dest,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(lib.size);
    }

    if let Some(ref asset_index) = mojang_detail.asset_index {
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
    }

    let profile_dir = vers_root.join(&profile_id);
    tokio::fs::create_dir_all(&profile_dir).await.map_err(|e| format!("{e}"))?;
    let profile_path = profile_dir.join("profile.json");
    let profile_json = serde_json::to_string(&profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    tokio::fs::write(&profile_path, profile_json)
        .await
        .map_err(|e| format!("Ошибка записи профиля: {e}"))?;

    Ok(profile_id)
}


#[tauri::command]
pub async fn install_quilt(
    app: AppHandle,
    game_version: String,
    loader_version: Option<String>,
) -> Result<String, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let client = http_client(false);

    log_to_console(
        &app,
        &format!("[Quilt] Начало установки Quilt для Minecraft {game_version}"),
    );

    let loader_version = match loader_version {
        Some(v) if !v.trim().is_empty() => v,
        _ => select_latest_quilt_loader(&game_version).await?,
    };
    log_to_console(
        &app,
        &format!("[Quilt] Выбран loader {loader_version}"),
    );

    let profile_url = format!(
        "https://meta.quiltmc.org/v3/versions/loader/{game_version}/{loader_version}/profile/json"
    );
    log_to_console(&app, &format!("[Quilt] Загрузка профиля с {profile_url}"));

    let resp = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки профиля Quilt: {e}"))?;
    let status = resp.status();
    log_to_console(&app, &format!("[Quilt] Ответ профиля: HTTP {status}"));

    let profile: FabricProfile = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора профиля Quilt: {e}"))?;

    let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
    log_to_console(
        &app,
        &format!(
            "[Quilt] Манифест Mojang для базовой версии {}: {mojang_url}",
            profile.inherits_from
        ),
    );
    let mojang_detail: VersionDetail = client
        .get(&mojang_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки версии Mojang: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора версии Mojang: {e}"))?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    tokio::fs::create_dir_all(&root).await.map_err(|e| format!("Папка игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root).await.map_err(|e| format!("Папка библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root).await.map_err(|e| format!("Папка версий: {e}"))?;

    let profile_id = profile.id.clone();
    let os_name = current_os_name();
    let mojang_dl = mojang_detail
        .downloads
        .as_ref()
        .ok_or("Версия Mojang без downloads")?;

    let mut total_size = mojang_dl.client.size
        + profile
            .libraries
            .iter()
            .map(|l| l.size)
            .fold(0u64, |a, b| a.saturating_add(b));
    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            total_size = total_size.saturating_add(a.size);
        }
        let native_classifier = match os_name {
            "windows" => "natives-windows",
            "osx" => "natives-macos",
            _ => "natives-linux",
        };
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(ref nat) = classifiers.get(native_classifier) {
                total_size = total_size.saturating_add(nat.size);
            }
        }
    }
    if let Some(ref ai) = mojang_detail.asset_index {
        log_to_console(
            &app,
            &format!(
                "[Quilt] Загрузка ассетов из {}",
                ai.url.as_str()
            ),
        );
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }
    let mut total_downloaded: u64 = 0;

    log_to_console(
        &app,
        &format!(
            "[Quilt] Итоговый размер загрузки (jar+lib+natives+assets): {} байт",
            total_size
        ),
    );

    let client_jar = root.join(format!("{}.jar", profile.inherits_from));
    if client_jar.is_file() {
        log_to_console(
            &app,
            &format!(
                "[Quilt] client.jar уже есть: {}",
                client_jar.display()
            ),
        );
        total_downloaded = total_downloaded.saturating_add(mojang_dl.client.size);
    } else {
        log_to_console(
            &app,
            &format!(
                "[Quilt] Загрузка клиентского JAR в {}",
                client_jar.display()
            ),
        );
        let _ = download_file(
            &client,
            &mojang_dl.client.url,
            &client_jar,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(mojang_dl.client.size);
    }

    let natives_dir = vers_root.join(&profile_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;
    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            if path.exists() {
                total_downloaded = total_downloaded.saturating_add(artifact.size);
                if total_size > 0 {
                    let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                    let _ = app.emit(
                        EVENT_DOWNLOAD_PROGRESS,
                        DownloadProgressPayload {
                            version_id: profile_id.clone(),
                            downloaded: total_downloaded,
                            total: total_size,
                            percent,
                        },
                    );
                }
                continue;
            }
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
            }
            let _ = download_file(
                &client,
                &artifact.url,
                &path,
                &app,
                &profile_id,
                total_size,
                total_downloaded,
            )
            .await?;
            total_downloaded = total_downloaded.saturating_add(artifact.size);
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    total_downloaded = total_downloaded.saturating_add(nat.size);
                    if total_size > 0 {
                        let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                        let _ = app.emit(
                            EVENT_DOWNLOAD_PROGRESS,
                            DownloadProgressPayload {
                                version_id: profile_id.clone(),
                                downloaded: total_downloaded,
                                total: total_size,
                                percent,
                            },
                        );
                    }
                    let _ = extract_natives_jar(&path, &natives_dir);
                    continue;
                }
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
                }
                let _ = download_file(
                    &client,
                    &nat.url,
                    &path,
                    &app,
                    &profile_id,
                    total_size,
                    total_downloaded,
                )
                .await?;
                total_downloaded = total_downloaded.saturating_add(nat.size);
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }

    let base_url = "https://maven.quiltmc.org/repository/release/";
    for lib in &profile.libraries {
        let path = fabric_library_path(&lib.name);
        let url = lib
            .url
            .as_deref()
            .unwrap_or(base_url)
            .trim_end_matches('/');
        let lib_url = format!("{url}/{path}");
        let dest = libs_root.join(&path);
        if dest.exists() {
            total_downloaded = total_downloaded.saturating_add(lib.size);
            if total_size > 0 {
                let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                let _ = app.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgressPayload {
                        version_id: profile_id.clone(),
                        downloaded: total_downloaded,
                        total: total_size,
                        percent,
                    },
                );
            }
            continue;
        }
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
        }
        let _ = download_file(
            &client,
            &lib_url,
            &dest,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(lib.size);
    }

    if let Some(ref asset_index) = mojang_detail.asset_index {
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
    }

    let profile_dir = vers_root.join(&profile_id);
    tokio::fs::create_dir_all(&profile_dir).await.map_err(|e| format!("{e}"))?;
    let profile_path = profile_dir.join("profile.json");
    let profile_json =
        serde_json::to_string(&profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    tokio::fs::write(&profile_path, profile_json)
        .await
        .map_err(|e| format!("Ошибка записи профиля: {e}"))?;

    Ok(profile_id)
}


#[tauri::command]
pub async fn install_forge(
    app: AppHandle,
    version_id: String,
    installer_url: String,
) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let is_neoforge = version_id.contains("-neoforge-");
    let (mc_version, forge_build) = parse_forge_id(&version_id)
        .or_else(|| parse_neoforge_id(&version_id))
        .ok_or_else(|| format!("Некорректный id версии Forge/NeoForge: {version_id}"))?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;

    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Не удалось создать папку игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root)
        .await
        .map_err(|e| format!("Не удалось создать папку библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root)
        .await
        .map_err(|e| format!("Не удалось создать папку версий: {e}"))?;

    let manifest_mc_request = if is_neoforge {
        neoforge_minecraft_version_for_install(&forge_build, &mc_version)
    } else {
        mc_version.clone()
    };
    let (resolved_mc, vanilla_url) = resolve_mojang_version(&manifest_mc_request).await?;
    let base_version_json_path =
        vers_root.join(&resolved_mc).join(format!("{resolved_mc}.json"));
    if !base_version_json_path.exists() {
        install_version(app.clone(), resolved_mc.clone(), vanilla_url).await?;
    }

    ensure_launcher_profiles_json(&root, &resolved_mc)?;

    let launcher_settings = load_settings_from_disk();
    let installer_client = http_client_for_binary_download(false);
    let installer_dir = game_root_dir()?.join("forge_installers").join(&version_id);
    tokio::fs::create_dir_all(&installer_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку для Forge installer: {e}"))?;
    let installer_path = installer_dir.join("installer.jar");

    let need_download = if installer_path.exists() {
        let ok = file_starts_with_pk(&installer_path).await.unwrap_or(false);
        !ok
    } else {
        true
    };

    let total_done = Arc::new(AtomicU64::new(0));
    let mut forge_use_mirror = installer_url.contains(FORGE_MAVEN_MIRROR_BASE);
    if need_download {
        let mut download_error = match download_forge_installer_once(
            &installer_client,
            &installer_url,
            &installer_path,
            &app,
            &version_id,
            total_done.clone(),
        )
        .await
        {
            Ok(downloaded) => {
                let _ = downloaded;
                None
            }
            Err(e) => Some(e),
        };

        if let Some(primary_error) = download_error.take() {
            if launcher_settings.forge_proxy_fallback {
                let official_url = forge_installer_url_with_official_maven(&installer_url);
                let _ = log_to_console(
                    &app,
                    &format!(
                        "[Forge] Загрузка installer с зеркала не удалась: {primary_error}. Пробуем официальный Maven."
                    ),
                );
                match download_forge_installer_once(
                    &installer_client,
                    &official_url,
                    &installer_path,
                    &app,
                    &version_id,
                    total_done.clone(),
                )
                .await
                {
                    Ok(_) => forge_use_mirror = false,
                    Err(fallback_err) => {
                        return Err(format!(
                            "Ошибка скачивания Forge installer. Зеркало: {primary_error}; официальный Maven: {fallback_err}"
                        ));
                    }
                }
            } else {
                return Err(primary_error);
            }
        }
    }

    let vanilla_client_jar = vers_root.join(&mc_version).join(format!("{mc_version}.jar"));
    if !vanilla_client_jar.exists() {
        let json_text = tokio::fs::read_to_string(&base_version_json_path)
            .await
            .map_err(|e| format!("Не удалось прочитать манифест версии: {e}"))?;
        let detail: VersionDetail = serde_json::from_str(&json_text)
            .map_err(|e| format!("Ошибка разбора манифеста версии: {e}"))?;
        if let Some(ref downloads) = detail.downloads {
            log_to_console(
                &app,
                &format!(
                    "[Forge] Предзагрузка vanilla client.jar: {}",
                    vanilla_client_jar.display()
                ),
            );
            let total_done_pre = Arc::new(AtomicU64::new(0));
            if let Err(e) = download_file_checked(
                &installer_client,
                &downloads.client.url,
                &vanilla_client_jar,
                downloads.client.sha1.clone(),
                &app,
                &version_id,
                downloads.client.size,
                total_done_pre,
                DEFAULT_DOWNLOAD_RETRIES,
            )
            .await
            {
                log_to_console(
                    &app,
                    &format!(
                        "[Forge] Предзагрузка client.jar не удалась (Forge попробует сам): {e}"
                    ),
                );
                let _ = tokio::fs::remove_file(&vanilla_client_jar).await;
            }
        }
    }

    let game_dir = root.clone();
    let java_installer = installer_path.clone();

    let mut forge_java_bin =
        crate::java_runtime::ensure_java_runtime(17, "java-runtime-gamma").await?;
    #[cfg(windows)]
    {
        if let Some(name) = forge_java_bin.file_name().and_then(|n| n.to_str()) {
            if name.eq_ignore_ascii_case("javaw.exe") {
                let candidate = forge_java_bin.with_file_name("java.exe");
                if candidate.is_file() {
                    forge_java_bin = candidate;
                }
            }
        }
    }

    let app_for_forge_install = app.clone();
    let forge_java_bin_for_thread = forge_java_bin.clone();
    let forge_use_mirror_for_install = forge_use_mirror;
    let output = tokio::task::spawn_blocking(move || {
        use std::process::{Command, Stdio};

        let mut help_cmd = Command::new(&forge_java_bin_for_thread);
        help_cmd
            .arg("-jar")
            .arg(&java_installer)
            .arg("--help")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut help_cmd);
        let help_output = help_cmd.output();

        let help_text = help_output
            .as_ref()
            .map(|o| {
                let mut s = String::new();
                s.push_str(&String::from_utf8_lossy(&o.stdout));
                s.push_str(&String::from_utf8_lossy(&o.stderr));
                s
            })
            .unwrap_or_default();

        let has_install_client = help_text.contains("--installClient");
        let has_install_server = help_text.contains("--installServer");
        let has_mirror_flag = help_text.contains("--mirror");

        let game_dir_arg = game_dir.to_string_lossy().into_owned();

        if forge_use_mirror_for_install && has_mirror_flag {
            let _ = log_to_console(
                &app_for_forge_install,
                &format!("[Forge] Installer mirror: {FORGE_INSTALLER_MIRROR_URL}"),
            );
        }

        let run_installer = |args: &[&str]| {
            let mut cmd = Command::new(&forge_java_bin_for_thread);
            cmd.current_dir(&game_dir);
            cmd.arg("-jar").arg(&java_installer);
            for arg in args {
                cmd.arg(arg);
            }
            if forge_use_mirror_for_install && has_mirror_flag {
                cmd.arg("--mirror").arg(FORGE_INSTALLER_MIRROR_URL);
            }
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
            hide_console(&mut cmd);
            cmd.output()
        };

        if has_install_client {
            let _ = log_to_console(&app_for_forge_install, "[Forge] Installer mode: --installClient");
            run_installer(&["--installClient", &game_dir_arg])
        } else if has_install_server {
            let _ = log_to_console(
                &app_for_forge_install,
                "[Forge] Installer mode: --installServer (cwd=game_dir)",
            );
            run_installer(&["--installServer"])
        } else {
            let _ = log_to_console(
                &app_for_forge_install,
                "[Forge] Installer mode: fallback --installClient",
            );
            run_installer(&["--installClient", &game_dir_arg])
        }
    })
    .await
    .map_err(|e| format!("Ошибка запуска Forge installer (spawn_blocking): {e}"))?;

    let output = output.map_err(|e| format!("Ошибка запуска Forge installer: {e}"))?;

    if !output.status.success() {
        let _ = tokio::fs::remove_file(&installer_path).await;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Forge installer завершился ошибкой ({}). stdout: {}\nstderr: {}",
            output.status,
            stdout,
            stderr
        ));
    }

    let expected_version_json_path =
        vers_root.join(&version_id).join(format!("{version_id}.json"));
    if expected_version_json_path.exists() {
        return Ok(());
    }

    let alt_folder_name = format!("{mc_version}-forge-{forge_build}");
    let alt_json_name = format!("{alt_folder_name}.json");
    let alt_dir = vers_root.join(&alt_folder_name);
    let alt_json = alt_dir.join(&alt_json_name);
    if alt_json.exists() {
        let expected_dir = vers_root.join(&version_id);
        tokio::fs::create_dir_all(&expected_dir)
            .await
            .map_err(|e| format!("Не удалось создать папку версии: {e}"))?;
        let mut json_content = tokio::fs::read_to_string(&alt_json)
            .await
            .map_err(|e| format!("Не удалось прочитать JSON Forge: {e}"))?;
        json_content = json_content.replace(&alt_folder_name, &version_id);
        tokio::fs::write(&expected_version_json_path, &json_content)
            .await
            .map_err(|e| format!("Не удалось записать JSON версии: {e}"))?;
        let _ = tokio::fs::remove_dir_all(&alt_dir).await;
        return Ok(());
    }

    if is_neoforge {
        let neo_folder_name = format!("neoforge-{forge_build}");
        let neo_dir = vers_root.join(&neo_folder_name);
        let neo_json = neo_dir.join(format!("{neo_folder_name}.json"));
        if neo_json.exists() {
            let expected_dir = vers_root.join(&version_id);
            tokio::fs::create_dir_all(&expected_dir)
                .await
                .map_err(|e| format!("Не удалось создать папку версии: {e}"))?;
            let mut json_content = tokio::fs::read_to_string(&neo_json)
                .await
                .map_err(|e| format!("Не удалось прочитать JSON NeoForge: {e}"))?;
            json_content = json_content.replace(&neo_folder_name, &version_id);
            tokio::fs::write(&expected_version_json_path, &json_content)
                .await
                .map_err(|e| format!("Не удалось записать JSON версии: {e}"))?;
            let _ = tokio::fs::remove_dir_all(&neo_dir).await;
            return Ok(());
        }
    }

    let mut discovered_json: Option<(PathBuf, String)> = None;
    if let Ok(entries) = std::fs::read_dir(&vers_root) {
        for entry in entries.flatten() {
            let dir_path = entry.path();
            if !dir_path.is_dir() {
                continue;
            }
            let folder_name = match dir_path.file_name().and_then(|n| n.to_str()) {
                Some(v) => v.to_string(),
                None => continue,
            };
            let folder_lower = folder_name.to_ascii_lowercase();
            let matches = if is_neoforge {
                folder_lower.contains("neoforge") && folder_name.contains(&forge_build)
            } else {
                folder_lower.contains("forge") && folder_name.contains(&forge_build)
            };
            if !matches {
                continue;
            }

            let exact_json = dir_path.join(format!("{folder_name}.json"));
            if exact_json.exists() {
                discovered_json = Some((exact_json, folder_name));
                break;
            }

            let mut json_candidates: Vec<PathBuf> = Vec::new();
            if let Ok(inner_entries) = std::fs::read_dir(&dir_path) {
                for inner_entry in inner_entries.flatten() {
                    let p = inner_entry.path();
                    if !p.is_file() {
                        continue;
                    }
                    let is_json = p.extension().and_then(|s| s.to_str()).map_or(false, |ext| {
                        ext.eq_ignore_ascii_case("json")
                    });
                    if is_json {
                        json_candidates.push(p);
                    }
                }
            }

            if json_candidates.len() == 1 {
                let source_json = json_candidates.pop().expect("len==1 implies pop Some");
                discovered_json = Some((source_json, folder_name));
                break;
            }
        }
    }

    if let Some((source_json_path, source_folder_name)) = discovered_json {
        let expected_dir = vers_root.join(&version_id);
        tokio::fs::create_dir_all(&expected_dir)
            .await
            .map_err(|e| format!("Не удалось создать папку версии: {e}"))?;
        let mut json_content = tokio::fs::read_to_string(&source_json_path)
            .await
            .map_err(|e| format!("Не удалось прочитать JSON установленной версии: {e}"))?;
        json_content = json_content.replace(&source_folder_name, &version_id);
        tokio::fs::write(&expected_version_json_path, &json_content)
            .await
            .map_err(|e| format!("Не удалось записать JSON версии: {e}"))?;
        return Ok(());
    }

    return Err(format!(
        "После установки Forge не найден файл версии: {}",
        expected_version_json_path.display()
    ));
}


#[tauri::command]
pub async fn install_version(
    app: AppHandle,
    version_id: String,
    version_url: String,
) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let client = http_client(false);

    log_to_console(
        &app,
        &format!(
            "[Vanilla] Начало установки версии {version_id}\nURL манифеста: {version_url}"
        ),
    );

    let version_json_text =
        download_text_with_retries(&client, &version_url, DEFAULT_DOWNLOAD_RETRIES).await?;

    install_version_from_json(app, version_id, version_json_text).await
}

#[tauri::command]
pub async fn install_local_version(app: AppHandle, version_id: String) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let vers_root = versions_dir()?;
    let version_json_path = vers_root.join(&version_id).join(format!("{version_id}.json"));
    let version_json_text = tokio::fs::read_to_string(&version_json_path)
        .await
        .map_err(|e| {
            format!(
                "Не найден {}: {e}. Импортируйте кастомную версию или установите из списка.",
                version_json_path.display()
            )
        })?;

    log_to_console(
        &app,
        &format!("[Vanilla] Установка локальной версии {version_id}"),
    );

    install_version_from_json(app, version_id, version_json_text).await
}

async fn install_version_from_json(
    app: AppHandle,
    version_id: String,
    version_json_text: String,
) -> Result<(), String> {
    let client = http_client(false);
    let os_name = current_os_name();

    let detail: VersionDetail = serde_json::from_str(&version_json_text)
        .map_err(|e| format!("Ошибка разбора описания версии: {e}"))?;

    let downloads = detail
        .downloads
        .as_ref()
        .ok_or("Описание версии не содержит downloads (не ванильная версия)")?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Не удалось создать папку игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root)
        .await
        .map_err(|e| format!("Не удалось создать папку библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root)
        .await
        .map_err(|e| format!("Не удалось создать папку версий: {e}"))?;

    let client_size = downloads.client.size;
    let mut total_size = client_size;
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            total_size = total_size.saturating_add(a.size);
        }
        let native_classifier = match os_name {
            "windows" => "natives-windows",
            "osx" => "natives-macos",
            _ => "natives-linux",
        };
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(ref nat) = classifiers.get(native_classifier) {
                total_size = total_size.saturating_add(nat.size);
            }
        }
    }
    if let Some(ref ai) = detail.asset_index {
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }

    let total_done = Arc::new(AtomicU64::new(0));

    log_to_console(
        &app,
        &format!(
            "[Vanilla] Итоговый размер загрузки (jar+lib+natives+assets): {} байт",
            total_size
        ),
    );

    // jar
    let client_jar = root.join(format!("{version_id}.jar"));
    log_to_console(
        &app,
        &format!(
            "[Vanilla] Загрузка клиентского JAR в {}",
            client_jar.display()
        ),
    );
    download_file_checked(
        &client,
        &downloads.client.url,
        &client_jar,
        downloads.client.sha1.clone(),
        &app,
        &version_id,
        total_size,
        total_done.clone(),
        DEFAULT_DOWNLOAD_RETRIES,
    )
    .await?;

    let natives_dir = vers_root.join(&version_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;

    log_to_console(&app, "[Vanilla] Загрузка библиотек и natives (параллельно)");
    let sem = Arc::new(Semaphore::new(DEFAULT_DOWNLOAD_CONCURRENCY));
    let mut tasks = futures_util::stream::FuturesUnordered::new();

    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }

        if let Some(ref artifact) = lib.downloads.artifact {
            let dest = libs_root.join(&artifact.path);
            if dest.exists() {
                continue;
            }
            let url = artifact.url.clone();
            let expected = artifact.sha1.clone();
            let client2 = client.clone();
            let app2 = app.clone();
            let sem2 = sem.clone();
            let total_done2 = total_done.clone();
            let vid = version_id.clone();
            tasks.push(tokio::spawn(async move {
                let _permit = sem2.acquire_owned().await.map_err(|_| "Semaphore закрыт".to_string())?;
                let expected2 = match expected {
                    Some(s) => Some(s),
                    None => try_fetch_remote_sha1(&client2, &url).await,
                };
                download_file_checked(
                    &client2,
                    &url,
                    &dest,
                    expected2,
                    &app2,
                    &vid,
                    total_size,
                    total_done2,
                    DEFAULT_DOWNLOAD_RETRIES,
                )
                .await?;
                Ok::<(), String>(())
            }));
        }

        if let Some(nat) = resolve_native_artifact(lib, os_name) {
            let dest = libs_root.join(&nat.path);
            if dest.exists() {
                let natives_dir2 = natives_dir.clone();
                let dest2 = dest.clone();
                let _ = tokio::task::spawn_blocking(move || extract_natives_jar(&dest2, &natives_dir2)).await;
            } else {
                let url = nat.url.clone();
                let expected = nat.sha1.clone();
                let client2 = client.clone();
                let app2 = app.clone();
                let sem2 = sem.clone();
                let total_done2 = total_done.clone();
                let vid = version_id.clone();
                let natives_dir2 = natives_dir.clone();
                tasks.push(tokio::spawn(async move {
                    let _permit = sem2.acquire_owned().await.map_err(|_| "Semaphore закрыт".to_string())?;
                    let expected2 = match expected {
                        Some(s) => Some(s),
                        None => try_fetch_remote_sha1(&client2, &url).await,
                    };
                    download_file_checked(
                        &client2,
                        &url,
                        &dest,
                        expected2,
                        &app2,
                        &vid,
                        total_size,
                        total_done2,
                        DEFAULT_DOWNLOAD_RETRIES,
                    )
                    .await?;
                    let _ = tokio::task::spawn_blocking(move || extract_natives_jar(&dest, &natives_dir2)).await;
                    Ok::<(), String>(())
                }));
            }
        }
    }

    while let Some(res) = tasks.next().await {
        res.map_err(|e| format!("Ошибка задачи загрузки библиотек: {e}"))??;
    }

    if let Some(ref asset_index) = detail.asset_index {
        log_to_console(
            &app,
            &format!(
                "[Vanilla] Загрузка ассетов из {}",
                asset_index.url.as_str()
            ),
        );
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &version_id,
            total_size,
            total_done.load(Ordering::SeqCst),
        )
        .await?;
    }

    log_to_console(
        &app,
        "[Vanilla] Сохранение json-описания версии и финализация установки",
    );

    //сохранение json версий
    let version_json_path = vers_root.join(&version_id).join(format!("{version_id}.json"));
    if let Some(parent) = version_json_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    tokio::fs::write(&version_json_path, &version_json_text)
        .await
        .map_err(|e| format!("Не удалось сохранить описание версии: {e}"))?;

    Ok(())
}


#[tauri::command]
pub async fn install_neoforge(app: AppHandle, version_id: String) -> Result<(), String> {
    let (_mc_version, neoforge_build) = parse_neoforge_id(&version_id)
        .ok_or_else(|| format!("Некорректный id NeoForge версии: {version_id}"))?;
    let installer_url =
        format!("{NEOFORGE_MAVEN_BASE}/{neoforge_build}/neoforge-{neoforge_build}-installer.jar");
    install_forge(app, version_id, installer_url).await
}
