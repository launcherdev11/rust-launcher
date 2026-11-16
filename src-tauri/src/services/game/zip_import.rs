use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::app::paths::instance_dir;
use crate::models::events::{MrpackImportProgressPayload, EVENT_MRPACK_IMPORT_PROGRESS};
use crate::models::profile::InstanceProfileSummary;
use crate::services::curseforge::installer::install_curseforge_zip_as_new_profile;
use crate::services::game::cache as cache_service;
use crate::services::game::core::safe_join;
use crate::services::game::download::{import_mrpack_as_new_profile, resolve_file_path};
use crate::services::game::profiles::{create_profile_impl, delete_profile};
use crate::services::game::state::CANCEL_DOWNLOAD;

const CANCELLED_MSG: &str = "Загрузка отменена пользователем";
const CONTENT_MARKERS: [&str; 6] = [
    "mods/",
    "config/",
    "saves/",
    "resourcepacks/",
    "shaderpacks/",
    "options.txt",
];

#[derive(Debug, Serialize)]
pub struct ZipImportResult {
    pub profile: InstanceProfileSummary,
    pub kind: &'static str,
    pub failed_files: u32,
}

#[derive(Debug, PartialEq)]
enum ArchiveKind {
    Mrpack,
    Curseforge,
    Instance,
}

#[derive(Debug, Default, PartialEq)]
struct InstanceMeta {
    name: Option<String>,
    game_version: Option<String>,
    loader: Option<String>,
    loader_version: Option<String>,
}

fn classify(names: &[String], manifest_text: Option<&str>) -> ArchiveKind {
    if names.iter().any(|n| n == "modrinth.index.json") {
        return ArchiveKind::Mrpack;
    }
    let is_curseforge = manifest_text
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok())
        .is_some_and(|v| v.get("minecraft").is_some_and(|m| m.is_object()) && v.get("files").is_some_and(|f| f.is_array()));
    if is_curseforge {
        ArchiveKind::Curseforge
    } else {
        ArchiveKind::Instance
    }
}

fn content_root(names: &[String]) -> Option<String> {
    let mut hits: HashMap<String, u32> = HashMap::new();
    for name in names {
        for marker in CONTENT_MARKERS {
            let prefix = if let Some(idx) = name.find(&format!("/{marker}")) {
                &name[..idx + 1]
            } else if name.starts_with(marker) {
                ""
            } else {
                continue;
            };
            if prefix.matches('/').count() <= 2 {
                *hits.entry(prefix.to_string()).or_default() += 1;
            }
            break;
        }
    }
    hits.into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.len().cmp(&a.0.len())))
        .map(|(prefix, _)| prefix)
}

fn meta_from_launcher_config(text: &str) -> Option<InstanceMeta> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let field = |key: &str| {
        v.get(key)
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let game_version = field("game_version")?;
    Some(InstanceMeta {
        name: field("name"),
        game_version: Some(game_version),
        loader: field("loader"),
        loader_version: field("loader_version"),
    })
}

fn meta_from_mmc_pack(text: &str) -> Option<InstanceMeta> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let mut meta = InstanceMeta::default();
    for component in v.get("components")?.as_array()? {
        let uid = component.get("uid").and_then(|x| x.as_str()).unwrap_or("");
        let version = component
            .get("version")
            .and_then(|x| x.as_str())
            .map(str::to_string);
        let loader = match uid {
            "net.minecraft" => {
                meta.game_version = version;
                continue;
            }
            "net.fabricmc.fabric-loader" => "fabric",
            "org.quiltmc.quilt-loader" => "quilt",
            "net.minecraftforge" => "forge",
            "net.neoforged" => "neoforge",
            _ => continue,
        };
        meta.loader = Some(loader.to_string());
        meta.loader_version = version;
    }
    meta.game_version.is_some().then_some(meta)
}

fn name_from_instance_cfg(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.trim().strip_prefix("name="))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parent_prefix(prefix: &str) -> Option<&str> {
    let trimmed = prefix.strip_suffix('/')?;
    Some(match trimmed.rfind('/') {
        Some(idx) => &prefix[..idx + 1],
        None => "",
    })
}

fn open_archive(path: &Path) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Не удалось открыть архив: {e}"))?;
    zip::ZipArchive::new(file).map_err(|e| format!("Файл не является ZIP-архивом: {e}"))
}

