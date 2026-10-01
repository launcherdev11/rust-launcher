use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use rand::{distributions::Alphanumeric, Rng};

use crate::app::paths::{game_root_dir, instance_dir};
use crate::models::profile::{InstanceConfig, InstanceProfileSummary};
use crate::services::game::profiles::{
    create_profile_impl, instance_profile_summary_for_dir, write_instance_config,
};

const BACKUP_SKIP_DIRS: &[&str] = &["logs", "crash-reports", ".cache", "cache"];
const MANIFEST_NAME: &str = "16launcher-backup.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileBackupInfo {
    pub id: String,
    pub profile_id: String,
    pub created_at: u64,
    pub size_bytes: u64,
    pub path: String,
    pub profile_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupManifest {
    version: u32,
    profile_id: String,
    profile_name: String,
    created_at: u64,
    game_version: String,
    loader: String,
    loader_version: Option<String>,
}

fn backups_root() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("backups"))
}

fn profile_backups_dir(profile_id: &str) -> Result<PathBuf, String> {
    Ok(backups_root()?.join(profile_id))
}

fn should_skip_entry(rel: &str) -> bool {
    let first = rel.split(['/', '\\']).next().unwrap_or("");
    BACKUP_SKIP_DIRS
        .iter()
        .any(|d| first.eq_ignore_ascii_case(d))
}

fn collect_files(root: &Path) -> Result<Vec<(PathBuf, String, u64)>, String> {
    let mut out = Vec::new();
    fn walk(dir: &Path, root: &Path, out: &mut Vec<(PathBuf, String, u64)>) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| format!("Ошибка чтения {}: {e}", dir.display()))? {
            let entry = entry.map_err(|e| format!("Ошибка чтения entry: {e}"))?;
            let path = entry.path();
            let rel = path
                .strip_prefix(root)
                .map_err(|_| "Ошибка пути".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if should_skip_entry(&rel) {
                continue;
            }
            if path.is_dir() {
                walk(&path, root, out)?;
            } else if path.is_file() {
                let meta = path
                    .metadata()
                    .map_err(|e| format!("Ошибка metadata {}: {e}", path.display()))?;
                out.push((path, rel, meta.len()));
            }
        }
        Ok(())
    }
    walk(root, root, &mut out)?;
    Ok(out)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn format_backup_id(created_at: u64) -> String {
    let secs = created_at as i64;
    let days = secs.div_euclid(86400);
    let tod = secs.rem_euclid(86400) as u32;
    let h = tod / 3600;
    let m = (tod % 3600) / 60;
    let s = tod % 60;
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}_{h:02}-{m:02}-{s:02}")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

fn load_instance_config(dir: &Path) -> Result<InstanceConfig, String> {
    let cfg_path = dir.join("config.json");
    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Не удалось прочитать config.json: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора config.json: {e}"))
}

fn backup_info_from_path(profile_id: &str, path: &Path) -> Option<ProfileBackupInfo> {
    let meta = path.metadata().ok()?;
    if !meta.is_file() {
        return None;
    }
    let id = path.file_stem()?.to_string_lossy().to_string();
    let created_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut profile_name = String::new();
    if let Ok(file) = File::open(path) {
        if let Ok(mut archive) = zip::ZipArchive::new(file) {
            if let Ok(mut entry) = archive.by_name(MANIFEST_NAME) {
                let mut buf = String::new();
                if entry.read_to_string(&mut buf).is_ok() {
                    if let Ok(m) = serde_json::from_str::<BackupManifest>(&buf) {
                        profile_name = m.profile_name;
                    }
                }
            }
        }
    }

    Some(ProfileBackupInfo {
        id,
        profile_id: profile_id.to_string(),
        created_at,
        size_bytes: meta.len(),
        path: path.to_string_lossy().to_string(),
        profile_name,
    })
}

