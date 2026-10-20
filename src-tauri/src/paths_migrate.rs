use std::fs;
use std::path::{Path, PathBuf};
use tauri::api::path::app_data_dir;

pub fn migrate_16launcher_to_nexus() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(mut old) = app_data_dir() {
        old.push("16Launcher");
        if old.exists() {
            if let Some(mut new) = app_data_dir() {
                new.push("NexusLauncher");
                if !new.exists() {
                    fs::create_dir_all(&new)?;
                    copy_dir_all(&old, &new)?;
                }
            }
        }
    }
    Ok(())
}

fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&from.into(), &to)?;
        } else {
            // if destination exists, do not overwrite
            if !to.exists() {
                fs::copy(&from, &to)?;
            }
        }
    }
    Ok(())
}
