use std::path::{Path, PathBuf};

use tauri::command;

use crate::app::paths::launcher_data_dir;
use crate::services::game::settings::launcher_cache_dir;

pub(crate) fn avatars_ely_cache_dir() -> Result<PathBuf, String> {
    Ok(launcher_cache_dir()?.join("avatars").join("ely"))
}

pub(crate) fn tmp_cache_dir() -> Result<PathBuf, String> {
    Ok(launcher_cache_dir()?.join("tmp"))
}

pub(crate) fn ensure_launcher_cache_layout() -> Result<(), String> {
    std::fs::create_dir_all(avatars_ely_cache_dir()?)
        .map_err(|e| format!("Не удалось создать папку кэша аватаров: {e}"))?;
    std::fs::create_dir_all(tmp_cache_dir()?)
        .map_err(|e| format!("Не удалось создать папку временных файлов: {e}"))?;
    migrate_legacy_launcher_cache()?;
    Ok(())
}

fn migrate_legacy_launcher_cache() -> Result<(), String> {
    if let Some(base) = dirs::cache_dir().or_else(dirs::data_local_dir) {
        let old_avatars = base.join("mc16launcher").join("avatars").join("ely");
        if old_avatars.is_dir() {
            copy_tree_merge(&old_avatars, &avatars_ely_cache_dir()?)?;
            let _ = std::fs::remove_dir_all(&old_avatars);
        }
    }

    let old_tmp = launcher_data_dir()?.join("tmp");
    if old_tmp.is_dir() {
        copy_tree_merge(&old_tmp, &tmp_cache_dir()?)?;
        let _ = std::fs::remove_dir_all(&old_tmp);
    }

    Ok(())
}

fn copy_tree_merge(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(dest).map_err(|e| format!("Не удалось создать папку кэша: {e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("Не удалось прочитать папку кэша: {e}"))? {
        let entry = entry.map_err(|e| format!("Не удалось прочитать элемент кэша: {e}"))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_tree_merge(&src_path, &dest_path)?;
        } else if !dest_path.exists() {
            std::fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Не удалось скопировать файл кэша: {e}"))?;
        }
    }
    Ok(())
}

pub(crate) fn dir_size_and_count(root: &Path) -> (u64, u32) {
    if !root.exists() {
        return (0, 0);
    }
    let mut total_bytes = 0u64;
    let mut files_count = 0u32;
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        if let Ok(entries) = std::fs::read_dir(&path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        total_bytes = total_bytes.saturating_add(meta.len());
                        files_count = files_count.saturating_add(1);
                    } else if meta.is_dir() {
                        stack.push(p);
                    }
                }
            }
        }
    }
    (total_bytes, files_count)
}

#[command]
pub fn get_launcher_cache_size() -> Result<u64, String> {
    ensure_launcher_cache_layout()?;
    let dir = launcher_cache_dir()?;
    let (bytes, _) = dir_size_and_count(&dir);
    Ok(bytes)
}

#[command]
pub fn clear_launcher_cache() -> Result<(), String> {
    let dir = launcher_cache_dir()?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("Не удалось удалить кэш лаунчера: {e}"))?;
    }
    ensure_launcher_cache_layout()?;
    Ok(())
}
