use std::path::{Path, PathBuf};

pub fn normalize_atlauncher_path(input: &Path) -> Result<(PathBuf, PathBuf, bool), String> {
    if !input.exists() {
        return Err("Путь не найден. Укажите корень ATLauncher или папку instances.".to_string());
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

    let instances_dir = root.join("instances");
    if !instances_dir.is_dir() {
        return Err(
            "Не найдена папка instances. Укажите корень ATLauncher или саму папку instances.".to_string(),
        );
    }
    Ok((root, instances_dir, was_instances))
}

