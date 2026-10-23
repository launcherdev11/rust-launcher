use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);
static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn write_atomic(path: &Path, data: impl AsRef<[u8]>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Некорректный путь для записи: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;

    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Некорректное имя файла: {}", path.display()))?;
    let tmp_name = format!(
        ".{}.tmp-{}-{}",
        file_name.to_string_lossy(),
        std::process::id(),
        WRITE_SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let tmp_path = parent.join(tmp_name);

    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let write_tmp = || -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(data.as_ref())?;
        file.sync_all()
    };
    if let Err(e) = write_tmp() {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "Не удалось записать временный файл {}: {e}",
            tmp_path.display()
        ));
    }

    if path.is_file() && has_content(path) {
        let _ = fs::copy(path, backup_path_for(path));
    }

    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Не удалось заменить {}: {e}", path.display()));
    }

    Ok(())
}

fn has_content(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false)
}

pub fn backup_path_for(path: &Path) -> std::path::PathBuf {
    let mut bak = path.as_os_str().to_owned();
    bak.push(".bak");
    std::path::PathBuf::from(bak)
}

pub fn read_to_string_with_backup(path: &Path) -> Option<String> {
    if let Ok(text) = fs::read_to_string(path) {
        if !text.trim().is_empty() {
            return Some(text);
        }
    }
    let bak = backup_path_for(path);
    fs::read_to_string(bak).ok().filter(|t| !t.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_writes_leave_valid_file_and_backup() {
        let dir = std::env::temp_dir().join(format!("fs_atomic_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("config.json");
        write_atomic(&path, "{\"v\":0}").unwrap();

        let handles: Vec<_> = (1..=16)
            .map(|i| {
                let path = path.clone();
                std::thread::spawn(move || write_atomic(&path, format!("{{\"v\":{i}}}")).unwrap())
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let main = fs::read_to_string(&path).unwrap();
        let bak = fs::read_to_string(backup_path_for(&path)).unwrap();
        assert!(serde_json::from_str::<serde_json::Value>(&main).is_ok());
        assert!(serde_json::from_str::<serde_json::Value>(&bak).is_ok());
        let leftovers = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .count();
        assert_eq!(leftovers, 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
