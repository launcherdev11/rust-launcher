use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use ignore::gitignore::GitignoreBuilder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageFormat, RgbaImage};
use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sha2::{Digest as Sha2Digest, Sha512};
use tauri::{AppHandle, Emitter};
use zip::write::SimpleFileOptions;

use crate::app::paths::instance_dir_for_id;
use crate::models::profile::InstanceConfig;
use crate::services::game::cache;
use crate::services::modrinth::client::{modrinth_http_client, MODRINTH_API_BASE};
use crate::services::modrinth::types::{ModrinthVersion, ModrinthVersionFile, MODRINTH_USER_AGENT};

const VERSION_FILES_BATCH: usize = 96;

/// Paths that are never useful in a shared pack (launcher metadata / runtime junk).
const BUILTIN_MRPACK_IGNORES: &[&str] = &[
    "config.json",
    "settings.json",
    "logs/",
    "crash-reports/",
    ".cache/",
    "cache/",
    "natives/",
    "libraries/",
    ".fabric/",
    ".quilt/",
    "*.log",
];

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
    /// "modrinth" | "override"
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewResult {
    pub files: Vec<PreviewFile>,
    /// Approximate size of the .mrpack/.zip itself (embedded overrides + index).
    pub total_bytes: u64,
    /// Size of files referenced via Modrinth downloads (not embedded).
    pub download_bytes: u64,
    pub resolved_count: u32,
    pub override_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportResult {
    pub path: String,
    pub skipped_files: Vec<String>,
    pub resolved_count: u32,
    pub override_count: u32,
}

#[derive(Debug, Serialize)]
struct VersionFilesRequest {
    hashes: Vec<String>,
    algorithm: String,
}

#[derive(Debug, Clone)]
struct ResolvedMrpackFile {
    path: String,
    sha1: String,
    sha512: String,
    downloads: Vec<String>,
    file_size: u64,
}

fn to_rel_slash(root: &Path, p: &Path) -> Result<String, String> {
    Ok(p
        .strip_prefix(root)
        .map_err(|_| "Bad prefix")?
        .to_str()
        .ok_or_else(|| "Invalid UTF-8".to_string())?
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string())
    .map(|s| if s.is_empty() { ".".into() } else { s })
}

fn build_ignore(root: &Path, patterns: &[String]) -> Result<ignore::gitignore::Gitignore, String> {
    let mut b = GitignoreBuilder::new(root);
    for p in patterns {
        let p = p.trim();
        if !p.is_empty() {
            b.add_line(None, p).map_err(|e| e.to_string())?;
        }
    }
    b.build().map_err(|e| e.to_string())
}

fn is_ignored(gi: &ignore::gitignore::Gitignore, root: &Path, p: &Path) -> bool {
    p.strip_prefix(root).ok().map_or(false, |rel| {
        let m = gi.matched_path_or_any_parents(rel, p.is_dir());
        !m.is_whitelist() && m.is_ignore()
    })
}

fn merge_ignores(user: &[String], fmt: &str) -> Vec<String> {
    let mut out = Vec::new();
    if fmt == "mrpack" {
        out.extend(BUILTIN_MRPACK_IGNORES.iter().map(|s| (*s).to_string()));
    }
    for p in user {
        let t = p.trim();
        if !t.is_empty() && !out.iter().any(|x| x == t) {
            out.push(t.to_string());
        }
    }
    out
}

fn scan_dir(root: &Path, cur: &Path) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();
    for entry in std::fs::read_dir(cur).map_err(|e| e.to_string())? {
        let e = entry.map_err(|e| e.to_string())?;
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        let meta = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if meta.is_dir() {
            let children = scan_dir(root, &p)?;
            let size = children.iter().map(|c| c.size).sum();
            nodes.push(FileNode {
                path: to_rel_slash(root, &p)?,
                name,
                is_dir: true,
                size,
                children: Some(children),
            });
        } else if meta.is_file() {
            nodes.push(FileNode {
                path: to_rel_slash(root, &p)?,
                name,
                is_dir: false,
                size: meta.len(),
                children: None,
            });
        }
    }
    nodes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(nodes)
}

