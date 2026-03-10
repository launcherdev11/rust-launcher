use std::{
    fs::File,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use ignore::gitignore::GitignoreBuilder;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use zip::write::SimpleFileOptions;

use crate::game_provider::{instance_dir_for_id, InstanceConfig};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub children: Option<Vec<FileNode>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewFile {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewResult {
    pub files: Vec<PreviewFile>,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportResult {
    pub path: String,
    pub skipped_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ExportProgressPayload {
    pub bytes_written: u64,
    pub total_bytes: u64,
    pub current_file: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ExportFinishedPayload {
    pub path: String,
    pub skipped_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ExportErrorPayload {
    pub message: String,
}

fn to_rel_slash_path(root: &Path, p: &Path) -> Result<String, String> {
    let rel = p
        .strip_prefix(root)
        .map_err(|_| "Не удалось получить относительный путь".to_string())?;
    let s = rel
        .to_string_lossy()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    Ok(if s.is_empty() { ".".to_string() } else { s })
}

fn build_gitignore(root: &Path, patterns: &[String]) -> Result<ignore::gitignore::Gitignore, String> {
    let mut b = GitignoreBuilder::new(root);
    for line in patterns {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        b.add_line(None, line)
            .map_err(|e| format!("Ошибка шаблона исключения '{line}': {e}"))?;
    }
    b.build()
        .map_err(|e| format!("Не удалось собрать правила исключений: {e}"))
}

fn is_ignored(gitignore: &ignore::gitignore::Gitignore, root: &Path, abs_path: &Path) -> bool {
    let rel = match abs_path.strip_prefix(root) {
        Ok(r) => r,
        Err(_) => return false,
    };
    let is_dir = abs_path.is_dir();
    let m = gitignore.matched_path_or_any_parents(rel, is_dir);
    if m.is_whitelist() {
        return false;
    }
    m.is_ignore()
}

fn scan_tree(root: &Path, current: &Path) -> Result<Vec<FileNode>, String> {
    let mut out = Vec::new();
    let entries = std::fs::read_dir(current)
        .map_err(|e| format!("Не удалось прочитать папку {:?}: {e}", current))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Ошибка чтения entry: {e}"))?;
        let p = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            let children = scan_tree(root, &p)?;
            let size = children.iter().map(|c| c.size).sum::<u64>();
            out.push(FileNode {
                path: to_rel_slash_path(root, &p)?,
                name,
                is_dir: true,
                size,
                children: Some(children),
            });
        } else if meta.is_file() {
            out.push(FileNode {
                path: to_rel_slash_path(root, &p)?,
                name,
                is_dir: false,
                size: meta.len(),
                children: None,
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn collect_files_for_selection(
    root: &Path,
    selected_paths: &[String],
    ignore_patterns: &[String],
) -> Result<Vec<(PathBuf, String, u64)>, String> {
    let gitignore = build_gitignore(root, ignore_patterns)?;
    let mut out: Vec<(PathBuf, String, u64)> = Vec::new();

    let mut push_file = |abs: PathBuf, rel: String, size: u64| {
        out.push((abs, rel, size));
    };

    for sp in selected_paths {
        let sp_trim = sp.trim().trim_start_matches('/');
        if sp_trim.is_empty() {
            continue;
        }
        let abs = if sp_trim == "." {
            root.to_path_buf()
        } else {
            root.join(sp_trim)
        };
        if !abs.exists() {
            continue;
        }

        if abs.is_file() {
            if is_ignored(&gitignore, root, &abs) {
                continue;
            }
            let size = abs.metadata().map(|m| m.len()).unwrap_or(0);
            let rel = to_rel_slash_path(root, &abs)?;
            push_file(abs, rel, size);
        } else if abs.is_dir() {
            let mut stack = vec![abs];
            while let Some(dir) = stack.pop() {
                if is_ignored(&gitignore, root, &dir) {
                    continue;
                }
                let rd = match std::fs::read_dir(&dir) {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                for e in rd.flatten() {
                    let p = e.path();
                    if is_ignored(&gitignore, root, &p) {
                        continue;
                    }
                    if let Ok(m) = e.metadata() {
                        if m.is_dir() {
                            stack.push(p);
                        } else if m.is_file() {
                            let rel = match to_rel_slash_path(root, &p) {
                                Ok(s) => s,
                                Err(_) => continue,
                            };
                            push_file(p, rel, m.len());
                        }
                    }
                }
            }
        }
    }

    out.sort_by(|a, b| a.1.cmp(&b.1));
    out.dedup_by(|a, b| a.1 == b.1);
    Ok(out)
}

fn load_instance_config(build_root: &Path) -> Option<InstanceConfig> {
    let p = build_root.join("config.json");
    let text = std::fs::read_to_string(p).ok()?;
    serde_json::from_str::<InstanceConfig>(&text).ok()
}

fn build_manifest_json(
    build_id: &str,
    cfg: Option<&InstanceConfig>,
    _build_root: &Path,
    selected_files: &[(PathBuf, String, u64)],
) -> Result<Vec<u8>, String> {
    let name = cfg
        .map(|c| c.name.clone())
        .unwrap_or_else(|| build_id.to_string());
    let game_version = cfg
        .map(|c| c.game_version.clone())
        .unwrap_or_default();
    let loader_raw = cfg
        .map(|c| c.loader.clone())
        .unwrap_or_else(|| "vanilla".to_string());

    let loader_dep_key = match loader_raw.to_lowercase().as_str() {
        "fabric" => Some("fabric-loader"),
        "forge" => Some("forge"),
        "quilt" => Some("quilt-loader"),
        "neoforge" | "neo-forge" => Some("neoforge"),
        _ => None,
    };

    let _total_override_files = selected_files.len();

    let mut deps = serde_json::Map::new();
    if !game_version.is_empty() {
        deps.insert("minecraft".to_string(), serde_json::Value::String(game_version));
    }
    if let Some(key) = loader_dep_key {
        deps.insert(key.to_string(), serde_json::Value::String("*".to_string()));
    }

    let obj = serde_json::json!({
        "formatVersion": 1,
        "game": "minecraft",
        "name": name,
        "versionId": build_id,
        "summary": "",
        "dependencies": deps,
        "files": [],
    });

    serde_json::to_vec_pretty(&obj).map_err(|e| format!("Не удалось сериализовать modrinth.index.json: {e}"))
}

fn normalize_out_path(
    format: &str,
    out_path: Option<String>,
    build_id: &str,
    cfg: Option<&InstanceConfig>,
) -> Result<PathBuf, String> {
    if let Some(p) = out_path {
        return Ok(PathBuf::from(p));
    }
    let base = dirs::download_dir().or_else(dirs::desktop_dir).ok_or_else(|| {
        "Не удалось определить папку для экспорта (Downloads/Desktop)".to_string()
    })?;
    let safe_name = cfg
        .map(|c| c.name.clone())
        .unwrap_or_else(|| build_id.to_string())
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");
    let ext = if format == "mrpack" { "mrpack" } else { "zip" };
    Ok(base.join(format!("{safe_name}-{build_id}.{ext}")))
}

fn is_no_space_error(e: &io::Error) -> bool {
    e.raw_os_error() == Some(112)
}

#[tauri::command]
pub fn list_build_files(build_id: String) -> Result<Vec<FileNode>, String> {
    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    scan_tree(&root, &root)
}

#[tauri::command]
pub fn preview_export(
    build_id: String,
    selected_paths: Vec<String>,
    ignore_patterns: Vec<String>,
) -> Result<PreviewResult, String> {
    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    let files = collect_files_for_selection(&root, &selected_paths, &ignore_patterns)?;
    let mut out_files = Vec::with_capacity(files.len());
    let mut total = 0u64;
    for (_, rel, size) in files {
        total = total.saturating_add(size);
        out_files.push(PreviewFile { path: rel, size });
    }
    Ok(PreviewResult {
        files: out_files,
        total_bytes: total,
    })
}

#[tauri::command]
pub fn export_build(
    app: AppHandle,
    build_id: String,
    selected_paths: Vec<String>,
    ignore_patterns: Vec<String>,
    format: String,
    out_path: Option<String>,
) -> Result<ExportResult, String> {
    let fmt = format.trim().to_lowercase();
    let fmt = if fmt == "mrpack" { "mrpack" } else { "zip" };

    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() {
        return Err("Папка сборки не найдена".to_string());
    }

    let cfg = load_instance_config(&root);
    let out_path = normalize_out_path(fmt, out_path, &build_id, cfg.as_ref())?;
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для экспорта: {e}"))?;
    }

    let selected_files = collect_files_for_selection(&root, &selected_paths, &ignore_patterns)?;
    let mut total_bytes: u64 = selected_files.iter().map(|(_, _, s)| *s).sum();

    let manifest_bytes = if fmt == "mrpack" {
        let b = build_manifest_json(&build_id, cfg.as_ref(), &root, &selected_files)?;
        total_bytes = total_bytes.saturating_add(b.len() as u64);
        Some(b)
    } else {
        None
    };

    let f = File::create(&out_path).map_err(|e| {
        if is_no_space_error(&e) {
            "Недостаточно места на диске для создания архива.".to_string()
        } else {
            format!("Не удалось создать файл архива: {e}")
        }
    })?;

    let mut writer = zip::ZipWriter::new(f);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut bytes_written = 0u64;
    let mut skipped: Vec<String> = Vec::new();

    let emit_progress = |app: &AppHandle, current_file: &str, bytes_written: u64, total_bytes: u64| {
        let _ = app.emit(
            "export-progress",
            ExportProgressPayload {
                bytes_written,
                total_bytes,
                current_file: current_file.to_string(),
            },
        );
    };

    if let Some(mb) = manifest_bytes.as_ref() {
        writer
            .start_file("modrinth.index.json", options)
            .map_err(|e| format!("Не удалось добавить modrinth.index.json: {e}"))?;
        writer
            .write_all(mb)
            .map_err(|e| format!("Не удалось записать modrinth.index.json: {e}"))?;
        bytes_written = bytes_written.saturating_add(mb.len() as u64);
        emit_progress(&app, "modrinth.index.json", bytes_written, total_bytes);
    }

    for (abs, rel, expected_size) in selected_files {
        let archive_path = if fmt == "mrpack" {
            format!("overrides/{rel}")
        } else {
            rel.clone()
        };

        emit_progress(&app, &rel, bytes_written, total_bytes);

        let meta = match abs.metadata() {
            Ok(m) => m,
            Err(_) => {
                skipped.push(rel);
                continue;
            }
        };
        if !meta.is_file() {
            continue;
        }
        if meta.len() != expected_size {
            skipped.push(rel);
            continue;
        }

        let mut src = match File::open(&abs) {
            Ok(f) => f,
            Err(_) => {
                skipped.push(rel);
                continue;
            }
        };

        if let Err(e) = writer.start_file(&archive_path, options) {
            let msg = format!("Не удалось добавить файл '{archive_path}' в архив: {e}");
            let _ = app.emit("export-error", ExportErrorPayload { message: msg.clone() });
            return Err(msg);
        }

        let mut buf = [0u8; 1024 * 128];
        let mut wrote_for_file = 0u64;
        let mut had_error = false;
        loop {
            let n = match src.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => {
                    skipped.push(rel.clone());
                    had_error = true;
                    break;
                }
            };
            if let Err(e) = writer.write_all(&buf[..n]) {
                let msg = if is_no_space_error(&e) {
                    "Недостаточно места на диске для записи архива.".to_string()
                } else {
                    format!("Ошибка записи архива: {e}")
                };
                let _ = app.emit("export-error", ExportErrorPayload { message: msg.clone() });
                return Err(msg);
            }
            wrote_for_file = wrote_for_file.saturating_add(n as u64);
            bytes_written = bytes_written.saturating_add(n as u64);
            emit_progress(&app, &rel, bytes_written, total_bytes);
        }

        if !had_error && wrote_for_file != expected_size {
            skipped.push(rel);
        }
    }

    if let Err(e) = writer.finish() {
        let msg = format!("Не удалось завершить архив: {e}");
        let _ = app.emit("export-error", ExportErrorPayload { message: msg.clone() });
        return Err(msg);
    }

    let out_str = out_path
        .to_str()
        .ok_or("Путь результата не в UTF-8")?
        .to_string();

    let _ = app.emit(
        "export-finished",
        ExportFinishedPayload {
            path: out_str.clone(),
            skipped_files: skipped.clone(),
        },
    );

    Ok(ExportResult {
        path: out_str,
        skipped_files: skipped,
    })
}

