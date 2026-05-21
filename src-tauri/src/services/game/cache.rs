use std::path::Path;

use crate::services::game::settings::launcher_cache_dir;

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

pub fn get_launcher_cache_size() -> Result<u64, String> {
    let dir = launcher_cache_dir()?;
    let (bytes, _) = dir_size_and_count(&dir);
    Ok(bytes)
}

pub fn clear_launcher_cache() -> Result<(), String> {
    let dir = launcher_cache_dir()?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Не удалось удалить кэш лаунчера: {e}"))?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку кэша лаунчера: {e}"))?;
    Ok(())
}