fn collect_files(
    root: &Path,
    selected: &[String],
    ignores: &[String],
) -> Result<Vec<(PathBuf, String, u64)>, String> {
    let gi = build_ignore(root, ignores)?;
    let mut out = Vec::new();

    for sp in selected {
        let sp = sp.trim().trim_start_matches('/');
        if sp.is_empty() {
            continue;
        }
        let abs = if sp == "." {
            root.to_path_buf()
        } else {
            root.join(sp)
        };
        if !abs.exists() {
            continue;
        }

        if abs.is_file() && !is_ignored(&gi, root, &abs) {
            let size = abs.metadata().map(|m| m.len()).unwrap_or(0);
            out.push((abs.clone(), to_rel_slash(root, &abs)?, size));
        } else if abs.is_dir() {
            let mut stack = vec![abs];
            while let Some(dir) = stack.pop() {
                if is_ignored(&gi, root, &dir) {
                    continue;
                }
                if let Ok(rd) = std::fs::read_dir(&dir) {
                    for e in rd.flatten() {
                        let p = e.path();
                        if is_ignored(&gi, root, &p) {
                            continue;
                        }
                        if let Ok(m) = e.metadata() {
                            if m.is_dir() {
                                stack.push(p);
                            } else if m.is_file() {
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
    std::fs::read_to_string(root.join("config.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn content_kind(rel: &str) -> Option<&'static str> {
    let rel = rel.replace('\\', "/");
    let lower = rel.to_ascii_lowercase();
    if lower.starts_with("mods/") {
        Some("mods")
    } else if lower.starts_with("resourcepacks/") {
        Some("resourcepacks")
    } else if lower.starts_with("shaderpacks/") {
        Some("shaderpacks")
    } else {
        None
    }
}

fn is_resolvable_pack_file(rel: &str) -> bool {
    let Some(kind) = content_kind(rel) else {
        return false;
    };
    let name = rel.rsplit('/').next().unwrap_or(rel).to_ascii_lowercase();
    // Skip nested junk inside content dirs.
    if name.starts_with('.') {
        return false;
    }
    match kind {
        "mods" => {
            name.ends_with(".jar")
                || name.ends_with(".jar.disabled")
                || name.ends_with(".zip")
                || name.ends_with(".zip.disabled")
        }
        "resourcepacks" | "shaderpacks" => {
            name.ends_with(".zip")
                || name.ends_with(".zip.disabled")
                || name.ends_with(".jar")
                || name.ends_with(".jar.disabled")
        }
        _ => false,
    }
}

fn pack_path_for_rel(rel: &str) -> String {
    let rel = rel.replace('\\', "/");
    let lower = rel.to_ascii_lowercase();
    if lower.ends_with(".disabled") {
        rel[..rel.len() - ".disabled".len()].to_string()
    } else {
        rel
    }
}

fn sha1_hex_file_sync(path: &Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| format!("SHA1 read {}: {e}", path.display()))?;
    let mut hasher = Sha1::new();
    Digest::update(&mut hasher, &data);
    Ok(format!("{:x}", Digest::finalize(hasher)))
}

fn sha512_hex_file_sync(path: &Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| format!("SHA512 read {}: {e}", path.display()))?;
    let mut hasher = Sha512::new();
    Sha2Digest::update(&mut hasher, &data);
    Ok(format!("{:x}", Sha2Digest::finalize(hasher)))
}

fn file_for_sha1<'a>(version: &'a ModrinthVersion, sha1: &str) -> Option<&'a ModrinthVersionFile> {
    let want = sha1.trim().to_ascii_lowercase();
    version
        .files
        .iter()
        .find(|f| f.sha1_hex().as_deref() == Some(want.as_str()))
        .or_else(|| {
            // Some API responses key the map by hash but only attach primary file metadata.
            version.primary_file().filter(|f| {
                f.sha1_hex()
                    .map(|h| h == want)
                    .unwrap_or(false)
                    || f.url.contains(&want)
            })
        })
}

async fn post_version_files_map(
    client: &reqwest::Client,
    hashes: &[String],
) -> Result<HashMap<String, ModrinthVersion>, String> {
    if hashes.is_empty() {
        return Ok(HashMap::new());
    }
    let body = VersionFilesRequest {
        hashes: hashes.to_vec(),
        algorithm: "sha1".to_string(),
    };
    let url = format!("{MODRINTH_API_BASE}/version_files");
    let resp = client
        .post(&url)
        .header(USER_AGENT, MODRINTH_USER_AGENT)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Modrinth version_files: сеть: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Modrinth version_files: HTTP {}", resp.status()));
    }
    resp.json::<HashMap<String, ModrinthVersion>>()
        .await
        .map_err(|e| format!("Modrinth version_files: JSON: {e}"))
}

async fn resolve_modrinth_entries(
    app: Option<&AppHandle>,
    files: &[(PathBuf, String, u64)],
) -> Result<(Vec<ResolvedMrpackFile>, HashSet<String>), String> {
    let candidates: Vec<&(PathBuf, String, u64)> = files
        .iter()
        .filter(|(_, rel, _)| is_resolvable_pack_file(rel))
        .collect();

    if candidates.is_empty() {
        return Ok((Vec::new(), HashSet::new()));
    }

    if let Some(app) = app {
        let _ = app.emit(
            "export-progress",
            serde_json::json!({
                "bytes_written": 0u64,
                "total_bytes": 0u64,
                "current_file": "Хеширование модов…"
            }),
        );
    }

    let mut sha_to_rels: HashMap<String, Vec<(usize, String, u64)>> = HashMap::new();
    for (idx, (abs, rel, size)) in candidates.iter().enumerate() {
        match sha1_hex_file_sync(abs) {
            Ok(sha1) => {
                sha_to_rels
                    .entry(sha1)
                    .or_default()
                    .push((idx, (*rel).clone(), *size));
            }
            Err(e) => {
                eprintln!("[export] skip hash {rel}: {e}");
            }
        }
    }

    let hashes: Vec<String> = sha_to_rels.keys().cloned().collect();
    let client = modrinth_http_client();
    let mut version_by_sha: HashMap<String, ModrinthVersion> = HashMap::new();

    if let Some(app) = app {
        let _ = app.emit(
            "export-progress",
            serde_json::json!({
                "bytes_written": 0u64,
                "total_bytes": 0u64,
                "current_file": "Поиск на Modrinth…"
            }),
        );
    }

    for chunk in hashes.chunks(VERSION_FILES_BATCH) {
        match post_version_files_map(&client, chunk).await {
            Ok(map) => {
                for (k, v) in map {
                    version_by_sha.insert(k.trim().to_ascii_lowercase(), v);
                }
            }
            Err(e) => {
                eprintln!("[export] Modrinth version_files batch failed: {e}");
            }
        }
    }

    let mut resolved = Vec::new();
    let mut resolved_rels = HashSet::new();

    for (sha1, entries) in sha_to_rels {
        let Some(version) = version_by_sha.get(&sha1) else {
            continue;
        };
        let Some(file) = file_for_sha1(version, &sha1) else {
            continue;
        };
        let url = file.url.trim();
        if url.is_empty() || !(url.starts_with("https://") || url.starts_with("http://")) {
            continue;
        }

        let sha512 = file
            .hashes
            .sha512
            .as_ref()
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty());

        for (_idx, rel, size) in entries {
            let pack_path = pack_path_for_rel(&rel);
            if resolved_rels.contains(&rel) || resolved.iter().any(|r: &ResolvedMrpackFile| r.path == pack_path)
            {
                resolved_rels.insert(rel);
                continue;
            }

            let sha512 = match &sha512 {
                Some(s) => s.clone(),
                None => {
                    // Fallback: hash local file (same bytes as Modrinth file).
                    let abs = files
                        .iter()
                        .find(|(_, r, _)| r == &rel)
                        .map(|(p, _, _)| p.clone());
                    match abs.and_then(|p| sha512_hex_file_sync(&p).ok()) {
                        Some(s) => s,
                        None => continue,
                    }
                }
            };

            resolved.push(ResolvedMrpackFile {
                path: pack_path,
                sha1: sha1.clone(),
                sha512,
                downloads: vec![url.to_string()],
                file_size: size,
            });
            resolved_rels.insert(rel);
        }
    }

    resolved.sort_by(|a, b| a.path.cmp(&b.path));
    Ok((resolved, resolved_rels))
}

fn build_manifest(
    id: &str,
    cfg: Option<&InstanceConfig>,
    resolved: &[ResolvedMrpackFile],
) -> Result<Vec<u8>, String> {
    let name = cfg.map(|c| c.name.clone()).unwrap_or_else(|| id.into());
    let ver = cfg.map(|c| c.game_version.clone()).unwrap_or_default();
    let loader = cfg.map(|c| c.loader.clone()).unwrap_or_else(|| "vanilla".into());
    let loader_ver = cfg
        .and_then(|c| c.loader_version.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "*".into());

    let loader_key = match loader.to_lowercase().as_str() {
        "fabric" => Some("fabric-loader"),
        "forge" => Some("forge"),
        "quilt" => Some("quilt-loader"),
        "neoforge" | "neo-forge" => Some("neoforge"),
        _ => None,
    };

    let mut deps = serde_json::Map::new();
    if !ver.is_empty() {
        deps.insert("minecraft".into(), ver.into());
    }
    if let Some(k) = loader_key {
        deps.insert(k.into(), loader_ver.into());
    }

    let files: Vec<serde_json::Value> = resolved
        .iter()
        .map(|f| {
            serde_json::json!({
                "path": f.path,
                "hashes": {
                    "sha1": f.sha1,
                    "sha512": f.sha512,
                },
                "env": {
                    "client": "required",
                    "server": "required",
                },
                "downloads": f.downloads,
                "fileSize": f.file_size,
            })
        })
        .collect();

    serde_json::to_vec_pretty(&serde_json::json!({
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": id,
        "name": name,
        "summary": "",
        "files": files,
        "dependencies": deps,
    }))
    .map_err(|e| e.to_string())
}

fn get_out_path(
    fmt: &str,
    opt: Option<String>,
    id: &str,
    cfg: Option<&InstanceConfig>,
) -> Result<PathBuf, String> {
    if let Some(p) = opt {
        return Ok(PathBuf::from(p));
    }
    let base = dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .ok_or("No download/desktop dir")?;

    let safe = cfg
        .map(|c| c.name.clone())
        .unwrap_or_else(|| id.into())
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");
    let ext = if fmt == "mrpack" { "mrpack" } else { "zip" };
    Ok(base.join(format!("{safe}-{id}.{ext}")))
}

#[tauri::command]
pub fn list_build_files(build_id: String) -> Result<Vec<FileNode>, String> {
    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() {
        return Err("Папка не найдена".into());
    }
    scan_dir(&root, &root)
}

#[tauri::command]
pub async fn preview_export(
    build_id: String,
    selected: Vec<String>,
    ignores: Vec<String>,
    format: Option<String>,
) -> Result<PreviewResult, String> {
    let fmt = if format
        .as_deref()
        .unwrap_or("mrpack")
        .trim()
        .eq_ignore_ascii_case("zip")
    {
        "zip"
    } else {
        "mrpack"
    };
    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() {
        return Err("Папка не найдена".into());
    }

    let merged = merge_ignores(&ignores, fmt);
    let files = collect_files(&root, &selected, &merged)?;

    if fmt != "mrpack" {
        let mut total = 0u64;
        let out: Vec<PreviewFile> = files
            .into_iter()
            .map(|(_, rel, size)| {
                total += size;
                PreviewFile {
                    path: rel,
                    size,
                    source: "override".into(),
                }
            })
            .collect();
        let override_count = out.len() as u32;
        return Ok(PreviewResult {
            files: out,
            total_bytes: total,
            download_bytes: 0,
            resolved_count: 0,
            override_count,
        });
    }

    let (resolved, resolved_rels) = resolve_modrinth_entries(None, &files).await?;
    let mut preview = Vec::new();
    let mut pack_bytes = 0u64;
    let mut download_bytes = 0u64;

    for r in &resolved {
        download_bytes += r.file_size;
        preview.push(PreviewFile {
            path: r.path.clone(),
            size: r.file_size,
            source: "modrinth".into(),
        });
    }

    for (_, rel, size) in &files {
        if resolved_rels.contains(rel) {
            continue;
        }
        pack_bytes += size;
        preview.push(PreviewFile {
            path: rel.clone(),
            size: *size,
            source: "override".into(),
        });
    }

    let cfg = load_cfg(&root);
    let manifest = build_manifest(&build_id, cfg.as_ref(), &resolved)?;
    pack_bytes += manifest.len() as u64;

    let resolved_count = resolved.len() as u32;
    let override_count = preview.iter().filter(|f| f.source == "override").count() as u32;

    preview.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then_with(|| a.path.cmp(&b.path))
    });

    Ok(PreviewResult {
        files: preview,
        total_bytes: pack_bytes,
        download_bytes,
        resolved_count,
        override_count,
    })
}

#[tauri::command]
pub async fn export_build(
    app: AppHandle,
    build_id: String,
    selected: Vec<String>,
    ignores: Vec<String>,
    format: String,
    out_path: Option<String>,
) -> Result<ExportResult, String> {
    let fmt = if format.trim().eq_ignore_ascii_case("mrpack") {
        "mrpack"
    } else {
        "zip"
    };
    let root = instance_dir_for_id(&build_id)?;
    if !root.exists() {
        return Err("Папка не найдена".into());
    }

    let cfg = load_cfg(&root);
    let out_path = get_out_path(fmt, out_path, &build_id, cfg.as_ref())?;
    if let Some(p) = out_path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }

    let merged = merge_ignores(&ignores, fmt);
    let files = collect_files(&root, &selected, &merged)?;

    let (resolved, resolved_rels) = if fmt == "mrpack" {
        resolve_modrinth_entries(Some(&app), &files).await?
    } else {
        (Vec::new(), HashSet::new())
    };

    let override_files: Vec<(PathBuf, String, u64)> = files
        .into_iter()
        .filter(|(_, rel, _)| !resolved_rels.contains(rel))
        .collect();

    let mut total: u64 = override_files.iter().map(|(_, _, s)| *s).sum();

    let manifest = if fmt == "mrpack" {
        let b = build_manifest(&build_id, cfg.as_ref(), &resolved)?;
        total += b.len() as u64;
        Some(b)
    } else {
        None
    };

    let f = File::create(&out_path).map_err(|e| {
        if e.raw_os_error() == Some(112) {
            "Недостаточно места".into()
        } else {
            e.to_string()
        }
    })?;

    let mut writer = zip::ZipWriter::new(f);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut written = 0u64;
    let mut skipped = Vec::new();
    let mut packed_overrides = 0u32;

    let emit_prog = |cur: &str, w: u64| {
        let _ = app.emit(
            "export-progress",
            serde_json::json!({
                "bytes_written": w,
                "total_bytes": total,
                "current_file": cur
            }),
        );
    };

    if let Some(mb) = &manifest {
        writer
            .start_file("modrinth.index.json", opts)
            .map_err(|e| e.to_string())?;
        writer.write_all(mb).map_err(|e| e.to_string())?;
        written += mb.len() as u64;
        emit_prog("modrinth.index.json", written);
    }

    let mut buf = [0u8; 128 * 1024];
    for (abs, rel, exp_size) in override_files {
        emit_prog(&rel, written);

        let meta = match abs.metadata() {
            Ok(m) => m,
            Err(_) => {
                skipped.push(rel);
                continue;
            }
        };
        if !meta.is_file() || meta.len() != exp_size {
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
        let arc_path = if fmt == "mrpack" {
            format!("overrides/{rel}")
        } else {
            rel.clone()
        };

        if writer.start_file(&arc_path, opts).is_err() {
            skipped.push(rel);
            continue;
        }

        let mut ok = true;
        loop {
            match src.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if writer.write_all(&buf[..n]).is_err() {
                        ok = false;
                        break;
                    }
                    written += n as u64;
                    emit_prog(&rel, written);
                }
                Err(_) => {
                    ok = false;
                    break;
                }
            }
        }
        if ok {
            packed_overrides += 1;
        } else {
            skipped.push(rel);
        }
    }

    writer.finish().map_err(|e| e.to_string())?;

    let path_str = out_path.to_str().ok_or("Invalid path")?.to_string();
    let resolved_count = resolved.len() as u32;

    let _ = app.emit(
        "export-finished",
        serde_json::json!({
            "path": &path_str,
            "skipped_files": &skipped,
            "resolved_count": resolved_count,
            "override_count": packed_overrides,
        }),
    );

    Ok(ExportResult {
        path: path_str,
        skipped_files: skipped,
        resolved_count,
        override_count: packed_overrides,
    })
}

