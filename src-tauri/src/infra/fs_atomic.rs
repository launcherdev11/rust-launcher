use std::fs;
use std::path::Path;

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
        ".{}.tmp-{}",
        file_name.to_string_lossy(),
        std::process::id()
    );
    let tmp_path = parent.join(tmp_name);

    fs::write(&tmp_path, data.as_ref()).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Не удалось записать временный файл {}: {e}", tmp_path.display())
    })?;

    if path.exists() {
        let bak_path = backup_path_for(path);
        let _ = fs::remove_file(&bak_path);
        if let Err(e) = fs::rename(path, &bak_path) {
            if let Err(copy_err) = fs::copy(path, &bak_path) {
                let _ = fs::remove_file(&tmp_path);
                return Err(format!(
                    "Не удалось создать бэкап {}: {e}; copy: {copy_err}",
                    bak_path.display()
                ));
            }
            let _ = fs::remove_file(path);
        }
    }

    if let Err(e) = fs::rename(&tmp_path, path) {
        if let Err(copy_err) = fs::copy(&tmp_path, path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "Не удалось заменить {}: {e}; copy: {copy_err}",
                path.display()
            ));
        }
        let _ = fs::remove_file(&tmp_path);
    }

    Ok(())
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