#[command]
pub fn list_profile_backups(profile_id: String) -> Result<Vec<ProfileBackupInfo>, String> {
    let dir = profile_backups_dir(&profile_id)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut list = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Ошибка чтения бэкапов: {e}"))? {
        let entry = entry.map_err(|e| format!("Ошибка чтения entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("zip") {
            continue;
        }
        if let Some(info) = backup_info_from_path(&profile_id, &path) {
            list.push(info);
        }
    }
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    Ok(list)
}

#[command]
pub async fn create_profile_backup(
    app: AppHandle,
    profile_id: String,
) -> Result<ProfileBackupInfo, String> {
    let root = instance_dir(&profile_id)?;
    if !root.is_dir() {
        return Err("Папка сборки не найдена".into());
    }
    let cfg = load_instance_config(&root)?;
    let created_at = now_secs();
    let backup_id = format_backup_id(created_at);
    let out_dir = profile_backups_dir(&profile_id)?;
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Не удалось создать папку бэкапов: {e}"))?;

    let out_path = out_dir.join(format!("{backup_id}.zip"));
    let out_path = if out_path.exists() {
        let suffix: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(4)
            .map(char::from)
            .collect();
        out_dir.join(format!("{backup_id}_{suffix}.zip"))
    } else {
        out_path
    };

    let files = collect_files(&root)?;
    let total: u64 = files.iter().map(|(_, _, s)| *s).sum();

    let manifest = BackupManifest {
        version: 1,
        profile_id: cfg.id.clone(),
        profile_name: cfg.name.clone(),
        created_at,
        game_version: cfg.game_version.clone(),
        loader: cfg.loader.clone(),
        loader_version: cfg.loader_version.clone(),
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("Ошибка сериализации манифеста: {e}"))?;

    let f = File::create(&out_path).map_err(|e| {
        if e.raw_os_error() == Some(112) {
            "Недостаточно места".into()
        } else {
            e.to_string()
        }
    })?;
    let mut writer = zip::ZipWriter::new(f);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut written = 0u64;

    let emit = |cur: &str, w: u64| {
        let _ = app.emit(
            "profile-backup-progress",
            serde_json::json!({
                "profile_id": profile_id,
                "bytes_written": w,
                "total_bytes": total.saturating_add(manifest_bytes.len() as u64),
                "current_file": cur,
            }),
        );
    };

    writer
        .start_file(MANIFEST_NAME, opts)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(&manifest_bytes)
        .map_err(|e| e.to_string())?;
    written += manifest_bytes.len() as u64;
    emit(MANIFEST_NAME, written);

    let mut buf = [0u8; 128 * 1024];
    for (abs, rel, exp_size) in files {
        emit(&rel, written);
        let meta = match abs.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() || meta.len() != exp_size {
            continue;
        }
        let mut src = match File::open(&abs) {
            Ok(f) => f,
            Err(_) => continue,
        };
        if writer.start_file(&rel, opts).is_err() {
            continue;
        }
        loop {
            let n = src.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            written += n as u64;
        }
    }

    writer.finish().map_err(|e| e.to_string())?;

    let info = backup_info_from_path(&profile_id, &out_path).ok_or_else(|| {
        "Бэкап создан, но не удалось прочитать метаданные".to_string()
    })?;

    let _ = app.emit(
        "profile-backup-finished",
        serde_json::json!({
            "profile_id": profile_id,
            "backup": info,
        }),
    );

    Ok(info)
}

#[command]
pub fn delete_profile_backup(profile_id: String, backup_id: String) -> Result<(), String> {
    let path = profile_backups_dir(&profile_id)?.join(format!("{backup_id}.zip"));
    if !path.is_file() {
        let dir = profile_backups_dir(&profile_id)?;
        let mut found = None;
        if dir.is_dir() {
            for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let p = entry.path();
                if p.file_stem().and_then(|s| s.to_str()) == Some(backup_id.as_str()) {
                    found = Some(p);
                    break;
                }
            }
        }
        let Some(p) = found else {
            return Err("Бэкап не найден".into());
        };
        std::fs::remove_file(&p).map_err(|e| format!("Не удалось удалить бэкап: {e}"))?;
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|e| format!("Не удалось удалить бэкап: {e}"))
}

