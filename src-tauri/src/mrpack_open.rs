use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub type PendingMrpackArc = Arc<Mutex<Option<String>>>;

#[derive(Clone, Serialize)]
pub struct MrpackOpenEventPayload {
    pub path: String,
}

pub fn pending_mrpack_new() -> PendingMrpackArc {
    Arc::new(Mutex::new(None))
}

fn path_from_cli_arg(arg: &str) -> Option<PathBuf> {
    let s = arg.trim();
    if s.is_empty() || s.starts_with('-') {
        return None;
    }
    let s = s
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(s)
        .trim();
    if s.is_empty() {
        return None;
    }
    
    if matches!(s.get(..5), Some(head) if head.eq_ignore_ascii_case("file:")) {
        if let Ok(u) = url::Url::parse(s) {
            if u.scheme() == "file" {
                return u.to_file_path().ok();
            }
        }
        return None;
    }
    Some(PathBuf::from(s))
}

pub fn is_mrpack_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("mrpack"))
        .unwrap_or(false)
}

pub fn first_mrpack_from_cli_args(args: impl Iterator<Item = String>) -> Option<PathBuf> {
    for arg in args {
        let p = path_from_cli_arg(&arg)?;
        if is_mrpack_path(&p) {
            return Some(p);
        }
    }
    None
}

pub fn stash_argv_mrpack_if_any(pending: &PendingMrpackArc) {
    if let Some(p) = first_mrpack_from_cli_args(std::env::args().skip(1)) {
        if let Ok(mut g) = pending.lock() {
            *g = Some(p.to_string_lossy().to_string());
        }
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn stash_mrpack_path(pending: &PendingMrpackArc, path: &Path) {
    if !is_mrpack_path(path) {
        return;
    }
    if let Ok(mut g) = pending.lock() {
        *g = Some(path.to_string_lossy().to_string());
    }
}

pub fn emit_mrpack_open_request(app: &AppHandle, path: String) {
    let _ = app.emit(
        "mrpack-open-request",
        MrpackOpenEventPayload { path },
    );
}

pub fn extract_mrpack_from_os_args(args: &[String]) -> Option<PathBuf> {
    for arg in args {
        let p = path_from_cli_arg(arg)?;
        if is_mrpack_path(&p) {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
pub fn take_pending_mrpack_open(pending: State<'_, PendingMrpackArc>) -> Option<String> {
    pending
        .inner()
        .lock()
        .ok()
        .and_then(|mut g| g.take())
}
