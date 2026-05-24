use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::Serialize;

use crate::app::paths::screenshots_dir as game_screenshots_dir;

#[derive(Debug, Serialize, Clone)]
pub struct ScreenshotInfo {
    pub name: String,
    pub modified_at: u64,
    pub size_bytes: u64,
}

fn screenshots_dir() -> Result<PathBuf, String> {
    let dir = game_screenshots_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось создать папку screenshots: {e}"))?;
    Ok(dir)
}

fn is_screenshot_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    ["png", "jpg", "jpeg", "webp"]
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

fn resolve_screenshot_path(name: &str) -> Result<PathBuf, String> {
    let file_name = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "Недопустимое имя файла".to_string())?;

    if file_name.contains("..") {
        return Err("Недопустимое имя файла".to_string());
    }

    let dir = screenshots_dir()?;
    let path = dir.join(file_name);
    if !path.starts_with(&dir) {
        return Err("Недопустимый путь".to_string());
    }
    Ok(path)
}

fn image_path_to_data_uri(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Не удалось прочитать скриншот: {e}"))?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "png" | _ => "image/png",
    };
    let encoded = BASE64_STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

#[tauri::command]
pub fn list_screenshots() -> Result<Vec<ScreenshotInfo>, String> {
    let dir = screenshots_dir()?;
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("Не удалось прочитать папку screenshots: {e}"))?;

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_screenshot_file(&name) {
            continue;
        }
        let meta = entry.metadata().ok();
        let modified_at = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let size_bytes = meta.map(|m| m.len()).unwrap_or(0);
        out.push(ScreenshotInfo {
            name,
            modified_at,
            size_bytes,
        });
    }

    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

#[tauri::command]
pub fn get_screenshot_data_uri(name: String) -> Result<Option<String>, String> {
    let path = resolve_screenshot_path(&name)?;
    image_path_to_data_uri(&path)
}

#[tauri::command]
pub fn delete_screenshot(name: String) -> Result<(), String> {
    let path = resolve_screenshot_path(&name)?;
    if !path.is_file() {
        return Err("Скриншот не найден".to_string());
    }
    std::fs::remove_file(&path).map_err(|e| format!("Не удалось удалить скриншот: {e}"))
}

async fn open_path_in_file_manager(path_str: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть проводник: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть файл: {e}"))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть файл: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn open_screenshots_folder() -> Result<(), String> {
    let dir = screenshots_dir()?;
    let path_str = dir
        .to_str()
        .ok_or_else(|| "Путь к папке screenshots не в UTF-8".to_string())?;
    open_path_in_file_manager(path_str).await
}

#[tauri::command]
pub async fn open_screenshot(name: String) -> Result<(), String> {
    let path = resolve_screenshot_path(&name)?;
    if !path.is_file() {
        return Err("Скриншот не найден".to_string());
    }
    let path_str = path
        .to_str()
        .ok_or_else(|| "Путь к скриншоту не в UTF-8".to_string())?;
    open_path_in_file_manager(path_str).await
}