const ELY_AVATAR_CACHE_TTL_SECS: u64 = 24 * 60 * 60;

fn ely_avatar_cache_dir() -> Result<PathBuf, String> {
    cache::ensure_launcher_cache_layout()?;
    Ok(cache::avatars_ely_cache_dir()?)
}

fn normalize_avatar_cache_key(username: &str) -> String {
    username
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn avatar_cache_file_path(username: &str) -> Result<PathBuf, String> {
    let key = normalize_avatar_cache_key(username);
    if key.is_empty() {
        return Err("Empty Ely username".to_string());
    }
    Ok(ely_avatar_cache_dir()?.join(format!("{key}.png")))
}

fn is_cache_fresh(path: &Path) -> bool {
    let meta = match std::fs::metadata(path) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let modified = match meta.modified() {
        Ok(v) => v,
        Err(_) => return false,
    };
    match SystemTime::now().duration_since(modified) {
        Ok(age) => age <= Duration::from_secs(ELY_AVATAR_CACHE_TTL_SECS),
        Err(_) => false,
    }
}

fn render_skin_head_png(skin_png: &[u8]) -> Result<Vec<u8>, String> {
    let skin = image::load_from_memory_with_format(skin_png, ImageFormat::Png)
        .map_err(|e| format!("Failed to decode skin PNG: {e}"))?;
    let (w, h) = skin.dimensions();
    if w < 64 || h < 16 {
        return Err(format!("Unexpected skin dimensions {w}x{h}"));
    }

    let base_face = skin.crop_imm(8, 8, 8, 8).to_rgba8();
    let hat = skin.crop_imm(40, 8, 8, 8).to_rgba8();

    let mut face = base_face;
    image::imageops::overlay(&mut face, &hat, 0, 0);
    let enlarged: RgbaImage = image::imageops::resize(&face, 64, 64, FilterType::Nearest);

    let mut out = std::io::Cursor::new(Vec::<u8>::new());
    DynamicImage::ImageRgba8(enlarged)
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|e| format!("Failed to encode avatar PNG: {e}"))?;
    Ok(out.into_inner())
}