fn resolve_backup_path(profile_id: &str, backup_id: &str) -> Result<PathBuf, String> {
    let direct = profile_backups_dir(profile_id)?.join(format!("{backup_id}.zip"));
    if direct.is_file() {
        return Ok(direct);
    }
    let dir = profile_backups_dir(profile_id)?;
    if dir.is_dir() {
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let p = entry.path();
            if p.file_stem().and_then(|s| s.to_str()) == Some(backup_id) {
                return Ok(p);
            }
        }
    }
    Err("Бэкап не найден".into())
}

#[command]
pub fn restore_profile_backup_as_new(
    profile_id: String,
    backup_id: String,
) -> Result<InstanceProfileSummary, String> {
    let zip_path = resolve_backup_path(&profile_id, &backup_id)?;
    let file = File::open(&zip_path).map_err(|e| format!("Не удалось открыть бэкап: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения ZIP бэкапа: {e}"))?;

    let mut manifest: Option<BackupManifest> = None;
    if let Ok(mut entry) = archive.by_name(MANIFEST_NAME) {
        let mut buf = String::new();
        entry
            .read_to_string(&mut buf)
            .map_err(|e| format!("Ошибка чтения манифеста: {e}"))?;
        manifest = serde_json::from_str(&buf).ok();
    }

    let mut cfg_from_zip: Option<InstanceConfig> = None;
    if let Ok(mut entry) = archive.by_name("config.json") {
        let mut buf = String::new();
        if entry.read_to_string(&mut buf).is_ok() {
            cfg_from_zip = serde_json::from_str(&buf).ok();
        }
    }

    let (base_name, game_version, loader, loader_version) = if let Some(c) = &cfg_from_zip {
        (
            c.name.clone(),
            c.game_version.clone(),
            c.loader.clone(),
            c.loader_version.clone(),
        )
    } else if let Some(m) = &manifest {
        (
            m.profile_name.clone(),
            m.game_version.clone(),
            m.loader.clone(),
            m.loader_version.clone(),
        )
    } else {
        return Err("В бэкапе нет config.json / манифеста".into());
    };

    let restore_name = format!("{base_name} (бэкап)");
    let summary = create_profile_impl(
        restore_name,
        game_version,
        loader,
        loader_version,
        None,
        None,
    )?;

    let dest = instance_dir(&summary.id)?;

    let file = File::open(&zip_path).map_err(|e| format!("Не удалось открыть бэкап: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения ZIP бэкапа: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения файла в ZIP: {e}"))?;
        let name = file.name().replace('\\', "/");
        if name.is_empty() || name.ends_with('/') {
            continue;
        }
        if name == MANIFEST_NAME || name.eq_ignore_ascii_case("config.json") {
            continue;
        }
        if should_skip_entry(&name) {
            continue;
        }
        if name.contains("..") {
            continue;
        }
        let out_path = dest.join(&name);
        let Ok(stripped) = out_path.strip_prefix(&dest) else {
            continue;
        };
        if stripped.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
        }
        let mut outfile =
            File::create(&out_path).map_err(|e| format!("Не удалось создать {}: {e}", out_path.display()))?;
        std::io::copy(&mut file, &mut outfile)
            .map_err(|e| format!("Не удалось распаковать {}: {e}", out_path.display()))?;
    }

    let cfg_path = dest.join("config.json");
    let mut cfg = load_instance_config(&dest)?;
    if dest.join("icon.png").is_file() {
        cfg.icon_path = dest.join("icon.png").to_str().map(|s| s.to_string());
        write_instance_config(&cfg_path, &cfg)?;
    }

    instance_profile_summary_for_dir(&cfg, &dest).or(Ok(summary))
}

#[command]
pub fn open_profile_backups_folder(profile_id: String) -> Result<(), String> {
    let dir = profile_backups_dir(&profile_id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось создать папку бэкапов: {e}"))?;
    open::that(&dir).map_err(|e| format!("Не удалось открыть папку бэкапов: {e}"))
}
