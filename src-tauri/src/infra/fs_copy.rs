use std::fs;
use std::path::Path;

pub fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Не удалось создать {}: {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("Ошибка чтения {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| format!("Ошибка чтения {}: {e}", from.display()))?;
        let from_path = entry.path();
        let to_path = to.join(entry.file_name());
        if from_path.is_dir() {
            copy_dir_recursive(&from_path, &to_path)?;
        } else {
            if let Some(parent) = to_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
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