fn read_entry(archive: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > 4 * 1024 * 1024 {
        return None;
    }
    let mut buf = String::new();
    entry.read_to_string(&mut buf).ok()?;
    Some(buf)
}

fn entry_names(archive: &mut zip::ZipArchive<std::fs::File>) -> Vec<String> {
    (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|e| e.name().replace('\\', "/")))
        .collect()
}

fn emit_progress(app: &AppHandle, phase: &str, current: Option<u32>, total: Option<u32>) {
    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: phase.to_string(),
            current,
            total,
            message: None,
        },
    );
}

fn extract_instance(
    app: &AppHandle,
    zip_path: &Path,
    root: &str,
    skip: &[String],
    dest: &Path,
) -> Result<(), String> {
    let mut archive = open_archive(zip_path)?;
    let total = archive.len() as u32;
    for i in 0..archive.len() {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err(CANCELLED_MSG.to_string());
        }
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения архива: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        let Some(rel) = name.strip_prefix(root) else {
            continue;
        };
        if rel.is_empty() || skip.iter().any(|s| s == &name) {
            continue;
        }
        let Some(target) = safe_join(dest, rel) else {
            continue;
        };
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
        }
        let mut out = std::fs::File::create(&target)
            .map_err(|e| format!("Не удалось создать файл {rel}: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("Ошибка распаковки {rel}: {e}"))?;
        if i % 25 == 0 {
            emit_progress(app, "files", Some(i as u32 + 1), Some(total));
        }
    }
    emit_progress(app, "files", Some(total), Some(total));
    Ok(())
}

fn summarize(profile: InstanceProfileSummary, dir: &Path) -> Result<InstanceProfileSummary, String> {
    let (mods_size, mods_count) = cache_service::dir_size_and_count(&dir.join("mods"));
    let (res_size, res_count) = cache_service::dir_size_and_count(&dir.join("resourcepacks"));
    let (shader_size, shader_count) = cache_service::dir_size_and_count(&dir.join("shaderpacks"));
    Ok(InstanceProfileSummary {
        mods_count,
        resourcepacks_count: res_count,
        shaderpacks_count: shader_count,
        total_size_bytes: mods_size.saturating_add(res_size).saturating_add(shader_size),
        directory: dir
            .to_str()
            .ok_or("Путь к папке сборки не в UTF-8")?
            .to_string(),
        ..profile
    })
}

async fn import_instance_archive(
    app: &AppHandle,
    zip_path: &Path,
    names: Vec<String>,
) -> Result<InstanceProfileSummary, String> {
    let root = content_root(&names)
        .ok_or("В архиве нет файлов сборки: не найдены папки mods, config или saves")?;

    let launcher_config = format!("{root}config.json");
    let pack_dir = parent_prefix(&root).unwrap_or("").to_string();
    let candidates = [
        launcher_config.clone(),
        format!("{pack_dir}mmc-pack.json"),
        format!("{root}mmc-pack.json"),
        format!("{pack_dir}instance.cfg"),
    ];

    let path = zip_path.to_path_buf();
    let texts: Vec<Option<String>> = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let mut archive = open_archive(&path)?;
        Ok(candidates
            .iter()
            .map(|name| read_entry(&mut archive, name))
            .collect())
    })
    .await
    .map_err(|e| format!("Ошибка чтения архива: {e}"))??;

    let from_launcher = texts[0].as_deref().and_then(meta_from_launcher_config);
    let skip = if from_launcher.is_some() {
        vec![launcher_config]
    } else {
        Vec::new()
    };
    let mut meta = from_launcher
        .or_else(|| texts[1].as_deref().and_then(meta_from_mmc_pack))
        .or_else(|| texts[2].as_deref().and_then(meta_from_mmc_pack))
        .ok_or(
            "Не удалось определить версию игры: в архиве нет config.json лаунчера или mmc-pack.json. \
             Создайте сборку вручную и перенесите в неё файлы.",
        )?;
    if meta.name.is_none() {
        meta.name = texts[3].as_deref().and_then(name_from_instance_cfg);
    }

    let name = meta.name.unwrap_or_else(|| {
        zip_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Modpack")
            .to_string()
    });
    let profile = create_profile_impl(
        name,
        meta.game_version.unwrap_or_default(),
        meta.loader.unwrap_or_else(|| "vanilla".to_string()),
        meta.loader_version,
        None,
        None,
    )?;
    let profile_id = profile.id.clone();
    let dir = instance_dir(&profile.id)?;

    emit_progress(app, "overrides", None, None);
    let extracted = {
        let app = app.clone();
        let path = zip_path.to_path_buf();
        let dir = dir.clone();
        tokio::task::spawn_blocking(move || extract_instance(&app, &path, &root, &skip, &dir))
            .await
            .map_err(|e| format!("Ошибка распаковки архива: {e}"))
            .and_then(|r| r)
    };
    if let Err(e) = extracted {
        let _ = delete_profile(profile_id);
        return Err(e);
    }

    summarize(profile, &dir)
}

