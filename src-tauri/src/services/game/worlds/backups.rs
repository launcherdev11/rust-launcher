use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::command;

use crate::app::paths::{instance_dir, launcher_data_dir};
use crate::services::game::core::safe_join;
use crate::services::game::state::GAME_PROCESS_PID;

const KEEP_AUTO: usize = 4;
const KEEP_SAFETY: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BackupKind {
    Manual,
    Auto,
    Safety,
}

impl BackupKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Auto => "auto",
            Self::Safety => "safety",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "manual" => Some(Self::Manual),
            "auto" => Some(Self::Auto),
            "safety" => Some(Self::Safety),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorldBackup {
    pub id: String,
    pub created_at_ms: u64,
    pub size: u64,
    pub kind: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn game_is_running() -> bool {
    GAME_PROCESS_PID.load(Ordering::SeqCst) != 0
}

pub(crate) fn world_dir(profile_id: &str, world: &str) -> Result<PathBuf, String> {
    if world.is_empty() || world.contains(['/', '\\']) || world == "." || world == ".." || world.starts_with('.') {
        return Err("Некорректное имя мира".to_string());
    }
    let saves = instance_dir(profile_id)?.join("saves");
    let dir = safe_join(&saves, world).ok_or("Некорректное имя мира")?;
    if !dir.is_dir() {
        return Err(format!("Мир «{world}» не найден"));
    }
    Ok(dir)
}

fn backups_dir(profile_id: &str, world: &str) -> Result<PathBuf, String> {
    if !profile_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Некорректный id сборки".to_string());
    }
    let mut h = DefaultHasher::new();
    world.hash(&mut h);
    let readable: String = world
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
        .take(40)
        .collect();
    Ok(launcher_data_dir()?
        .join("world-backups")
        .join(profile_id)
        .join(format!("{readable}-{:016x}", h.finish())))
}

fn parse_backup_name(name: &str) -> Option<(u64, BackupKind)> {
    let stem = name.strip_suffix(".zip")?;
    let (ts, kind) = stem.split_once('-')?;
    Some((ts.parse().ok()?, BackupKind::parse(kind)?))
}

fn list_backup_files(dir: &Path) -> Vec<(u64, BackupKind, PathBuf)> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<(u64, BackupKind, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let (ts, kind) = parse_backup_name(p.file_name()?.to_str()?)?;
            Some((ts, kind, p))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    root: &Path,
    dir: &Path,
    opts: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("Не удалось прочитать {}: {e}", dir.display()))?;
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| "Ошибка пути в мире".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if ft.is_dir() {
            zip.add_directory(format!("{rel}/"), opts).map_err(|e| format!("zip: {e}"))?;
            add_dir_to_zip(zip, root, &path, opts)?;
        } else if ft.is_file() {
            if rel == "session.lock" {
                continue;
            }
            let mut f = match fs::File::open(&path) {
                Ok(f) => f,
                Err(e) => return Err(format!("Не удалось открыть {rel}: {e}")),
            };
            zip.start_file(rel.as_str(), opts).map_err(|e| format!("zip: {e}"))?;
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                let n = f.read(&mut buf).map_err(|e| format!("Ошибка чтения {rel}: {e}"))?;
                if n == 0 {
                    break;
                }
                zip.write_all(&buf[..n]).map_err(|e| format!("Ошибка записи архива: {e}"))?;
            }
        }
    }
    Ok(())
}

fn prune(dir: &Path) {
    let files = list_backup_files(dir);
    for (kind, keep) in [(BackupKind::Auto, KEEP_AUTO), (BackupKind::Safety, KEEP_SAFETY)] {
        for (_, _, p) in files.iter().filter(|f| f.1 == kind).skip(keep) {
            let _ = fs::remove_file(p);
        }
    }
}

pub(crate) fn create_backup_blocking(profile_id: &str, world: &str, kind: BackupKind) -> Result<WorldBackup, String> {
    let src = world_dir(profile_id, world)?;
    let dir = backups_dir(profile_id, world)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку бэкапов: {e}"))?;
    let ts = now_ms();
    let name = format!("{ts}-{}.zip", kind.as_str());
    let tmp = dir.join(format!(".{name}.part"));
    let result = (|| {
        let file = fs::File::create(&tmp).map_err(|e| format!("Не удалось создать архив: {e}"))?;
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(3))
            .large_file(true);
        add_dir_to_zip(&mut zip, &src, &src, opts)?;
        zip.finish().map_err(|e| format!("zip: {e}"))?;
        Ok::<(), String>(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    let dest = dir.join(&name);
    fs::rename(&tmp, &dest).map_err(|e| format!("Не удалось сохранить архив: {e}"))?;
    prune(&dir);
    Ok(WorldBackup {
        id: name,
        created_at_ms: ts,
        size: fs::metadata(&dest).map(|m| m.len()).unwrap_or(0),
        kind: kind.as_str().to_string(),
    })
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("Не удалось открыть архив: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Архив повреждён: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("Архив повреждён: {e}"))?;
        let Some(out) = safe_join(dest, entry.name()) else { continue };
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| format!("Ошибка распаковки: {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Ошибка распаковки: {e}"))?;
        }
        let mut f = fs::File::create(&out).map_err(|e| format!("Ошибка распаковки: {e}"))?;
        std::io::copy(&mut entry, &mut f).map_err(|e| format!("Ошибка распаковки: {e}"))?;
    }
    Ok(())
}

