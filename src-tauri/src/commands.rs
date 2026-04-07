use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use ignore::gitignore::GitignoreBuilder;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use zip::write::SimpleFileOptions;

use crate::game_provider::{instance_dir_for_id, InstanceConfig};

// Models
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub path: String, pub name: String, pub is_dir: bool, pub size: u64,
    pub children: Option<Vec<FileNode>>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewFile { pub path: String, pub size: u64 }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewResult { pub files: Vec<PreviewFile>, pub total_bytes: u64 }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportResult { pub path: String, pub skipped_files: Vec<String> }

// Helpers
fn io_err(e: io::Error) -> String { e.to_string() }

fn to_rel_slash(root: &Path, p: &Path) -> Result<String, String> {
    p.strip_prefix(root)
        .map_err(|_| "Bad prefix")?
        .to_str()
        .ok_or("Invalid UTF-8")
        .map(|s| s.replace('\\', "/").trim_start_matches("./").to_string())
        .map(|s| if s.is_empty() { ".".into() } else { s })
}

fn build_ignore(root: &Path, patterns: &[String]) -> Result<ignore::gitignore::Gitignore, String> {
    let mut b = GitignoreBuilder::new(root);
    for p in patterns {
        let p = p.trim();
        if !p.is_empty() { b.add_line(None, p).map_err(|e| e.to_string())?; }
    }
    b.build().map_err(|e| e.to_string())
}

fn is_ignored(gi: &ignore::gitignore::Gitignore, root: &Path, p: &Path) -> bool {
    p.strip_prefix(root).ok().map_or(false, |rel| {
        let m = gi.matched_path_or_any_parents(rel, p.is_dir());
        !m.is_whitelist() && m.is_ignore()
    })
}

fn scan_dir(root: &Path, cur: &Path) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();
    for entry in std::fs::read_dir(cur).map_err(io_err)? {
        let e = entry.map_err(io_err)?;
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        let meta = match e.metadata() { Ok(m) => m, Err(_) => continue };
        
        if meta.is_dir() {
            let children = scan_dir(root, &p)?;
            let size = children.iter().map(|c| c.size).sum();
            nodes.push(FileNode {
                path: to_rel_slash(root, &p)?, name, is_dir: true, size,
                children: Some(children),
            });
        } else if meta.is_file() {
            nodes.push(FileNode {
                path: to_rel_slash(root, &p)?, name, is_dir: false,
                size: meta.len(), children: None,
            });
        }
    }
    nodes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(nodes)
}

