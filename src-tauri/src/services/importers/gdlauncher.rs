use std::path::{Path, PathBuf};

pub fn normalize_gdlauncher_path(input: &Path) -> Result<(PathBuf, PathBuf, bool), String> {
    if !input.exists() {
        return Err(
            "Путь не найден. Укажите корень GDLauncher (Next/Carbon) или папку instances.".to_string(),
        );
    }

    let mut was_instances = false;
    let mut root = input.to_path_buf();
    let name = input.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if name.eq_ignore_ascii_case("instances") {
        was_instances = true;
        root = input
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or("Папка instances не должна быть корнем диска.".to_string())?;
    }

    let direct_instances = root.join("instances");
    if direct_instances.is_dir() {
        return Ok((root, direct_instances, was_instances));
    }

    let carbon_instances = root.join("data").join("instances");
    if carbon_instances.is_dir() {
        return Ok((root, carbon_instances, was_instances));
    }

    Err("Не найдена папка instances. Укажите корень GDLauncher (Next/Carbon) или папку instances."
        .to_string())
}

