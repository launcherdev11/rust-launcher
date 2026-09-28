use std::path::{Path, PathBuf};

pub fn normalize_curseforge_path(input: &Path) -> Result<(PathBuf, PathBuf, bool), String> {
    if !input.exists() {
        return Err("Путь не найден. Укажите корень CurseForge или папку Instances.".to_string());
    }

    let name = input.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if name.eq_ignore_ascii_case("instances") {
        let root = input
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or("Папка Instances не должна быть корнем диска.".to_string())?;
        return Ok((root, input.to_path_buf(), true));
    }

    let root = input.to_path_buf();
    let instances_dir = root.join("Instances");
    if !instances_dir.is_dir() {
        return Err(
            "Не найдена папка Instances. Укажите корень CurseForge (…/curseforge/minecraft) или …/Instances."
                .to_string(),
        );
    }
    Ok((root, instances_dir, false))
}

