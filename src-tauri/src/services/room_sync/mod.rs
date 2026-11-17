mod options;
mod paths;
mod platform;
mod scan;

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tauri::command;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::app::paths::{instance_config_path, instance_dir, launcher_data_dir};
use crate::services::game::config_files::snapshot_config_version;
use crate::services::game::content_snapshots::UpdateSnapshot;
use crate::services::game::profiles::{
    profile_item_display_name, profile_item_is_disabled, profile_item_stored_name,
    read_instance_config,
};
use crate::services::modrinth::curseforge_file_fingerprint;

pub use options::SyncOptions;
pub use paths::SyncFileKind;
use paths::{classify, CONFIG_ROOTS, CRAFTTWEAKER_DIR, KUBEJS_DIRS, PACK_ROOTS};

const MAX_FILES: usize = 20_000;
const MAX_CONFIG_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_SCRIPT_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ASSET_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_READ_CHUNK: u64 = 256 * 1024;
const MAX_STAGE_CHUNK: usize = 8 * 1024 * 1024;
const STAGE_MAX_AGE_SECS: u64 = 24 * 60 * 60;
const KEEP_BACKUPS: usize = 5;
const PART_SUFFIX: &str = ".part";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFile {
    pub path: String,
    pub sha1: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifest {
    pub game_version: String,
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub shares_configs: bool,
    #[serde(default)]
    pub options: Option<SyncOptions>,
    pub files: Vec<SyncFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedFile {
    #[serde(flatten)]
    pub file: SyncFile,
    pub kind: SyncFileKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub stage_id: String,
    pub host_game_version: String,
    pub host_loader: String,
    pub local_game_version: String,
    pub local_loader: String,
    pub version_mismatch: bool,
    pub missing: Vec<PlannedFile>,
    pub enable: Vec<String>,
    pub extra_mods: Vec<String>,
    pub extra_scripts: Vec<String>,
    pub options: Option<SyncOptions>,
    pub options_differ: bool,
    pub unchanged: usize,
    pub rejected: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncApplyResult {
    pub mods: u32,
    pub packs: u32,
    pub configs: u32,
    pub scripts: u32,
    pub assets: u32,
    pub disabled: u32,
    pub enabled: u32,
    pub removed_scripts: u32,
    pub options: bool,
    pub backup_dir: Option<String>,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha1_hex(bytes: &[u8]) -> String {
    hex(&Sha1::digest(bytes))
}

fn sha1_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

fn stages_root() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("room-sync"))
}

fn stage_dir(stage_id: &str) -> Result<PathBuf, String> {
    if stage_id.len() != 16 || !stage_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Некорректный идентификатор синхронизации".to_string());
    }
    Ok(stages_root()?.join(stage_id))
}

fn staged_path(stage_id: &str, rel: &str) -> Result<(PathBuf, SyncFileKind), String> {
    let kind = classify(rel).ok_or_else(|| format!("Недопустимый путь: {rel}"))?;
    Ok((stage_dir(stage_id)?.join(rel), kind))
}

fn prune_old_dirs(root: &Path, max_age_secs: u64) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    let now = now_secs();
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .is_some_and(|t| now.saturating_sub(t.as_secs()) > max_age_secs);
        if old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn walk_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > paths::MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        let path = entry.path();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            walk_files(&path, depth + 1, out);
        } else if file_type.is_file() {
            out.push(path);
        }
    }
}

fn flat_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        if is_file && !profile_item_is_disabled(&entry.file_name().to_string_lossy()) {
            out.push(entry.path());
        }
    }
}

fn script_dirs(root: &Path) -> Vec<PathBuf> {
    KUBEJS_DIRS
        .iter()
        .map(|d| root.join("kubejs").join(d))
        .chain(std::iter::once(root.join(CRAFTTWEAKER_DIR)))
        .collect()
}

fn rel_path(base: &Path, path: &Path) -> Option<String> {
    Some(path.strip_prefix(base).ok()?.to_str()?.replace('\\', "/"))
}

