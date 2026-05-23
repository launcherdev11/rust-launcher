use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use tauri::command;

use crate::app::paths::launcher_data_dir;
use crate::services::game::settings as settings_service;

fn image_path_to_data_uri(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Не удалось прочитать файл изображения: {e}"))?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "png" | _ => "image/png",
    };
    let encoded = BASE64_STANDARD.encode(bytes);
    Ok(Some(format!("data:{};base64,{}", mime, encoded)))
}

#[command]
pub fn set_background_image(source_path: Option<String>) -> Result<Option<String>, String> {
    let mut settings = settings_service::load_settings_from_disk();

    let new_path = if let Some(src) = source_path {
        let path = Path::new(&src);
        if !path.exists() {
            return Err("Файл не найден.".to_string());
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let data_dir = launcher_data_dir()?;
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Не удалось создать папку данных лаунчера: {e}"))?;
        let dest = data_dir.join(format!("background.{}", ext));
        std::fs::copy(path, &dest)
            .map_err(|e| format!("Не удалось скопировать файл: {e}"))?;
        Some(
            dest.to_str()
                .ok_or("Путь не в UTF-8")?
                .to_string(),
        )
    } else {
        None
    };

    if new_path.is_none() {
        if let Some(old) = settings.background_image_url.as_ref() {
            let old_path = PathBuf::from(old);
            if let Ok(data_dir) = launcher_data_dir() {
                if old_path.starts_with(&data_dir) {
                    let _ = std::fs::remove_file(&old_path);
                }
            }
        }
    }

    settings.background_image_url = new_path.clone();
    settings_service::save_settings_to_disk(&settings)?;
    Ok(new_path)
}

#[command]
pub fn get_background_data_uri() -> Result<Option<String>, String> {
    let settings = settings_service::load_settings_from_disk();
    let path_str = match settings.background_image_url {
        Some(p) => p,
        None => return Ok(None),
    };
    let path = PathBuf::from(&path_str);
    if path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("gif"))
    {
        return Ok(None);
    }
    image_path_to_data_uri(&path)
}