fn collect_files(root: &Path, selected: &[String], ignores: &[String]) -> Result<Vec<(PathBuf, String, u64)>, String> {
    let gi = build_ignore(root, ignores)?;
    let mut out = Vec::new();
    
    for sp in selected {
        let sp = sp.trim().trim_start_matches('/');
        if sp.is_empty() { continue; }
        let abs = if sp == "." { root.to_path_buf() } else { root.join(sp) };
        if !abs.exists() { continue; }

        if abs.is_file() && !is_ignored(&gi, root, &abs) {
            let size = abs.metadata().map(|m| m.len()).unwrap_or(0);
            out.push((abs.clone(), to_rel_slash(root, &abs)?, size));
        } else if abs.is_dir() {
            let mut stack = vec![abs];
            while let Some(dir) = stack.pop() {
                if is_ignored(&gi, root, &dir) { continue; }
                if let Ok(rd) = std::fs::read_dir(&dir) {
                    for e in rd.flatten() {
                        let p = e.path();
                        if is_ignored(&gi, root, &p) { continue; }
                        if let Ok(m) = e.metadata() {
                            if m.is_dir() { stack.push(p); }
                            else if m.is_file() {
                                if let Ok(rel) = to_rel_slash(root, &p) {
                                    out.push((p, rel, m.len()));
                                }
                            }
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

fn load_cfg(root: &Path) -> Option<InstanceConfig> {
    std::fs::read_to_string(root.join("config.json")).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn build_manifest(id: &str, cfg: Option<&InstanceConfig>, files: &[(PathBuf, String, u64)]) -> Result<Vec<u8>, String> {
    let name = cfg.map(|c| c.name.clone()).unwrap_or_else(|| id.into());
    let ver = cfg.map(|c| c.game_version.clone()).unwrap_or_default();
    let loader = cfg.map(|c| c.loader.clone()).unwrap_or_else(|| "vanilla".into());
    
    let loader_key = match loader.to_lowercase().as_str() {
        "fabric" => Some("fabric-loader"), "forge" => Some("forge"),
        "quilt" => Some("quilt-loader"), "neoforge" | "neo-forge" => Some("neoforge"),
        _ => None,
    };

    let mut deps = serde_json::Map::new();
    if !ver.is_empty() { deps.insert("minecraft".into(), ver.into()); }
    if let Some(k) = loader_key { deps.insert(k.into(), "*".into()); }

    serde_json::to_vec_pretty(&serde_json::json!({
        "formatVersion": 1, "game": "minecraft", "name": name,
        "versionId": id, "summary": "", "dependencies": deps, "files": []
    })).map_err(|e| e.to_string())
}

fn get_out_path(fmt: &str, opt: Option<String>, id: &str, cfg: Option<&InstanceConfig>) -> Result<PathBuf, String> {
    if let Some(p) = opt { return Ok(PathBuf::from(p)); }
    let base = dirs::download_dir().or_else(dirs::desktop_dir).ok_or("No download/desktop dir")?;
    let safe = cfg.map(|c| c.name).unwrap_or_else(|| id.into())
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");
    let ext = if fmt == "mrpack" { "mrpack" } else { "zip" };
    Ok(base.join(format!("{safe}-{id}.{ext}")))
}

fn is_no_space(e: &io::Error) -> bool { e.raw_os_error() == Some(112) }

// Commands

#[tauri::command]
pub fn list_build_files(build_id: String) -> Result<Vec<FileNode>, String> {
    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() { return Err("Папка не найдена".into()); }
    scan_dir(&root, &root)
}

#[tauri::command]
pub fn preview_export(build_id: String, selected: Vec<String>, ignores: Vec<String>) -> Result<PreviewResult, String> {
    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() { return Err("Папка не найдена".into()); }
    
    let files = collect_files(&root, &selected, &ignores)?;
    let mut total = 0u64;
    let out = files.into_iter().map(|(_, rel, size)| {
        total += size;
        PreviewFile { path: rel, size }
    }).collect();
    
    Ok(PreviewResult { files: out, total_bytes: total })
}

#[tauri::command]
pub fn export_build(
    app: AppHandle, build_id: String, selected: Vec<String>, ignores: Vec<String>,
    format: String, out_path: Option<String>,
) -> Result<ExportResult, String> {
    let fmt = if format.trim().to_lowercase() == "mrpack" { "mrpack" } else { "zip" };
    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() { return Err("Папка не найдена".into()); }

    let cfg = load_cfg(&root);
    let out_path = get_out_path(fmt, out_path, &build_id, cfg.as_ref())?;
    if let Some(p) = out_path.parent() { std::fs::create_dir_all(p).map_err(io_err)?; }

    let files = collect_files(&root, &selected, &ignores)?;
    let mut total: u64 = files.iter().map(|(_, _, s)| *s).sum();

    let manifest = if fmt == "mrpack" {
        let b = build_manifest(&build_id, cfg.as_ref(), &files)?;
        total += b.len() as u64;
        Some(b)
    } else { None };

    let f = File::create(&out_path).map_err(|e| {
        if is_no_space(&e) { "Недостаточно места".into() } else { io_err(e) }
    })?;

    let mut writer = zip::ZipWriter::new(f);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut written = 0u64;
    let mut skipped = Vec::new();

    let emit_prog = |cur: &str, w: u64| {
        let _ = app.emit("export-progress", serde_json::json!({
            "bytes_written": w, "total_bytes": total, "current_file": cur
        }));
    };

    if let Some(mb) = &manifest {
        writer.start_file("modrinth.index.json", opts).map_err(io_err)?;
        writer.write_all(mb).map_err(io_err)?;
        written += mb.len() as u64;
        emit_prog("modrinth.index.json", written);
    }

    let mut buf = [0u8; 128 * 1024];
    for (abs, rel, exp_size) in files {
        emit_prog(&rel, written);
        
        let meta = match abs.metadata() { Ok(m) => m, Err(_) => { skipped.push(rel); continue; } };
        if !meta.is_file() || meta.len() != exp_size { skipped.push(rel); continue; }

        let mut src = match File::open(&abs) { Ok(f) => f, Err(_) => { skipped.push(rel); continue; } };
        let arc_path = if fmt == "mrpack" { format!("overrides/{rel}") } else { rel.clone() };

        if writer.start_file(&arc_path, opts).is_err() { skipped.push(rel); continue; }

        let mut ok = true;
        loop {
            match src.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if writer.write_all(&buf[..n]).is_err() { ok = false; break; }
                    written += n as u64;
                    emit_prog(&rel, written);
                }
                Err(_) => { ok = false; break; }
            }
        }
        if !ok { skipped.push(rel); }
    }

    writer.finish().map_err(io_err)?;
    
    let path_str = out_path.to_str().ok_or("Invalid path")?.to_string();
    let _ = app.emit("export-finished", serde_json::json!({
        "path": &path_str, "skipped_files": &skipped
    }));

    Ok(ExportResult { path: path_str, skipped_files: skipped })
}