async fn fetch_ely_skin(username: &str) -> Result<Vec<u8>, String> {
    let url = format!(
        "https://skinsystem.ely.by/skins/{}.png",
        urlencoding::encode(username)
    );
    let client = reqwest::Client::builder()
        .user_agent("mc16launcher/2.0")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ely request failed: {e}"))?;

    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::NO_CONTENT {
        return Err(format!("Ely skin unavailable: HTTP {status}"));
    }
    if !status.is_success() {
        return Err(format!("Ely skin bad response: HTTP {status}"));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read Ely skin body: {e}"))
}

fn png_data_url(png_bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(png_bytes)
    )
}

#[tauri::command]
pub async fn get_ely_skin(username: String) -> Result<Option<String>, String> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let skin_png = match fetch_ely_skin(trimmed).await {
        Ok(v) => v,
        Err(error) => {
            eprintln!("[skin] failed to fetch Ely skin for '{}': {}", trimmed, error);
            return Ok(None);
        }
    };

    Ok(Some(png_data_url(&skin_png)))
}

#[tauri::command]
pub async fn get_ely_avatar(username: String) -> Result<Option<String>, String> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let cache_path = avatar_cache_file_path(trimmed)?;

    if is_cache_fresh(&cache_path) {
        match std::fs::read(&cache_path) {
            Ok(bytes) => return Ok(Some(png_data_url(&bytes))),
            Err(error) => eprintln!("[avatar] failed to read Ely avatar cache: {error}"),
        }
    }

    let skin_png = match fetch_ely_skin(trimmed).await {
        Ok(v) => v,
        Err(error) => {
            eprintln!("[avatar] failed to fetch Ely skin for '{}': {}", trimmed, error);
            return Ok(None);
        }
    };
    let avatar_png = match render_skin_head_png(&skin_png) {
        Ok(v) => v,
        Err(error) => {
            eprintln!("[avatar] failed to build Ely avatar for '{}': {}", trimmed, error);
            return Ok(None);
        }
    };

    if let Err(error) = std::fs::write(&cache_path, &avatar_png) {
        eprintln!("[avatar] failed to write Ely avatar cache: {error}");
    }

    Ok(Some(png_data_url(&avatar_png)))
}

