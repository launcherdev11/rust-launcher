use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};

use crate::infra::fs_copy::copy_dir_recursive;
use crate::models::events::{ExternalImportProgressPayload, EVENT_EXTERNAL_IMPORT_PROGRESS};
use crate::app::paths::instance_dir;
use crate::models::InstanceProfileSummary;
use crate::services::game::profiles::{create_profile_impl, delete_profile};
use crate::services::importers::detect::default_launcher_root;
use crate::services::importers::resolve::normalize_launcher_path;
use crate::services::importers::scan::{scan_generic_instances, scan_multimc_like_instances};
use crate::services::importers::types::{ExternalLauncherType, ImportableInstance};

fn emit_progress(app: &AppHandle, phase: &str, current: Option<u32>, total: Option<u32>, message: Option<String>) {
    let _ = app.emit(
        EVENT_EXTERNAL_IMPORT_PROGRESS,
        ExternalImportProgressPayload {
            phase: phase.to_string(),
            current,
            total,
            message,
        },
    );
}

fn dir_is_empty(dir: &Path) -> bool {
    std::fs::read_dir(dir).ok().and_then(|mut it| it.next()).is_none()
}

fn copy_dir_contents_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(to)
        .map_err(|e| format!("Не удалось создать папку {}: {e}", to.display()))?;
    for entry in std::fs::read_dir(from)
        .map_err(|e| format!("Ошибка чтения {}: {e}", from.display()))?
    {
        let entry = entry.map_err(|e| format!("Ошибка чтения {}: {e}", from.display()))?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir_contents_recursive(&src, &dst)?;
        } else if src.is_file() {
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
            }
            let _ = std::fs::copy(&src, &dst);
        }
    }
    Ok(())
}

fn normalize_dot_minecraft_layout(dest: &Path) -> Result<(), String> {
    let candidates = [dest.join(".minecraft"), dest.join("minecraft")];

    for content_root in candidates {
        if !content_root.is_dir() {
            continue;
        }
        for (from_name, to_name) in [
            ("mods", "mods"),
            ("resourcepacks", "resourcepacks"),
            ("shaderpacks", "shaderpacks"),
        ] {
            let from = content_root.join(from_name);
            let to = dest.join(to_name);
            if !from.is_dir() {
                continue;
            }
            if to.is_dir() && !dir_is_empty(&to) {
                continue;
            }
            copy_dir_contents_recursive(&from, &to)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn default_external_launcher_path(launcher_type: ExternalLauncherType) -> Option<String> {
    default_launcher_root(launcher_type).and_then(|p| p.to_str().map(|s| s.to_string()))
}

#[tauri::command]
pub fn list_importable_instances(
    launcher_type: ExternalLauncherType,
    base_path: Option<String>,
) -> Result<Vec<ImportableInstance>, String> {
    let normalized = normalize_launcher_path(launcher_type, base_path.as_deref())?;
    let instances_dir = PathBuf::from(&normalized.instances_dir);
    let launcher_root = PathBuf::from(&normalized.launcher_root);
    let lt = normalized.launcher_type;
    match lt {
        ExternalLauncherType::PrismLauncher | ExternalLauncherType::MultiMC => {
            scan_multimc_like_instances(lt, Some(launcher_root.as_path()), &instances_dir)
        }
        ExternalLauncherType::CurseForge
        | ExternalLauncherType::ATLauncher
        | ExternalLauncherType::GDLauncher => scan_generic_instances(lt, &instances_dir),
        _ => Err("Неподдерживаемый тип лаунчера".to_string()),
    }
}

fn copy_instance_payload(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Err("Папка инстанса не найдена".to_string());
    }

    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Не удалось прочитать папку инстанса: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Ошибка чтения папки инстанса: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.eq_ignore_ascii_case("config.json") || name.eq_ignore_ascii_case("settings.json") {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&name);
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
            }
            std::fs::copy(&from, &to).map_err(|e| {
                format!(
                    "Не удалось скопировать {} → {}: {e}",
                    from.display(),
                    to.display()
                )
            })?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn import_selected_external_instance(
    app: AppHandle,
    launcher_type: ExternalLauncherType,
    base_path: Option<String>,
    instance_path: String,
    display_name: Option<String>,
    loader: Option<String>,
    game_version: Option<String>,
    icon_path: Option<String>,
) -> Result<InstanceProfileSummary, String> {
    let _normalized = normalize_launcher_path(launcher_type, base_path.as_deref())?;

    emit_progress(&app, "start", None, None, None);

    let name = display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Imported profile".to_string());
    let gv = game_version.unwrap_or_else(|| "unknown".to_string());
    let ld = loader.unwrap_or_else(|| "vanilla".to_string());

    let profile = create_profile_impl(name, gv, ld, None, icon_path, None)?;
    let profile_id = profile.id.clone();
    let dest = instance_dir(&profile_id)?;

    let src = PathBuf::from(&instance_path);
    let res = (|| -> Result<(), String> {
        emit_progress(&app, "copy", None, None, None);
        copy_instance_payload(&src, &dest)?;
        emit_progress(&app, "layout", None, None, None);
        normalize_dot_minecraft_layout(&dest)?;
        Ok(())
    })();

    if let Err(e) = res {
        let _ = delete_profile(profile_id.clone());
        emit_progress(&app, "error", None, None, Some(e.clone()));
        return Err(e);
    }

    emit_progress(&app, "done", Some(1), Some(1), None);
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rollback_deletes_profile_dir_on_copy_error() {
        let profile = create_profile_impl(
            "RollbackTest".to_string(),
            "1.20.1".to_string(),
            "fabric".to_string(),
            None,
            None,
            None,
        )
        .unwrap();
        let pid = profile.id.clone();
        let dest = instance_dir(&pid).unwrap();
        assert!(dest.is_dir());

        let src = PathBuf::from("Z:/this/path/should/not/exist");
        let err = copy_instance_payload(&src, &dest).unwrap_err();
        assert!(!err.is_empty());

        delete_profile(pid.clone()).unwrap();
        let dest2 = instance_dir(&pid).unwrap();
        assert!(!dest2.exists());
    }

    #[test]
    fn prism_minecraft_dir_is_mapped_to_root_mods() {
        let profile = create_profile_impl(
            "LayoutTest".to_string(),
            "1.16.5".to_string(),
            "fabric".to_string(),
            None,
            None,
            None,
        )
        .unwrap();
        let pid = profile.id.clone();
        let dest = instance_dir(&pid).unwrap();

        let src_mods = dest.join("minecraft").join("mods");
        fs::create_dir_all(&src_mods).unwrap();
        fs::write(src_mods.join("a.jar"), b"test").unwrap();

        let target_mods = dest.join("mods");
        fs::create_dir_all(&target_mods).unwrap();
        for e in fs::read_dir(&target_mods).unwrap() {
            let _ = e;
            panic!("mods dir should start empty");
        }

        normalize_dot_minecraft_layout(&dest).unwrap();
        assert!(target_mods.join("a.jar").is_file());

        delete_profile(pid).unwrap();
    }
}

