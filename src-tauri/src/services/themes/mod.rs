use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::app::paths::launcher_data_dir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ThemeMeta {
    #[serde(default)]
    name: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    version: String,
}

pub fn themes_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("themes"))
}

fn ensure_themes_dir() -> Result<PathBuf, String> {
    let dir = themes_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось создать папку тем: {e}"))?;
    Ok(dir)
}

fn read_theme_info(theme_dir: &std::path::Path) -> Option<ThemeInfo> {
    let id = theme_dir.file_name()?.to_str()?.to_string();
    let meta_path = theme_dir.join("theme.json");
    let style_path = theme_dir.join("style.css");

    if !meta_path.is_file() || !style_path.is_file() {
        return None;
    }

    let text = std::fs::read_to_string(&meta_path).ok()?;
    let meta: ThemeMeta = serde_json::from_str(&text).unwrap_or_default();

    Some(ThemeInfo {
        id,
        name: if meta.name.is_empty() {
            theme_dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        } else {
            meta.name
        },
        author: meta.author,
        description: meta.description,
        version: meta.version,
    })
}

/// Copy bundled example theme to user's themes dir if it doesn't exist yet.
pub fn ensure_example_theme(app_handle: &tauri::AppHandle) {
    use tauri::Manager;

    let dest = match themes_dir() {
        Ok(d) => d.join("example-theme"),
        Err(_) => return,
    };

    if dest.is_dir() {
        return;
    }

    let resource_dir = match app_handle.path().resource_dir() {
        Ok(d) => d,
        Err(_) => return,
    };

    let source = resource_dir.join("themes").join("example-theme");
    if !source.is_dir() {
        return;
    }

    let _ = std::fs::create_dir_all(&dest);
    for file_name in &["theme.json", "style.css", "README.txt"] {
        let src = source.join(file_name);
        let dst = dest.join(file_name);
        if src.is_file() && !dst.exists() {
            let _ = std::fs::copy(&src, &dst);
        }
    }
}

#[command]
pub fn list_themes() -> Result<Vec<ThemeInfo>, String> {
    let dir = ensure_themes_dir()?;
    let mut themes = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Не удалось прочитать папку тем: {e}"))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(info) = read_theme_info(&path) {
            themes.push(info);
        }
    }

    themes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(themes)
}

#[command]
pub fn import_theme_zip(source_path: String) -> Result<ThemeInfo, String> {
    let zip_path = std::path::Path::new(&source_path);
    if !zip_path.exists() {
        return Err("Файл не найден.".to_string());
    }

    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Не удалось открыть файл: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Не удалось прочитать ZIP-архив: {e}"))?;

    // Find theme.json to determine theme name
    let mut has_theme_json = false;
    let mut has_style_css = false;
    for i in 0..archive.len() {
        let entry = archive.by_index(i)
            .map_err(|e| format!("Ошибка чтения ZIP: {e}"))?;
        let name = entry.name().replace('\\', "/");
        let parts: Vec<&str> = name.split('/').filter(|s| !s.is_empty()).collect();
        // Accept files at root or inside a single top-level folder
        let file_name = parts.last().copied().unwrap_or("");
        if file_name == "theme.json" {
            has_theme_json = true;
        }
        if file_name == "style.css" {
            has_style_css = true;
        }
    }

    if !has_theme_json {
        return Err("ZIP-архив не содержит theme.json.".to_string());
    }
    if !has_style_css {
        return Err("ZIP-архив не содержит style.css.".to_string());
    }

    // Determine theme id from zip file name
    let zip_stem = zip_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let theme_id = zip_stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>();
    let theme_id = if theme_id.is_empty() {
        format!("theme-{}", rand::random::<u32>())
    } else {
        theme_id
    };

    let themes = ensure_themes_dir()?;
    let dest = themes.join(&theme_id);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Не удалось создать папку темы: {e}"))?;

    // Detect if files are in root or in a subfolder
    let mut prefix = String::new();
    {
        let reopen = std::fs::File::open(zip_path)
            .map_err(|e| format!("Не удалось открыть файл: {e}"))?;
        let mut arc = zip::ZipArchive::new(reopen)
            .map_err(|e| format!("Не удалось прочитать ZIP: {e}"))?;
        for i in 0..arc.len() {
            let entry = arc.by_index(i)
                .map_err(|e| format!("Ошибка чтения ZIP: {e}"))?;
            let name = entry.name().replace('\\', "/");
            if name.ends_with("theme.json") {
                let p = name.strip_suffix("theme.json").unwrap_or("");
                prefix = p.to_string();
                break;
            }
        }
    }

    // Extract files
    let reopen = std::fs::File::open(zip_path)
        .map_err(|e| format!("Не удалось открыть файл: {e}"))?;
    let mut arc = zip::ZipArchive::new(reopen)
        .map_err(|e| format!("Не удалось прочитать ZIP: {e}"))?;

    for i in 0..arc.len() {
        let mut entry = arc.by_index(i)
            .map_err(|e| format!("Ошибка чтения ZIP: {e}"))?;

        if entry.is_dir() {
            continue;
        }

        let name = entry.name().replace('\\', "/");
        let relative = if !prefix.is_empty() && name.starts_with(&prefix) {
            name[prefix.len()..].to_string()
        } else {
            name.clone()
        };

        if relative.is_empty() || relative.contains("..") {
            continue;
        }

        let target = dest.join(&relative);
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut out = std::fs::File::create(&target)
            .map_err(|e| format!("Не удалось создать файл {relative}: {e}"))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("Не удалось записать файл {relative}: {e}"))?;
    }

    read_theme_info(&dest)
        .ok_or_else(|| "Не удалось прочитать импортированную тему.".to_string())
}