#[tauri::command]
pub async fn import_zip_as_new_profile(app: AppHandle, zip_path: String) -> Result<ZipImportResult, String> {
    let pack_path = resolve_file_path(&zip_path);
    if !pack_path.exists() {
        return Err("Файл архива не найден".to_string());
    }
    emit_progress(&app, "start", None, None);

    let path = pack_path.clone();
    let (names, manifest) = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let mut archive = open_archive(&path)?;
        let names = entry_names(&mut archive);
        let manifest = read_entry(&mut archive, "manifest.json");
        Ok((names, manifest))
    })
    .await
    .map_err(|e| format!("Ошибка чтения архива: {e}"))??;

    match classify(&names, manifest.as_deref()) {
        ArchiveKind::Mrpack => {
            let profile = import_mrpack_as_new_profile(app, zip_path, None).await?;
            Ok(ZipImportResult { profile, kind: "mrpack", failed_files: 0 })
        }
        ArchiveKind::Curseforge => {
            let (profile, result) = install_curseforge_zip_as_new_profile(app, zip_path).await?;
            Ok(ZipImportResult {
                profile,
                kind: "curseforge",
                failed_files: result.failed_mods.len() as u32,
            })
        }
        ArchiveKind::Instance => {
            let profile = import_instance_archive(&app, &pack_path, names).await?;
            Ok(ZipImportResult { profile, kind: "instance", failed_files: 0 })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn classify_detects_archive_kinds() {
        assert_eq!(
            classify(&names(&["modrinth.index.json", "overrides/config/a.toml"]), None),
            ArchiveKind::Mrpack
        );
        assert_eq!(
            classify(
                &names(&["manifest.json", "overrides/mods/a.jar"]),
                Some(r#"{"minecraft":{"version":"1.20.1"},"files":[]}"#)
            ),
            ArchiveKind::Curseforge
        );
        assert_eq!(
            classify(&names(&["manifest.json", "mods/a.jar"]), Some(r#"{"name":"x"}"#)),
            ArchiveKind::Instance
        );
    }

    #[test]
    fn content_root_finds_nested_game_dir() {
        assert_eq!(content_root(&names(&["mods/a.jar", "config/b.toml"])).as_deref(), Some(""));
        assert_eq!(
            content_root(&names(&[
                "Pack/mmc-pack.json",
                "Pack/.minecraft/mods/a.jar",
                "Pack/.minecraft/config/x/mods/y.json",
                "Pack/.minecraft/options.txt",
            ]))
            .as_deref(),
            Some("Pack/.minecraft/")
        );
        assert_eq!(content_root(&names(&["readme.txt"])), None);
    }

    #[test]
    fn mmc_pack_yields_version_and_loader() {
        let meta = meta_from_mmc_pack(
            r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.15.7"}]}"#,
        )
        .unwrap();
        assert_eq!(meta.game_version.as_deref(), Some("1.20.1"));
        assert_eq!(meta.loader.as_deref(), Some("fabric"));
        assert_eq!(meta.loader_version.as_deref(), Some("0.15.7"));
        assert!(meta_from_mmc_pack(r#"{"components":[]}"#).is_none());
    }

    #[test]
    fn launcher_config_requires_game_version() {
        let meta = meta_from_launcher_config(r#"{"name":"A","game_version":"1.21","loader":"forge"}"#).unwrap();
        assert_eq!(meta.name.as_deref(), Some("A"));
        assert_eq!(meta.loader.as_deref(), Some("forge"));
        assert!(meta_from_launcher_config(r#"{"name":"A"}"#).is_none());
    }

    #[test]
    fn parent_prefix_steps_up_one_dir() {
        assert_eq!(parent_prefix("Pack/.minecraft/"), Some("Pack/"));
        assert_eq!(parent_prefix(".minecraft/"), Some(""));
        assert_eq!(parent_prefix(""), None);
    }
}