#[derive(Default)]
struct TextBudget {
    config: u64,
    script: u64,
    asset: u64,
}

impl TextBudget {
    fn take(&mut self, kind: SyncFileKind, size: u64) -> bool {
        let (used, limit) = match kind {
            SyncFileKind::Config => (&mut self.config, MAX_CONFIG_TOTAL_BYTES),
            SyncFileKind::Script => (&mut self.script, MAX_SCRIPT_TOTAL_BYTES),
            SyncFileKind::Asset => (&mut self.asset, MAX_ASSET_TOTAL_BYTES),
            _ => return true,
        };
        if *used + size > limit {
            return false;
        }
        *used += size;
        true
    }
}

fn build_manifest(profile_id: &str, include_configs: bool) -> Result<SyncManifest, String> {
    let root = instance_dir(profile_id)?;
    let cfg = read_instance_config(&instance_config_path(profile_id)?)?;

    let mut candidates: Vec<PathBuf> = Vec::new();
    flat_files(&root.join("mods"), &mut candidates);
    for dir in PACK_ROOTS {
        walk_files(&root.join(dir), 1, &mut candidates);
    }
    if include_configs {
        for dir in CONFIG_ROOTS {
            walk_files(&root.join(dir), 1, &mut candidates);
        }
        for dir in script_dirs(&root) {
            walk_files(&dir, 2, &mut candidates);
        }
    }

    let mut files = Vec::new();
    let mut budget = TextBudget::default();
    for path in candidates {
        if files.len() >= MAX_FILES {
            break;
        }
        let Some(rel) = rel_path(&root, &path) else { continue };
        let Some(kind) = classify(&rel) else { continue };
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(u64::MAX);
        if size > kind.max_bytes() || !budget.take(kind, size) {
            continue;
        }
        let entry = if kind == SyncFileKind::Mod {
            let Ok(bytes) = std::fs::read(&path) else { continue };
            SyncFile {
                sha1: sha1_hex(&bytes),
                size: bytes.len() as u64,
                fingerprint: Some(curseforge_file_fingerprint(&bytes)),
                path: rel,
            }
        } else {
            let Ok(sha1) = sha1_file(&path) else { continue };
            SyncFile {
                sha1,
                size,
                fingerprint: None,
                path: rel,
            }
        };
        files.push(entry);
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(SyncManifest {
        game_version: cfg.game_version.trim().to_string(),
        loader: cfg.loader.trim().to_ascii_lowercase(),
        loader_version: cfg.loader_version,
        shares_configs: include_configs,
        options: Some(options::read_options(&root)),
        files,
    })
}

#[command]
pub async fn room_sync_manifest(profile_id: String, include_configs: bool) -> Result<SyncManifest, String> {
    tokio::task::spawn_blocking(move || build_manifest(&profile_id, include_configs))
        .await
        .map_err(|e| format!("Сбор списка файлов прерван: {e}"))?
}

fn read_shared_chunk(
    profile_id: &str,
    rel: &str,
    offset: u64,
    length: u64,
    include_configs: bool,
) -> Result<Vec<u8>, String> {
    use std::io::{Seek, SeekFrom};

    let kind = classify(rel).ok_or_else(|| format!("Файл нельзя передать: {rel}"))?;
    if kind.needs_config_share() && !include_configs {
        return Err("Передача конфигов и скриптов выключена".to_string());
    }
    let root = instance_dir(profile_id)?;
    let path = root.join(rel);
    let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("Файл недоступен: {e}"))?;
    if !meta.is_file() || meta.len() > kind.max_bytes() {
        return Err(format!("Файл нельзя передать: {rel}"));
    }
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    if !path.canonicalize().map_err(|e| e.to_string())?.starts_with(&canonical_root) {
        return Err(format!("Файл нельзя передать: {rel}"));
    }

    let mut file = std::fs::File::open(&path).map_err(|e| format!("Файл недоступен: {e}"))?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(length.min(MAX_READ_CHUNK) as usize);
    file.take(length.min(MAX_READ_CHUNK))
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

#[command]
pub async fn room_sync_read_file(
    profile_id: String,
    path: String,
    offset: u64,
    length: u64,
    include_configs: bool,
) -> Result<Response, String> {
    let bytes = tokio::task::spawn_blocking(move || {
        read_shared_chunk(&profile_id, &path, offset, length, include_configs)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

fn index_mods(dir: &Path) -> HashMap<String, (String, bool)> {
    let mut out = HashMap::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let stored = entry.file_name().to_string_lossy().to_string();
        if let Ok(sha1) = sha1_file(&entry.path()) {
            out.insert(
                profile_item_display_name(&stored),
                (sha1, !profile_item_is_disabled(&stored)),
            );
        }
    }
    out
}

fn local_scripts(root: &Path) -> Vec<String> {
    let mut found = Vec::new();
    for dir in script_dirs(root) {
        walk_files(&dir, 2, &mut found);
    }
    found
        .iter()
        .filter_map(|p| rel_path(root, p))
        .filter(|rel| classify(rel) == Some(SyncFileKind::Script))
        .collect()
}

fn new_stage_id() -> String {
    use rand::{distributions::Alphanumeric, Rng};
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect()
}

fn build_plan(profile_id: &str, manifest: SyncManifest) -> Result<SyncPlan, String> {
    let root = instance_dir(profile_id)?;
    let cfg = read_instance_config(&instance_config_path(profile_id)?)?;
    let local_game_version = cfg.game_version.trim().to_string();
    let local_loader = cfg.loader.trim().to_ascii_lowercase();

    let local_mods = index_mods(&root.join("mods"));
    let mut local_by_sha: HashMap<&str, Vec<(&str, bool)>> = HashMap::new();
    for (name, (sha1, enabled)) in &local_mods {
        local_by_sha.entry(sha1.as_str()).or_default().push((name.as_str(), *enabled));
    }

    let mut missing = Vec::new();
    let mut enable = Vec::new();
    let mut rejected = Vec::new();
    let mut unchanged = 0usize;
    let mut host_mod_hashes = HashSet::new();
    let mut host_paths = HashSet::new();
    let mut budget = TextBudget::default();

    for file in manifest.files.into_iter().take(MAX_FILES) {
        let kind = classify(&file.path);
        let valid_hash = file.sha1.len() == 40 && file.sha1.chars().all(|c| c.is_ascii_hexdigit());
        let Some(kind) = kind.filter(|k| valid_hash && file.size <= k.max_bytes()) else {
            rejected.push(file.path);
            continue;
        };
        if !host_paths.insert(file.path.to_ascii_lowercase()) || !budget.take(kind, file.size) {
            rejected.push(file.path);
            continue;
        }
        if kind.needs_config_share() && !manifest.shares_configs {
            rejected.push(file.path);
            continue;
        }
        let file = SyncFile {
            sha1: file.sha1.to_ascii_lowercase(),
            ..file
        };
        if kind == SyncFileKind::Mod {
            host_mod_hashes.insert(file.sha1.clone());
            match local_by_sha.get(file.sha1.as_str()) {
                Some(copies) if copies.iter().any(|(_, enabled)| *enabled) => unchanged += 1,
                Some(copies) => {
                    enable.push(copies[0].0.to_string());
                    unchanged += 1;
                }
                None => missing.push(PlannedFile { file, kind }),
            }
            continue;
        }
        let same = sha1_file(&root.join(&file.path))
            .map(|sha1| sha1 == file.sha1)
            .unwrap_or(false);
        if same {
            unchanged += 1;
        } else {
            missing.push(PlannedFile { file, kind });
        }
    }

    let mut extra_mods: Vec<String> = local_mods
        .iter()
        .filter(|(name, (sha1, enabled))| {
            *enabled && !host_mod_hashes.contains(sha1) && classify(&format!("mods/{name}")).is_some()
        })
        .map(|(name, _)| name.clone())
        .collect();
    extra_mods.sort();

    let mut extra_scripts: Vec<String> = if manifest.shares_configs {
        local_scripts(&root)
            .into_iter()
            .filter(|rel| !host_paths.contains(&rel.to_ascii_lowercase()))
            .collect()
    } else {
        Vec::new()
    };
    extra_scripts.sort();

    let options = manifest.options.and_then(options::sanitize);
    let options_differ = options
        .as_ref()
        .is_some_and(|o| *o != options::read_options(&root));

    prune_old_dirs(&stages_root()?, STAGE_MAX_AGE_SECS);
    let stage_id = new_stage_id();
    std::fs::create_dir_all(stage_dir(&stage_id)?)
        .map_err(|e| format!("Не удалось создать временную папку: {e}"))?;

    Ok(SyncPlan {
        stage_id,
        version_mismatch: manifest.game_version != local_game_version || manifest.loader != local_loader,
        host_game_version: manifest.game_version,
        host_loader: manifest.loader,
        local_game_version,
        local_loader,
        missing,
        enable,
        extra_mods,
        extra_scripts,
        options,
        options_differ,
        unchanged,
        rejected,
    })
}

#[command]
pub async fn room_sync_plan(profile_id: String, manifest: SyncManifest) -> Result<SyncPlan, String> {
    tokio::task::spawn_blocking(move || build_plan(&profile_id, manifest))
        .await
        .map_err(|e| format!("Сравнение сборок прервано: {e}"))?
}

#[command]
pub async fn room_sync_fetch_platform(stage_id: String, files: Vec<SyncFile>) -> Result<Vec<String>, String> {
    let stage = stage_dir(&stage_id)?;
    let archives: Vec<SyncFile> = files
        .into_iter()
        .filter(|f| classify(&f.path).is_some_and(SyncFileKind::is_archive))
        .collect();
    Ok(platform::fetch_from_platforms(&stage, &archives).await)
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .ok_or_else(|| format!("Нет заголовка {name}"))
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(PART_SUFFIX);
    dest.with_file_name(name)
}

#[command]
pub async fn room_sync_stage_chunk(request: Request<'_>) -> Result<(), String> {
    let stage_id = header(&request, "x-stage-id")?;
    let rel = urlencoding::decode(&header(&request, "x-path")?)
        .map_err(|_| "Некорректный путь".to_string())?
        .into_owned();
    let offset: u64 = header(&request, "x-offset")?
        .parse()
        .map_err(|_| "Некорректное смещение".to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Ожидались двоичные данные".to_string());
    };
    if bytes.len() > MAX_STAGE_CHUNK {
        return Err("Слишком большой кусок файла".to_string());
    }
    let (dest, kind) = staged_path(&stage_id, &rel)?;
    if offset + bytes.len() as u64 > kind.max_bytes() {
        return Err(format!("Файл слишком большой: {rel}"));
    }
    let part = part_path(&dest);
    if let Some(parent) = part.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = if offset == 0 {
        std::fs::File::create(&part)
    } else {
        std::fs::OpenOptions::new().append(true).open(&part)
    }
    .map_err(|e| e.to_string())?;
    let current = file.metadata().map_err(|e| e.to_string())?.len();
    if current != offset {
        return Err(format!("Нарушен порядок передачи: {rel}"));
    }
    file.write_all(bytes).map_err(|e| e.to_string())
}

#[command]
pub async fn room_sync_stage_finish(stage_id: String, path: String, sha1: String, size: u64) -> Result<(), String> {
    let (dest, _) = staged_path(&stage_id, &path)?;
    tokio::task::spawn_blocking(move || {
        let part = part_path(&dest);
        let len = std::fs::metadata(&part).map(|m| m.len()).map_err(|e| e.to_string())?;
        let actual = sha1_file(&part).map_err(|e| e.to_string())?;
        if len != size || !actual.eq_ignore_ascii_case(&sha1) {
            let _ = std::fs::remove_file(&part);
            return Err(format!("Контрольная сумма не совпала: {path}"));
        }
        std::fs::rename(&part, &dest).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn staged_archives(stage_id: &str, paths: &[String]) -> Result<Vec<scan::Archive>, String> {
    let mut out = Vec::new();
    for rel in paths {
        let (path, kind) = staged_path(stage_id, rel)?;
        if kind.is_archive() && path.is_file() {
            out.push(scan::Archive {
                rel: rel.clone(),
                path,
                kind,
            });
        }
    }
    Ok(out)
}

#[command]
pub async fn room_sync_inspect(stage_id: String, paths: Vec<String>) -> Result<scan::InspectReport, String> {
    let archives = staged_archives(&stage_id, &paths)?;
    tokio::task::spawn_blocking(move || scan::inspect_archives(&archives))
        .await
        .map_err(|e| e.to_string())
}

fn move_into_place(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map_err(|e| format!("Не удалось скопировать {}: {e}", to.display()))?;
    let _ = std::fs::remove_file(from);
    Ok(())
}

struct BackupDir {
    root: PathBuf,
    used: bool,
}

impl BackupDir {
    fn new(profile_id: &str) -> Result<Self, String> {
        if !profile_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err("Некорректный id сборки".to_string());
        }
        let base = launcher_data_dir()?.join("room-sync-backups").join(profile_id);
        Ok(Self {
            root: base.join(now_secs().to_string()),
            used: false,
        })
    }

    fn keep(&mut self, rel: &str, source: &Path, move_original: bool) -> Result<(), String> {
        let target = self.root.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if move_original {
            move_into_place(source, &target)?;
        } else {
            std::fs::copy(source, &target).map_err(|e| e.to_string())?;
        }
        self.used = true;
        Ok(())
    }

    fn finish(self) -> Option<String> {
        let base = self.root.parent().map(Path::to_path_buf);
        if let Some(base) = base {
            let mut all: Vec<PathBuf> = std::fs::read_dir(&base)
                .map(|rd| rd.flatten().map(|e| e.path()).collect())
                .unwrap_or_default();
            all.sort();
            let excess = all.len().saturating_sub(KEEP_BACKUPS);
            for old in all.into_iter().take(excess) {
                let _ = std::fs::remove_dir_all(old);
            }
        }
        self.used.then(|| self.root.display().to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    profile_id: String,
    stage_id: String,
    files: Vec<String>,
    disable: Vec<String>,
    enable: Vec<String>,
    remove_scripts: Vec<String>,
    options: Option<SyncOptions>,
}

fn apply_stage(req: ApplyRequest) -> Result<SyncApplyResult, String> {
    let profile_id = req.profile_id.as_str();
    let root = instance_dir(profile_id)?;
    let mods_dir = root.join("mods");
    let mut staged = Vec::new();
    for rel in &req.files {
        let (path, kind) = staged_path(&req.stage_id, rel)?;
        if !path.is_file() {
            return Err(format!("Файл не получен: {rel}"));
        }
        staged.push((rel.clone(), path, kind));
    }

    let archives = staged_archives(&req.stage_id, &req.files)?;
    if scan::inspect_archives(&archives).files.iter().any(|f| f.blocked) {
        return Err("Среди файлов есть заблокированные, установка отменена".to_string());
    }

    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    let snapshot = UpdateSnapshot::begin(profile_id, "mods", &mods_dir)?;
    let mut backup = BackupDir::new(profile_id)?;
    let mut result = SyncApplyResult::default();

    for name in &req.disable {
        let path = mods_dir.join(name);
        if classify(&format!("mods/{name}")).is_none() || !path.is_file() {
            continue;
        }
        let disabled_name = profile_item_stored_name(name, false);
        snapshot.stash_copy(&path, &disabled_name);
        if std::fs::rename(&path, mods_dir.join(&disabled_name)).is_ok() {
            result.disabled += 1;
        }
    }
    for name in &req.enable {
        let disabled_path = mods_dir.join(profile_item_stored_name(name, false));
        if classify(&format!("mods/{name}")).is_none() || !disabled_path.is_file() {
            continue;
        }
        snapshot.stash_copy(&disabled_path, name);
        if std::fs::rename(&disabled_path, mods_dir.join(name)).is_ok() {
            result.enabled += 1;
        }
    }
    for rel in &req.remove_scripts {
        let path = root.join(rel);
        if classify(rel) == Some(SyncFileKind::Script) && path.is_file() {
            backup.keep(rel, &path, true)?;
            result.removed_scripts += 1;
        }
    }

    for (rel, path, kind) in &staged {
        let dest = root.join(rel);
        match kind {
            SyncFileKind::Mod => {
                let name = profile_item_display_name(
                    dest.file_name().and_then(|n| n.to_str()).unwrap_or_default(),
                );
                if dest.is_file() {
                    snapshot.stash_copy(&dest, &name);
                }
                let disabled_twin = mods_dir.join(profile_item_stored_name(&name, false));
                if disabled_twin.is_file() {
                    snapshot.stash_move(&disabled_twin, None);
                }
                result.mods += 1;
            }
            SyncFileKind::Config => {
                if dest.is_file() {
                    snapshot_config_version(profile_id, rel, &dest)?;
                }
                result.configs += 1;
            }
            SyncFileKind::Pack | SyncFileKind::Script | SyncFileKind::Asset => {
                if dest.is_file() {
                    backup.keep(rel, &dest, false)?;
                }
                match kind {
                    SyncFileKind::Script => result.scripts += 1,
                    SyncFileKind::Asset => result.assets += 1,
                    _ => result.packs += 1,
                }
            }
        }
        move_into_place(path, &dest)?;
    }

    if let Some(opts) = req.options.and_then(options::sanitize) {
        let options_path = root.join("options.txt");
        if options_path.is_file() {
            backup.keep("options.txt", &options_path, false)?;
        }
        options::apply_options(&root, &opts)?;
        result.options = true;
    }

    snapshot.finish();
    result.backup_dir = backup.finish();
    let _ = std::fs::remove_dir_all(stage_dir(&req.stage_id)?);
    Ok(result)
}

#[command]
pub async fn room_sync_apply(request: ApplyRequest) -> Result<SyncApplyResult, String> {
    tokio::task::spawn_blocking(move || apply_stage(request))
        .await
        .map_err(|e| format!("Установка прервана: {e}"))?
}

#[command]
pub fn room_sync_discard(stage_id: String) -> Result<(), String> {
    let dir = stage_dir(&stage_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::paths::{MAX_CONFIG_BYTES, MAX_MOD_BYTES};
    use super::*;

    #[test]
    fn stage_id_must_be_plain_alphanumeric() {
        assert!(stage_dir("abcdEFGH12345678").is_ok());
        assert!(stage_dir("../../../../etc!").is_err());
        assert!(stage_dir("short").is_err());
    }

    #[test]
    fn sha1_matches_known_value() {
        assert_eq!(sha1_hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
    }

    #[test]
    fn streaming_sha1_matches_in_memory() {
        let path = std::env::temp_dir().join(format!("room-sync-sha-{}", new_stage_id()));
        let data: Vec<u8> = (0..700_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &data).unwrap();
        assert_eq!(sha1_file(&path).unwrap(), sha1_hex(&data));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn size_limits_follow_kind() {
        assert_eq!(SyncFileKind::Mod.max_bytes(), MAX_MOD_BYTES);
        assert_eq!(SyncFileKind::Config.max_bytes(), MAX_CONFIG_BYTES);
    }

    #[test]
    fn text_budget_caps_each_category() {
        let mut budget = TextBudget::default();
        assert!(budget.take(SyncFileKind::Config, MAX_CONFIG_TOTAL_BYTES));
        assert!(!budget.take(SyncFileKind::Config, 1));
        assert!(budget.take(SyncFileKind::Script, 1));
        assert!(budget.take(SyncFileKind::Asset, MAX_ASSET_TOTAL_BYTES));
        assert!(!budget.take(SyncFileKind::Asset, 1));
        assert!(budget.take(SyncFileKind::Pack, u64::MAX / 2));
    }
}
