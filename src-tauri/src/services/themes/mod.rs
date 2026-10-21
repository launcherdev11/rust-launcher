use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{command, Emitter};

use crate::app::paths::launcher_data_dir;
use crate::infra::fs_copy::copy_dir_recursive;

/// Event emitted while hot reload is on and a file inside the watched theme folder changes.
pub const THEME_CHANGED_EVENT: &str = "custom-theme-changed";

const WATCH_INTERVAL: Duration = Duration::from_millis(700);
const WATCH_MAX_FILES: usize = 512;
const WATCH_MAX_DEPTH: usize = 4;

const ASSET_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "woff", "woff2", "ttf", "otf",
];
const PREVIEW_FILES: &[&str] = &["preview.png", "preview.jpg", "preview.jpeg", "preview.webp"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub version: String,
    /// CSS custom properties from theme.json, applied as `:root { ... }` before style.css.
    pub variables: BTreeMap<String, String>,
    /// Absolute path of the preview image, if the theme has one.
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemeDetails {
    #[serde(flatten)]
    pub info: ThemeInfo,
    pub css: String,
    pub dir: String,
}

/// Editable part of theme.json. Unknown fields already in the file are preserved on save.
#[derive(Debug, Clone, Deserialize)]
pub struct ThemeMetaInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
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
    #[serde(default)]
    variables: BTreeMap<String, String>,
    #[serde(default)]
    preview: Option<String>,
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

/// Theme ids come from the webview; they must name a direct child of the themes folder.
fn validate_theme_id(theme_id: &str) -> Result<(), String> {
    let valid = !theme_id.trim().is_empty()
        && !theme_id.contains("..")
        && !theme_id.contains(['/', '\\', ':'])
        && !theme_id.starts_with('.');
    if valid {
        Ok(())
    } else {
        Err("Недопустимый ID темы.".to_string())
    }
}

fn theme_path(theme_id: &str) -> Result<PathBuf, String> {
    validate_theme_id(theme_id)?;
    Ok(themes_dir()?.join(theme_id))
}

fn existing_theme_path(theme_id: &str) -> Result<PathBuf, String> {
    let dir = theme_path(theme_id)?;
    if !dir.is_dir() {
        return Err(format!("Тема «{theme_id}» не найдена."));
    }
    Ok(dir)
}

fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_alphanumeric() || c == '_' {
            out.extend(c.to_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// `base`, or `base-2`, `base-3`, … if a folder with that name already exists.
fn unique_theme_id(base: &str) -> Result<String, String> {
    let dir = ensure_themes_dir()?;
    let base = if base.is_empty() {
        format!("theme-{}", rand::random::<u32>())
    } else {
        base.to_string()
    };
    if !dir.join(&base).exists() {
        return Ok(base);
    }
    for n in 2..1000 {
        let candidate = format!("{base}-{n}");
        if !dir.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Ok(format!("{base}-{}", rand::random::<u32>()))
}

pub fn is_valid_variable_name(name: &str) -> bool {
    name.len() > 2
        && name.starts_with("--")
        && name[2..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A value must not be able to close the `:root { }` block it is written into.
pub fn is_valid_variable_value(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1024 && !value.contains(['{', '}', ';'])
}

fn sanitize_variables(variables: BTreeMap<String, String>) -> BTreeMap<String, String> {
    variables
        .into_iter()
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .filter(|(k, v)| is_valid_variable_name(k) && is_valid_variable_value(v))
        .collect()
}

/// Writes through a temp file so an editor watching the file never sees it half written.
fn write_theme_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Некорректный путь: {}", path.display()))?;
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let tmp = parent.join(format!(".{file_name}.tmp-{}", std::process::id()));
    std::fs::write(&tmp, data).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Не удалось записать {file_name}: {e}")
    })?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Не удалось записать {file_name}: {e}")
    })
}

fn read_meta_object(theme_dir: &Path) -> Map<String, Value> {
    std::fs::read_to_string(theme_dir.join("theme.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')).ok())
        .and_then(|v| match v {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

fn find_preview(theme_dir: &Path, meta: &ThemeMeta) -> Option<String> {
    let declared = meta
        .preview
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty() && !p.contains("..") && !Path::new(p).is_absolute())
        .map(|p| theme_dir.join(p));
    declared
        .into_iter()
        .chain(PREVIEW_FILES.iter().map(|f| theme_dir.join(f)))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
}

fn read_theme_info(theme_dir: &Path) -> Option<ThemeInfo> {
    let id = theme_dir.file_name()?.to_str()?.to_string();
    let meta_path = theme_dir.join("theme.json");
    let style_path = theme_dir.join("style.css");

    if !meta_path.is_file() || !style_path.is_file() {
        return None;
    }

    let text = std::fs::read_to_string(&meta_path).ok()?;
    let meta: ThemeMeta =
        serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_default();
    let preview = find_preview(theme_dir, &meta);

    Some(ThemeInfo {
        name: if meta.name.trim().is_empty() {
            id.clone()
        } else {
            meta.name
        },
        id,
        author: meta.author,
        description: meta.description,
        version: meta.version,
        variables: sanitize_variables(meta.variables),
        preview,
    })
}

pub fn ensure_example_theme(app_handle: &tauri::AppHandle) {
    use tauri::Manager;

    let themes_root = match themes_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let _ = std::fs::create_dir_all(&themes_root);

    let resource_dir = match app_handle.path().resource_dir() {
        Ok(d) => d,
        Err(_) => return,
    };

    let bundled = resource_dir.join("themes");
    if !bundled.is_dir() {
        return;
    }

    let entries = match std::fs::read_dir(&bundled) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let source = entry.path();
        if !source.is_dir() {
            continue;
        }
        let Some(id) = source.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let dest = themes_root.join(id);
        if dest.is_dir() {
            continue;
        }
        if !source.join("theme.json").is_file() || !source.join("style.css").is_file() {
            continue;
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

/// Directory inside the archive that holds theme.json: the shallowest one, ignoring macOS metadata.
fn zip_theme_prefix<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<Option<String>, String> {
    let mut best: Option<String> = None;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения ZIP: {e}"))?;
        let name = entry.name().replace('\\', "/");
        if name.starts_with("__MACOSX/") {
            continue;
        }
        let prefix = if name == "theme.json" {
            ""
        } else if let Some(p) = name.strip_suffix("/theme.json") {
            p
        } else {
            continue;
        };
        let prefix = if prefix.is_empty() {
            String::new()
        } else {
            format!("{prefix}/")
        };
        let depth = prefix.matches('/').count();
        if best.as_ref().map_or(true, |b| depth < b.matches('/').count()) {
            best = Some(prefix);
        }
    }
    Ok(best)
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

    let Some(prefix) = zip_theme_prefix(&mut archive)? else {
        return Err("ZIP-архив не содержит theme.json.".to_string());
    };
    if archive.by_name(&format!("{prefix}style.css")).is_err() {
        return Err("ZIP-архив не содержит style.css рядом с theme.json.".to_string());
    }

    let zip_stem = zip_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let theme_id = zip_stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    let theme_id = theme_id.trim_matches('-').to_string();
    let theme_id = if theme_id.is_empty() {
        format!("theme-{}", rand::random::<u32>())
    } else {
        theme_id
    };

    let dest = ensure_themes_dir()?.join(&theme_id);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Не удалось создать папку темы: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения ZIP: {e}"))?;

        if entry.is_dir() {
            continue;
        }

        let name = entry.name().replace('\\', "/");
        let Some(relative) = name.strip_prefix(&prefix) else {
            continue;
        };

        if relative.is_empty()
            || relative.contains("..")
            || relative.starts_with('/')
            || relative.contains(':')
        {
            continue;
        }

        let target = dest.join(relative);
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
    let style_path = theme_path(&theme_id)?.join("style.css");
    if !style_path.is_file() {
        return Err(format!("Файл стилей темы «{theme_id}» не найден."));
    }
    std::fs::read_to_string(&style_path)
        .map_err(|e| format!("Не удалось прочитать style.css: {e}"))
}

/// Everything needed to apply or edit a theme in one call: metadata, variables, CSS and folder.
#[command]
pub fn get_theme(theme_id: String) -> Result<ThemeDetails, String> {
    let dir = existing_theme_path(&theme_id)?;
    let info = read_theme_info(&dir)
        .ok_or_else(|| format!("В теме «{theme_id}» нет theme.json или style.css."))?;
    let css = std::fs::read_to_string(dir.join("style.css"))
        .map_err(|e| format!("Не удалось прочитать style.css: {e}"))?;
    Ok(ThemeDetails {
        info,
        css,
        dir: dir.to_string_lossy().to_string(),
    })
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
    let id = sanitized.trim().replace(' ', "-").to_lowercase();
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
        version: "1.0".to_string(),
        ..ThemeMeta::default()
    };
    let mut meta_value = serde_json::to_value(&meta)
        .map_err(|e| format!("Ошибка сериализации theme.json: {e}"))?;
    if let Value::Object(map) = &mut meta_value {
        map.remove("preview");
        map.remove("variables");
    }
    let meta_json = serde_json::to_string_pretty(&meta_value)
        .map_err(|e| format!("Ошибка сериализации theme.json: {e}"))?;
    std::fs::write(theme_dir.join("theme.json"), meta_json)
        .map_err(|e| format!("Не удалось записать theme.json: {e}"))?;

    let default_css = r#"/* Ваш CSS-код здесь / Your CSS code here
 *
 * Цвета, скругления и шрифт удобнее менять в редакторе темы (вкладка «Оформление»):
 * они сохраняются в theme.json → "variables" и подставляются перед этим файлом.
 *
 * Примеры / Examples:
 * .glass-panel { border-color: var(--accent-line); }
 * [data-launcher-tab="play"] .launcher-gradient { background: url(assets/bg.jpg) center / cover; }
 */
"#;
    std::fs::write(theme_dir.join("style.css"), default_css)
        .map_err(|e| format!("Не удалось записать style.css: {e}"))?;

    read_theme_info(&theme_dir).ok_or_else(|| "Не удалось создать тему.".to_string())
}

/// Saves metadata and variables into theme.json (keeping fields the editor doesn't know about)
/// and, when given, the new style.css.
#[command]
pub fn save_theme(
    theme_id: String,
    meta: ThemeMetaInput,
    css: Option<String>,
) -> Result<ThemeInfo, String> {
    let dir = existing_theme_path(&theme_id)?;

    let mut object = read_meta_object(&dir);
    object.insert("name".into(), Value::String(meta.name.trim().to_string()));
    object.insert("author".into(), Value::String(meta.author.trim().to_string()));
    object.insert(
        "description".into(),
        Value::String(meta.description.trim().to_string()),
    );
    object.insert("version".into(), Value::String(meta.version.trim().to_string()));
    let variables = sanitize_variables(meta.variables);
    if variables.is_empty() {
        object.remove("variables");
    } else {
        let map: Map<String, Value> = variables
            .into_iter()
            .map(|(k, v)| (k, Value::String(v)))
            .collect();
        object.insert("variables".into(), Value::Object(map));
    }

    let meta_json = serde_json::to_string_pretty(&Value::Object(object))
        .map_err(|e| format!("Ошибка сериализации theme.json: {e}"))?;
    write_theme_file(&dir.join("theme.json"), meta_json.as_bytes())?;

    if let Some(css) = css {
        write_theme_file(&dir.join("style.css"), css.as_bytes())?;
    }

    read_theme_info(&dir).ok_or_else(|| "Не удалось прочитать сохранённую тему.".to_string())
}

#[command]
pub fn duplicate_theme(theme_id: String, name: String) -> Result<ThemeInfo, String> {
    let source = existing_theme_path(&theme_id)?;
    let name = name.trim().to_string();
    let new_id = unique_theme_id(&slugify(&name))?;
    let dest = ensure_themes_dir()?.join(&new_id);

    if let Err(e) = copy_dir_recursive(&source, &dest) {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(e);
    }

    let mut object = read_meta_object(&dest);
    object.insert("name".into(), Value::String(name));
    let meta_json = serde_json::to_string_pretty(&Value::Object(object))
        .map_err(|e| format!("Ошибка сериализации theme.json: {e}"))?;
    write_theme_file(&dest.join("theme.json"), meta_json.as_bytes())?;

    read_theme_info(&dest).ok_or_else(|| "Не удалось прочитать копию темы.".to_string())
}

/// Files that belong to the theme rather than to an editor or the OS.
fn is_theme_content_file(name: &str) -> bool {
    !(name.starts_with('.')
        || name.ends_with('~')
        || name.ends_with(".tmp")
        || name.ends_with(".bak")
        || name.ends_with(".swp")
        || name.eq_ignore_ascii_case("thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini"))
}

fn collect_theme_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > WATCH_MAX_DEPTH || out.len() >= WATCH_MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_theme_content_file(&name) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_theme_files(&path, depth + 1, out);
        } else if out.len() < WATCH_MAX_FILES {
            out.push(path);
        }
    }
}

#[command]
pub fn export_theme_zip(theme_id: String, dest_path: String) -> Result<(), String> {
    use zip::write::SimpleFileOptions;

    let dir = existing_theme_path(&theme_id)?;
    let mut files = Vec::new();
    collect_theme_files(&dir, 0, &mut files);

    let out = std::fs::File::create(&dest_path)
        .map_err(|e| format!("Не удалось создать архив: {e}"))?;
    let mut writer = zip::ZipWriter::new(out);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for path in files {
        let Ok(relative) = path.strip_prefix(&dir) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        let data = std::fs::read(&path)
            .map_err(|e| format!("Не удалось прочитать {relative}: {e}"))?;
        writer
            .start_file(format!("{theme_id}/{relative}"), opts)
            .map_err(|e| format!("Ошибка записи ZIP: {e}"))?;
        writer
            .write_all(&data)
            .map_err(|e| format!("Ошибка записи ZIP: {e}"))?;
    }

    writer
        .finish()
        .map_err(|e| format!("Ошибка записи ZIP: {e}"))?;
    Ok(())
}

/// Copies an image or font into `<theme>/assets/` and returns the path to use in `url(...)`.
#[command]
pub fn add_theme_asset(theme_id: String, source_path: String) -> Result<String, String> {
    let dir = existing_theme_path(&theme_id)?;
    let source = Path::new(&source_path);
    if !source.is_file() {
        return Err("Файл не найден.".to_string());
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if !ASSET_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Неподдерживаемый тип файла. Можно: {}.",
            ASSET_EXTENSIONS.join(", ")
        ));
    }

    let stem = source
        .file_stem()
        .map(|s| slugify(&s.to_string_lossy()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "asset".to_string());

    let assets = dir.join("assets");
    std::fs::create_dir_all(&assets)
        .map_err(|e| format!("Не удалось создать папку assets: {e}"))?;

    let mut file_name = format!("{stem}.{ext}");
    let mut n = 2;
    while assets.join(&file_name).exists() {
        file_name = format!("{stem}-{n}.{ext}");
        n += 1;
    }

    std::fs::copy(source, assets.join(&file_name))
        .map_err(|e| format!("Не удалось скопировать файл: {e}"))?;
    Ok(format!("assets/{file_name}"))
}

#[command]
pub fn delete_theme(theme_id: String) -> Result<(), String> {
    let theme_dir = existing_theme_path(&theme_id)?;
    std::fs::remove_dir_all(&theme_dir)
        .map_err(|e| format!("Не удалось удалить тему: {e}"))
}

#[command]
pub fn open_themes_folder() -> Result<(), String> {
    let dir = ensure_themes_dir()?;
    open::that(&dir).map_err(|e| format!("Не удалось открыть папку: {e}"))
}

#[command]
pub fn open_theme_folder(theme_id: String) -> Result<(), String> {
    let dir = existing_theme_path(&theme_id)?;
    open::that(&dir).map_err(|e| format!("Не удалось открыть папку: {e}"))
}

#[command]
pub fn open_theme_css_file(theme_id: String) -> Result<(), String> {
    let style_path = theme_path(&theme_id)?.join("style.css");
    if !style_path.is_file() {
        return Err(format!("Файл стилей темы «{theme_id}» не найден."));
    }
    open::that(&style_path).map_err(|e| format!("Не удалось открыть файл: {e}"))
}

#[command]
pub fn get_theme_dir(theme_id: String) -> Result<String, String> {
    let theme_dir = existing_theme_path(&theme_id)?;
    Ok(theme_dir.to_string_lossy().to_string())
}

/// Bumped on every `watch_theme` call; a watcher thread exits once it no longer owns the latest value.
static WATCH_GENERATION: AtomicU64 = AtomicU64::new(0);

fn theme_fingerprint(dir: &Path) -> u64 {
    let mut files = Vec::new();
    collect_theme_files(dir, 0, &mut files);
    let mut hasher = DefaultHasher::new();
    for path in files {
        path.hash(&mut hasher);
        if let Ok(meta) = std::fs::metadata(&path) {
            meta.len().hash(&mut hasher);
            if let Ok(modified) = meta.modified() {
                modified
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
                    .hash(&mut hasher);
            }
        }
    }
    hasher.finish()
}

/// Hot reload: polls the theme folder and emits `custom-theme-changed` when any file in it changes.
/// Polling (not OS notifications) because editors save via rename/replace in ways that native
/// watchers report inconsistently, and a theme folder is only a handful of files.
/// `theme_id: None` stops the current watcher.
#[command]
pub fn watch_theme(app: tauri::AppHandle, theme_id: Option<String>) -> Result<(), String> {
    let generation = WATCH_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(theme_id) = theme_id else {
        return Ok(());
    };
    let dir = existing_theme_path(&theme_id)?;

    std::thread::Builder::new()
        .name("theme-hot-reload".into())
        .spawn(move || {
            let mut last = theme_fingerprint(&dir);
            loop {
                std::thread::sleep(WATCH_INTERVAL);
                if WATCH_GENERATION.load(Ordering::SeqCst) != generation {
                    break;
                }
                if !dir.is_dir() {
                    break;
                }
                let current = theme_fingerprint(&dir);
                if current != last {
                    last = current;
                    let _ = app.emit(THEME_CHANGED_EVENT, &theme_id);
                }
            }
        })
        .map_err(|e| format!("Не удалось запустить отслеживание темы: {e}"))?;
    Ok(())
}

pub fn theme_exists(theme_id: &str) -> bool {
    theme_path(theme_id)
        .map(|theme_dir| {
            theme_dir.join("theme.json").is_file() && theme_dir.join("style.css").is_file()
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_like_theme_ids() {
        assert!(validate_theme_id("ocean-mint").is_ok());
        assert!(validate_theme_id("Тема_1").is_ok());
        for bad in ["", " ", "..", "../x", "a/b", "a\\b", "C:x", ".hidden"] {
            assert!(validate_theme_id(bad).is_err(), "{bad:?} must be rejected");
        }
    }

    #[test]
    fn variables_cannot_break_out_of_root_block() {
        let mut vars = BTreeMap::new();
        vars.insert("--accent-color".to_string(), " #10b981 ".to_string());
        vars.insert("--r-card".to_string(), "4px; } body { display: none".to_string());
        vars.insert("color".to_string(), "red".to_string());
        vars.insert("--empty".to_string(), "  ".to_string());
        let clean = sanitize_variables(vars);
        assert_eq!(clean.len(), 1);
        assert_eq!(clean.get("--accent-color").map(String::as_str), Some("#10b981"));
    }

    #[test]
    fn slugify_makes_folder_names() {
        assert_eq!(slugify("Ocean Mint"), "ocean-mint");
        assert_eq!(slugify("  Cool Theme (final)!! "), "cool-theme-final");
        assert_eq!(slugify("Моя тема"), "моя-тема");
    }
}