#[derive(Debug, Deserialize)]
struct McSessionProperty {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct McSessionProfile {
    #[serde(default)]
    properties: Vec<McSessionProperty>,
}

#[derive(Debug, Deserialize)]
struct McTexturesPayload {
    #[serde(default)]
    textures: McTexturesMap,
}

#[derive(Debug, Deserialize, Default)]
struct McTexturesMap {
    #[serde(default, rename = "SKIN")]
    skin: Option<McSkinTexture>,
}

#[derive(Debug, Deserialize)]
struct McSkinTexture {
    url: String,
}

fn normalize_mc_uuid_cache_key(uuid: &str) -> Result<String, String> {
    let key = uuid.trim().to_ascii_lowercase().replace('-', "");
    if key.len() != 32 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid Minecraft UUID".to_string());
    }
    Ok(key)
}

fn mc_avatar_cache_file_path(uuid: &str) -> Result<PathBuf, String> {
    let key = normalize_mc_uuid_cache_key(uuid)?;
    cache::ensure_launcher_cache_layout()?;
    Ok(cache::avatars_mc_cache_dir()?.join(format!("{key}.png")))
}

async fn fetch_mc_skin_png(uuid: &str) -> Result<Vec<u8>, String> {
    let key = normalize_mc_uuid_cache_key(uuid)?;
    let profile_url = format!(
        "https://sessionserver.mojang.com/session/minecraft/profile/{key}"
    );
    let client = reqwest::Client::builder()
        .user_agent("16Launcher/1.0")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let profile_resp = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Mojang profile request failed: {e}"))?;

    let status = profile_resp.status();
    if status == reqwest::StatusCode::NO_CONTENT || status == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("Mojang profile unavailable: HTTP {status}"));
    }
    if !status.is_success() {
        return Err(format!("Mojang profile bad response: HTTP {status}"));
    }

    let profile: McSessionProfile = profile_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Mojang profile: {e}"))?;

    let textures_value = profile
        .properties
        .into_iter()
        .find(|p| p.name == "textures")
        .ok_or_else(|| "Mojang profile has no textures".to_string())?
        .value;

    let decoded = BASE64_STANDARD
        .decode(textures_value.as_bytes())
        .map_err(|e| format!("Failed to decode Mojang textures: {e}"))?;
    let payload: McTexturesPayload = serde_json::from_slice(&decoded)
        .map_err(|e| format!("Failed to parse Mojang textures JSON: {e}"))?;

    let skin_url = payload
        .textures
        .skin
        .ok_or_else(|| "Mojang profile has no skin texture".to_string())?
        .url;

    let skin_resp = client
        .get(&skin_url)
        .send()
        .await
        .map_err(|e| format!("Mojang skin request failed: {e}"))?;

    let skin_status = skin_resp.status();
    if !skin_status.is_success() {
        return Err(format!("Mojang skin bad response: HTTP {skin_status}"));
    }

    skin_resp
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read Mojang skin body: {e}"))
}

