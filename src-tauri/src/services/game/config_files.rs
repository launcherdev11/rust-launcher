use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::command;

use crate::app::paths::{instance_dir, launcher_data_dir};
use crate::infra::fs_atomic::write_atomic;
use crate::services::game::core::safe_join;

const ROOT_DIRS: &[&str] = &["config", "defaultconfigs", "kubejs/config"];
const ROOT_FILES: &[&str] = &["options.txt", "optionsof.txt", "optionsshaders.txt", "server.properties"];
const EXTENSIONS: &[&str] = &[
    "toml", "json", "json5", "jsonc", "cfg", "conf", "properties", "yaml", "yml", "txt", "ini", "snbt",
];
const MAX_DEPTH: usize = 8;
const MAX_FILES: usize = 6000;
const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;
const KEEP_VERSIONS: usize = 25;
const MAX_SEARCH_HITS: usize = 400;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFileEntry {
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFileContent {
    pub content: String,
    pub modified_ms: u64,
    pub lossy: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigVersion {
    pub id: String,
    pub saved_at_ms: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSearchHit {
    pub path: String,
    pub line_no: u64,
    pub line: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigValidation {
    pub ok: bool,
    pub line: Option<u64>,
    pub message: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn has_config_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

fn normalize_rel(rel: &str) -> String {
    rel.replace('\\', "/").trim_start_matches("./").to_string()
}

fn resolve_config_path(profile_id: &str, rel: &str) -> Result<(PathBuf, String), String> {
    let rel = normalize_rel(rel);
    let allowed_root = ROOT_FILES.contains(&rel.as_str())
        || ROOT_DIRS.iter().any(|d| rel.starts_with(&format!("{d}/")));
    if !allowed_root {
        return Err("Этот файл нельзя открыть в редакторе конфигов".to_string());
    }
    let dir = instance_dir(profile_id)?;
    let path = safe_join(&dir, &rel).ok_or("Некорректный путь к файлу")?;
    if !has_config_extension(&path) {
        return Err("Неподдерживаемый тип файла".to_string());
    }
    Ok((path, rel))
}

fn walk(dir: &Path, base: &Path, depth: usize, out: &mut Vec<ConfigFileEntry>) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            walk(&path, base, depth + 1, out);
        } else if ft.is_file() && has_config_extension(&path) {
            let Ok(rel) = path.strip_prefix(base) else { continue };
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(ConfigFileEntry {
                path: rel.to_string_lossy().replace('\\', "/"),
                size,
                modified_ms: modified_ms(&path),
            });
        }
    }
}

fn history_dir(profile_id: &str, rel: &str) -> Result<PathBuf, String> {
    if !profile_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Некорректный id сборки".to_string());
    }
    let mut h = DefaultHasher::new();
    rel.hash(&mut h);
    let file_name = Path::new(rel)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .take(48)
        .collect::<String>();
    Ok(launcher_data_dir()?
        .join("config-history")
        .join(profile_id)
        .join(format!("{file_name}-{:016x}", h.finish())))
}

fn snapshot_current(profile_id: &str, rel: &str, path: &Path) -> Result<(), String> {
    let Ok(bytes) = fs::read(path) else {
        return Ok(());
    };
    let dir = history_dir(profile_id, rel)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку истории: {e}"))?;
    let mut existing = list_version_files(&dir);
    if let Some((_, last)) = existing.first() {
        if fs::read(last).ok().as_deref() == Some(bytes.as_slice()) {
            return Ok(());
        }
    }
    write_atomic(&dir.join(format!("{}.bak", now_ms())), &bytes)?;
    existing = list_version_files(&dir);
    for (_, old) in existing.into_iter().skip(KEEP_VERSIONS) {
        let _ = fs::remove_file(old);
    }
    Ok(())
}

fn list_version_files(dir: &Path) -> Vec<(u64, PathBuf)> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<(u64, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let stem = p.file_name()?.to_str()?.strip_suffix(".bak")?.parse::<u64>().ok()?;
            Some((stem, p))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

#[command]
pub async fn list_config_files(profile_id: String) -> Result<Vec<ConfigFileEntry>, String> {
    let dir = instance_dir(&profile_id)?;
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for f in ROOT_FILES {
            let p = dir.join(f);
            if p.is_file() {
                out.push(ConfigFileEntry {
                    path: (*f).to_string(),
                    size: fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
                    modified_ms: modified_ms(&p),
                });
            }
        }
        for root in ROOT_DIRS {
            walk(&dir.join(root), &dir, 0, &mut out);
        }
        out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        out
    })
    .await
    .map_err(|e| format!("Ошибка чтения конфигов: {e}"))
}

