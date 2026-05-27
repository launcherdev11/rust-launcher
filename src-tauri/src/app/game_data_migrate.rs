use std::fs;
use std::path::{Path, PathBuf};

const GAME_DATA_SUBDIRS: &[&str] = &[
    "libraries",
    "versions",
    "assets",
    "instances",
    "screenshots",
    "runtimes",
    "forge_installers",
];

pub fn migrate_game_data_if_needed(
    target_root: &Path,
    legacy_instances: &Path,
    legacy_runtimes: &Path,
    legacy_forge_installers: &Path,
) -> Result<(), String> {
    fs::create_dir_all(target_root)
        .map_err(|e| format!("Не удалось создать папку игры: {e}"))?;

    let target_instances = target_root.join("instances");
    if legacy_instances.is_dir() && legacy_instances != target_instances.as_path() {
        merge_directory(legacy_instances, &target_instances)?;
        try_remove_dir_if_empty(legacy_instances)?;
    }

    let target_runtimes = target_root.join("runtimes");
    if legacy_runtimes.is_dir() && legacy_runtimes != target_runtimes.as_path() {
        merge_directory(legacy_runtimes, &target_runtimes)?;
        try_remove_dir_if_empty(legacy_runtimes)?;
    }

    let target_forge = target_root.join("forge_installers");
    if legacy_forge_installers.is_dir() && legacy_forge_installers != target_forge.as_path() {
        merge_directory(legacy_forge_installers, &target_forge)?;
        try_remove_dir_if_empty(legacy_forge_installers)?;
    }

    Ok(())
}

pub fn migrate_between_game_roots(from: &Path, to: &Path) -> Result<(), String> {
    if paths_equal(from, to) {
        return Ok(());
    }
    if !from.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(to).map_err(|e| format!("Не удалось создать папку игры: {e}"))?;

    for name in GAME_DATA_SUBDIRS {
        let src = from.join(name);
        if src.is_dir() {
            merge_directory(&src, &to.join(name))?;
        }
    }

    merge_top_level_files(from, to)?;

    Ok(())
}

fn merge_top_level_files(from: &Path, to: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(from) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("Ошибка чтения папки игры: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let file_name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };
        if GAME_DATA_SUBDIRS.contains(&file_name.as_str()) {
            continue;
        }
        let dest = to.join(&file_name);
        if dest.exists() {
            continue;
        }
        move_path(&path, &dest)?;
    }
    Ok(())
}

pub fn merge_directory(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    if !dir_has_entries(src) {
        return Ok(());
    }

    fs::create_dir_all(dest).map_err(|e| format!("Не удалось создать {}: {e}", dest.display()))?;

    for entry in fs::read_dir(src).map_err(|e| format!("Ошибка чтения {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("Ошибка чтения {}: {e}", src.display()))?;
        let from_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if from_path.is_dir() {
            if dest_path.is_dir() {
                merge_directory(&from_path, &dest_path)?;
                try_remove_dir_if_empty(&from_path)?;
            } else if dest_path.exists() {
                continue;
            } else {
                move_path(&from_path, &dest_path)?;
            }
        } else if !dest_path.exists() {
            move_path(&from_path, &dest_path)?;
        }
    }

    Ok(())
}

fn move_path(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    if from.is_dir() {
        copy_dir_recursive(from, to)?;
        fs::remove_dir_all(from)
            .map_err(|e| format!("Не удалось удалить {} после копирования: {e}", from.display()))?;
    } else {
        fs::copy(from, to)
            .map_err(|e| format!("Не удалось скопировать {} → {}: {e}", from.display(), to.display()))?;
        fs::remove_file(from)
            .map_err(|e| format!("Не удалось удалить {} после копирования: {e}", from.display()))?;
    }
    Ok(())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Не удалось создать {}: {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("Ошибка чтения {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| format!("Ошибка чтения {}: {e}", from.display()))?;
        let from_path = entry.path();
        let to_path = to.join(entry.file_name());
        if from_path.is_dir() {
            copy_dir_recursive(&from_path, &to_path)?;
        } else {
            if let Some(parent) = to_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
            }
            fs::copy(&from_path, &to_path).map_err(|e| {
                format!(
                    "Не удалось скопировать {} → {}: {e}",
                    from_path.display(),
                    to_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn try_remove_dir_if_empty(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Ok(());
    }
    if dir_has_entries(path) {
        return Ok(());
    }
    let _ = fs::remove_dir(path);
    Ok(())
}

fn dir_has_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .ok()
        .and_then(|mut it| it.next())
        .is_some()
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    fs::canonicalize(a)
        .ok()
        .zip(fs::canonicalize(b).ok())
        .map(|(a, b)| a == b)
        .unwrap_or_else(|| a == b)
}

pub fn game_root_from_directory_setting(game_directory: Option<&str>) -> Result<PathBuf, String> {
    if let Some(raw) = game_directory {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    let base = dirs::data_dir().ok_or("Не удалось получить системную папку данных")?;
    Ok(base.join("16Launcher").join("game"))
}
