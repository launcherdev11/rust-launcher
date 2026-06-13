use std::path::{Path, PathBuf};

use super::types::ExternalLauncherType;

fn parse_cfg_kv(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let (k, v) = trimmed.split_once('=')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect()
}

pub fn instances_dir_from_root(
    launcher_type: ExternalLauncherType,
    launcher_root: &Path,
) -> Option<PathBuf> {
    match launcher_type {
        ExternalLauncherType::PrismLauncher => {
            let cfg_path = launcher_root.join("prismlauncher.cfg");
            let text = std::fs::read_to_string(cfg_path).ok()?;
            let kv = parse_cfg_kv(&text);
            let custom = kv
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("InstanceDir"))
                .map(|(_, v)| v.clone());
            if let Some(v) = custom {
                let p = PathBuf::from(v);
                if p.is_absolute() {
                    return Some(p);
                }
                return Some(launcher_root.join(p));
            }
            Some(launcher_root.join("instances"))
        }
        ExternalLauncherType::MultiMC => {
            let cfg_path = launcher_root.join("multimc.cfg");
            let text = std::fs::read_to_string(cfg_path).ok()?;
            let kv = parse_cfg_kv(&text);
            let custom = kv
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("InstanceDir"))
                .map(|(_, v)| v.clone());
            if let Some(v) = custom {
                let p = PathBuf::from(v);
                if p.is_absolute() {
                    return Some(p);
                }
                return Some(launcher_root.join(p));
            }
            Some(launcher_root.join("instances"))
        }
        _ => None,
    }
}

pub fn normalize_multimc_like_path(
    launcher_type: ExternalLauncherType,
    input: &Path,
) -> Result<(PathBuf, PathBuf, bool), String> {
    if !input.exists() {
        return Err("Путь не найден. Укажите папку лаунчера или папку instances.".to_string());
    }

    let mut was_instances = false;
    let mut root = input.to_path_buf();
    let name = input
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    if name.eq_ignore_ascii_case("instances") {
        was_instances = true;
        root = input
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or("Папка instances не должна быть корнем диска.".to_string())?;
    }

    let instances_dir = instances_dir_from_root(launcher_type, &root)
        .ok_or("Не удалось прочитать конфиг лаунчера (InstanceDir).".to_string())?;

    if !instances_dir.is_dir() {
        return Err(
            "Не найдена папка instances. Укажите корень PrismLauncher/MultiMC или саму папку instances."
                .to_string(),
        );
    }

    Ok((root, instances_dir, was_instances))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_tmp_dir(name: &str) -> PathBuf {
        let mut base = std::env::temp_dir();
        base.push(format!(
            "mc16launcher-test-{}-{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        base
    }

    #[test]
    fn prism_normalize_root_and_instances() {
        let root = unique_tmp_dir("prism-root");
        let instances = root.join("instances");
        fs::create_dir_all(&instances).unwrap();
        fs::write(root.join("prismlauncher.cfg"), "InstanceDir=instances\n").unwrap();

        let (r1, i1, was1) =
            normalize_multimc_like_path(ExternalLauncherType::PrismLauncher, &root).unwrap();
        assert_eq!(r1, root);
        assert_eq!(i1, instances);
        assert!(!was1);

        let (r2, i2, was2) =
            normalize_multimc_like_path(ExternalLauncherType::PrismLauncher, &instances).unwrap();
        assert_eq!(r2, root);
        assert_eq!(i2, instances);
        assert!(was2);

        let _ = fs::remove_dir_all(&root);
    }
}

