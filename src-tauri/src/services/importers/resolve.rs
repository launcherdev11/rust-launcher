use std::path::PathBuf;

use super::atlauncher::normalize_atlauncher_path;
use super::curseforge::normalize_curseforge_path;
use super::detect::{autodetect_launcher_type, default_launcher_root};
use super::gdlauncher::normalize_gdlauncher_path;
use super::multimc_family::normalize_multimc_like_path;
use super::types::{ExternalLauncherType, NormalizedLauncherPath};

pub fn normalize_launcher_path(
    requested_type: ExternalLauncherType,
    user_input: Option<&str>,
) -> Result<NormalizedLauncherPath, String> {
    let chosen_type = match requested_type {
        ExternalLauncherType::Auto => {
            let p = user_input
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
                .ok_or("Не указан путь к лаунчеру. Укажите корень лаунчера или папку instances.".to_string())?;
            autodetect_launcher_type(&p)
        }
        other => other,
    };

    let base = if let Some(s) = user_input {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            default_launcher_root(chosen_type).ok_or("Не указан путь к лаунчеру.".to_string())?
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        default_launcher_root(chosen_type).ok_or("Не указан путь к лаунчеру.".to_string())?
    };

    let (root, instances_dir, was_instances_dir_input) = match chosen_type {
        ExternalLauncherType::PrismLauncher | ExternalLauncherType::MultiMC => {
            normalize_multimc_like_path(chosen_type, &base)?
        }
        ExternalLauncherType::CurseForge => normalize_curseforge_path(&base)?,
        ExternalLauncherType::GDLauncher => normalize_gdlauncher_path(&base)?,
        ExternalLauncherType::ATLauncher => normalize_atlauncher_path(&base)?,
        ExternalLauncherType::Unknown | ExternalLauncherType::Auto => {
            let t = autodetect_launcher_type(&base);
            if t == ExternalLauncherType::Unknown {
                return Err("Не удалось определить тип лаунчера по указанному пути.".to_string());
            }
            return normalize_launcher_path(t, user_input);
        }
    };

    Ok(NormalizedLauncherPath {
        launcher_type: chosen_type,
        launcher_root: root.to_str().unwrap_or_default().to_string(),
        instances_dir: instances_dir.to_str().unwrap_or_default().to_string(),
        was_instances_dir_input,
    })
}