#[command]
pub fn get_theme_css(theme_id: String) -> Result<String, String> {
    let dir = themes_dir()?;
    let style_path = dir.join(&theme_id).join("style.css");
    if !style_path.is_file() {
        return Err(format!("Файл стилей темы «{theme_id}» не найден."));
    }
    std::fs::read_to_string(&style_path)
        .map_err(|e| format!("Не удалось прочитать style.css: {e}"))
}



#[command]
pub fn save_custom_theme_css(theme_id: String, css: String) -> Result<(), String> {
    let dir = themes_dir()?;
    let theme_dir = dir.join(&theme_id);
    if !theme_dir.is_dir() {
        return Err(format!("Тема «{theme_id}» не найдена."));
    }
    let style_path = theme_dir.join("style.css");
    std::fs::write(&style_path, css)
        .map_err(|e| format!("Не удалось сохранить style.css: {e}"))
}

#[command]
pub fn create_empty_theme(name: String) -> Result<ThemeInfo, String> {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let id = sanitized
        .trim()
        .replace(' ', "-")
        .to_lowercase();
    let id = if id.is_empty() {
        format!("theme-{}", rand::random::<u32>())
    } else {
        id
    };

    let dir = ensure_themes_dir()?;
    let theme_dir = dir.join(&id);

    if theme_dir.exists() {
        return Err("Тема с таким именем уже существует.".to_string());
    }

    std::fs::create_dir_all(&theme_dir)
        .map_err(|e| format!("Не удалось создать папку темы: {e}"))?;

    let meta = ThemeMeta {
        name: name.trim().to_string(),
        author: String::new(),
        description: String::new(),
        version: "1.0".to_string(),
    };
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Ошибка сериализации theme.json: {e}"))?;
    std::fs::write(theme_dir.join("theme.json"), meta_json)
        .map_err(|e| format!("Не удалось записать theme.json: {e}"))?;

    let default_css = r#"/* Ваш CSS-код здесь / Your CSS code here */

/* Примеры / Examples:
 * body { background: #1a1a2e; }
 * .glass-panel { background: rgba(0,0,0,0.8) !important; }
 * .interactive-press { border-radius: 0 !important; }
 */
"#;
    std::fs::write(theme_dir.join("style.css"), default_css)
        .map_err(|e| format!("Не удалось записать style.css: {e}"))?;

    read_theme_info(&theme_dir)
        .ok_or_else(|| "Не удалось создать тему.".to_string())
}

#[command]
pub fn delete_theme(theme_id: String) -> Result<(), String> {
    let dir = themes_dir()?;
    let theme_dir = dir.join(&theme_id);
    if !theme_dir.is_dir() {
        return Err(format!("Тема «{theme_id}» не найдена."));
    }
    // Safety: only delete within themes dir
    if !theme_dir.starts_with(&dir) {
        return Err("Недопустимый путь темы.".to_string());
    }
    std::fs::remove_dir_all(&theme_dir)
        .map_err(|e| format!("Не удалось удалить тему: {e}"))
}

#[command]
pub fn open_themes_folder() -> Result<(), String> {
    let dir = ensure_themes_dir()?;
    open::that(&dir).map_err(|e| format!("Не удалось открыть папку: {e}"))
}

#[command]
pub fn open_theme_css_file(theme_id: String) -> Result<(), String> {
    let dir = themes_dir()?;
    let style_path = dir.join(&theme_id).join("style.css");
    if !style_path.is_file() {
        return Err(format!("Файл стилей темы «{theme_id}» не найден."));
    }
    open::that(&style_path).map_err(|e| format!("Не удалось открыть файл: {e}"))
}

#[command]
pub fn get_theme_dir(theme_id: String) -> Result<String, String> {
    let dir = themes_dir()?;
    let theme_dir = dir.join(&theme_id);
    if !theme_dir.is_dir() {
        return Err(format!("Тема «{theme_id}» не найдена."));
    }
    Ok(theme_dir.to_string_lossy().to_string())
}