fn resolve_backup(profile_id: &str, world: &str, backup_id: &str) -> Result<PathBuf, String> {
    if parse_backup_name(backup_id).is_none() {
        return Err("Некорректный бэкап".to_string());
    }
    let path = backups_dir(profile_id, world)?.join(backup_id);
    if !path.is_file() {
        return Err("Бэкап не найден".to_string());
    }
    Ok(path)
}

pub(crate) fn auto_backup_touched_worlds(profile_id: &str, since_ms: u64) {
    let Ok(saves) = instance_dir(profile_id).map(|d| d.join("saves")) else { return };
    let Ok(rd) = fs::read_dir(&saves) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let touched = fs::metadata(path.join("level.dat"))
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .is_some_and(|d| d.as_millis() as u64 >= since_ms);
        if touched {
            if let Err(e) = create_backup_blocking(profile_id, &name, BackupKind::Auto) {
                eprintln!("[WorldBackup] Автобэкап мира «{name}» не удался: {e}");
            }
        }
    }
}

#[command]
pub async fn list_world_backups(profile_id: String, world: String) -> Result<Vec<WorldBackup>, String> {
    world_dir(&profile_id, &world)?;
    let dir = backups_dir(&profile_id, &world)?;
    Ok(list_backup_files(&dir)
        .into_iter()
        .map(|(ts, kind, p)| WorldBackup {
            id: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            created_at_ms: ts,
            size: fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
            kind: kind.as_str().to_string(),
        })
        .collect())
}

#[command]
pub async fn create_world_backup(profile_id: String, world: String) -> Result<WorldBackup, String> {
    tokio::task::spawn_blocking(move || create_backup_blocking(&profile_id, &world, BackupKind::Manual))
        .await
        .map_err(|e| format!("Ошибка бэкапа: {e}"))?
}

#[command]
pub async fn delete_world_backup(profile_id: String, world: String, backup_id: String) -> Result<(), String> {
    let path = resolve_backup(&profile_id, &world, &backup_id)?;
    fs::remove_file(path).map_err(|e| format!("Не удалось удалить бэкап: {e}"))
}
#[command]
pub async fn restore_world_backup(profile_id: String, world: String, backup_id: String) -> Result<(), String> {
    if game_is_running() {
        return Err("Закройте игру перед восстановлением мира".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let archive = resolve_backup(&profile_id, &world, &backup_id)?;
        let current = world_dir(&profile_id, &world)?;
        create_backup_blocking(&profile_id, &world, BackupKind::Safety)?;
        let saves = current.parent().ok_or("Некорректный путь мира")?.to_path_buf();
        let stamp = now_ms();
        let staging = saves.join(format!(".{world}.restore-{stamp}"));
        let old = saves.join(format!(".{world}.old-{stamp}"));
        if let Err(e) = extract_zip(&archive, &staging) {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
        fs::rename(&current, &old).map_err(|e| {
            let _ = fs::remove_dir_all(&staging);
            format!("Мир занят другой программой: {e}")
        })?;
        if let Err(e) = fs::rename(&staging, &current) {
            let _ = fs::rename(&old, &current);
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Не удалось подменить мир: {e}"));
        }
        let _ = fs::remove_dir_all(&old);
        Ok(())
    })
    .await
    .map_err(|e| format!("Ошибка восстановления: {e}"))?
}

#[command]
pub async fn open_world_backups_folder(profile_id: String, world: String) -> Result<(), String> {
    let dir = backups_dir(&profile_id, &world)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    open::that_detached(&dir).map_err(|e| format!("Не удалось открыть папку: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_names() {
        assert_eq!(parse_backup_name("1700000000000-auto.zip").map(|x| x.1), Some(BackupKind::Auto));
        assert!(parse_backup_name("../x-auto.zip").is_none());
        assert!(parse_backup_name("123-other.zip").is_none());
        assert!(parse_backup_name("123-manual.tar").is_none());
    }

    #[test]
    fn zip_roundtrip() {
        let root = std::env::temp_dir().join(format!("mc16-world-zip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let world = root.join("w");
        fs::create_dir_all(world.join("region")).unwrap();
        fs::write(world.join("level.dat"), b"lvl").unwrap();
        fs::write(world.join("session.lock"), b"x").unwrap();
        fs::write(world.join("region").join("r.0.0.mca"), vec![7u8; 5000]).unwrap();
        let archive = root.join("a.zip");
        {
            let f = fs::File::create(&archive).unwrap();
            let mut zip = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            add_dir_to_zip(&mut zip, &world, &world, opts).unwrap();
            zip.finish().unwrap();
        }
        let out = root.join("out");
        extract_zip(&archive, &out).unwrap();
        assert_eq!(fs::read(out.join("level.dat")).unwrap(), b"lvl");
        assert_eq!(fs::read(out.join("region").join("r.0.0.mca")).unwrap().len(), 5000);
        assert!(!out.join("session.lock").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
