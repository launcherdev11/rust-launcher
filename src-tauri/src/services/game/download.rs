use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use rand::Rng;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::app::paths::{game_root_dir, instance_dir, launcher_data_dir};
use crate::infra::http::http_client;
use crate::models::events::{MrpackImportProgressPayload, EVENT_MRPACK_IMPORT_PROGRESS};
use crate::models::profile::InstanceProfileSummary;
use crate::services::game::cache as cache_service;
use crate::services::game::profiles::{create_profile_impl, delete_profile, set_profile_icon_path};
use crate::services::game::state::CANCEL_DOWNLOAD;

const DOWNLOAD_CANCELLED_MSG: &str = "Загрузка отменена пользователем";

fn check_download_cancelled() -> Result<(), String> {
    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        Err(DOWNLOAD_CANCELLED_MSG.to_string())
    } else {
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct MrpackFileEntry {
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) downloads: Vec<String>,
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

#[tauri::command]
pub async fn import_mrpack(
    app: AppHandle,
    profile_id: String,
    mrpack_path: String,
) -> Result<(), String> {
    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "start".to_string(),
            current: None,
            total: None,
            message: None,
        },
    );

    let dir = instance_dir(&profile_id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }

    let pack_path = resolve_file_path(&mrpack_path);
    if !pack_path.exists() {
        return Err("Файл .mrpack не найден".to_string());
    }

    let file = std::fs::File::open(&pack_path)
        .map_err(|e| format!("Не удалось открыть .mrpack: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения .mrpack: {e}"))?;

    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "overrides".to_string(),
            current: None,
            total: None,
            message: None,
        },
    );

    let mut index_json = None;

    for i in 0..archive.len() {
        check_download_cancelled()?;
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry .mrpack: {e}"))?;
        let name = entry.name().to_string();
        if name == "modrinth.index.json" {
            let mut buf = String::new();
            use std::io::Read;
            entry
                .read_to_string(&mut buf)
                .map_err(|e| format!("Ошибка чтения modrinth.index.json: {e}"))?;
            index_json = Some(buf);
        } else if name.starts_with("overrides/") && !name.ends_with('/') {
            let rel = &name["overrides/".len()..];
            if rel.is_empty() {
                continue;
            }
            let dest = dir.join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку override: {e}"))?;
            }
            let mut out =
                std::fs::File::create(&dest).map_err(|e| format!("Не удалось создать файл override: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Ошибка распаковки override: {e}"))?;
        }
    }

    let Some(index_text) = index_json else {
        return Ok(());
    };

    let index: MrpackIndex =
        serde_json::from_str(&index_text).map_err(|e| format!("Ошибка разбора modrinth.index.json: {e}"))?;

    let files_to_download: Vec<_> = index
        .files
        .iter()
        .filter(|f| !f.downloads.is_empty() && !f.downloads[0].is_empty())
        .collect();
    let total = files_to_download.len() as u32;

    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "files".to_string(),
            current: Some(0),
            total: Some(total),
            message: None,
        },
    );

    let client = http_client(false);

    let mut current_file: u32 = 0;
    for f in index.files.iter() {
        check_download_cancelled()?;
        if f.downloads.is_empty() {
            continue;
        }
        let url = &f.downloads[0];
        if url.is_empty() {
            continue;
        }
        current_file += 1;
        let filename = f.path.rsplit('/').next().unwrap_or(&f.path).to_string();
        let _ = app.emit(
            EVENT_MRPACK_IMPORT_PROGRESS,
            MrpackImportProgressPayload {
                phase: "files".to_string(),
                current: Some(current_file),
                total: Some(total),
                message: Some(filename),
            },
        );
        let dest = dir.join(&f.path);
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку для файла сборки: {e}"))?;
        }
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Ошибка скачивания файла из Modrinth: {e}"))?;
        check_download_cancelled()?;
        if !resp.status().is_success() {
            return Err(format!(
                "Modrinth вернул ошибку {} при скачивании {}",
                resp.status(),
                url
            ));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Ошибка чтения тела ответа Modrinth: {e}"))?;
        check_download_cancelled()?;
        tokio::fs::write(&dest, &bytes)
            .await
            .map_err(|e| format!("Не удалось сохранить файл сборки: {e}"))?;
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
    let resp = client
        .get(trimmed)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки иконки сборки: {e}"))?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения иконки сборки: {e}"))?;
    if bytes.is_empty() {
        return Ok(None);
    }

    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить иконку сборки: {e}"))?;

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
    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "start".to_string(),
            current: None,
            total: None,
            message: None,
        },
    );

    let pack_path = resolve_file_path(&mrpack_path);
    if !pack_path.exists() {
        return Err("Файл .mrpack не найден".to_string());
    }

    let file = std::fs::File::open(&pack_path)
        .map_err(|e| format!("Не удалось открыть .mrpack: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения .mrpack: {e}"))?;

    let mut index_json = None;
    for i in 0..archive.len() {
        check_download_cancelled()?;
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry .mrpack: {e}"))?;
        if entry.name() == "modrinth.index.json" {
            let mut buf = String::new();
            use std::io::Read;
            entry
                .read_to_string(&mut buf)
                .map_err(|e| format!("Ошибка чтения modrinth.index.json: {e}"))?;
            index_json = Some(buf);
            break;
        }
    }

    let index_text = index_json.ok_or("В .mrpack нет modrinth.index.json".to_string())?;
    let index: MrpackIndex =
        serde_json::from_str(&index_text).map_err(|e| format!("Ошибка разбора modrinth.index.json: {e}"))?;

    let (game_version, loader) = mrpack_game_version_and_loader(&index.dependencies);
    let name = index
        .name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            pack_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Modpack")
                .to_string()
        });

    let profile = create_profile_impl(name, game_version, loader, None, None)?;
    let profile_id = profile.id.clone();
    let dir = instance_dir(&profile.id)?;

    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "overrides".to_string(),
            current: None,
            total: None,
            message: None,
        },
    );

    let file2 = std::fs::File::open(&pack_path)
        .map_err(|e| format!("Не удалось открыть .mrpack: {e}"))?;
    let mut archive2 =
        zip::ZipArchive::new(file2).map_err(|e| format!("Ошибка чтения .mrpack: {e}"))?;

    for i in 0..archive2.len() {
        if let Err(e) = check_download_cancelled() {
            let _ = delete_profile(profile_id.clone());
            return Err(e);
        }
        let mut entry = archive2
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry .mrpack: {e}"))?;
        let name_entry = entry.name().to_string();
        if name_entry.starts_with("overrides/") && !name_entry.ends_with('/') {
            let rel = &name_entry["overrides/".len()..];
            if rel.is_empty() {
                continue;
            }
            let dest = dir.join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку override: {e}"))?;
            }
            let mut out =
                std::fs::File::create(&dest).map_err(|e| format!("Не удалось создать файл override: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Ошибка распаковки override: {e}"))?;
        }
    }

    let files_to_download: Vec<_> = index
        .files
        .iter()
        .filter(|f| !f.downloads.is_empty() && !f.downloads[0].is_empty())
        .collect();
    let total = files_to_download.len() as u32;

    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "files".to_string(),
            current: Some(0),
            total: Some(total),
            message: None,
        },
    );

    let client = http_client(false);
    let mut current_file: u32 = 0;
    for f in index.files.iter() {
        if let Err(e) = check_download_cancelled() {
            let _ = delete_profile(profile_id.clone());
            return Err(e);
        }
        if f.downloads.is_empty() || f.downloads[0].is_empty() {
            continue;
        }
        current_file += 1;
        let url = &f.downloads[0];
        let filename = f.path.rsplit('/').next().unwrap_or(&f.path).to_string();
        let _ = app.emit(
            EVENT_MRPACK_IMPORT_PROGRESS,
            MrpackImportProgressPayload {
                phase: "files".to_string(),
                current: Some(current_file),
                total: Some(total),
                message: Some(filename),
            },
        );
        let dest = dir.join(&f.path);
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку для файла сборки: {e}"))?;
        }
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Ошибка скачивания файла из Modrinth: {e}"))?;
        if let Err(e) = check_download_cancelled() {
            let _ = delete_profile(profile_id.clone());
            return Err(e);
        }
        if !resp.status().is_success() {
            return Err(format!(
                "Modrinth вернул ошибку {} при скачивании {}",
                resp.status(),
                url
            ));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Ошибка чтения тела ответа Modrinth: {e}"))?;
        if let Err(e) = check_download_cancelled() {
            let _ = delete_profile(profile_id.clone());
            return Err(e);
        }
        tokio::fs::write(&dest, &bytes)
            .await
            .map_err(|e| format!("Не удалось сохранить файл сборки: {e}"))?;
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
    let root = launcher_data_dir()?
        .join("tmp")
        .join("modrinth_modpacks");
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

    let client = http_client(false);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки Modrinth .mrpack: {e}"))?;

    check_download_cancelled()?;

    if !resp.status().is_success() {
        return Err(format!(
            "Modrinth вернул ошибку {} при скачивании .mrpack",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения тела ответа Modrinth: {e}"))?;

    check_download_cancelled()?;

    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить .mrpack во временный файл: {e}"))?;

    let dest_str = dest
        .to_str()
        .ok_or_else(|| "Путь к временной .mrpack не в UTF-8".to_string())?
        .to_string();

    let imported = import_mrpack_as_new_profile(app.clone(), dest_str, icon_url).await?;

    let _ = tokio::fs::remove_file(&dest).await;

    Ok(imported)
}


#[tauri::command]
pub async fn download_modrinth_file(
    category: String,
    url: String,
    filename: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    let root = if let Some(ref id) = profile_id {
        instance_dir(id)?
    } else {
        game_root_dir()?
    };
    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестный тип контента Modrinth: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };

    let target_dir = root.join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку '{subdir}': {e}"))?;

    let dest_path = target_dir.join(&filename);

    let client = http_client(false);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки файла Modrinth: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Сервер Modrinth вернул ошибку {} при скачивании файла.",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения тела ответа Modrinth: {e}"))?;

    tokio::fs::write(&dest_path, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить файл в {:?}: {e}", dest_path))?;

    Ok(())
}


#[tauri::command]
pub async fn import_modpack_files(
    modpack_id: String,
    category: String,
    files: Vec<String>,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let root = game_root_dir()?;
    let modpacks_root = root.join("modpacks").join(&modpack_id);

    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестный тип контента сборки: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };

    let target_dir = modpacks_root.join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку сборки '{subdir}': {e}"))?;

    for src in files {
        let src_path = PathBuf::from(&src);
        if !src_path.exists() {
            continue;
        }
        let file_name = match src_path.file_name().and_then(|n| n.to_str()) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => continue,
        };
        let dest_path = target_dir.join(&file_name);
        if let Some(parent) = dest_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку для файла сборки: {e}"))?;
        }
        tokio::fs::copy(&src_path, &dest_path)
            .await
            .map_err(|e| format!("Не удалось скопировать файл сборки {:?}: {e}", src_path))?;
    }

    Ok(())
}
