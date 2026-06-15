use std::path::{Path, PathBuf};

use super::types::ExternalLauncherType;

pub fn default_launcher_root(launcher_type: ExternalLauncherType) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let home = dirs::home_dir()?;
        let appdata = dirs::data_dir();
        match launcher_type {
            ExternalLauncherType::PrismLauncher => {
                if let Some(ad) = appdata {
                    return Some(ad.join("PrismLauncher"));
                }
                Some(home.join("AppData").join("Roaming").join("PrismLauncher"))
            }
            ExternalLauncherType::MultiMC => {
                if let Some(ad) = appdata {
                    return Some(ad.join("MultiMC"));
                }
                Some(home.join("AppData").join("Roaming").join("MultiMC"))
            }
            ExternalLauncherType::CurseForge => {
                Some(home.join("Documents").join("Curse").join("Minecraft"))
            }
            ExternalLauncherType::GDLauncher => {
                if let Some(ad) = appdata {
                    let next = ad.join("gdlauncher_next");
                    if next.exists() {
                        return Some(next);
                    }
                    let carbon = ad.join("gdlauncher_carbon");
                    if carbon.exists() {
                        return Some(carbon);
                    }
                    return Some(next);
                }
                let next = home.join("AppData").join("Roaming").join("gdlauncher_next");
                if next.exists() {
                    return Some(next);
                }
                let carbon = home.join("AppData").join("Roaming").join("gdlauncher_carbon");
                if carbon.exists() {
                    return Some(carbon);
                }
                Some(next)
            }
            ExternalLauncherType::ATLauncher => {
                if let Some(ad) = appdata {
                    return Some(ad.join("ATLauncher"));
                }
                Some(home.join("AppData").join("Roaming").join("ATLauncher"))
            }
            _ => None,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = launcher_type;
        None
    }
}

pub fn autodetect_launcher_type(base_path: &Path) -> ExternalLauncherType {
    let prism_cfg = base_path.join("prismlauncher.cfg");
    let multimc_cfg = base_path.join("multimc.cfg");
    if prism_cfg.is_file() {
        return ExternalLauncherType::PrismLauncher;
    }
    if multimc_cfg.is_file() {
        return ExternalLauncherType::MultiMC;
    }

    let name = base_path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if name == "instances" || name == "instance" {
        if let Some(parent) = base_path.parent() {
            let t = autodetect_launcher_type(parent);
            if t != ExternalLauncherType::Unknown {
                return t;
            }
        }
    }

    if base_path.join("Instances").is_dir()
        && base_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("minecraft"))
            .unwrap_or(false)
    {
        return ExternalLauncherType::CurseForge;
    }

    if base_path.join("instances").is_dir() && base_path.join("ATLauncher.conf").is_file() {
        return ExternalLauncherType::ATLauncher;
    }

    if base_path.join("instances").is_dir() && base_path.join("settings.json").is_file() {
        return ExternalLauncherType::GDLauncher;
    }

    if base_path.join("data").join("instances").is_dir() {
        return ExternalLauncherType::GDLauncher;
    }

    ExternalLauncherType::Unknown
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
    fn autodetect_prism_by_cfg() {
        let root = unique_tmp_dir("autodetect-prism");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("prismlauncher.cfg"), "InstanceDir=instances\n").unwrap();
        assert_eq!(autodetect_launcher_type(&root), ExternalLauncherType::PrismLauncher);
        let _ = fs::remove_dir_all(&root);
    }
}