#[command]
pub async fn read_config_file(profile_id: String, path: String) -> Result<ConfigFileContent, String> {
    let (full, _) = resolve_config_path(&profile_id, &path)?;
    let meta = fs::metadata(&full).map_err(|e| format!("Файл недоступен: {e}"))?;
    if meta.len() > MAX_EDIT_BYTES {
        return Err("Файл слишком большой для редактора".to_string());
    }
    let bytes = fs::read(&full).map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    let (content, lossy) = match String::from_utf8(bytes) {
        Ok(s) => (s, false),
        Err(e) => (String::from_utf8_lossy(e.as_bytes()).into_owned(), true),
    };
    Ok(ConfigFileContent {
        content,
        modified_ms: modified_ms(&full),
        lossy,
    })
}

#[command]
pub async fn save_config_file(
    profile_id: String,
    path: String,
    content: String,
    expected_modified_ms: Option<u64>,
    force: Option<bool>,
) -> Result<u64, String> {
    let (full, rel) = resolve_config_path(&profile_id, &path)?;
    if content.len() as u64 > MAX_EDIT_BYTES {
        return Err("Файл слишком большой для редактора".to_string());
    }
    if !force.unwrap_or(false) {
        if let Some(expected) = expected_modified_ms {
            let actual = modified_ms(&full);
            if actual != 0 && actual != expected {
                return Err("CONFLICT".to_string());
            }
        }
    }
    snapshot_current(&profile_id, &rel, &full)?;
    write_atomic(&full, content.as_bytes())?;
    Ok(modified_ms(&full))
}

#[command]
pub async fn list_config_versions(profile_id: String, path: String) -> Result<Vec<ConfigVersion>, String> {
    let (_, rel) = resolve_config_path(&profile_id, &path)?;
    let dir = history_dir(&profile_id, &rel)?;
    Ok(list_version_files(&dir)
        .into_iter()
        .map(|(ts, p)| ConfigVersion {
            id: ts.to_string(),
            saved_at_ms: ts,
            size: fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
        })
        .collect())
}

#[command]
pub async fn read_config_version(profile_id: String, path: String, version_id: String) -> Result<String, String> {
    let (_, rel) = resolve_config_path(&profile_id, &path)?;
    let ts: u64 = version_id.parse().map_err(|_| "Некорректная версия")?;
    let file = history_dir(&profile_id, &rel)?.join(format!("{ts}.bak"));
    let bytes = fs::read(&file).map_err(|e| format!("Версия недоступна: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[command]
pub async fn search_config_files(profile_id: String, query: String) -> Result<Vec<ConfigSearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.len() < 2 {
        return Ok(Vec::new());
    }
    let files = list_config_files(profile_id.clone()).await?;
    let dir = instance_dir(&profile_id)?;
    tokio::task::spawn_blocking(move || {
        let mut hits = Vec::new();
        for f in files {
            if f.size > MAX_EDIT_BYTES {
                continue;
            }
            let Some(full) = safe_join(&dir, &f.path) else { continue };
            let Ok(file) = fs::File::open(&full) else { continue };
            for (idx, line) in BufReader::new(file).lines().enumerate() {
                let Ok(line) = line else { break };
                if line.to_lowercase().contains(&needle) {
                    hits.push(ConfigSearchHit {
                        path: f.path.clone(),
                        line_no: idx as u64 + 1,
                        line: line.trim().chars().take(240).collect(),
                    });
                    if hits.len() >= MAX_SEARCH_HITS {
                        return hits;
                    }
                }
            }
        }
        hits
    })
    .await
    .map_err(|e| format!("Ошибка поиска по конфигам: {e}"))
}

#[command]
pub fn validate_config_toml(content: String) -> ConfigValidation {
    match content.parse::<toml::Table>() {
        Ok(_) => ConfigValidation { ok: true, line: None, message: None },
        Err(e) => {
            let line = e.span().map(|span| content[..span.start.min(content.len())].matches('\n').count() as u64 + 1);
            ConfigValidation {
                ok: false,
                line,
                message: Some(e.message().to_string()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toml_validation_reports_line() {
        let ok = validate_config_toml("[a]\nb = 1\n".to_string());
        assert!(ok.ok);
        let bad = validate_config_toml("[a]\nb = 1\nc = \n".to_string());
        assert!(!bad.ok);
        assert_eq!(bad.line, Some(3));
    }

    #[test]
    fn extension_filter() {
        assert!(has_config_extension(Path::new("config/a.toml")));
        assert!(has_config_extension(Path::new("config/a.JSON")));
        assert!(!has_config_extension(Path::new("config/a.jar")));
        assert!(!has_config_extension(Path::new("config/noext")));
    }

    #[test]
    fn rel_normalization() {
        assert_eq!(normalize_rel(r"config\sodium.json"), "config/sodium.json");
        assert_eq!(normalize_rel("./options.txt"), "options.txt");
    }
}