#[tauri::command]
pub async fn get_mc_skin(uuid: String) -> Result<Option<String>, String> {
    let trimmed = uuid.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let skin_png = match fetch_mc_skin_png(trimmed).await {
        Ok(v) => v,
        Err(error) => {
            eprintln!("[skin] failed to fetch Mojang skin for '{trimmed}': {error}");
            return Ok(None);
        }
    };

    Ok(Some(png_data_url(&skin_png)))
}

#[tauri::command]
pub async fn get_mc_avatar(uuid: String) -> Result<Option<String>, String> {
    let trimmed = uuid.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let cache_path = mc_avatar_cache_file_path(trimmed)?;

    if is_cache_fresh(&cache_path) {
        match std::fs::read(&cache_path) {
            Ok(bytes) => return Ok(Some(png_data_url(&bytes))),
            Err(error) => eprintln!("[avatar] failed to read Mojang avatar cache: {error}"),
        }
    }

    let skin_png = match fetch_mc_skin_png(trimmed).await {
        Ok(v) => v,
        Err(error) => {
            eprintln!("[avatar] failed to fetch Mojang skin for '{trimmed}': {error}");
            return Ok(None);
        }
    };

    let avatar_png = match render_skin_head_png(&skin_png) {
        Ok(v) => v,
        Err(error) => {
            eprintln!("[avatar] failed to build Mojang avatar for '{trimmed}': {error}");
            return Ok(None);
        }
    };

    if let Err(error) = std::fs::write(&cache_path, &avatar_png) {
        eprintln!("[avatar] failed to write Mojang avatar cache: {error}");
    }

    Ok(Some(png_data_url(&avatar_png)))
}
